#!/usr/bin/env python3
"""Inventory locked dependencies; optionally fetch missing crates.io metadata.

Python >=3.11, standard library only. Never installs or executes dependencies.
Local cache paths are used as inputs but never written into the public report.
License identifiers and text heuristics are evidence, not a legal clearance.
"""
import argparse
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import re
import tomllib
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--fetch-missing", action="store_true")
parser.add_argument("--output", default="docs/dependency-licenses.json")
parser.add_argument("--write-vendored-notices", action="store_true",
                    help="Regenerate both Mermaid dependency notice bundles from installed packages")
args = parser.parse_args()
cache = ROOT / ".public-prep/license-metadata"

def sha(data):
    return hashlib.sha256(data).hexdigest()

def texts(directory):
    if not directory.is_dir():
        return []
    result = []
    for p in sorted(directory.iterdir()):
        if p.is_file() and re.match(r"^(licen[sc]e|copying|notice|copyright)([.\-_]|$)", p.name, re.I):
            result.append({"file": p.name, "sha256": sha(p.read_bytes())})
    if not result:
        for p in sorted(directory.glob("[Rr][Ee][Aa][Dd][Mm][Ee]*")):
            content = p.read_text(errors="replace")
            section = re.search(r"^##? Licen[sc]e\s*\n([\s\S]*?)(?=^##? |\Z)", content, re.M | re.I)
            # Some old MIT packages put the complete notice in README instead
            # of a separate LICENSE. Do not treat a bare license label as text.
            if section and "Permission is hereby granted, free of charge" in section[1] and "THE SOFTWARE IS PROVIDED" in section[1]:
                result.append({"file": p.name, "section": "License", "sha256": sha(section[1].encode()), "file_sha256": sha(p.read_bytes())})
    return result

def license_content(directory, file):
    content = (directory / file["file"]).read_text(errors="replace")
    if file.get("section") == "License":
        return re.search(r"^##? Licen[sc]e\s*\n([\s\S]*?)(?=^##? |\Z)", content, re.M | re.I)[1]
    return content

def hint(directory, files):
    text = "\n".join(license_content(directory, f) for f in files)
    found = []
    for name, needle in [("MIT", "Permission is hereby granted, free of charge"),
                         ("BSD", "Redistribution and use in source and binary forms"),
                         ("Apache-2.0", "Apache License"),
                         ("MPL-2.0", "Mozilla Public License"),
                         ("LGPL", "GNU LESSER GENERAL PUBLIC LICENSE"),
                         ("GPL", "GNU GENERAL PUBLIC LICENSE")]:
        if needle.lower() in text.lower():
            found.append(name)
    return found

items = []
inputs = {}
for lock in ["package-lock.json", "desktop/package-lock.json"]:
    raw = (ROOT / lock).read_bytes()
    inputs[lock] = sha(raw)
    for key, value in json.loads(raw)["packages"].items():
        if not key:
            continue
        directory = ROOT / Path(lock).parent / key
        files = texts(directory)
        declared = value.get("license")
        basis = "lockfile"
        if not declared and (directory / "license").is_file() and "The MIT License" in (directory / "license").read_text():
            declared = "MIT"
            basis = "package license text (lockfile lacks identifier)"
        items.append({"ecosystem": "npm", "lockfile": lock, "package_path": key,
                      "name": key.split("node_modules/")[-1], "version": value["version"],
                      "declared_license": declared, "basis": basis,
                      "development_only": bool(value.get("dev")),
                      "optional": bool(value.get("optional")), "license_texts": files,
                      "locked_integrity": value.get("integrity"),
                      "metadata_url": value.get("resolved")})

cargo_lock = "desktop/src-tauri/Cargo.lock"
raw = (ROOT / cargo_lock).read_bytes()
inputs[cargo_lock] = sha(raw)
crates = []
missing = []
cargo_home = Path(os.environ.get("CARGO_HOME", Path.home() / ".cargo"))
for value in tomllib.loads(raw.decode())["package"]:
    if "source" not in value:
        continue
    name, version = value["name"], value["version"]
    candidates = sorted((cargo_home / "registry/src").glob(f"*/{name}-{version}/Cargo.toml"))
    item = {"ecosystem": "cargo", "lockfile": cargo_lock, "name": name, "version": version,
            "metadata_url": f"https://crates.io/api/v1/crates/{name}/{version}",
            "locked_checksum": value.get("checksum"),
            "declared_license": None, "license_texts": [], "basis": "metadata unavailable"}
    if candidates:
        package = tomllib.loads(candidates[0].read_text())["package"]
        item.update(declared_license=package.get("license"), basis="cached published Cargo.toml", license_texts=texts(candidates[0].parent))
    else:
        missing.append(item)
    crates.append(item)

def crate_metadata(item):
    local = cache / f"{item['name']}-{item['version']}.json"
    try:
        if local.is_file():
            data = json.loads(local.read_text())
        elif args.fetch_missing:
            req = urllib.request.Request(item["metadata_url"], headers={"User-Agent": "Relayune-license-audit/1.0 (read-only metadata inventory)"})
            with urllib.request.urlopen(req, timeout=25) as response:
                version = json.load(response)["version"]
            data = {"license": version.get("license"), "checksum": version.get("checksum")}
            cache.mkdir(parents=True, exist_ok=True)
            local.write_text(json.dumps(data))
        else:
            return
        if data.get("checksum") != item.get("locked_checksum"):
            raise ValueError("crates.io metadata checksum differs from Cargo.lock")
        item.update(declared_license=data.get("license"), basis="crates.io published version metadata (checksum matches lock)")
    except Exception as error:
        item["metadata_error"] = type(error).__name__

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
    list(pool.map(crate_metadata, missing))
items.extend(crates)

pub_cache = Path(os.environ.get("PUB_CACHE", Path.home() / ".pub-cache"))
for lock in ["mobile/pubspec.lock", "docs/design/startup-effects-preview/pubspec.lock", "docs/design/history-loading-preview/pubspec.lock"]:
    raw = (ROOT / lock).read_bytes()
    inputs[lock] = sha(raw)
    # Pub's generated lockfile has one package at indentation 2; descriptions
    # are nested. Avoid requiring PyYAML just to inspect this generated format.
    text = raw.decode().split("packages:\n", 1)[1].split("\nsdks:", 1)[0]
    for match in re.finditer(r"^  ([\w]+):\n([\s\S]*?)(?=^  \w+:\n|\Z)", text, re.M):
        name, body = match.groups()
        version = re.search(r'^    version: "([^"]+)"', body, re.M).group(1)
        source = re.search(r"^    source: (.+)", body, re.M).group(1)
        directory = pub_cache / "hosted/pub.dev" / f"{name}-{version}"
        files = texts(directory)
        items.append({"ecosystem": "pub", "lockfile": lock, "name": name, "version": version,
                      "source": source, "metadata_url": f"https://pub.dev/packages/{name}/versions/{version}" if source == "hosted" else None,
                      "license_texts": files, "text_license_hints": hint(directory, files),
                      "basis": "cached published package license text" if files else "SDK bundled" if source == "sdk" else "license text unavailable"})

report = {"schema_version": 1, "scope": "All entries in the six listed lockfiles; includes development, optional and cross-platform dependencies, not a linked-binary bill of materials.",
          "inputs_sha256": inputs,
          "limitations": ["Identifiers are publisher declarations; text hints are heuristics, not license determinations.",
                          "Installed npm metadata and local Rust/pub license files may cover only this host. Missing texts are explicit empty arrays.",
                          "Native libraries fetched by Flutter plugins, system libraries, SDKs and final executable linkage require separate per-platform release review.",
                          "Original package archives and accompanying notices must be preserved when redistributing dependencies; this inventory does not replace them."],
          "packages": items}
(ROOT / args.output).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
if args.write_vendored_notices:
    # Include the entire runtime dependency closure, including optional modules.
    # This is deliberately broader than the modules present in the browser bundle.
    seen = {}
    def visit(directory):
        package = json.loads((directory / "package.json").read_text())
        key = package["name"] + "@" + package["version"]
        if key in seen:
            return
        seen[key] = (directory, package)
        for name in sorted(package.get("dependencies", {})):
            base = directory
            while base != ROOT.parent:
                target = base / "node_modules" / name
                if (target / "package.json").is_file():
                    visit(target)
                    break
                base = base.parent
            else:
                raise RuntimeError(f"Missing Mermaid dependency: {name}")
    visit(ROOT / "node_modules/mermaid")
    sections = ["Mermaid browser runtime: third-party license texts\n"
                "Generated by scripts/audit-licenses.py --write-vendored-notices.\n"
                "Includes the full installed Mermaid dependency closure, not an exact bundle-module listing.\n"
                "Preserve this file, LICENSE and the runtime's embedded license comments.\n"]
    missing_texts = []
    for key, (directory, package) in sorted(seen.items()):
        sections.append("\n" + "=" * 72 + "\n" + key + "\n"
                        + "Declared license: " + str(package.get("license", "see license text")) + "\n"
                        + "Source: https://www.npmjs.com/package/" + package["name"] + "/v/" + package["version"] + "\n")
        files = texts(directory)
        if not files:
            missing_texts.append(key)
        for file in files:
            sections.append("\n--- " + file["file"] + (" / License section" if file.get("section") else "") + " ---\n" + license_content(directory, file))
    if missing_texts:
        raise RuntimeError("Missing license texts: " + ", ".join(missing_texts))
    output = "\n".join(sections) + "\n"
    for directory in ["public/mermaid", "mobile/assets/mermaid"]:
        (ROOT / directory / "THIRD_PARTY_LICENSES.txt").write_text(output)
    print(json.dumps({"mermaid_dependency_license_packages": len(seen)}))
print(json.dumps({"packages": len(items), "missing_declared_cargo_license": sum(not x["declared_license"] for x in crates),
                  "missing_hosted_pub_license_text": sum(x["ecosystem"] == "pub" and x["source"] == "hosted" and not x["license_texts"] for x in items)}))
