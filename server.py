#!/usr/bin/env python3
"""Loopback Ground Station UI and a restricted, direct ESP32-CAM relay."""
import ipaddress
import socket
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parent
BOARD_NETWORKS = tuple(ipaddress.ip_network(value) for value in
                       ('192.168.0.0/16', '10.0.0.0/8', '172.16.0.0/12'))
BOARD_NAMES = frozenset(('sunseek.local', 'sunseek-cam.local'))
BOARD_ENDPOINTS = frozenset(('/status', '/images', '/image', '/stream'))


def camera_url(host, path):
    """Validate each destination before any network request is made."""
    if host not in BOARD_NAMES:
        address = ipaddress.ip_address(host)
        if not any(address in network for network in BOARD_NETWORKS):
            raise ValueError('Private board address required')
    endpoint = urlsplit(path)
    if (endpoint.path not in BOARD_ENDPOINTS or endpoint.scheme or endpoint.netloc
            or endpoint.fragment or any(c in path for c in ('\r', '\n', '\\'))):
        raise ValueError('Unsupported board endpoint')
    return 'http://' + host + path


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        # Do not let a board response redirect the relay to another destination.
        return None


BOARD_HTTP = build_opener(ProxyHandler({}), NoRedirects())


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        url = urlsplit(self.path)
        if url.path != '/camera':
            return super().do_GET()
        if self.headers.get('Sec-Fetch-Site') == 'cross-site':
            return self.send_error(403)
        query = parse_qs(url.query)
        try:
            destination = camera_url(query.get('host', ['192.168.4.1'])[0],
                                     query.get('path', ['/status'])[0])
        except ValueError as error:
            return self.send_error(400, str(error))
        response_started = False
        try:
            request = Request(destination, headers={'Connection': 'close'})
            with BOARD_HTTP.open(request, timeout=5) as upstream:
                self.send_response(200)
                self.send_header('Content-Type', upstream.headers.get(
                    'Content-Type', 'application/octet-stream'))
                self.send_header('Connection', 'close')
                self.end_headers()
                response_started = True
                while True:
                    chunk = upstream.read1(16384)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # Closing a camera view normally ends a stream this way.
        except HTTPError as error:
            if not response_started:
                self.send_error(error.code, 'Camera HTTP error')
        except (TimeoutError, socket.timeout):
            if not response_started:
                self.send_error(504, 'Camera timed out')
        except (URLError, OSError):
            if not response_started:
                self.send_error(502, 'Camera unreachable')
        finally:
            self.close_connection = True

    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8080), Handler)
    print('SunSeek Ground Station: http://localhost:8080', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
