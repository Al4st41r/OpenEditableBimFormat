import json
import threading
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import pytest

from live_server import PREFIX, make_handler, resolve


@pytest.fixture
def server(tmp_path):
    (tmp_path / 'model.json').write_text('{"elements": []}')
    (tmp_path / 'profiles').mkdir()
    (tmp_path / 'profiles' / 'p1.json').write_text('{"id": "p1"}')
    (tmp_path.parent / 'secret.txt').write_text('outside')
    srv = ThreadingHTTPServer(('127.0.0.1', 0), make_handler(tmp_path))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f'http://127.0.0.1:{srv.server_address[1]}{PREFIX}', tmp_path
    srv.shutdown()


def call(url, method='GET', body=None):
    req = urllib.request.Request(url, data=body, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_reads_a_file(server):
    base, _ = server
    assert call(f'{base}/files/profiles/p1.json') == (200, b'{"id": "p1"}')


def test_missing_file_is_404(server):
    base, _ = server
    assert call(f'{base}/files/profiles/none.json')[0] == 404


def test_writes_a_file_creating_folders(server):
    base, root = server
    assert call(f'{base}/files/details/d1.json', 'PUT', b'{"id": "d1"}')[0] == 204
    assert json.loads((root / 'details' / 'd1.json').read_text()) == {'id': 'd1'}
    assert not list(root.rglob('*.tmp'))


def test_writes_svg_as_given(server):
    base, root = server
    assert call(f'{base}/files/profiles/p1.svg', 'PUT', b'<svg/>')[0] == 204
    assert (root / 'profiles' / 'p1.svg').read_text() == '<svg/>'


def test_refuses_json_that_does_not_parse(server):
    base, root = server
    assert call(f'{base}/files/model.json', 'PUT', b'{broken')[0] == 400
    assert (root / 'model.json').read_text() == '{"elements": []}'


def test_lists_a_folder_and_an_absent_one(server):
    base, _ = server
    assert call(f'{base}/list/profiles') == (200, b'["p1.json"]')
    assert call(f'{base}/list/junctions') == (200, b'[]')


def test_deletes_a_file(server):
    base, root = server
    assert call(f'{base}/files/profiles/p1.json', 'DELETE')[0] == 204
    assert not (root / 'profiles' / 'p1.json').exists()


@pytest.mark.parametrize('bad', ['../secret.txt', '%2e%2e/secret.txt', 'profiles/../../secret.txt', '.hidden', ''])
def test_nothing_outside_the_bundle(server, bad):
    base, _ = server
    assert call(f'{base}/files/{bad}')[0] in (400, 404)
    assert call(f'{base}/files/{bad}', 'PUT', b'x')[0] in (400, 404)


def test_resolve_keeps_paths_inside(tmp_path):
    assert resolve(tmp_path, 'a/b.json') == (tmp_path / 'a' / 'b.json').resolve()
    assert resolve(tmp_path, '../x') is None
    assert resolve(tmp_path, '/etc/passwd') == (tmp_path / 'etc' / 'passwd').resolve()   # leading slash is dropped, stays inside
