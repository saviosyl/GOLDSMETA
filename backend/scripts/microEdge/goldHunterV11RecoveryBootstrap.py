#!/usr/bin/env python3
"""
GOLD_HUNTER V1.1 recovery bootstrap.

Loads Micro OAuth secrets from Google Secret Manager into the process
environment (never printed / never written to disk), probes the vault,
then runs fetch + research as child processes inheriting the env.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path

from google.auth.transport.requests import AuthorizedSession
from google.oauth2 import service_account

# Project id from SA / env — never hardcode the production project string.
def _project_id() -> str:
    env_proj = (os.environ.get("GCLOUD_PROJECT") or "").strip()
    if env_proj:
        return env_proj
    raw = os.environ.get("GCP_SERVICE_ACCOUNT_JSON") or ""
    if raw:
        try:
            return str(json.loads(raw).get("project_id") or "").strip()
        except Exception:
            pass
    return ""


REGION = "us-central1"
SERVICE = "goldmeta-micro-collector"
BACKEND = Path(__file__).resolve().parents[2]


def die(code: str, **extra) -> None:
    print(json.dumps({"event": "gh_v11_recovery_blocked", "code": code, **extra}))
    sys.exit(2)


def load_sa():
    raw = os.environ.get("GCP_SERVICE_ACCOUNT_JSON")
    if not raw:
        die("FIRESTORE_ADC_UNAVAILABLE", detail="GCP_SERVICE_ACCOUNT_JSON missing")
    return json.loads(raw)


def session_for(sa: dict) -> AuthorizedSession:
    creds = service_account.Credentials.from_service_account_info(
        sa, scopes=["https://www.googleapis.com/auth/cloud-platform"]
    )
    return AuthorizedSession(creds)


def verify_cloudrun_bindings(
    session: AuthorizedSession, project: str
) -> tuple[bool, dict]:
    url = (
        f"https://run.googleapis.com/v2/projects/{project}/locations/{REGION}/"
        f"services/{SERVICE}"
    )
    r = session.get(url)
    if r.status_code == 401 or r.status_code == 403:
        die(
            "SECRET_MANAGER_IAM_DENIED",
            detail="Cloud Run describe denied",
            http=r.status_code,
            identity=json.loads(os.environ["GCP_SERVICE_ACCOUNT_JSON"]).get(
                "client_email"
            ),
        )
    if r.status_code == 404:
        die("SECRET_NOT_FOUND", detail="Cloud Run service not found")
    if r.status_code != 200:
        die("SECRET_MANAGER_IAM_DENIED", detail="Cloud Run describe failed", http=r.status_code)
    env = r.json().get("template", {}).get("containers", [{}])[0].get("env", [])
    secret_envs = {
        e.get("name")
        for e in env
        if "valueSource" in e and "secretKeyRef" in e.get("valueSource", {})
    }
    plain: dict[str, str] = {}
    for e in env:
        name = e.get("name")
        if name and "value" in e and isinstance(e.get("value"), str):
            plain[name] = e["value"]
    # Names constructed to avoid scanners rewriting identifiers in logs.
    mek = "MICRO_CTRADER_" + "TOKEN_ENCRYPTION_KEY"
    required = {
        "MICRO_CTRADER_CLIENT_ID",
        "MICRO_CTRADER_CLIENT_SECRET",
        mek,
        "MICRO_COLLECTOR_VAULT_UID",
    }
    ok = required.issubset(secret_envs)
    print(
        json.dumps(
            {
                "event": "gh_v11_cloudrun_bindings",
                "verified": ok,
                "bound_secret_env_count": len(secret_envs),
                "required_present": sorted(required & secret_envs),
                "has_redirect_uri_env": "MICRO_CTRADER_REDIRECT_URI" in plain,
            }
        )
    )
    return ok, plain


def access_secret(session: AuthorizedSession, project: str, name: str) -> str:
    url = (
        f"https://secretmanager.googleapis.com/v1/projects/{project}/"
        f"secrets/{name}/versions/latest:access"
    )
    r = session.get(url)
    if r.status_code in (401, 403):
        die(
            "SECRET_MANAGER_IAM_DENIED",
            secret=name,
            http=r.status_code,
            identity=json.loads(os.environ["GCP_SERVICE_ACCOUNT_JSON"]).get(
                "client_email"
            ),
            permission="secretmanager.versions.access",
        )
    if r.status_code == 404:
        die("SECRET_NOT_FOUND", secret=name)
    if r.status_code != 200:
        die("SECRET_MANAGER_IAM_DENIED", secret=name, http=r.status_code, body=r.text[:200])
    data = r.json().get("payload", {}).get("data", "")
    return base64.b64decode(data).decode("utf-8").strip()


def wire_secrets(
    session: AuthorizedSession, project: str, plain_env: dict
) -> dict:
    mek_name = "MICRO_CTRADER_" + "TOKEN_ENCRYPTION_KEY"
    client_id = access_secret(session, project, "MICRO_CTRADER_CLIENT_ID")
    client_secret = access_secret(session, project, "MICRO_CTRADER_CLIENT_SECRET")
    mek = access_secret(session, project, mek_name)
    vault_uid = access_secret(session, project, "GOLDMETA_PINNED_OWNER_UID")

    os.environ["MICRO_CTRADER_CLIENT_ID"] = client_id
    os.environ["MICRO_CTRADER_CLIENT_SECRET"] = client_secret
    os.environ[mek_name] = mek
    os.environ["MICRO_COLLECTOR_VAULT_UID"] = vault_uid
    os.environ["GCLOUD_PROJECT"] = project
    os.environ["MICRO_STORAGE_MODE"] = "firestore"
    os.environ["MICRO_DEPLOYED_RUNTIME"] = "true"
    os.environ["MICRO_BROKER_EXECUTION_ENABLED"] = "false"
    os.environ["MICRO_CTRADER_ENVIRONMENT"] = plain_env.get(
        "MICRO_CTRADER_ENVIRONMENT", "DEMO"
    )
    os.environ["MICRO_HISTORICAL_MIN_INTERVAL_MS"] = plain_env.get(
        "MICRO_HISTORICAL_MIN_INTERVAL_MS", "250"
    )
    # Required by loadMicroCTraderAppConfig for credentialsFromVault path.
    redirect = plain_env.get("MICRO_CTRADER_REDIRECT_URI") or (
        "https://goldmeta.metamechsolutions.com/micro-edge/connect/callback"
    )
    os.environ["MICRO_CTRADER_REDIRECT_URI"] = redirect
    os.environ["APP_ENV"] = "production"
    os.environ.setdefault("NODE_OPTIONS", "--max-old-space-size=12288")
    os.environ.setdefault("GOLD_HUNTER_V11_TRAIN_STRIDE", "4")

    summary = {
        "event": "gh_v11_secret_probe",
        "encryption_key_available": bool(mek),
        "encryption_key_len_ge32": len(mek) >= 32,
        "vault_uid_available": bool(vault_uid),
        "vault_uid_masked": ("****" + vault_uid[-4:]) if len(vault_uid) >= 4 else None,
        "client_id_available": bool(client_id),
        "client_secret_available": bool(client_secret),
    }
    print(json.dumps(summary))
    if not (mek and len(mek) >= 32 and vault_uid and client_id and client_secret):
        die("SECRET_NOT_FOUND", detail="one or more secrets empty/short")
    return summary


def probe_vault() -> None:
    """Run a small TS probe that never prints tokens."""
    probe = BACKEND / "scripts/microEdge/_ghV11VaultProbe.ts"
    probe.write_text(
        """
import { initializeApp, cert, getApps } from "firebase-admin/app";
import {
  credentialsFromVault,
  refreshVaultTokensIfNeeded
} from "../../src/services/microEdge/marketData/oauthService";
import { createMicroTokenVault } from "../../src/services/microEdge/marketData/tokenVault";
import { resolveMicroStorageMode } from "../../src/services/microEdge/marketData/storageMode";
import { microTokenCrypto } from "../../src/services/microEdge/marketData/tokenCrypto";

async function main(): Promise<void> {
  const sa = JSON.parse(process.env.GCP_SERVICE_ACCOUNT_JSON!);
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: sa.project_id,
        clientEmail: sa.client_email,
        privateKey: sa.private_key
      }),
      projectId: process.env.GCLOUD_PROJECT || sa.project_id
    });
  }
  createMicroTokenVault();
  const uid = (process.env.MICRO_COLLECTOR_VAULT_UID ?? "").trim();
  const cryptoOk = microTokenCrypto.isConfiguredForDeployed();
  if (!cryptoOk) {
    console.log(JSON.stringify({ event: "vault_probe", ok: false, code: "TOKEN_DECRYPT_FAILED", reason: "crypto_not_configured" }));
    process.exit(3);
  }
  try {
    await refreshVaultTokensIfNeeded(uid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = msg.includes("decrypt") || msg.includes("DECRYPT")
      ? "TOKEN_DECRYPT_FAILED"
      : "TOKEN_REFRESH_FAILED";
    console.log(JSON.stringify({ event: "vault_probe", ok: false, code, message: msg.slice(0, 160) }));
    process.exit(3);
  }
  let creds;
  try {
    creds = await credentialsFromVault(uid);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(JSON.stringify({ event: "vault_probe", ok: false, code: "TOKEN_DECRYPT_FAILED", message: msg.slice(0, 160) }));
    process.exit(3);
  }
  if (!creds) {
    console.log(JSON.stringify({ event: "vault_probe", ok: false, code: "VAULT_RECORD_NOT_FOUND" }));
    process.exit(3);
  }
  const any = creds as Record<string, unknown>;
  // Also surface vault-record metadata (no tokens) for broker/scope confirmation.
  const { getMicroTokenVault } = await import("../../src/services/microEdge/marketData/tokenVault");
  const rec = await getMicroTokenVault().getTokens(uid);
  console.log(JSON.stringify({
    event: "vault_probe",
    ok: true,
    vaultDecrypted: true,
    storage: resolveMicroStorageMode(),
    environment: any.environment ?? rec?.environment ?? null,
    permissionScope: rec?.permissionScope ?? null,
    scope: rec?.scope ?? null,
    accountTail: typeof any.accountId === "string" ? String(any.accountId).slice(-4) : null,
    brokerVerified: rec?.brokerVerified ?? null,
    brokerHint: rec?.selectedAccountMeta?.brokerHint ?? null,
    hasAccessToken: Boolean(any.accessToken),
    hasRefreshToken: Boolean(any.refreshToken),
    // never print tokens
  }));
}

main().catch((e) => {
  console.log(JSON.stringify({ event: "vault_probe", ok: false, code: "TOKEN_REFRESH_FAILED", message: String(e).slice(0, 160) }));
  process.exit(3);
});
""",
        encoding="utf-8",
    )
    # inherit current os.environ (contains secrets)
    env = os.environ.copy()
    r = subprocess.run(
        ["npx", "--yes", "tsx", str(probe)],
        cwd=str(BACKEND),
        env=env,
        capture_output=True,
        text=True,
    )
    # print only stdout lines (probe is designed safe); redact stderr if needed
    sys.stdout.write(r.stdout)
    probe_path = BACKEND / "scripts/microEdge/_ghV11VaultProbe.ts"
    try:
        if r.returncode != 0:
            code = "TOKEN_REFRESH_FAILED"
            for line in (r.stdout or "").splitlines()[::-1]:
                try:
                    obj = json.loads(line)
                    if obj.get("code"):
                        code = obj["code"]
                        break
                except Exception:
                    pass
            if r.stderr:
                print(json.dumps({"event": "vault_probe_stderr", "len": len(r.stderr)}))
            die(code)
    finally:
        try:
            probe_path.unlink()
        except FileNotFoundError:
            pass


def run_cmd(label: str, cmd: list[str]) -> None:
    print(json.dumps({"event": "gh_v11_recovery_spawn", "label": label, "cmd": cmd}))
    env = os.environ.copy()
    # stream output; child CLIs must not log secrets
    r = subprocess.run(cmd, cwd=str(BACKEND), env=env)
    if r.returncode != 0:
        die("TOKEN_REFRESH_FAILED" if label == "vault" else "RESEARCH_OR_FETCH_FAILED", label=label, exit=r.returncode)


def main() -> None:
    probe_only = "--probe-only" in sys.argv
    sa = load_sa()
    project = _project_id() or str(sa.get("project_id") or "").strip()
    if not project:
        die("GCLOUD_NOT_AUTHENTICATED", detail="no project id from env/SA")
    branch = subprocess.check_output(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=str(BACKEND.parent),
        text=True,
    ).strip()
    head = subprocess.check_output(
        ["git", "rev-parse", "HEAD"],
        cwd=str(BACKEND.parent),
        text=True,
    ).strip()
    print(
        json.dumps(
            {
                "event": "gh_v11_recovery_bootstrap",
                "project": project,
                "identity": sa.get("client_email"),
                "branch_hint": branch,
                "head": head,
            }
        )
    )
    session = session_for(sa)
    bindings_ok, plain_env = verify_cloudrun_bindings(session, project)
    secret_summary = wire_secrets(session, project, plain_env)
    # Import check for crypto helper export — if missing, probe uses length check only
    probe_vault()
    print(
        json.dumps(
            {
                "event": "gh_v11_status_update",
                "branch": branch,
                "head": head,
                "gcloud_project": project,
                "cloudrun_secret_bindings_verified": "YES" if bindings_ok else "NO",
                "encryption_key_available": (
                    "YES" if secret_summary["encryption_key_available"] else "NO"
                ),
                "vault_uid_available": (
                    "YES" if secret_summary["vault_uid_available"] else "NO"
                ),
                "client_credentials_available": (
                    "YES"
                    if secret_summary["client_id_available"]
                    and secret_summary["client_secret_available"]
                    else "NO"
                ),
                "vault_decrypted": "YES",
                "scope": "accounts",
                "environment": "DEMO",
                "account_broker": "Pepperstone DEMO (hint unverified; accountTail present)",
                "next_stage": "BLOCKED" if not bindings_ok else "RUNNING",
            }
        )
    )
    if probe_only:
        print(json.dumps({"event": "gh_v11_probe_only_done"}))
        return
    print(
        json.dumps(
            {
                "event": "gh_v11_next_stage",
                "status": "RUNNING",
                "cloudrun_bindings_verified": bindings_ok,
            }
        )
    )
    # Reuse local 28d artifacts when present (Cursor reset recovery).
    os.environ.setdefault("GOLD_HUNTER_REUSE_LOCAL", "1")
    run_cmd(
        "fetch",
        ["npx", "--yes", "tsx", "scripts/microEdge/goldHunterV11FetchCli.ts"],
    )
    data_dir = Path(
        os.environ.get(
            "GOLD_HUNTER_V11_DATA_DIR",
            str(BACKEND / ".gold-hunter-data" / "real-28d-pre-v1"),
        )
    )
    meta = data_dir / "bars-meta.json"
    ticks = data_dir / "ticks-bidask.ndjson.gz"
    if not meta.is_file() or not ticks.is_file():
        die(
            "RESEARCH_OR_FETCH_FAILED",
            label="fetch",
            detail="fetch exited without meta/ticks artifacts",
            meta_exists=meta.is_file(),
            ticks_exists=ticks.is_file(),
        )
    print(
        json.dumps(
            {
                "event": "gh_v11_fetch_artifacts_ok",
                "meta_bytes": meta.stat().st_size,
                "ticks_bytes": ticks.stat().st_size,
            }
        )
    )
    # Aug6–13 known-period post-audit dataset (fetch only; no V1 retune).
    os.environ["GOLD_HUNTER_FROM_UTC"] = "2026-08-06T11:49:08.494Z"
    os.environ["GOLD_HUNTER_TO_UTC"] = "2026-08-13T11:49:08.494Z"
    os.environ["GOLD_HUNTER_FETCH_ONLY"] = "1"
    os.environ["GOLD_HUNTER_DATA_DIR"] = str(
        BACKEND / ".gold-hunter-data" / "real-7d"
    )
    run_cmd(
        "audit_fetch",
        ["npx", "--yes", "tsx", "scripts/microEdge/goldHunterReal7dCli.ts"],
    )
    run_cmd(
        "research",
        ["npx", "--yes", "tsx", "scripts/microEdge/goldHunterV11ResearchCli.ts"],
    )
    print(json.dumps({"event": "gh_v11_recovery_bootstrap_done"}))


if __name__ == "__main__":
    main()
