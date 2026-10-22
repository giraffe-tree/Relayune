#!/usr/bin/env python3
"""Query OSV for locked Cargo and hosted Pub package versions (Python >=3.11).

This explicit network audit sends only public package names/ecosystems/versions,
not source, local paths, credentials, or runtime state. It does not install or run
dependencies. Advisory presence includes maintenance notices, not just exploitable
vulnerabilities. An API error is a failed audit, never a clean result.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
LOCKS = ["desktop/src-tauri/Cargo.lock", "mobile/pubspec.lock",
         "docs/design/startup-effects-preview/pubspec.lock",
         "docs/design/history-loading-preview/pubspec.lock"]


def packages():
    result = set()
    for package in tomllib.loads((ROOT / LOCKS[0]).read_text())["package"]:
        if package.get("source", "").startswith("registry+"):
            result.add(("crates.io", package["name"], package["version"]))
    for lock in LOCKS[1:]:
        # Pub's generated lockfile has fixed two-space package entries; SDK/path
        # dependencies are intentionally excluded from versioned hosted queries.
        for block in re.finditer(r"^  ([a-zA-Z0-9_]+):\n(.*?)(?=^  [a-zA-Z0-9_]+:|\Z)", (ROOT / lock).read_text(), re.M | re.S):
            if re.search(r"^    source: hosted\s*$", block[2], re.M):
                version = re.search(r'^    version: "([^"]+)"\s*$', block[2], re.M)
                if not version:
                    raise ValueError("Hosted Pub lock entry has no version")
                result.add(("Pub", block[1], version[1]))
    return sorted(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fail-on-findings", action="store_true")
    args = parser.parse_args()
    selected = packages()
    findings = []
    for start in range(0, len(selected), 100):
        batch = selected[start:start + 100]
        pending = [(item, {"package": {"ecosystem": item[0], "name": item[1]}, "version": item[2]}) for item in batch]
        by_package = {item: set() for item in batch}
        while pending:
            request = urllib.request.Request("https://api.osv.dev/v1/querybatch",
                data=json.dumps({"queries": [query for _, query in pending]}).encode(),
                headers={"Content-Type": "application/json", "User-Agent": "Relayune-dependency-audit"})
            with urllib.request.urlopen(request, timeout=45) as response:
                rows = json.load(response)["results"]
            if len(rows) != len(pending):
                raise ValueError("Incomplete OSV batch response")
            next_page = []
            for (item, query), row in zip(pending, rows):
                by_package[item].update(vulnerability["id"] for vulnerability in row.get("vulns", []))
                if row.get("next_page_token"):
                    next_page.append((item, {**query, "page_token": row["next_page_token"]}))
            pending = next_page
        for (ecosystem, name, version), ids in by_package.items():
            if ids:
                findings.append({"ecosystem": ecosystem, "name": name, "version": version, "advisories": sorted(ids)})
    output = {"provider": "https://api.osv.dev/v1/querybatch", "queried_versions": len(selected),
              "inputs_sha256": {lock: hashlib.sha256((ROOT / lock).read_bytes()).hexdigest() for lock in LOCKS},
              "findings": findings,
              "limits": "Known package advisories only; includes unmaintained/unsoundness notices. Not native binary, SDK, side-channel or reachability analysis."}
    directory = ROOT / ".public-prep"
    directory.mkdir(exist_ok=True)
    (directory / "osv-current.json").write_text(json.dumps(output, indent=2) + "\n")
    print(json.dumps({"queried_versions": len(selected), "packages_with_advisories": len(findings), "findings": findings}, indent=2))
    if findings and args.fail_on_findings:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
