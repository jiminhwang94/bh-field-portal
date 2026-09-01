#!/usr/bin/env python3
"""로봇 현장 대응 경량 포털 - 로컬 서버.

표준 라이브러리만 사용한다. 실행:
    python3 server.py            # http://localhost:8787
    python3 server.py --port 9000 --host 0.0.0.0
"""

import argparse
import json
import mimetypes
import os
import socket
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import api, db  # noqa: E402

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("application/manifest+json", ".webmanifest")

# APK 로 설치한 앱은 화면 파일이 기기 안에 있어(https://appassets.androidplatform.net)
# 서버와 **다른 출처**가 된다. 그래서 이 출처만 골라서 허용한다.
# (아무 사이트나 허용하면 사내망 서버가 외부 웹페이지에서 호출될 수 있다)
ALLOWED_ORIGINS = ("https://appassets.androidplatform.net",)
ALLOWED_HEADERS = "Content-Type, X-Device-Id"


class Handler(BaseHTTPRequestHandler):
    server_version = "BHFieldPortal/1.0"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------- 응답 도구
    def _cors_headers(self) -> dict:
        """APK 앱(다른 출처)에서 온 요청이면 허용 헤더를 붙인다."""
        origin = (self.headers.get("Origin") or "").strip()
        if origin not in ALLOWED_ORIGINS:
            return {}
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }

    def _send(self, status, body=b"", content_type="application/octet-stream",
              extra=None):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for key, value in self._cors_headers().items():
            self.send_header(key, value)
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, payload, extra=None):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        # API 응답은 브라우저가 절대 재사용하지 않게 한다.
        # (캐시 지시자가 없으면 오래된 데이터를 그대로 보여줄 수 있다)
        headers = {"Cache-Control": "no-store"}
        headers.update(extra or {})
        self._send(status, body, "application/json; charset=utf-8", headers)

    def _error(self, status, message):
        self._json(status, {"error": message})

    def log_message(self, fmt, *args):  # 노이즈 축소
        if os.environ.get("BH_VERBOSE"):
            super().log_message(fmt, *args)

    def handle_one_request(self):
        # 태블릿이 화면을 옮기거나 절전에 들어가면 연결이 그냥 끊긴다.
        # 정상 상황이므로 터미널에 오류로 보이지 않게 조용히 닫는다.
        try:
            super().handle_one_request()
        except (ConnectionResetError, BrokenPipeError, TimeoutError):
            self.close_connection = True

    # ------------------------------------------------------------- 메서드
    def do_GET(self):
        self._route("GET")

    def do_HEAD(self):
        self._route("GET")

    def do_POST(self):
        self._route("POST")

    def do_PUT(self):
        self._route("PUT")

    def do_PATCH(self):
        self._route("PATCH")

    def do_DELETE(self):
        self._route("DELETE")

    def do_OPTIONS(self):
        """APK 앱이 본 요청 전에 보내는 사전 확인(preflight)."""
        if not self._cors_headers():
            self._error(405, "허용되지 않는 메서드입니다.")
            return
        # 허용 출처 헤더는 _send 가 붙인다. 여기서는 사전 확인용 헤더만 더한다.
        # (같은 헤더를 두 번 보내면 브라우저가 응답 전체를 거부한다)
        self._send(204, b"", "text/plain", {
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": ALLOWED_HEADERS,
            "Access-Control-Max-Age": "86400",
        })

    # ------------------------------------------------------------- 라우팅
    def _read_body(self, path=""):
        length = self.headers.get("Content-Length")
        if not length:
            return b""
        try:
            size = int(length)
        except ValueError:
            return b""
        if size <= 0:
            return b""
        if size > api.MAX_UPLOAD_BYTES + 1024:
            # 본문을 읽지 않고 응답하면 남은 바이트가 다음 요청으로 섞여
            # 연결이 깨진다. 이 연결은 응답 뒤 닫는다.
            self.close_connection = True
            raise api.ApiError(413, "요청 본문이 너무 큽니다.")
        return self.rfile.read(size)

    def _route(self, method):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)

        try:
            if path.startswith("/api/"):
                body = self._read_body(path)
                status, payload = api.handle(
                    method, path, query, body,
                    self.headers.get("Content-Type", ""),
                    self.headers,
                )
                self._json(status, payload)
                return
            if path.startswith("/media/"):
                self._serve_media(path[len("/media/"):])
                return
            if method != "GET":
                # 본문이 남아 있을 수 있다 — 다음 요청과 섞이지 않게 연결을 닫는다.
                self.close_connection = True
                self._error(405, "허용되지 않는 메서드입니다.")
                return
            self._serve_static(path)
        except api.ApiError as exc:
            self._error(exc.status, exc.message)
        except BrokenPipeError:
            pass
        except Exception:  # noqa: BLE001 - 서버가 죽지 않도록 방어
            traceback.print_exc()
            self._error(500, "서버 내부 오류가 발생했습니다. 터미널 로그를 확인하세요.")

    # ------------------------------------------------------------- 정적 파일
    def _resolve(self, root, relative):
        target = os.path.normpath(os.path.join(root, relative.lstrip("/")))
        if not (target == root or target.startswith(root + os.sep)):
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
        if ctype.startswith("text/") or ctype in ("application/javascript",
                                                  "application/json",
                                                  "application/manifest+json",
                                                  "image/svg+xml"):
            ctype += "; charset=utf-8"
        with open(target, "rb") as handle:
            body = handle.read()
        self._send(200, body, ctype, {"Cache-Control": "no-cache"})

    def _serve_media(self, filename):
        filename = os.path.basename(filename)
        target = self._resolve(db.MEDIA_DIR, filename)
        if target is None or not os.path.isfile(target):
            self._error(404, "파일을 찾을 수 없습니다.")
            return
        ctype = mimetypes.guess_type(target)[0] or "application/octet-stream"
        with open(target, "rb") as handle:
            body = handle.read()
        self._send(200, body, ctype, {"Cache-Control": "max-age=86400"})


def local_ip():
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(("8.8.8.8", 80))
        ip = sock.getsockname()[0]
        sock.close()
        return ip
    except OSError:
        return "127.0.0.1"


def ensure_cert(cert_dir):
    """자체 서명 인증서를 만든다(없을 때만). openssl 은 macOS/Linux 기본 포함."""
    import subprocess

    os.makedirs(cert_dir, exist_ok=True)
    cert = os.path.join(cert_dir, "cert.pem")
    key = os.path.join(cert_dir, "key.pem")
    if os.path.isfile(cert) and os.path.isfile(key):
        return cert, key

    ip = local_ip()
    san = f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}"
    cmd = [
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", key, "-out", cert, "-days", "3650",
        "-subj", "/CN=BH Field Portal", "-addext", san,
    ]
    try:
        subprocess.run(cmd, check=True, capture_output=True)
    except FileNotFoundError:
        raise SystemExit("openssl 을 찾을 수 없습니다. 인증서를 직접 준비해 --cert/--key 로 지정하세요.")
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"인증서 생성 실패:\n{exc.stderr.decode('utf-8', 'replace')}")
    print(f"  자체 서명 인증서를 생성했습니다: {cert}")
    return cert, key


def main():
    parser = argparse.ArgumentParser(description="로봇 현장 대응 경량 포털")
    parser.add_argument("--port", type=int,
                        default=int(os.environ.get("PORT", 8787)))
    parser.add_argument("--host", default=os.environ.get("HOST", "0.0.0.0"))
    parser.add_argument("--https", action="store_true",
                        help="HTTPS 로 실행 (도메인 서비스용)")
    parser.add_argument("--cert", help="인증서 파일 (기본: data/cert/cert.pem)")
    parser.add_argument("--key", help="개인키 파일 (기본: data/cert/key.pem)")

    args = parser.parse_args()

    db.init()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    scheme = "http"

    if args.https:
        import ssl as ssl_module
        cert, key = (args.cert, args.key)
        if not (cert and key):
            cert, key = ensure_cert(os.path.join(db.DATA_DIR, "cert"))
        context = ssl_module.SSLContext(ssl_module.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certfile=cert, keyfile=key)
        httpd.socket = context.wrap_socket(httpd.socket, server_side=True)
        scheme = "https"
        os.environ["BH_SCHEME"] = "https"

    print("=" * 60, flush=True)
    print("  로봇 현장 대응 포털이 실행되었습니다.")
    print(f"  이 PC          : {scheme}://localhost:{args.port}")
    if args.host == "0.0.0.0":
        print(f"  태블릿/휴대폰  : {scheme}://{local_ip()}:{args.port}")
        print("  (같은 Wi-Fi 또는 테더링에 연결된 기기에서 접속)")
    if scheme == "https":
        print("  ※ 자체 서명 인증서면 브라우저가 경고를 띄웁니다.")
        print("    운영에서는 정식 인증서(리버스 프록시)를 쓰세요.")
    site = (db.get_settings().get("site_url") or "").strip()
    if site:
        print(f"  서비스 주소    : {site}  (설정에서 지정됨)")
    print(f"  공개본 DB      : {db.DB_PATH}")
    print(f"  공개 버전      : {db.published_state()['revision']} "
          f"(앱은 기기에 자료를 두고 오프라인으로 동작합니다)")
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
