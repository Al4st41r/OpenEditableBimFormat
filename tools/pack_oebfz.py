#!/usr/bin/env python3
"""
pack_oebfz.py: pack an .oebf directory into a Zstd-compressed tar (.oebfz).

A thin wrapper: the implementation is oebf.archive.pack in ifc-tools, also reached as `oebf pack`.

Usage:
    cd ifc-tools && uv run python ../tools/pack_oebfz.py <input_dir> <output_file>
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "ifc-tools" / "src"))
from oebf.archive import pack  # noqa: E402

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    src, out = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    size = pack(src, out)
    print(f"Packed {src} -> {out}\n  tar size:        {size:,} bytes\n  compressed size: {out.stat().st_size:,} bytes")
