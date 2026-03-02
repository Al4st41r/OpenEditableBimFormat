#!/usr/bin/env python3
"""
OEBF Migration: 0.1 -> 0.2

Stub migration script. 0.2 format changes are not yet defined.
This script demonstrates the required format_version check pattern.

Usage: python 0.1-to-0.2.py <bundle-path>
"""
import json
import sys
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
        print(f"Error: this script migrates {FROM_VERSION} -> {TO_VERSION}")
        print(f"       bundle has format_version: {actual!r}")
        sys.exit(1)


def migrate(bundle_path: Path) -> None:
    check_version(bundle_path)

    # --- Apply 0.1 -> 0.2 changes here ---
    # Example:
    #   for entity_file in bundle_path.rglob("*.json"):
    #       data = json.loads(entity_file.read_text())
    #       if "$schema" in data:
    #           data["$schema"] = data["$schema"].replace("/0.1/", "/0.2/")
    #       entity_file.write_text(json.dumps(data, indent=2))

    # Update manifest version
    manifest_path = bundle_path / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["format_version"] = TO_VERSION
    manifest_path.write_text(json.dumps(manifest, indent=2))

    print(f"Migrated {bundle_path} from {FROM_VERSION} to {TO_VERSION}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: python {sys.argv[0]} <bundle-path>")
        sys.exit(1)
    migrate(Path(sys.argv[1]))
