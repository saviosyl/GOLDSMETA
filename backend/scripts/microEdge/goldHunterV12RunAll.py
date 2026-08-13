#!/usr/bin/env python3
"""Wire secrets then run V1.2 fetch + research. Never prints secret values."""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]


def main() -> None:
    # Project comes from GCP_SERVICE_ACCOUNT_JSON / existing GCLOUD_PROJECT only.
    os.environ["MICRO_BROKER_EXECUTION_ENABLED"] = "false"
    os.environ.setdefault("MICRO_STORAGE_MODE", "firestore")
    os.environ.setdefault("MICRO_DEPLOYED_RUNTIME", "true")
    os.environ.setdefault("MICRO_CTRADER_ENVIRONMENT", "DEMO")
    os.environ.setdefault("MICRO_HISTORICAL_MIN_INTERVAL_MS", "250")
    os.environ.setdefault("NODE_OPTIONS", "--max-old-space-size=14000")
    os.environ.setdefault("GOLD_HUNTER_V12_TRAIN_STRIDE", "8")
    os.environ.setdefault("GOLD_HUNTER_V12_SAMPLE_STRIDE", "3")
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
            "event": "gh_v12_runall_ready",
            "bindings": bindings_ok,
            "reuse": os.environ.get("GOLD_HUNTER_REUSE_LOCAL"),
        },
        flush=True,
    )

    data_dir = Path(
        os.environ.get(
            "GOLD_HUNTER_V12_DATA_DIR",
            str(BACKEND / ".gold-hunter-data" / "real-56d-pre-v11"),
        )
    )
    meta = data_dir / "bars-meta.json"
    if meta.is_file() and os.environ.get("GOLD_HUNTER_REUSE_LOCAL") == "1":
        print({"event": "gh_v12_skip_fetch_reuse"}, flush=True)
    else:
        os.environ["GOLD_HUNTER_REUSE_LOCAL"] = "0"
        print({"event": "gh_v12_spawn_fetch"}, flush=True)
        r = subprocess.run(
            ["npx", "--yes", "tsx", "scripts/microEdge/goldHunterV12FetchCli.ts"],
            cwd=str(BACKEND),
            env=os.environ.copy(),
        )
        if r.returncode != 0 or not meta.is_file():
            print(
                {
                    "event": "gh_v12_fetch_failed",
                    "rc": r.returncode,
                    "meta": meta.is_file(),
                },
                flush=True,
            )
            sys.exit(2)

    print({"event": "gh_v12_spawn_research"}, flush=True)
    r2 = subprocess.run(
        ["npx", "--yes", "tsx", "scripts/microEdge/goldHunterV12ResearchCli.ts"],
        cwd=str(BACKEND),
        env=os.environ.copy(),
    )
    print({"event": "gh_v12_runall_done", "rc": r2.returncode}, flush=True)
    sys.exit(r2.returncode)


if __name__ == "__main__":
    main()
