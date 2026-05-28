"""词云本地启动助手 — 固定端口 8764，供页面一键启动 serve.py"""

from __future__ import annotations

import http.server
import json
import socket
import socketserver
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = WEB_DIR.parent
LAUNCHER_PORT = 8764
SERVE_PORTS = (8765, 8766, 8767, 8080, 3000)

_start_lock = threading.Lock()
_starting = False


def _probe_server_port(timeout: float = 1.0) -> int | None:
    for port in SERVE_PORTS:
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/api/transcribe/health",
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                if resp.status == 200:
                    return port
        except (urllib.error.URLError, TimeoutError, OSError):
            continue
    return None


def _spawn_server() -> None:
    flags = 0
    if sys.platform == "win32":
        flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(
        [sys.executable, str(WEB_DIR / "serve.py")],
        cwd=str(WEB_DIR),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=flags,
    )


def start_server(wait_seconds: int = 90) -> dict:
    global _starting
    with _start_lock:
        port = _probe_server_port()
        if port:
            return {
                "ok": True,
                "alreadyRunning": True,
                "serverPort": port,
                "serverUrl": f"http://127.0.0.1:{port}/",
            }

        if _starting:
            return {"ok": False, "error": "正在启动中，请稍候…"}

        _starting = True
        try:
            _spawn_server()
            deadline = time.time() + wait_seconds
            while time.time() < deadline:
                time.sleep(1)
                port = _probe_server_port(timeout=2)
                if port:
                    return {
                        "ok": True,
                        "alreadyRunning": False,
                        "serverPort": port,
                        "serverUrl": f"http://127.0.0.1:{port}/",
                    }
            return {
                "ok": False,
                "error": "启动超时，请查看是否缺少依赖（pip install openai-whisper av jieba）",
            }
        finally:
            _starting = False


def get_status() -> dict:
    port = _probe_server_port()
    return {
        "launcher": True,
        "launcherPort": LAUNCHER_PORT,
        "serverRunning": port is not None,
        "serverPort": port,
        "serverUrl": f"http://127.0.0.1:{port}/" if port else None,
    }


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:
        pass

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, data: dict, status: int = 200) -> None:
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self._cors()
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/status":
            self._json(get_status())
            return
        self._json({"launcher": True, "hint": "词云本地启动助手"}, 200)

    def do_POST(self) -> None:
        path = self.path.split("?", 1)[0]
        if path == "/api/start":
            self._json(start_server())
            return
        self.send_error(404)


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main() -> None:
    try:
        httpd = ThreadingHTTPServer(("", LAUNCHER_PORT), Handler)
    except OSError as exc:
        print(f"启动助手失败（端口 {LAUNCHER_PORT} 可能被占用）: {exc}")
        sys.exit(1)

    print(f"词云启动助手已运行: http://127.0.0.1:{LAUNCHER_PORT}/")
    print("页面可点击「启动本地服务」按钮，无需每次手动打开 bat")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n助手已停止")


if __name__ == "__main__":
    main()
