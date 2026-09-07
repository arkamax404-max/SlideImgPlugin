#!/usr/bin/env python3
"""Build and verify the reproducible universal ImageSlide release artifacts."""

import argparse
import base64
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent.parent
PLUGIN_NAME = "com.arkamax.ulanzi.imageslide.ulanziPlugin"
PLUGIN = ROOT / PLUGIN_NAME
BUILD = ROOT / ".build-package"
STAGE = BUILD / "stage" / PLUGIN_NAME
ARTIFACTS = (
    ROOT / f"{PLUGIN_NAME}.zip",
    ROOT / "ImageSlidePlugin-source.zip",
    ROOT / "ImageSlideSetupHelper.zip",
)
PROFILE = ROOT / "ImageSlide.ulanziDeckProfile"
PROFILE_RECEIPT = ROOT / "ImageSlide.ulanziDeckProfile.receipt.json"
DELIVERY_FILES = (
    ROOT / "README.md",
    ROOT / "MIGRATION.md",
    ROOT / "TEST-REPORT.txt",
    ROOT / "Install-ImageSlidePlugin.ps1",
    *ARTIFACTS,
    PROFILE,
    PROFILE_RECEIPT,
    ROOT / "store.json",
    ROOT / "assets" / "cover.png",
    ROOT / "assets" / "banner.png",
)
PRIVACY_MARKERS = (
    b"D:" + b"\\Desarrollo",
    b"UlanziBig" + b"ButtomPlugin",
    b"POST_" + b"Arkamax",
    b"/Users/" + b"santiago" + b"perez",
    b"\\Users\\" + b"santiago" + b"perez",
    b"a8eace19-" + b"3a71-47a9-ae9e-" + b"5e1bfc1c13c8",
)
RUNTIME_PACKAGES = {
    "sharp": "0.35.4",
    "ws": "8.21.3",
    "@img/colour": "1.1.0",
    "detect-libc": "2.1.2",
    "semver": "7.8.5",
    "@img/sharp-win32-x64": "0.35.4",
    "@img/sharp-darwin-x64": "0.35.4",
    "@img/sharp-libvips-darwin-x64": "1.3.3",
    "@img/sharp-darwin-arm64": "0.35.4",
    "@img/sharp-libvips-darwin-arm64": "1.3.3",
}
EXCLUDED_PARTS = {".git", ".codegraph", ".build-package", "node_modules", "test", "tests", "docs", "examples", "install", ".github"}
SOURCE_EXCLUDED_PARTS = {".git", ".codegraph", ".build-package", "node_modules", "__pycache__", ".pytest_cache"}
EXCLUDED_FILES = {".DS_Store", ".npmignore"}
GENERATED_NAMES = {path.name for path in ARTIFACTS} | {
    "ImageSlide.ulanziDeckProfile",
    "ImageSlide.ulanziDeckProfile.receipt.json",
    "SHA256SUMS.txt",
}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def lock_packages():
    return json.loads((PLUGIN / "package-lock.json").read_text(encoding="utf-8"))["packages"]


def fetch_packages():
    cache = BUILD / "cache"
    cache.mkdir(parents=True, exist_ok=True)
    locked = lock_packages()
    archives = {}
    for name, version in RUNTIME_PACKAGES.items():
        entry = locked[f"node_modules/{name}"]
        if entry["version"] != version:
            raise RuntimeError(f"Lock mismatch for {name}: {entry['version']} != {version}")
        target = cache / f"{name.replace('/', '__').replace('@', '')}-{version}.tgz"
        if not target.exists():
            with urllib.request.urlopen(entry["resolved"]) as response:
                target.write_bytes(response.read())
        algorithm, encoded = entry["integrity"].split("-", 1)
        actual = base64.b64encode(hashlib.new(algorithm, target.read_bytes()).digest()).decode()
        if actual != encoded:
            target.unlink(missing_ok=True)
            raise RuntimeError(f"Integrity mismatch for {name}")
        archives[name] = target
    return archives


def excluded(relative, package=False):
    parts = set(relative.parts)
    if relative.name in EXCLUDED_FILES or parts & EXCLUDED_PARTS:
        return True
    lower = relative.name.lower()
    if package and (lower.startswith("readme") or lower.startswith("changelog") or lower.endswith((".map", ".ts", ".mts", ".cts"))):
        return True
    return False


def copy_source_tree():
    if STAGE.parent.exists():
        shutil.rmtree(STAGE.parent)
    STAGE.mkdir(parents=True)
    for source in sorted(PLUGIN.rglob("*")):
        relative = source.relative_to(PLUGIN)
        if excluded(relative) or relative.name == "package-lock.json":
            continue
        target = STAGE / relative
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif source.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)


def extract_package(name, archive):
    destination = STAGE / "node_modules" / name
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive, "r:gz") as source:
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            if not path.parts or path.parts[0] != "package" or len(path.parts) == 1:
                continue
            relative = Path(*path.parts[1:])
            if excluded(relative, package=True) or "src" in relative.parts:
                continue
            target = (destination / relative).resolve()
            if destination.resolve() not in target.parents:
                raise RuntimeError(f"Unsafe package path: {member.name}")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                extracted = source.extractfile(member)
                target.write_bytes(extracted.read())


def pe_machine(path):
    data = path.read_bytes()
    if data[:2] != b"MZ":
        raise RuntimeError(f"Not PE: {path}")
    offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[offset:offset + 4] != b"PE\0\0":
        raise RuntimeError(f"Invalid PE: {path}")
    return struct.unpack_from("<H", data, offset + 4)[0]


def macho_cpu(path):
    data = path.read_bytes()[:8]
    if len(data) != 8 or data[:4] not in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf"):
        raise RuntimeError(f"Not 64-bit Mach-O: {path}")
    order = "<" if data[:4] == b"\xcf\xfa\xed\xfe" else ">"
    return struct.unpack(order + "I", data[4:8])[0]


def verify_stage(stage=STAGE):
    manifest = json.loads((stage / "manifest.json").read_text(encoding="utf-8"))
    if manifest["UUID"] != "com.arkamax.ulanzi.imageslide":
        raise RuntimeError("Plugin UUID changed")
    if manifest["OS"] != [{"Platform": "windows", "MinimumVersion": "10"}, {"Platform": "mac", "MinimumVersion": "13"}]:
        raise RuntimeError("Universal OS declaration mismatch")
    installed = {}
    for name, version in RUNTIME_PACKAGES.items():
        metadata = json.loads((stage / "node_modules" / name / "package.json").read_text(encoding="utf-8"))
        if metadata["name"] != name or metadata["version"] != version:
            raise RuntimeError(f"Package metadata mismatch: {name}")
        installed[name] = version
    img_root = stage / "node_modules" / "@img"
    actual_img = {f"@img/{path.name}" for path in img_root.iterdir() if path.is_dir()}
    expected_img = {name for name in RUNTIME_PACKAGES if name.startswith("@img/")}
    if actual_img != expected_img:
        raise RuntimeError(f"Unexpected @img inventory: {sorted(actual_img ^ expected_img)}")
    native = {
        "@img/sharp-win32-x64": ("*.node", 0x8664, pe_machine),
        "@img/sharp-darwin-x64": ("*.node", 0x01000007, macho_cpu),
        "@img/sharp-libvips-darwin-x64": ("*.dylib", 0x01000007, macho_cpu),
        "@img/sharp-darwin-arm64": ("*.node", 0x0100000C, macho_cpu),
        "@img/sharp-libvips-darwin-arm64": ("*.dylib", 0x0100000C, macho_cpu),
    }
    for name, (pattern, expected, inspector) in native.items():
        files = list((stage / "node_modules" / name).rglob(pattern))
        if not files or any(inspector(path) != expected for path in files):
            raise RuntimeError(f"Native architecture mismatch: {name}")
    win_dlls = list((stage / "node_modules" / "@img" / "sharp-win32-x64").rglob("*.dll"))
    if not win_dlls or any(pe_machine(path) != 0x8664 for path in win_dlls):
        raise RuntimeError("Windows x64 libvips inventory mismatch")
    if not (stage / "node_modules" / "ws" / "lib" / "websocket.js").is_file():
        raise RuntimeError("ws runtime JS missing")
    return installed


def zip_tree(output, files):
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source, name in sorted(files, key=lambda item: item[1]):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, source.read_bytes())


def plugin_files():
    return [(path, f"{PLUGIN_NAME}/{path.relative_to(STAGE).as_posix()}") for path in STAGE.rglob("*") if path.is_file()]


def source_files():
    result = []
    for path in ROOT.rglob("*"):
        relative = path.relative_to(ROOT)
        if not path.is_file() or set(relative.parts) & SOURCE_EXCLUDED_PARTS or relative.name in GENERATED_NAMES or relative.name in EXCLUDED_FILES:
            continue
        result.append((path, f"ImageSlidePlugin-source/{relative.as_posix()}"))
    return result


def artifact_payloads(path):
    yield path.name, path.read_bytes()
    if path.suffix == ".zip" or path.name.endswith(".ulanziDeckProfile"):
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                if not name.endswith("/"):
                    yield f"{path.name}:{name}", archive.read(name)


def verify_delivery_privacy(files):
    for path in files:
        for location, payload in artifact_payloads(path):
            for marker in PRIVACY_MARKERS:
                if marker in payload:
                    raise RuntimeError(f"Private source identity found in delivery artifact: {location}")
    receipt = json.loads(PROFILE_RECEIPT.read_text(encoding="utf-8"))
    forbidden = {"source_package_id", "source_profile_id", "profile_id_map", "input_sha256"}
    if forbidden & receipt.keys():
        raise RuntimeError("Portable profile receipt contains source provenance fields")


def build_artifacts():
    subprocess.run(
        [sys.executable, str(ROOT / "tools" / "profile_tool.py"), "receipt", str(PROFILE), "--output", str(PROFILE_RECEIPT)],
        check=True,
    )
    zip_tree(ARTIFACTS[0], plugin_files())
    zip_tree(ARTIFACTS[1], source_files())
    helpers = [(path, f"ImageSlideSetupHelper/{path.relative_to(PLUGIN / 'helper').as_posix()}") for path in (PLUGIN / "helper").rglob("*") if path.is_file()]
    zip_tree(ARTIFACTS[2], helpers)
    text = "".join(f"{sha256(path.read_bytes())}  {path.relative_to(ROOT).as_posix()}\n" for path in DELIVERY_FILES)
    (ROOT / "SHA256SUMS.txt").write_text(text, encoding="utf-8", newline="\n")
    verify_delivery_privacy((*DELIVERY_FILES, ROOT / "SHA256SUMS.txt"))


def verify_zip():
    with zipfile.ZipFile(ARTIFACTS[0]) as archive:
        if archive.testzip() is not None:
            raise RuntimeError("Plugin ZIP CRC failure")
        roots = {PurePosixPath(name).parts[0] for name in archive.namelist()}
        if roots != {PLUGIN_NAME}:
            raise RuntimeError(f"Unexpected plugin ZIP roots: {roots}")
    for line in (ROOT / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
        expected, name = line.split(None, 1)
        if sha256((ROOT / name.strip()).read_bytes()) != expected:
            raise RuntimeError(f"Checksum mismatch: {name}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage-only", action="store_true")
    args = parser.parse_args()
    copy_source_tree()
    for name, archive in fetch_packages().items():
        extract_package(name, archive)
    verify_stage()
    if not args.stage_only:
        build_artifacts()
        verify_zip()
    print(f"Verified universal stage: {STAGE}")
    if not args.stage_only:
        print("Built: " + ", ".join(path.name for path in ARTIFACTS))


if __name__ == "__main__":
    main()
