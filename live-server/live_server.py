"""
live_server.py — serve one OEBF bundle folder so the browser editor can read and write it directly.

The editor's ServerAdapter (viewer/src/editor/serverAdapter.js) calls:

    GET    <prefix>/files/<path>   the file as it is
    PUT    <prefix>/files/<path>   write the request body to the file, creating folders
    DELETE <prefix>/files/<path>   remove the file
    GET    <prefix>/list/<dir>     JSON array of the names in a folder ([] when it does not exist)

It listens on 127.0.0.1 only. nginx puts it behind a password at /oebf-live/ (see docs/live-copy.md). Paths are
checked so nothing outside the bundle folder can be read or written. Cross-site pages cannot write: PUT and DELETE
need a CORS preflight, which this server never answers.

Run:  uv run live_server.py --root ../live/terraced-house.oebf --port 5080
"""

import argparse
import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

PREFIX = '/oebf-live/api'
MAX_BYTES = 20 * 1024 * 1024
SAFE_PART = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._ -]*$')
TYPES = {'.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8'}


def resolve(root: Path, rel: str) -> Path | None:
    """The file `rel` names under `root`, or None when the path is not a plain relative path inside it."""
    parts = [p for p in unquote(rel).split('/') if p]
    if not parts or not all(SAFE_PART.match(p) and p not in ('.', '..') for p in parts):
        return None
    target = root.joinpath(*parts).resolve()
    return target if target.is_relative_to(root) else None


def make_handler(root: Path):
    root = root.resolve()

    class Handler(BaseHTTPRequestHandler):
        server_version = 'oebf-live/0.1'

        def _route(self):
            path = urlsplit(self.path).path
            if not path.startswith(PREFIX + '/'):
                return None, None
            rest = path[len(PREFIX) + 1:]
            kind, _, rel = rest.partition('/')
            return kind, rel

        def _send(self, code, body=b'', ctype='text/plain; charset=utf-8'):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)

        def do_GET(self):
            kind, rel = self._route()
            if kind == 'list':
                folder = root if rel.strip('/') == '' else resolve(root, rel)
                if folder is None:
                    return self._send(400, b'bad path')
                names = sorted(p.name for p in folder.iterdir()) if folder.is_dir() else []
                return self._send(200, json.dumps(names).encode(), 'application/json')
            if kind == 'files':
                target = resolve(root, rel)
                if target is None:
                    return self._send(400, b'bad path')
                if not target.is_file():
                    return self._send(404, b'not found')
                return self._send(200, target.read_bytes(), TYPES.get(target.suffix, 'application/octet-stream'))
            return self._send(404, b'not found')

        do_HEAD = do_GET

        def do_PUT(self):
            kind, rel = self._route()
            target = resolve(root, rel) if kind == 'files' else None
            if target is None:
                return self._send(400, b'bad path')
            length = int(self.headers.get('Content-Length') or 0)
            if length > MAX_BYTES:
                return self._send(413, b'too large')
            body = self.rfile.read(length)
            if target.suffix == '.json':
                try:
                    json.loads(body)
                except ValueError:
                    return self._send(400, b'not JSON')
            target.parent.mkdir(parents=True, exist_ok=True)
            tmp = target.with_name(target.name + '.tmp')
            tmp.write_bytes(body)
            tmp.replace(target)   # a reader never sees half a file
            return self._send(204)

        def do_DELETE(self):
            kind, rel = self._route()
            target = resolve(root, rel) if kind == 'files' else None
            if target is None:
                return self._send(400, b'bad path')
            if target.is_file():
                target.unlink()
            return self._send(204)

        def log_message(self, fmt, *args):   # one line per write, none per read
            if self.command in ('PUT', 'DELETE'):
                super().log_message(fmt, *args)

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--root', required=True, type=Path, help='the bundle folder to serve')
    ap.add_argument('--port', type=int, default=5080)
    args = ap.parse_args()
    if not (args.root / 'model.json').is_file():
        raise SystemExit(f'{args.root} has no model.json')
    ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(args.root)).serve_forever()


if __name__ == '__main__':
    main()
