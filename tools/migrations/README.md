# OEBF Migration Scripts

Migration scripts update OEBF bundles from one format version to the next.

## Convention

- Script name: `{from}-to-{to}.py` (e.g. `0.1-to-0.2.py`)
- Entry point: `python 0.1-to-0.2.py <bundle-path>`
- The script MUST check `format_version` in `manifest.json` before making any changes
- The script MUST refuse to run if the bundle is not the expected source version

## Version Check Pattern

```python
import json, sys
from pathlib import Path

FROM_VERSION = "0.1.0"
TO_VERSION = "0.2.0"

def check_version(bundle_path: Path) -> None:
    manifest_path = bundle_path / "manifest.json"
    if not manifest_path.exists():
        print(f"Error: {manifest_path} not found")
        sys.exit(1)
    manifest = json.loads(manifest_path.read_text())
    actual = manifest.get("format_version")
    if actual != FROM_VERSION:
        print(f"Error: this script migrates {FROM_VERSION} → {TO_VERSION}")
        print(f"       bundle has format_version: {actual!r}")
        sys.exit(1)
```

## URI Convention

Entity files declare their schema version via the `$schema` field:
```
"$schema": "oebf://schema/0.1/element"
```

The URI pattern is: `oebf://schema/{version}/{entity-type}`

Migration scripts update both `format_version` in `manifest.json` and the `$schema`
field in every entity file to reflect the new version.
