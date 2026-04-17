#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_shared"))

from manifest_tooling import run_install_cli


if __name__ == "__main__":
    raise SystemExit(run_install_cli(Path(__file__).resolve().parent))
