#!/usr/bin/env python3
"""Inspect and safely clone/patch exported Ulanzi Studio Version 2 profiles."""
from __future__ import annotations
import argparse, copy, hashlib, io, json, re, sys, uuid, zipfile
from pathlib import Path

HEADER = b"#Version: 2\n"
BUILTIN_ACTION = "com.ulanzi.ulanzideck.smallwindow.window"
PLUGIN_UUID = "com.arkamax.ulanzi.imageslide"
ACTION_UUID = PLUGIN_UUID + ".slideshow"
PLUGIN_VERSION = "0.3.0"
PROFILE_RE = re.compile(r"(?:^|/)Profiles/([^/]+)/manifest\.json$")
PACKAGE_RE = re.compile(r"^([^/]+)\.ulanziProfile/")

class ProfileError(Exception): pass
def sha256(data: bytes) -> str: return hashlib.sha256(data).hexdigest()

def PNG_DIMS(data: bytes):
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR": raise ProfileError("Invalid PNG asset")
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")

def read_archive(path: Path):
    data = path.read_bytes()
    if not data.startswith(HEADER): raise ProfileError("Input must start with the exact '#Version: 2\\n' header")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data[len(HEADER):]), "r")
        bad = archive.testzip()
        if bad: raise ProfileError(f"Corrupt ZIP member: {bad}")
        names = archive.namelist()
        if len(names) != len(set(names)): raise ProfileError("Duplicate ZIP member names are not supported")
        return data, archive
    except zipfile.BadZipFile as exc: raise ProfileError("Profile payload is not a valid ZIP archive") from exc

def package_identity(archive):
    roots = {m.group(1) for name in archive.namelist() if (m := PACKAGE_RE.match(name))}
    if len(roots) != 1: raise ProfileError(f"Expected exactly one .ulanziProfile package root; found {len(roots)}")
    package_id = next(iter(roots)); root = f"{package_id}.ulanziProfile"; root_name = root + "/manifest.json"
    if root_name not in archive.namelist(): raise ProfileError("Package root manifest.json is missing")
    try: root_manifest = json.loads(archive.read(root_name).decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc: raise ProfileError("Invalid package root manifest.json") from exc
    profile_ids, manifests = set(), {}
    for info in archive.infolist():
        match = PROFILE_RE.search(info.filename)
        if not match: continue
        profile_ids.add(match.group(1))
        try: manifests[info.filename] = json.loads(archive.read(info).decode("utf-8-sig"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc: raise ProfileError(f"Invalid JSON manifest: {info.filename}") from exc
    if not profile_ids: raise ProfileError("No profile/page manifests were found")
    return package_id, root, root_name, root_manifest, profile_ids, manifests

def candidates(archive):
    package_id, root, _, root_manifest, _, manifests = package_identity(archive); result = []
    for manifest_name, document in manifests.items():
        profile_id = PROFILE_RE.search(manifest_name).group(1)
        for controller_index, controller in enumerate(document.get("Controllers", [])):
            entry = (controller.get("Actions") or {}).get("3_2")
            if entry is not None:
                result.append({"package_id":package_id,"package_root":root,"profile_id":profile_id,"name":document.get("Name") or root_manifest.get("Name", ""),"action":entry.get("Action", ""),"action_id":entry.get("ActionID", ""),"manifest":manifest_name,"controller_index":controller_index,"document":document,"entry":entry})
    return result

def inspect(path: Path):
    _, archive = read_archive(path); found = candidates(archive)
    if not found: raise ProfileError("No Controllers[*].Actions['3_2'] candidates found")
    for item in found: print(json.dumps({key:item[key] for key in ("package_id","profile_id","name","action","action_id","manifest","controller_index")},ensure_ascii=False,sort_keys=True))

def new_entry(action_id: str):
    return {"Action":ACTION_UUID,"ActionID":action_id,"ActionParam":{"SmallViewMode":2},"LinkedTitle":True,"Name":"Image Slideshow","Plugin":{"Name":"Image Slideshow","UUID":PLUGIN_UUID,"Version":PLUGIN_VERSION},"State":0,"ViewParam":[{"Icon":"","IconRel":"","Name":"Image Slideshow"}]}

def clone_info(info, filename):
    out = zipfile.ZipInfo(filename, info.date_time)
    for attr in ("compress_type","comment","extra","internal_attr","external_attr","create_system","create_version","extract_version","flag_bits","volume"): setattr(out, attr, getattr(info, attr))
    return out

def deterministic_uuid_factory(seed: str):
    """Return a repeatable UUID factory for tests; normal CLI patching uses uuid4."""
    counter = 0
    def factory():
        nonlocal counter; counter += 1
        return uuid.uuid5(uuid.NAMESPACE_URL, f"ulanzi-imageslide:{seed}:{counter}")
    return factory

def fresh_uuid(factory, forbidden):
    for _ in range(10000):
        try: value = str(uuid.UUID(str(factory())))
        except (ValueError, AttributeError, TypeError) as exc: raise ProfileError("UUID factory returned an invalid UUID") from exc
        if value not in forbidden: forbidden.add(value); return value
    raise ProfileError("UUID factory repeatedly returned colliding UUIDs")

def walk_transform(value, profile_map, action_map, factory, forbidden):
    if isinstance(value, dict):
        transformed = {}
        for key, item in value.items():
            if key == "ActionID":
                old = str(item); new = fresh_uuid(factory, forbidden); action_map.setdefault(old, []).append(new); transformed[key] = new
            elif key == "ProfileUUID":
                if item not in profile_map: raise ProfileError(f"Unresolved ActionParam.ProfileUUID reference: {item}")
                transformed[key] = profile_map[item]
            else: transformed[key] = walk_transform(item, profile_map, action_map, factory, forbidden)
        return transformed
    if isinstance(value, list): return [walk_transform(item, profile_map, action_map, factory, forbidden) for item in value]
    return value

def rename_member(name, old_root, new_root, profile_map):
    if name == old_root: return new_root
    if name.startswith(old_root + "/"): name = new_root + name[len(old_root):]
    match = re.match(rf"^{re.escape(new_root)}/Profiles/([^/]+)(/.*)?$", name)
    if match and match.group(1) in profile_map: name = f"{new_root}/Profiles/{profile_map[match.group(1)]}{match.group(2) or ''}"
    return name

def collect_key_values(documents, wanted):
    values = []
    def visit(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key == wanted: values.append(str(item))
                else: visit(item)
        elif isinstance(value, list):
            for item in value: visit(item)
    for document in documents: visit(document)
    return values

def validate_clone(source, output_path, old_package_id, new_package_id, old_profile_ids, profile_map, old_action_ids):
    output_data, archive = read_archive(output_path)
    package_id, _, _, root_manifest, new_profile_ids, manifests = package_identity(archive)
    if package_id != new_package_id or package_id == old_package_id: raise ProfileError("Output package identity was not independently cloned")
    expected_profiles = set(profile_map.values())
    if new_profile_ids != expected_profiles or new_profile_ids & old_profile_ids: raise ProfileError("Output profile/page identities collide with or do not match the clone map")
    pages = root_manifest.get("Pages") or {}; listed = set(pages.get("Pages") or []); current = pages.get("Current")
    if current not in new_profile_ids or not listed.issubset(new_profile_ids): raise ProfileError("Output root Pages references do not resolve")
    refs = collect_key_values(manifests.values(), "ProfileUUID")
    if any(ref not in new_profile_ids for ref in refs): raise ProfileError("Output contains an unresolved ProfileUUID reference")
    new_action_ids = collect_key_values(manifests.values(), "ActionID")
    if len(new_action_ids) != len(set(new_action_ids)): raise ProfileError("Output ActionIDs are not unique")
    if set(new_action_ids) & set(old_action_ids): raise ProfileError("Output ActionIDs collide with the source profile")
    if sha256(source) == sha256(output_data): raise ProfileError("Output unexpectedly matches input")
    return output_data, archive, root_manifest, manifests, new_action_ids

def patch(input_path: Path, output_path: Path, profile_id: str, force: bool=False, clone_name: str|None=None, uuid_factory=None):
    if input_path.resolve() == output_path.resolve(): raise ProfileError("In-place patching is forbidden; choose a different output path")
    if output_path.exists(): raise ProfileError("Output already exists; choose a new filename")
    factory = uuid_factory or uuid.uuid4
    source_data, archive = read_archive(input_path)
    old_package_id, old_root, root_manifest_name, root_manifest, old_profile_ids, manifests = package_identity(archive)
    matches = [item for item in candidates(archive) if item["profile_id"] == profile_id]
    if len(matches) != 1: raise ProfileError(f"--profile-id must select exactly one candidate; matched {len(matches)}")
    selected = matches[0]
    if selected["action"] != BUILTIN_ACTION and not force: raise ProfileError(f"Selected action is '{selected['action']}', not the built-in small-window action; use --force only after manual review")
    old_action_ids = collect_key_values(manifests.values(), "ActionID")
    forbidden = {old_package_id, *old_profile_ids, *old_action_ids}
    new_package_id = fresh_uuid(factory, forbidden)
    profile_map = {old:fresh_uuid(factory, forbidden) for old in sorted(old_profile_ids)}
    action_map = {}
    transformed = {name:walk_transform(copy.deepcopy(document),profile_map,action_map,factory,forbidden) for name,document in manifests.items()}
    cloned_root = copy.deepcopy(root_manifest); old_name = str(cloned_root.get("Name") or "Profile")
    new_name = clone_name or ("Image Slideshow" if old_name == "Arkamax" else f"{old_name} Image Slideshow")
    if not new_name.strip() or new_name == old_name: raise ProfileError("Clone name must be non-empty and different from the source name")
    cloned_root["Name"] = new_name; pages = cloned_root.get("Pages")
    if not isinstance(pages, dict) or pages.get("Current") not in profile_map: raise ProfileError("Root Pages.Current is missing or unresolved")
    if any(item not in profile_map for item in pages.get("Pages", [])): raise ProfileError("Root Pages.Pages contains an unresolved profile/page UUID")
    pages["Current"] = profile_map[pages["Current"]]; pages["Pages"] = [profile_map[item] for item in pages.get("Pages", [])]
    before = copy.deepcopy(selected["entry"]); slideshow_action_id = fresh_uuid(factory, forbidden); after = new_entry(slideshow_action_id)
    transformed[selected["manifest"]]["Controllers"][selected["controller_index"]]["Actions"]["3_2"] = after
    new_root = f"{new_package_id}.ulanziProfile"; replacements = {root_manifest_name:cloned_root, **transformed}
    target = io.BytesIO(); renamed = set()
    with zipfile.ZipFile(target, "w", allowZip64=True) as output:
        output.comment = archive.comment
        for info in archive.infolist():
            new_member = rename_member(info.filename, old_root, new_root, profile_map)
            if new_member in renamed: raise ProfileError(f"Clone mapping produced duplicate member: {new_member}")
            renamed.add(new_member); body = archive.read(info)
            if info.filename in replacements: body = json.dumps(replacements[info.filename],ensure_ascii=False,separators=(",", ":")).encode("utf-8")
            output.writestr(clone_info(info,new_member),body)
    output_path.parent.mkdir(parents=True,exist_ok=True); output_path.write_bytes(HEADER + target.getvalue())
    try:
        validated_data, checked, checked_root, _, new_action_ids = validate_clone(source_data,output_path,old_package_id,new_package_id,old_profile_ids,profile_map,old_action_ids)
        new_selected_id = profile_map[profile_id]; verified = [item for item in candidates(checked) if item["profile_id"] == new_selected_id]
        if len(verified) != 1 or verified[0]["entry"] != after: raise ProfileError("Output read-back did not match the requested slideshow patch")
        if checked_root.get("Device") != root_manifest.get("Device"): raise ProfileError("Device binding changed during cloning")
    except Exception:
        output_path.unlink(missing_ok=True); raise
    receipt = {"schema":"com.arkamax.ulanzi.imageslide.profile-clone-patch/v2","input_sha256":sha256(source_data),"output_sha256":sha256(validated_data),"source_package_id":old_package_id,"clone_package_id":new_package_id,"source_name":old_name,"clone_name":new_name,"source_profile_id":profile_id,"clone_profile_id":profile_map[profile_id],"profile_id_map":profile_map,"action_ids_regenerated":len(new_action_ids),"manifest_member":rename_member(selected["manifest"],old_root,new_root,profile_map),"controller_index":selected["controller_index"],"key":"3_2","new_action_id":slideshow_action_id,"semantic_diff":{"before":before,"after":after},"preserved":["Device.UUID","Device.Model","plugin UUIDs","assets and non-identity semantics"],"validation":{"header":"#Version: 2\\n","zip":"valid","read_back":"valid","package_id_collision":False,"profile_id_collisions":0,"action_id_collisions":0,"profile_references":"resolved"},"rollback":"Import the untouched original exported profile; it remains the rollback authority."}
    receipt_path = output_path.with_name(output_path.name + ".receipt.json"); receipt_path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
    print(json.dumps({"output":str(output_path),"receipt":str(receipt_path),"output_sha256":receipt["output_sha256"],"source_profile_id":profile_id,"clone_profile_id":profile_map[profile_id],"clone_package_id":new_package_id,"action_id":slideshow_action_id},sort_keys=True))

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__); sub=parser.add_subparsers(dest="command",required=True)
    p_inspect=sub.add_parser("inspect",help="List every 3_2 candidate"); p_inspect.add_argument("input",type=Path)
    p_patch=sub.add_parser("patch",help="Write an independent cloned profile with the selected 3_2 action patched")
    p_patch.add_argument("input",type=Path); p_patch.add_argument("output",type=Path); p_patch.add_argument("--profile-id",required=True); p_patch.add_argument("--clone-name",help="Distinct clone name (default: 'Image Slideshow' for Arkamax)"); p_patch.add_argument("--force",action="store_true")
    args=parser.parse_args(argv)
    try:
        if args.command=="inspect": inspect(args.input)
        else: patch(args.input,args.output,args.profile_id,args.force,args.clone_name)
        return 0
    except (OSError,ProfileError) as exc: print(f"error: {exc}",file=sys.stderr); return 2

if __name__ == "__main__": raise SystemExit(main())
