#!/usr/bin/env python3
"""Pull GitHub cloud-build artifacts on a fast node and rsync them to Beijing."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

BUILD_ID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'").strip('"')
    return values


class Config:
    def __init__(self, env: dict[str, str]) -> None:
        merged = {**env}
        for key, value in os.environ.items():
            if key in (
                "ADMIN_BASE_URL",
                "WORKER_TOKEN",
                "GITHUB_TOKEN",
                "GITHUB_API",
                "BEIJING_SSH",
                "BEIJING_ARTIFACT_ROOT",
                "BEIJING_PHP",
                "BEIJING_APP_ROOT",
                "POLL_SECONDS",
                "WORK_DIR",
                "DOWNLOAD_TIMEOUT",
            ):
                merged[key] = value
        self.admin_base = merged.get("ADMIN_BASE_URL", "https://agent.haohuoban.com").rstrip("/")
        self.worker_token = merged.get("WORKER_TOKEN", "")
        self.github_token = merged.get("GITHUB_TOKEN", "")
        self.github_api = merged.get("GITHUB_API", "https://api.github.com").rstrip("/")
        self.beijing_ssh = merged.get("BEIJING_SSH", "root@123.56.114.223")
        self.beijing_root = merged.get(
            "BEIJING_ARTIFACT_ROOT",
            "/www/wwwroot/agent.haohuoban.com/storage/app/cloud-build-artifacts",
        ).rstrip("/")
        self.beijing_php = merged.get("BEIJING_PHP", "/www/server/php/82/bin/php")
        self.beijing_app = merged.get("BEIJING_APP_ROOT", "/www/wwwroot/agent.haohuoban.com")
        self.poll_seconds = int(merged.get("POLL_SECONDS") or "30")
        self.work_dir = Path(merged.get("WORK_DIR") or "/var/lib/agent-mirror-worker")
        self.download_timeout = int(merged.get("DOWNLOAD_TIMEOUT") or "1800")


class MirrorError(RuntimeError):
    pass


def die(message: str, code: int = 1) -> None:
    print(f"[mirror] {message}", file=sys.stderr)
    raise SystemExit(code)


def fail(message: str) -> None:
    raise MirrorError(message)


def log(message: str) -> None:
    print(f"[mirror] {message}", flush=True)


def run(cmd: list[str], timeout: int | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=False, text=True, capture_output=True, timeout=timeout)


def require_build_id(build_id: str) -> str:
    if not BUILD_ID_RE.match(build_id):
        die(f"invalid build_id: {build_id}")
    return build_id.lower()


def github_headers(cfg: Config) -> dict[str, str]:
    if not cfg.github_token:
        die("GITHUB_TOKEN is empty")
    return {
        "Authorization": f"Bearer {cfg.github_token}",
        "User-Agent": "haohuoban-mirror-worker",
    }


def http_json(url: str, headers: dict[str, str], data: dict[str, Any] | None = None, method: str = "GET") -> tuple[int, Any]:
    body = None
    req_headers = dict(headers)
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
        method = method if method != "GET" else "POST"
    request = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            raw = response.read().decode("utf-8") or "{}"
            return response.status, json.loads(raw)
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            parsed: Any = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            parsed = {"error": raw[:240]}
        return exc.code, parsed


def admin_headers(cfg: Config) -> dict[str, str]:
    if not cfg.worker_token:
        die("WORKER_TOKEN is empty; poll/ack need the same token as 云控 CLOUDBUILD_MIRROR_WORKER_TOKEN")
    return {
        "Authorization": f"Bearer {cfg.worker_token}",
        "Accept": "application/json",
        "User-Agent": "haohuoban-mirror-worker",
    }


def ssh(cfg: Config, remote: str, timeout: int = 60) -> subprocess.CompletedProcess[str]:
    return run(
        [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "ConnectTimeout=15",
            cfg.beijing_ssh,
            remote,
        ],
        timeout=timeout,
    )


def download_asset(cfg: Config, url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    cmd = [
        "curl",
        "-fL",
        "--retry",
        "3",
        "--retry-delay",
        "2",
        "--connect-timeout",
        "20",
        "--max-time",
        str(cfg.download_timeout),
        "-C",
        "-",
        "-H",
        f"Authorization: Bearer {cfg.github_token}",
        "-H",
        "Accept: application/octet-stream",
        "-H",
        "User-Agent: haohuoban-mirror-worker",
        "-o",
        str(part),
        url,
    ]
    log(f"download {dest.name}")
    result = run(cmd, timeout=cfg.download_timeout + 30)
    if result.returncode != 0:
        fail(f"curl failed for {dest.name}: {result.stderr.strip() or result.stdout.strip()}")
    part.replace(dest)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_asset(path: Path, expected_sha: str, expected_size: int) -> None:
    actual_size = path.stat().st_size
    if expected_size > 1024 and actual_size < int(expected_size * 0.5):
        fail(f"{path.name} size {actual_size} << expected {expected_size}")
    if expected_size > 0 and actual_size != expected_size:
        log(f"warn {path.name} size {actual_size} expected {expected_size}")
    expected = expected_sha.lower()
    if expected and expected != "0" * 64:
        actual = sha256_file(path)
        if actual != expected:
            path.unlink(missing_ok=True)
            fail(f"sha256 mismatch {path.name}")


def rsync_build(cfg: Config, build_id: str, local_dir: Path) -> None:
    remote = f"{cfg.beijing_ssh}:{cfg.beijing_root}/{build_id}/"
    mkdir = ssh(cfg, f"mkdir -p {cfg.beijing_root}/{build_id}")
    if mkdir.returncode != 0:
        fail(f"cannot mkdir on Beijing: {mkdir.stderr.strip()}")
    result = run(
        [
            "rsync",
            "-az",
            "--partial",
            "--exclude",
            "*.part",
            f"{local_dir}/",
            remote,
        ],
        timeout=cfg.download_timeout,
    )
    if result.returncode != 0:
        fail(f"rsync failed: {result.stderr.strip() or result.stdout.strip()}")
    log(f"rsync {build_id} -> Beijing")


def here() -> Path:
    return Path(__file__).resolve().parent


def scp_to_beijing(cfg: Config, local: Path, remote: str) -> None:
    result = run(
        [
            "scp",
            "-o",
            "BatchMode=yes",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "ConnectTimeout=15",
            str(local),
            f"{cfg.beijing_ssh}:{remote}",
        ],
        timeout=30,
    )
    if result.returncode != 0:
        fail(f"scp {local.name} failed: {result.stderr.strip() or result.stdout.strip()}")


def run_beijing_php(cfg: Config, script_name: str, env_assigns: str, timeout: int = 90) -> subprocess.CompletedProcess[str]:
    remote_script = f"/tmp/{script_name}"
    scp_to_beijing(cfg, here() / script_name, remote_script)
    return ssh(
        cfg,
        f"export {env_assigns}; cd {cfg.beijing_app} && {cfg.beijing_php} artisan tinker --execute='require \"{remote_script}\";'",
        timeout=timeout,
    )


def mark_ready_on_beijing(cfg: Config, build_id: str, primary_name: str) -> None:
    result = run_beijing_php(
        cfg,
        "beijing_mark_ready.php",
        f"MIRROR_BUILD_ID={build_id} MIRROR_PRIMARY={primary_name}",
    )
    if result.returncode != 0:
        fail(f"Beijing mark-ready failed: {result.stderr.strip() or result.stdout.strip()}")
    log(f"Beijing phase={result.stdout.strip() or 'unknown'}")


def dump_assets_from_beijing(cfg: Config, build_id: str) -> list[dict[str, Any]]:
    result = run_beijing_php(cfg, "beijing_dump.php", f"MIRROR_BUILD_ID={build_id}", timeout=60)
    if result.returncode != 0:
        fail(f"cannot read release_assets: {result.stderr.strip() or result.stdout.strip()}")
    try:
        assets = json.loads(result.stdout.strip() or "[]")
    except json.JSONDecodeError as exc:
        fail(f"Beijing returned non-json assets: {result.stdout[:200]} ({exc})")
    if not isinstance(assets, list) or assets == []:
        fail(f"no release_assets for {build_id}")
    return assets


def process_assets(cfg: Config, build_id: str, assets: list[dict[str, Any]]) -> str:
    local_dir = cfg.work_dir / build_id
    local_dir.mkdir(parents=True, exist_ok=True)
    primary = ""
    for asset in assets:
        filename = Path(str(asset.get("filename") or "")).name
        url = str(asset.get("asset_url") or "")
        if not filename or not url:
            fail(f"asset missing filename/url: {asset}")
        dest = local_dir / filename
        if dest.is_file() and dest.stat().st_size == int(asset.get("size") or 0):
            log(f"reuse {filename}")
        else:
            download_asset(cfg, url, dest)
        verify_asset(dest, str(asset.get("sha256") or ""), int(asset.get("size") or 0))
        if str(asset.get("role") or "") == "primary" or not primary:
            primary = filename
    rsync_build(cfg, build_id, local_dir)
    mark_ready_on_beijing(cfg, build_id, primary)
    return primary


def cmd_doctor(cfg: Config) -> None:
    cfg.work_dir.mkdir(parents=True, exist_ok=True)
    if not cfg.github_token:
        die("GITHUB_TOKEN is empty")
    status, body = http_json(f"{cfg.github_api}/rate_limit", github_headers(cfg))
    if status == 200:
        remaining = ((body or {}).get("rate") or {}).get("remaining")
        log(f"GitHub API ok remaining={remaining}")
    else:
        log(f"warn GitHub token {status}: API 拒绝，私有 Release 会下不下来；先检查 云控 GITHUB_BUILD_TOKEN")
        anon_status, _ = http_json(f"{cfg.github_api}/rate_limit", {"User-Agent": "haohuoban-mirror-worker"})
        if anon_status != 200:
            die(f"GitHub unreachable {anon_status}")
        log("GitHub 网络可达（未认证）")
    result = ssh(cfg, "hostname && test -d /www/wwwroot/agent.haohuoban.com/storage/app && echo beijing_app_ok")
    if result.returncode != 0:
        die(f"SSH Beijing failed: {result.stderr.strip() or result.stdout.strip()}")
    log(result.stdout.strip().replace("\n", " | "))
    if cfg.worker_token:
        status, body = http_json(f"{cfg.admin_base}/api/cloud-build/mirror/pending", admin_headers(cfg))
        log(f"pending API {status}")
        if status == 503:
            log("云控还没写 WORKER_TOKEN，只可用 push，不要开 poll")
        elif status != 200:
            die(f"pending failed: {body}")
    else:
        log("WORKER_TOKEN empty: poll disabled, push still works")


def cmd_push(cfg: Config, build_id: str) -> None:
    build_id = require_build_id(build_id)
    try:
        assets = dump_assets_from_beijing(cfg, build_id)
        process_assets(cfg, build_id, assets)
    except MirrorError as exc:
        die(str(exc))
    log(f"push done {build_id}")


def cmd_poll(cfg: Config) -> None:
    if not cfg.worker_token:
        die("poll requires WORKER_TOKEN matching 云控 CLOUDBUILD_MIRROR_WORKER_TOKEN")
    log(f"poll {cfg.admin_base} every {cfg.poll_seconds}s")
    while True:
        status, body = http_json(f"{cfg.admin_base}/api/cloud-build/mirror/pending", admin_headers(cfg))
        if status == 503:
            log("云控未配置 worker token，sleep")
        elif status != 200:
            log(f"pending {status} {body}")
        else:
            items = (body or {}).get("items") or []
            if (body or {}).get("paused"):
                log("workers paused")
            for item in items:
                build_id = require_build_id(str(item.get("build_id") or ""))
                assets = item.get("release_assets") or []
                if not isinstance(assets, list) or assets == []:
                    assets = dump_assets_from_beijing(cfg, build_id)
                try:
                    process_assets(cfg, build_id, assets)
                    ack_status, ack_body = http_json(
                        f"{cfg.admin_base}/api/cloud-build/mirror/{build_id}/ack",
                        admin_headers(cfg),
                        {"mirror_url_primary": f"{cfg.beijing_root}/{build_id}"},
                    )
                    log(f"ack {build_id} {ack_status} {ack_body}")
                except MirrorError as exc:
                    http_json(
                        f"{cfg.admin_base}/api/cloud-build/mirror/{build_id}/fail",
                        admin_headers(cfg),
                        {"error": str(exc)[:400]},
                    )
                    log(f"fail reported {build_id}: {exc}")
        time.sleep(cfg.poll_seconds)


def main(argv: list[str]) -> None:
    root = Path(__file__).resolve().parent.parent
    cfg = Config(load_env(root / ".env"))
    if len(argv) < 2 or argv[1] in {"-h", "--help"}:
        print("usage: python3 src/worker.py doctor|push <build_id>|poll")
        raise SystemExit(0)
    command = argv[1]
    if command == "doctor":
        cmd_doctor(cfg)
        return
    if command == "push":
        if len(argv) < 3:
            die("usage: python3 src/worker.py push <build_id>")
        cmd_push(cfg, argv[2])
        return
    if command == "poll":
        cmd_poll(cfg)
        return
    die(f"unknown command: {command}")


if __name__ == "__main__":
    main(sys.argv)
