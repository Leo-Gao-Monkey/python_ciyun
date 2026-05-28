"""Kiosk 词云本地服务器：静态文件 + SSE 实时同步 API"""

from __future__ import annotations

import http.server
import json
import queue
import socket
import socketserver
import sys
import threading
import time
import webbrowser
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = WEB_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))

try:
    from segment_lib import HAS_JIEBA, segment_list
except ImportError:
    HAS_JIEBA = False

    def segment_list(text: str, stopwords=None) -> list[str]:  # type: ignore
        return []

try:
    from transcribe_lib import get_status as transcribe_status, transcribe_bytes, warm_up as transcribe_warm_up
    HAS_TRANSCRIBE = True
except ImportError:
    HAS_TRANSCRIBE = False

    def transcribe_status() -> dict:  # type: ignore
        return {"available": False, "error": "transcribe_lib 未找到"}

    def transcribe_bytes(data: bytes, suffix: str = ".webm") -> str:  # type: ignore
        raise RuntimeError("语音识别模块不可用")

    def transcribe_warm_up() -> None:  # type: ignore
        pass

STATE_FILE = WEB_DIR / "data" / "sync-state.json"
DEFAULT_PORTS = (8765, 8766, 8767, 8080, 3000)

DEFAULT_STATE = {
    "revision": 0,
    "background": "gradient-1",
    "customBgImage": None,
    "shapeMask": "circle",
    "customMaskImage": None,
    "updatedAt": "",
}

VISUAL_SYNC_KEYS = (
    "background",
    "customBgImage",
    "shapeMask",
    "customMaskImage",
)


class StateManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state = dict(DEFAULT_STATE)
        self._subscribers: list[queue.Queue] = []
        self._load()

    def _load(self) -> None:
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        if STATE_FILE.exists():
            try:
                data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
                with self._lock:
                    self._state.update(data)
            except (json.JSONDecodeError, OSError):
                pass

    def _persist(self) -> None:
        try:
            STATE_FILE.write_text(
                json.dumps(self._state, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError:
            pass

    def get(self) -> dict:
        with self._lock:
            return dict(self._state)

    def update(self, incoming: dict) -> dict:
        with self._lock:
            old_rev = self._state.get("revision", 0)
            new_rev = incoming.get("revision", 0)
            changed = False

            if new_rev > old_rev:
                for key in VISUAL_SYNC_KEYS:
                    if key in incoming:
                        self._state[key] = incoming[key]
                self._state["revision"] = new_rev
                changed = True

            if not changed:
                return dict(self._state)

            self._state["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            snapshot = dict(self._state)
        self._persist()
        self._broadcast(snapshot)
        return snapshot

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=64)
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _broadcast(self, snapshot: dict) -> None:
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(snapshot)
            except queue.Full:
                pass


STATE = StateManager()
RUNTIME_HOST_INFO: dict = {}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, format: str, *args) -> None:
        if self.path.startswith("/api/"):
            return
        sys.stderr.write("%s - - [%s] %s\n" % (
            self.address_string(),
            self.log_date_time_string(),
            format % args,
        ))

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/state":
            self._send_json(STATE.get())
            return
        if path == "/api/segment/health":
            self._send_json({
                "available": HAS_JIEBA,
                "engine": "jieba" if HAS_JIEBA else None,
            })
            return
        if path == "/api/transcribe/health":
            self._send_json(transcribe_status())
            return
        if path == "/api/host-info":
            self._send_json(self._host_info())
            return
        if path == "/api/events":
            self._handle_sse()
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/state":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length else b"{}"
            try:
                data = json.loads(body.decode("utf-8"))
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return
            snapshot = STATE.update(data)
            self._send_json(snapshot)
            return
        if path == "/api/segment":
            self._handle_segment()
            return
        if path == "/api/transcribe":
            self._handle_transcribe()
            return
        self.send_error(404)

    def _handle_segment(self) -> None:
        if not HAS_JIEBA:
            self._send_json(
                {"error": "jieba_not_installed", "words": []},
                status=501,
            )
            return

        import re

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        text = (data.get("text") or "").strip()
        if not text:
            self._send_json({"words": [], "engine": "jieba"})
            return

        words = segment_list(text)
        self._send_json({"words": words, "engine": "jieba"})

    def _host_info(self) -> dict:
        host_header = self.headers.get("Host", "")
        port = host_header.split(":")[-1] if ":" in host_header else str(RUNTIME_HOST_INFO.get("port") or "")
        lan = RUNTIME_HOST_INFO.get("lan")
        local_port = RUNTIME_HOST_INFO.get("port") or port
        return {
            "localUrl": f"http://127.0.0.1:{local_port}/",
            "lanUrl": f"http://{lan}:{local_port}/" if lan else None,
            "port": int(local_port) if str(local_port).isdigit() else local_port,
        }

    def _handle_transcribe(self) -> None:
        status = transcribe_status()
        if not status.get("available"):
            self._send_json(
                {"error": status.get("error") or "transcribe_unavailable", "text": ""},
                status=501,
            )
            return

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length) if length else b""
        if not body:
            self._send_json({"text": "", "engine": "whisper"})
            return

        content_type = (self.headers.get("Content-Type") or "audio/webm").split(";")[0].strip()
        suffix = ".webm"
        if "wav" in content_type:
            suffix = ".wav"
        elif "mp4" in content_type or "m4a" in content_type:
            suffix = ".mp4"
        elif "ogg" in content_type:
            suffix = ".ogg"

        try:
            text = transcribe_bytes(body, suffix=suffix)
            self._send_json({"text": text, "engine": "whisper"})
        except Exception as exc:
            self._send_json(
                {"error": str(exc), "text": ""},
                status=500,
            )

    def _send_json(self, data: dict, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(payload)

    def _handle_sse(self) -> None:
        client_q = STATE.subscribe()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            init = json.dumps(STATE.get(), ensure_ascii=False)
            self.wfile.write(f"event: update\ndata: {init}\n\n".encode("utf-8"))
            self.wfile.flush()

            while True:
                try:
                    snapshot = client_q.get(timeout=25)
                    msg = json.dumps(snapshot, ensure_ascii=False)
                    self.wfile.write(f"event: update\ndata: {msg}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            STATE.unsubscribe(client_q)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("", port))
            return True
        except OSError:
            return False


def pick_port() -> int:
    for port in DEFAULT_PORTS:
        if port_available(port):
            return port
    raise OSError("无法找到可用端口")


def local_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return None


def main() -> None:
    if not (WEB_DIR / "index.html").exists():
        print(f"错误: 未找到 index.html，目录: {WEB_DIR}")
        sys.exit(1)

    port = pick_port()
    base = f"http://127.0.0.1:{port}"
    lan = local_ip()
    lan_base = f"http://{lan}:{port}" if lan else None
    RUNTIME_HOST_INFO["port"] = port
    RUNTIME_HOST_INFO["lan"] = lan

    try:
        httpd = ThreadingHTTPServer(("", port), Handler)
    except OSError as exc:
        print(f"启动失败: {exc}")
        input("按回车键退出...")
        sys.exit(1)

    print("=" * 54)
    print("  词云 Kiosk 服务器已启动")
    print("=" * 54)
    print(f"  控制台（录入）: {base}/")
    print(f"  大屏展示:       {base}/display.html")
    if lan_base:
        print(f"  局域网访问:     {lan_base}/")
    if HAS_JIEBA:
        print("  分词引擎:       jieba（/api/segment）")
    else:
        print("  分词引擎:       未安装 jieba，请运行 pip install jieba")
    t_status = transcribe_status()
    if t_status.get("available"):
        print(f"  语音识别:       whisper/{t_status.get('model', 'tiny')}（/api/transcribe）")
        transcribe_warm_up()
    else:
        hint = t_status.get("error") or "未配置"
        print(f"  语音识别:       不可用 — {hint}")
    print("  按 Ctrl+C 停止")
    print("=" * 54)

    try:
        webbrowser.open(base)
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
