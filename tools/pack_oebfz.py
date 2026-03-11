#!/usr/bin/env python3
"""
pack_oebfz.py — Pack an .oebf directory into a Zstd-compressed tar (.oebfz).

Usage:
    python3 tools/pack_oebfz.py <input_dir> <output_file>

Example:
    python3 tools/pack_oebfz.py example/terraced-house.oebf viewer/public/terraced-house.oebfz

The tar archive contains files with the bundle directory as the leading component
so the JS extractor (extractFilesFromTar) can strip it correctly:
    terraced-house.oebf/manifest.json
    terraced-house.oebf/model.json
    ...
"""

import sys
import tarfile
import io
from pathlib import Path
import zstandard


def pack(input_dir: Path, output_file: Path) -> None:
    bundle_name = input_dir.name  # e.g. "terraced-house.oebf"

    tar_buffer = io.BytesIO()
    with tarfile.open(fileobj=tar_buffer, mode='w') as tar:
        for path in sorted(input_dir.rglob('*')):
            if path.is_file():
                arcname = f"{bundle_name}/{path.relative_to(input_dir)}"
                tar.add(path, arcname=arcname)

    tar_bytes = tar_buffer.getvalue()

    cctx = zstandard.ZstdCompressor(level=3)
    compressed = cctx.compress(tar_bytes)

    output_file.parent.mkdir(parents=True, exist_ok=True)
    output_file.write_bytes(compressed)

    print(f"Packed {input_dir} → {output_file}")
    print(f"  tar size:        {len(tar_bytes):,} bytes")
    print(f"  compressed size: {len(compressed):,} bytes")


if __name__ == '__main__':
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    pack(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())
