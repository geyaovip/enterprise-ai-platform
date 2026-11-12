#!/usr/bin/env python3
"""Prepare and activate a Cloudflare frontend from a successful main-branch CI build."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import tarfile
import tempfile
import time
import zipfile
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError
from urllib.request import Request, urlopen


REPO = "geyaovip/enterprise-ai-platform"
ORIGIN = "https://zhixingark.cn"
TARGETS = {"workspace": "web", "tenant-admin": "admin", "platform-admin": "platform-admin"}
VERSION = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"


def run(*command, cwd=None):
    return subprocess.check_output(command, cwd=cwd, timeout=240)


def gh(path):
    return json.loads(run("gh", "api", f"repos/{REPO}/{path}"))


def digest(path):
    with path.open("rb") as stream:
        result = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
        return result.hexdigest()


def save(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    tmp.replace(path)


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def download_build(sha, directory):
    runs = gh(f"actions/workflows/ci.yml/runs?branch=main&head_sha={sha}&status=success")["workflow_runs"]
    run_ids = [row["id"] for row in runs if row["head_sha"] == sha
               and row["head_branch"] == "main" and row["conclusion"] == "success"
               and row["event"] in ("push", "workflow_dispatch")
               and row["head_repository"]["full_name"] == REPO]
    for run_id in run_ids:
        artifacts = gh(f"actions/runs/{run_id}/artifacts")["artifacts"]
        artifact = next((row for row in artifacts if row["name"] == f"frontends-{sha}"
                         and not row["expired"]), None)
        if artifact:
            break
    else:
        raise RuntimeError("No successful main CI run with an available artifact for this SHA")

    zip_path = directory / "github-artifact.zip"
    with zip_path.open("wb") as stream:
        subprocess.run(["gh", "api", f"repos/{REPO}/actions/artifacts/{artifact['id']}/zip"],
                       stdout=stream, check=True, timeout=240)
    require(artifact.get("digest") == "sha256:" + digest(zip_path), "GitHub artifact digest mismatch")
    with zipfile.ZipFile(zip_path) as archive:
        require(archive.namelist() == ["frontends.tar.gz"], "Unexpected CI artifact contents")
        with archive.open("frontends.tar.gz") as packed, tarfile.open(fileobj=packed, mode="r|gz") as tar:
            bundle = directory / "bundle"
            bundle.mkdir()
            for member in tar:
                name = PurePosixPath(member.name)
                require(not name.is_absolute() and ".." not in name.parts and
                        (member.isfile() or member.isdir()), f"Invalid archive member: {member.name}")
                tar.extract(member, bundle)
    require((bundle / "release-sha.txt").read_text().strip() == sha, "CI archive SHA mismatch")
    zip_path.unlink()
    return {"repository": REPO, "sha": sha, "ci_run": run_id, "artifact_id": artifact["id"],
            "artifact_digest": artifact["digest"]}


def wrangler(target, bundle, *args):
    executable = [os.environ["WRANGLER"]] if "WRANGLER" in os.environ else ["npx", "--yes", "wrangler@4.151.0"]
    return run(*executable, *args, "--config", f"wrangler.{target}.jsonc", cwd=bundle)


def current(target, bundle):
    rows = json.loads(wrangler(target, bundle, "deployments", "list", "--json"))
    deployment = max(rows, key=lambda row: row["created_on"])
    versions = deployment["versions"]
    require(len(versions) == 1 and versions[0]["percentage"] == 100, "Expected a single active Worker version")
    return {"deployment": deployment["id"], "version": versions[0]["version_id"]}


def fetch(path, version):
    request = Request(ORIGIN + path + "?release-check=" + version, headers={"Cache-Control": "no-cache"})
    with urlopen(request, timeout=20) as response:
        return response.read()


def prefix(target):
    return "" if target == "workspace" else "/" + target


def asset_name(name):
    return isinstance(name, str) and re.fullmatch(r"[-\w.]+", name) and name not in (".", "..")


def retain_previous(target, baseline, dist, bootstrap, bootstrap_version):
    try:
        previous = json.loads(fetch(prefix(target) + "/release-info.json", baseline["version"]))
    except HTTPError as error:
        if error.code != 404:
            raise
        require(bootstrap and bootstrap_version == baseline["version"],
                "First release needs the current asset manifest and matching --previous-version")
        names = json.loads(bootstrap.read_text())
        require(isinstance(names, list) and names, "Invalid previous asset manifest")
        previous = {"assets": dict.fromkeys(names)}
    assets = previous["assets"]
    require(isinstance(assets, dict) and assets, "Missing previous asset inventory")
    for name, expected in assets.items():
        require(asset_name(name), f"Invalid previous asset name: {name}")
        local = dist / "assets" / name
        if local.exists() and expected is not None:
            require(digest(local) == expected, f"Same asset name has different content: {name}")
            continue
        body = fetch(prefix(target) + "/assets/" + name, baseline["version"])
        if expected is not None:
            require(hashlib.sha256(body).hexdigest() == expected, f"Previous asset digest mismatch: {name}")
        if local.exists():
            require(local.read_bytes() == body, f"Same asset name has different content: {name}")
        else:
            local.write_bytes(body)


def prepare(args):
    require(re.fullmatch(r"[0-9a-f]{40}", args.sha), "Supply the complete Git commit SHA")
    directory = Path("var/releases") / args.sha / args.target
    require(not directory.exists(), "A receipt already exists for this SHA and frontend")
    directory.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=directory.parent, prefix=f".{args.target}-") as temp:
        stage = Path(temp) / "release"
        stage.mkdir()
        receipt = stage_release(args, stage)
        stage.rename(directory)
    print(f"{directory / 'receipt.json'}\nCandidate {receipt['candidate']} uploaded")


def stage_release(args, directory):
    target = args.target
    source = download_build(args.sha, directory)
    bundle = directory / "bundle"
    app = TARGETS[target]
    dist = bundle / "apps" / app / "dist"
    baseline = current(target, bundle)
    names = json.loads((bundle / f"var/cloud-frontend-assets/{app}.json").read_text())
    require(isinstance(names, list) and names and all(asset_name(name) for name in names), "Invalid CI asset manifest")
    info = {**source, "target": target, "assets": {name: digest(dist / "assets" / name) for name in names}}
    retain_previous(target, baseline, dist, args.previous_assets, args.previous_version)
    save(dist / "release-info.json", info)
    require(current(target, bundle) == baseline, "Cloudflare deployment changed during preparation")
    output = wrangler(target, bundle, "versions", "upload", "--strict",
                      "--tag", "git-" + args.sha[:12], "--message", f"Git {args.sha} | CI {source['ci_run']}").decode()
    versions = set(re.findall(rf"^.*?version(?:\s+id)?:\s*({VERSION})\s*$", output, re.I | re.M))
    require(len(versions) == 1, "Could not identify the uploaded Cloudflare version")
    receipt = {"source": source, "target": target, "previous": baseline, "candidate": versions.pop()}
    save(directory / "receipt.json", receipt)
    return receipt


def deploy(target, bundle, version, message):
    require(re.fullmatch(VERSION, version), "Invalid Cloudflare version ID")
    wrangler(target, bundle, "versions", "deploy", version + "@100", "--yes", "--message", message)
    active = current(target, bundle)
    require(active["version"] == version, "Cloudflare returned an unexpected active version")
    return active


def smoke(target, bundle, version):
    origin_path = prefix(target)
    dist = bundle / "apps" / TARGETS[target] / "dist"
    expected = json.loads((dist / "release-info.json").read_text())
    require(json.loads(fetch(origin_path + "/release-info.json", version)) == expected, "Live release identity mismatch")
    route = origin_path + "/" if origin_path else "/login"
    entry = "index.html" if origin_path else "app.html"
    pattern = rb'(?:src|href)="([^"]+/assets/[^"]+|/assets/[^"]+)"'
    paths = set(re.findall(pattern, (dist / entry).read_bytes()))
    require(paths and set(re.findall(pattern, fetch(route, version))) == paths, "Live app entry asset paths mismatch")
    for name, sha in expected["assets"].items():
        require(hashlib.sha256(fetch(origin_path + "/assets/" + name, version)).hexdigest() == sha,
                f"Live asset digest mismatch: {name}")
    require(json.loads(fetch("/api/v1/health", version)).get("database") == "ready", "Gateway API health check failed")


def activate_or_rollback(args):
    path = args.receipt.resolve()
    receipt = json.loads(path.read_text())
    bundle = path.parent / "bundle"
    target, candidate, previous = receipt["target"], receipt["candidate"], receipt["previous"]
    source = receipt["source"]
    label = f"Git {source['sha']} | CI {source['ci_run']}"
    active = current(target, bundle)
    if args.action == "rollback":
        require(active["version"] == candidate, "Current version is not this receipt's candidate")
        receipt["rollback"] = deploy(target, bundle, previous["version"], "Rollback " + label)
    else:
        require(active == previous or active["version"] == candidate, "Production changed since this receipt was prepared")
        try:
            receipt["active"] = active if active["version"] == candidate else deploy(target, bundle, candidate, label)
            save(path, receipt)
            for attempt in range(3):
                try:
                    smoke(target, bundle, candidate)
                    break
                except (RuntimeError, OSError, ValueError):
                    if attempt == 2:
                        raise
                    time.sleep(3)
            receipt["smoke"] = "passed"
        except Exception:
            if current(target, bundle)["version"] == candidate:
                receipt["rollback"] = deploy(target, bundle, previous["version"], "Smoke rollback " + label)
                save(path, receipt)
            raise
    save(path, receipt)
    print(f"{args.action} complete: {path}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    stage = actions.add_parser("prepare")
    stage.add_argument("sha")
    stage.add_argument("target", choices=TARGETS)
    stage.add_argument("--previous-assets", type=Path)
    stage.add_argument("--previous-version")
    for action in ("activate", "rollback"):
        command = actions.add_parser(action)
        command.add_argument("receipt", type=Path)
    args = parser.parse_args()
    if args.action == "prepare":
        prepare(args)
    else:
        activate_or_rollback(args)


if __name__ == "__main__":
    main()
