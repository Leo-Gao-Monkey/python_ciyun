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
STATE_FILE = WEB_DIR / "data" / "sync-state.json"
DEFAULT_PORTS = (8765, 8766, 8767, 8080, 3000)

DEFAULT_STATE = {
    "revision": 0,
    "voiceFrequencies": {},
    "manualFrequencies": {},
    "displaySource": "voice",
    "background": "gradient-1",
    "customBgImage": None,
    "shapeMask": "circle",
    "customMaskImage": None,
    "updatedAt": "",
}


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
            if new_rev <= old_rev:
                return dict(self._state)

            sync_keys = (
                "voiceFrequencies",
                "manualFrequencies",
                "displaySource",
                "frequencies",
                "background",
                "customBgImage",
                "shapeMask",
                "customMaskImage",
            )
            for key in sync_keys:
                if key in incoming:
                    self._state[key] = incoming[key]

            self._state["revision"] = new_rev
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
        if self.path == "/api/state":
            self._send_json(STATE.get())
            return
        if self.path == "/api/events":
            self._handle_sse()
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/api/state":
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
        self.send_error(404)

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


def main() -> None:
    if not (WEB_DIR / "index.html").exists():
        print(f"错误: 未找到 index.html，目录: {WEB_DIR}")
        sys.exit(1)

    port = pick_port()
    base = f"http://127.0.0.1:{port}"

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
