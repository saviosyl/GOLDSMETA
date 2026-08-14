#!/usr/bin/env python3
"""
GOLD_HUNTER V1.2 bootstrap — Secret Manager → vault probe → fetch → research.
Never prints secret values.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[2]
V11_BOOT = BACKEND / "scripts/microEdge/goldHunterV11RecoveryBootstrap.py"


def load_v11_boot():
    spec = importlib.util.spec_from_file_location("ghv11boot", V11_BOOT)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    boot = load_v11_boot()
    sa = boot.load_sa()
    project = boot._project_id() or str(sa.get("project_id") or "").strip()
    if not project:
        boot.die("GCLOUD_NOT_AUTHENTICATED", detail="no project id")
    session = boot.session_for(sa)
    bindings_ok, plain_env = boot.verify_cloudrun_bindings(session, project)
    boot.wire_secrets(session, project, plain_env)
    boot.probe_vault()
    print(
        json.dumps(
            {
                "event": "gh_v12_bootstrap",
                "project": project,
                "cloudrun_bindings_verified": bindings_ok,
                "next": "RUNNING",
            }
        )
    )
    os.environ.setdefault("NODE_OPTIONS", "--max-old-space-size=12288")
    os.environ.setdefault("GOLD_HUNTER_V12_TRAIN_STRIDE", "6")
    os.environ["MICRO_BROKER_EXECUTION_ENABLED"] = "false"

    def run(label: str, cmd: list[str]) -> None:
        print(json.dumps({"event": "gh_v12_spawn", "label": label, "cmd": cmd}))
        r = subprocess.run(cmd, cwd=str(BACKEND), env=os.environ.copy())
        if r.returncode != 0:
            boot.die("RESEARCH_OR_FETCH_FAILED", label=label, exit=r.returncode)

    data_dir = Path(
        os.environ.get(
            "GOLD_HUNTER_V12_DATA_DIR",
            str(BACKEND / ".gold-hunter-data" / "real-56d-pre-v11"),
        )
    )
    meta = data_dir / "bars-meta.json"
    # Only reuse when a complete meta artifact already exists.
    os.environ["GOLD_HUNTER_REUSE_LOCAL"] = "1" if meta.is_file() else "0"
    run("fetch", ["npx", "--yes", "tsx", "scripts/microEdge/goldHunterV12FetchCli.ts"])
    if not meta.is_file():
        boot.die("RESEARCH_OR_FETCH_FAILED", detail="missing v12 meta")
    run(
        "research",
        ["npx", "--yes", "tsx", "scripts/microEdge/goldHunterV12ResearchCli.ts"],
    )
    print(json.dumps({"event": "gh_v12_bootstrap_done"}))


if __name__ == "__main__":
    main()
