"""Pack and unpack OEBF bundle archives.

A `.oebfz` is a ustar tar of `<name>.oebf/...` (sorted names, owner and time zeroed), Zstd-compressed. Older
editor versions saved a zip (`.oebf.zip` or `.zip`) instead; unpacking reads both. The viewer's loader
(`viewer/src/loader/loadBundleZstd.js`) is the reference for what an archive may hold: relative paths without `..`,
and no more than 200 MB once decompressed.

Unpacking is safe against hostile archives: absolute paths, `..` segments, backslashes, links, devices and
anything beyond the size cap are refused with an `ArchiveError`, and nothing outside the destination is written.
"""

import io
import shutil
import stat
import tarfile
import tempfile
import zipfile
import zlib
from contextlib import contextmanager
from pathlib import Path

import zstandard

MAX_ARCHIVE_BYTES = 200 * 1024 * 1024
ARCHIVE_SUFFIXES = (".oebfz", ".oebf.zip", ".zip")


class ArchiveError(Exception):
    """The archive cannot be read, or holds something that is not allowed."""


def archive_name(path) -> str:
    """The bundle's name from its archive's file name: `house.oebfz` and `house.oebf.zip` give `house`."""
    name = Path(path).name
    for suffix in ARCHIVE_SUFFIXES:
        if name.lower().endswith(suffix):
            name = name[: -len(suffix)]
            break
    return name[:-5] if name.lower().endswith(".oebf") else name


def _safe_parts(name: str) -> list[str]:
    bad = ArchiveError(f"Unsafe path in the archive: {name!r}")
    if not name or name.startswith("/") or "\\" in name or "\0" in name:
        raise bad
    parts = name.split("/")
    if parts[-1] == "":   # a directory entry
        parts = parts[:-1]
    if not parts or any(p in ("", ".", "..") for p in parts) or parts[0].endswith(":"):
        raise bad
    return parts


def _too_big(limit):
    return ArchiveError(f"The archive holds more than {limit // (1024 * 1024)} MB once decompressed, so it was not unpacked")


def _is_zip(path: Path) -> bool:
    with open(path, "rb") as f:
        return f.read(2) == b"PK"


def _tar_files(path: Path, limit: int):
    """Yield (relative path, bytes) for each regular file of a .oebfz."""
    total = 0
    try:
        with open(path, "rb") as raw:
            reader = zstandard.ZstdDecompressor().stream_reader(raw)
            with tarfile.open(fileobj=reader, mode="r|") as tar:
                for member in tar:
                    if member.isdir():
                        _safe_parts(member.name)
                        continue
                    if not member.isreg():
                        raise ArchiveError(f"Links and special files are not allowed in an archive: {member.name!r}")
                    parts = _safe_parts(member.name)
                    total += member.size
                    if total > limit:
                        raise _too_big(limit)
                    data = tar.extractfile(member).read()
                    # like the viewer, take off the leading folder
                    yield "/".join(parts[1:] if len(parts) > 1 else parts), data
    except (zstandard.ZstdError, tarfile.TarError, EOFError) as exc:
        raise ArchiveError(f"Not a readable .oebfz archive: {exc}") from exc


def _zip_files(path: Path, limit: int):
    try:
        with zipfile.ZipFile(path) as zf:
            infos = zf.infolist()
            for info in infos:
                _safe_parts(info.filename)
                mode = info.external_attr >> 16
                if mode and stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                    raise ArchiveError(f"Links and special files are not allowed in an archive: {info.filename!r}")
            if sum(i.file_size for i in infos) > limit:
                raise _too_big(limit)
            files = [i for i in infos if not i.is_dir()
                     and not i.filename.startswith("__MACOSX/") and not i.filename.split("/")[-1].startswith(".")]
            names = [i.filename for i in files]
            prefix = ""
            if "model.json" not in names:
                inner = next((n for n in names if n.endswith("/model.json")), None)
                if inner is None:
                    raise ArchiveError("This zip has no model.json, so it is not an OEBF bundle")
                prefix = inner[: -len("model.json")]
            total = 0
            for info in files:
                if not info.filename.startswith(prefix):
                    continue
                with zf.open(info) as f:
                    data = f.read(info.file_size + 1)   # the header's size can lie; read one more to notice
                total += len(data)
                if len(data) != info.file_size or total > limit:
                    raise ArchiveError("The archive is corrupt or larger than it says")
                yield info.filename[len(prefix):], data
    except (zipfile.BadZipFile, zlib.error) as exc:
        raise ArchiveError(f"Not a readable zip archive: {exc}") from exc


def unpack(archive, dest, max_bytes: int = MAX_ARCHIVE_BYTES) -> Path:
    """Unpack an archive into the bundle folder `dest` (created; must be absent or empty). Returns `dest`."""
    archive, dest = Path(archive), Path(dest)
    if dest.exists() and (not dest.is_dir() or any(dest.iterdir())):
        raise ArchiveError(f"{dest} already exists and is not empty")
    files = _zip_files(archive, max_bytes) if _is_zip(archive) else _tar_files(archive, max_bytes)
    existed = dest.exists()
    dest.mkdir(parents=True, exist_ok=True)
    root = dest.resolve()
    try:
        written = 0
        for rel, data in files:
            _safe_parts(rel)
            target = (root / rel).resolve()
            if root not in target.parents:
                raise ArchiveError(f"Unsafe path in the archive: {rel!r}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            written += 1
        if not written:
            raise ArchiveError("The archive holds no files")
    except BaseException:
        if existed:
            for child in dest.iterdir():
                shutil.rmtree(child) if child.is_dir() else child.unlink()
        else:
            shutil.rmtree(dest, ignore_errors=True)
        raise
    return dest


def pack(bundle_dir, output, level: int = 3) -> int:
    """Pack a bundle folder into a .oebfz at `output`, with the folder's name as the leading component. Returns the tar size."""
    bundle_dir = Path(bundle_dir).resolve()
    if not (bundle_dir / "model.json").is_file():
        raise ArchiveError(f"{bundle_dir} has no model.json, so it is not an OEBF bundle")
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for path in sorted(bundle_dir.rglob("*")):
            if path.is_symlink():
                raise ArchiveError(f"{path} is a link; links are not packed")
            if not path.is_file():
                continue
            info = tar.gettarinfo(path, arcname=f"{bundle_dir.name}/{path.relative_to(bundle_dir).as_posix()}")
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            info.mode = 0o644
            with open(path, "rb") as f:
                tar.addfile(info, f)
    tar_bytes = buf.getvalue()
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(zstandard.ZstdCompressor(level=level).compress(tar_bytes))
    return len(tar_bytes)


@contextmanager
def open_bundle(path):
    """Yield a bundle folder: `path` itself if it is a folder, else a temporary unpacked copy of the archive."""
    path = Path(path)
    if path.is_dir():
        yield path
        return
    with tempfile.TemporaryDirectory(prefix="oebf-") as tmp:
        yield unpack(path, Path(tmp) / f"{archive_name(path)}.oebf")
