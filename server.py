#!/usr/bin/env python3
"""현장 포털 — 화면 파일을 내주는 서버.

**이 서버는 자료를 다루지 않는다.** 가이드·재고·리포트·항목은 전부 기기 안에 있고,
팀이 함께 보는 원본은 구글 스프레드시트 하나다. 여기서는 `web/` 폴더의 화면 파일
(HTML · CSS · JS · 서체 · 아이콘)을 브라우저에 내줄 뿐이다.
APK 로 설치한 앱은 화면 파일이 앱 안에 있어 이 서버가 아예 필요 없다.

예전(v3.x 초반)에는 '사무실 서버' 가 팀 공개본을 보관하고 동기화 API 를 두었다.
구글 시트로 전부 옮긴 뒤 하는 일이 없어졌는데, 주소를 안 넣은 태블릿에서
"서버 주소가 설정되지 않았습니다" 같은 엉뚱한 알림만 냈다. v3.9 에서 걷어냈다.

표준 라이브러리만 사용한다. 실행:
    python3 server.py            # http://localhost:8787
    python3 server.py --port 9000 --host 0.0.0.0
"""

import argparse
import mimetypes
import os
import socket
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
# 예전 서버 API 로 올라간 가이드 사진이 남아 있을 수 있어 읽기 전용으로 내준다.
MEDIA_DIR = os.path.join(
    os.environ.get("BH_DATA_DIR") or os.path.join(BASE_DIR, "data"), "media")

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("font/woff2", ".woff2")

TEXT_TYPES = ("application/javascript", "application/json",
              "application/manifest+json", "image/svg+xml")


class Handler(BaseHTTPRequestHandler):
    server_version = "BHFieldPortal/2.0"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------- 응답 도구
    def _send(self, status, body=b"", content_type="application/octet-stream",
              extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _error(self, status, message):
        self._send(status, message + "\n", "text/plain; charset=utf-8",
                   {"Cache-Control": "no-store"})

    def log_message(self, fmt, *args):  # noqa: D401 - 조용한 로그
        if os.environ.get("BH_QUIET"):
            return
        super().log_message(fmt, *args)

    # ------------------------------------------------------------- 라우팅
    def do_GET(self):
        self._route()

    def do_HEAD(self):
        self._route()

    def _route(self):
        path = unquote(urlparse(self.path).path)
        try:
            if path.startswith("/api/"):
                # 앱은 더 이상 서버 API 를 부르지 않는다. 옛 버전이 부르면 분명히 알려 준다.
                self._error(404, "이 서버에는 API 가 없습니다. 자료는 구글 시트에 있습니다.")
                return
            if path.startswith("/media/"):
                self._serve_media(path[len("/media/"):])
                return
            self._serve_static(path)
        except BrokenPipeError:
            pass
        except Exception:  # noqa: BLE001 - 서버가 죽지 않도록 방어
            traceback.print_exc()
            self._error(500, "서버 내부 오류가 발생했습니다. 터미널 로그를 확인하세요.")

    def _refuse(self):
        self.close_connection = True
        self._error(405, "허용되지 않는 메서드입니다. 이 서버는 화면 파일만 내줍니다.")

    do_POST = do_PUT = do_DELETE = do_PATCH = _refuse

    # ------------------------------------------------------------- 정적 파일
    @staticmethod
    def _resolve(root, relative):
        """root 밖으로 나가는 경로(../)를 막는다."""
        target = os.path.normpath(os.path.join(root, relative.lstrip("/")))
        root = os.path.normpath(root)
        if target != root and not target.startswith(root + os.sep):
            return None
        return target

    def _serve_static(self, path):
        relative = "index.html" if path in ("", "/") else path
        target = self._resolve(WEB_DIR, relative)
        if target is None:
            self._error(403, "접근이 거부되었습니다.")
            return
        if os.path.isdir(target):
            target = os.path.join(target, "index.html")
        if not os.path.isfile(target):
            # 확장자 없는 경로만 index.html 로 폴백한다(SPA 진입점).
            # .js/.css 등 누락된 정적 파일은 404 로 알려야 디버깅이 쉽다.
            if os.path.splitext(target)[1]:
                self._error(404, f"찾을 수 없습니다: {path}")
                return
            target = os.path.join(WEB_DIR, "index.html")
            if not os.path.isfile(target):
                self._error(404, "찾을 수 없습니다.")
                return
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in TEXT_TYPES:
            ctype += "; charset=utf-8"
        with open(target, "rb") as handle:
            body = handle.read()
        # 화면 파일은 매번 서버에 확인한다 — 새 버전을 올렸는데 옛 파일이 남으면
        # 화면 절반만 바뀐 채 열려 원인을 찾기 어렵다. (오프라인 캐시는 서비스워커가 맡는다)
        self._send(200, body, ctype, {"Cache-Control": "no-cache"})

    def _serve_media(self, filename):
        filename = os.path.basename(filename)
        target = self._resolve(MEDIA_DIR, filename)
        if target is None or not os.path.isfile(target):
            self._error(404, "파일을 찾을 수 없습니다.")
            return
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        with open(target, "rb") as handle:
            body = handle.read()
        self._send(200, body, ctype, {"Cache-Control": "max-age=86400"})


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def main():
    parser = argparse.ArgumentParser(description="현장 포털 — 화면 파일 서버")
    parser.add_argument("--port", type=int,
                        default=int(os.environ.get("PORT", 8787)))
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    args = parser.parse_args()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print("=" * 60, flush=True)
    print("  현장 포털 화면 서버가 실행되었습니다.")
    print(f"  이 PC          : http://localhost:{args.port}")
    if args.host == "0.0.0.0":
        print(f"  태블릿/휴대폰  : http://{local_ip()}:{args.port}")
        print("  (같은 Wi-Fi 또는 테더링에 연결된 기기에서 접속)")
    print("  자료는 이 서버가 아니라 구글 시트와 각 기기에 있습니다.")
    print("  종료: Ctrl + C")
    print("=" * 60, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
