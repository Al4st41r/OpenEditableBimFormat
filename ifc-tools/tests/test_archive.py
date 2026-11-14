"""oebf pack / unpack and `oebf validate` on archives (#196)."""
import io
import pathlib
import shutil
import subprocess
import tarfile
import zipfile

import pytest
import zstandard
from click.testing import CliRunner

from oebf.archive import ArchiveError, pack, unpack
from oebf.cli import cli

REPO = pathlib.Path(__file__).parent.parent.parent
EXAMPLE = REPO / "example" / "terraced-house.oebf"

NODE_PACK = """
import fs from 'node:fs'; import path from 'node:path';
import { packOebfz } from '%s';
const root = process.argv[2]; const files = new Map();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  const p = path.join(d, e.name); if (e.isDirectory()) walk(p);
  else files.set(path.relative(root, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')); } };
walk(root);
fs.writeFileSync(process.argv[3], await packOebfz(files, 'terraced-house.oebf'));
"""


def tree(root):
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def zst(tar_bytes):
    return zstandard.ZstdCompressor().compress(tar_bytes)


def make_tar(entries):
    """entries: (name, kind, payload) with kind 'file', 'symlink' or 'hardlink'."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for name, kind, payload in entries:
            info = tarfile.TarInfo(name)
            if kind == "file":
                info.size = len(payload)
                tar.addfile(info, io.BytesIO(payload))
            else:
                info.type = tarfile.SYMTYPE if kind == "symlink" else tarfile.LNKTYPE
                info.linkname = payload
                tar.addfile(info)
    return buf.getvalue()


def test_round_trip_equals_folder(tmp_path):
    archive = tmp_path / "terraced-house.oebfz"
    pack(EXAMPLE, archive)
    out = unpack(archive, tmp_path / "out.oebf")
    assert tree(out) == tree(EXAMPLE)


def test_pack_is_deterministic_and_zstd_tar(tmp_path):
    pack(EXAMPLE, tmp_path / "a.oebfz")
    pack(EXAMPLE, tmp_path / "b.oebfz")
    assert (tmp_path / "a.oebfz").read_bytes() == (tmp_path / "b.oebfz").read_bytes()
    with (tmp_path / "a.oebfz").open("rb") as f:
        raw = zstandard.ZstdDecompressor().stream_reader(f)
        with tarfile.open(fileobj=raw, mode="r|") as tar:
            assert next(iter(tar)).name.startswith("terraced-house.oebf/")


def test_cli_pack_unpack_validate(tmp_path):
    runner = CliRunner()
    r = runner.invoke(cli, ["pack", str(EXAMPLE), str(tmp_path / "x.oebfz")])
    assert r.exit_code == 0, r.output
    r = runner.invoke(cli, ["validate", str(tmp_path / "x.oebfz")])
    assert r.exit_code == 0, r.output
    assert "No problems" in r.output
    r = runner.invoke(cli, ["unpack", str(tmp_path / "x.oebfz")])   # default destination: x.oebf beside the archive
    assert r.exit_code == 0, r.output
    assert tree(tmp_path / "x.oebf") == tree(EXAMPLE)
    r = runner.invoke(cli, ["unpack", str(tmp_path / "x.oebfz")])   # now exists
    assert r.exit_code == 1 and "not empty" in r.output


def test_validate_reports_paths_relative_to_the_bundle(tmp_path):
    broken = tmp_path / "b.oebf"
    shutil.copytree(EXAMPLE, broken)
    (broken / "model.json").write_text("{not json")
    pack(broken, tmp_path / "b.oebfz")
    r = CliRunner().invoke(cli, ["validate", str(tmp_path / "b.oebfz")])
    assert r.exit_code == 1
    assert "json-invalid" in r.output and " model.json:" in r.output
    assert str(tmp_path) not in r.output.split("problem(s)")[0]


def test_legacy_zip_with_and_without_folder(tmp_path):
    for prefix in ("", "terraced-house.oebf/"):
        z = tmp_path / f"z{len(prefix)}.oebf.zip"
        with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, data in tree(EXAMPLE).items():
                zf.writestr(prefix + name, data)
            zf.writestr("__MACOSX/._model.json", b"junk")
        out = unpack(z, tmp_path / f"out{len(prefix)}")
        assert tree(out) == tree(EXAMPLE)
        r = CliRunner().invoke(cli, ["validate", str(z)])
        assert r.exit_code == 0, r.output


def test_archive_from_the_browser_writer_validates(tmp_path):
    if not shutil.which("node") or not (REPO / "viewer" / "node_modules" / "@hpcc-js").exists():
        pytest.skip("node or the viewer's dependencies are not installed")
    script = tmp_path / "pack.mjs"
    script.write_text(NODE_PACK % (REPO / "viewer/src/editor/oebfzWriter.js").as_posix())
    archive = tmp_path / "browser.oebfz"
    subprocess.run(["node", str(script), str(EXAMPLE), str(archive)], check=True, cwd=REPO / "viewer")
    assert tree(unpack(archive, tmp_path / "u")) == tree(EXAMPLE)
    r = CliRunner().invoke(cli, ["validate", str(archive)])
    assert r.exit_code == 0, r.output


@pytest.mark.parametrize("name", ["/abs/model.json", "b.oebf/../../evil.json", "b.oebf/a/../../evil.json", "b.oebf\\x.json"])
def test_unsafe_tar_paths_refused(tmp_path, name):
    a = tmp_path / "a.oebfz"
    a.write_bytes(zst(make_tar([("b.oebf/model.json", "file", b"{}"), (name, "file", b"x")])))
    with pytest.raises(ArchiveError, match="Unsafe path"):
        unpack(a, tmp_path / "out")
    assert not (tmp_path / "out").exists()
    assert not (tmp_path / "evil.json").exists()


@pytest.mark.parametrize("kind,target", [("symlink", "/etc/passwd"), ("hardlink", "b.oebf/model.json")])
def test_links_refused(tmp_path, kind, target):
    a = tmp_path / "a.oebfz"
    a.write_bytes(zst(make_tar([("b.oebf/model.json", "file", b"{}"), ("b.oebf/link.json", kind, target)])))
    with pytest.raises(ArchiveError, match="Links"):
        unpack(a, tmp_path / "out")


def test_zip_unsafe_and_symlink_refused(tmp_path):
    z = tmp_path / "a.zip"
    with zipfile.ZipFile(z, "w") as zf:
        zf.writestr("model.json", "{}")
        zf.writestr("../evil.json", "x")
    with pytest.raises(ArchiveError, match="Unsafe path"):
        unpack(z, tmp_path / "o1")
    z2 = tmp_path / "b.zip"
    with zipfile.ZipFile(z2, "w") as zf:
        zf.writestr("model.json", "{}")
        info = zipfile.ZipInfo("link")
        info.external_attr = 0o120777 << 16
        zf.writestr(info, "/etc/passwd")
    with pytest.raises(ArchiveError, match="Links"):
        unpack(z2, tmp_path / "o2")


def test_size_cap(tmp_path):
    a = tmp_path / "a.oebfz"
    a.write_bytes(zst(make_tar([("b.oebf/model.json", "file", b"x" * 5000)])))
    with pytest.raises(ArchiveError, match="once decompressed"):
        unpack(a, tmp_path / "out", max_bytes=1000)
    assert not (tmp_path / "out").exists()
    z = tmp_path / "a.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("model.json", "x" * 5000)
    with pytest.raises(ArchiveError, match="once decompressed"):
        unpack(z, tmp_path / "out2", max_bytes=1000)


def test_not_an_archive(tmp_path):
    f = tmp_path / "junk.oebfz"
    f.write_bytes(b"not zstd at all")
    r = CliRunner().invoke(cli, ["validate", str(f)])
    assert r.exit_code == 1 and "Cannot read" in r.output
