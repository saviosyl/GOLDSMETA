#!/usr/bin/env python3
"""Wire secrets then run GOLD_HUNTER FAST real DEMO Level-II probe. Never prints secrets."""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]


def main() -> None:
    os.environ["MICRO_BROKER_EXECUTION_ENABLED"] = "false"
    os.environ.setdefault("MICRO_STORAGE_MODE", "firestore")
    os.environ.setdefault("MICRO_DEPLOYED_RUNTIME", "true")
    os.environ.setdefault("MICRO_CTRADER_ENVIRONMENT", "DEMO")
    os.environ.setdefault("GOLD_HUNTER_FAST_SHADOW_ENABLED", "true")
    os.environ.setdefault("GOLD_HUNTER_FAST_PROBE_MS", "180000")
    os.environ.setdefault("NODE_OPTIONS", "--max-old-space-size=4096")

    boot_path = BACKEND / "scripts/microEdge/goldHunterV11RecoveryBootstrap.py"
    spec = importlib.util.spec_from_file_location("ghboot", boot_path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)

    sa = mod.load_sa()
    project = mod._project_id() or str(sa.get("project_id") or "").strip()
    session = mod.session_for(sa)
    bindings_ok, plain = mod.verify_cloudrun_bindings(session, project)
    mod.wire_secrets(session, project, plain)
    mod.probe_vault()
    print(
        {
            "event": "gh_fast_probe_ready",
            "bindings": bindings_ok,
            "fastEnabled": os.environ.get("GOLD_HUNTER_FAST_SHADOW_ENABLED"),
        },
        flush=True,
    )

    r = subprocess.run(
        ["npx", "--yes", "tsx", "scripts/microEdge/goldHunterFastRealProbeCli.ts"],
        cwd=str(BACKEND),
        env=os.environ.copy(),
    )
    print({"event": "gh_fast_probe_done", "rc": r.returncode}, flush=True)
    raise SystemExit(r.returncode)


if __name__ == "__main__":
    main()
