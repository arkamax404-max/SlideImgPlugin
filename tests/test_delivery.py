import contextlib, hashlib, importlib.util, io, json, subprocess, tempfile, unittest, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parent.parent
SOURCE=Path(r"D:\Desarrollo\UlanziBigButtomPlugin\POST_Arkamax.ulanziDeckProfile")
TARGET="a8eace19-3a71-47a9-ae9e-5e1bfc1c13c8"
SETUP_ID="11111111-1111-4111-8111-111111111111"
OTHER_SETUP_ID="22222222-2222-4222-8222-222222222222"
spec=importlib.util.spec_from_file_location("profile_tool",ROOT/"tools"/"profile_tool.py");tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)

class DeliveryTests(unittest.TestCase):
    def _resolve_fixture(self, devices, stores, pressed_key="0_0", action_id=SETUP_ID):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        prefix=helper[helper.index("$ActionUuid="):helper.index("$exitCode=0")]
        with tempfile.TemporaryDirectory() as td:
            base=Path(td)/"UlanziDeck";(base/"Config").mkdir(parents=True)
            (base/"Config"/"setting_source.json").write_text(json.dumps({"Devices":devices}),encoding="utf-8")
            for store_name,groups in stores.items():
                for group in groups:
                    group_root=base/store_name/group["id"];(group_root/"Profiles").mkdir(parents=True)
                    pages=list(group["pages"])
                    root={"Name":group["name"],"Device":{"UUID":group["device"],"Model":"D200"},"Pages":{"Current":group["current"],"Pages":pages}}
                    (group_root/"manifest.json").write_text(json.dumps(root),encoding="utf-8")
                    for page_id,controllers in group["pages"].items():
                        page_root=group_root/"Profiles"/page_id;page_root.mkdir()
                        (page_root/"manifest.json").write_text(json.dumps({"Controllers":controllers}),encoding="utf-8")
            quoted=lambda value:str(value).replace("'","''")
            script=Path(td)/"resolve.ps1"
            script.write_text(prefix+f"\n$base=Full '{quoted(base)}'\n$setting=Full '{quoted(base/'Config'/'setting_source.json')}'\ntry{{$r=ResolveTarget '{quoted(pressed_key)}' (ActionIdHash '{quoted(action_id)}');[pscustomobject]@{{store=$r.Store;groupId=$r.GroupId;pageId=$r.PageId;kind=$r.Kind;phase=$CurrentPhase}}|ConvertTo-Json -Compress;exit 0}}catch{{Write-Output (([string]$_.Exception.Message)+'|'+$CurrentPhase);exit 2}}\n",encoding="utf-8")
            return subprocess.run(["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-File",str(script)],capture_output=True,text=True)

    @staticmethod
    def _keypad(action="com.ulanzi.ulanzideck.smallwindow.window",setup_id=SETUP_ID,setup_key="0_0",setup_action="com.arkamax.ulanzi.imageslide.setup"):
        return {"Type":"Keypad","Actions":{"3_2":{"Action":action},setup_key:{"Action":setup_action,"ActionID":setup_id}}}

    def _requested_target_fixture(self, case):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8");prefix=helper[helper.index("$ActionUuid="):helper.index("$exitCode=0")]
        group_id="group-a";page_id="page-a";other_page="page-b"
        with tempfile.TemporaryDirectory() as td:
            base=Path(td)/"UlanziDeck";(base/"Config").mkdir(parents=True);(base/"Config"/"setting_source.json").write_text(json.dumps({"Devices":[{"CurrentProfile":"Arkamax","CurrentDevice":"device-1"}]}),encoding="utf-8")
            group=base/"ProfilesV2"/group_id;page=group/"Profiles"/page_id
            if case!="missing":
                page.mkdir(parents=True);current=other_page if case=="page_changed" else page_id;root_doc={"Name":"Arkamax","Device":{"UUID":"device-1","Model":"D200"},"Pages":{"Current":current,"Pages":[page_id,other_page]}}
                root_bytes=(b"{broken" if case=="malformed_requested" else json.dumps(root_doc,separators=(",",":")).encode());(group/"manifest.json").write_bytes(root_bytes)
                actual_id=OTHER_SETUP_ID if case=="setup_mismatch" else SETUP_ID;page_doc={"Controllers":[self._keypad(setup_id=actual_id)]};page_bytes=json.dumps(page_doc,separators=(",",":")).encode();(page/"manifest.json").write_bytes(page_bytes)
            else:
                root_bytes=b"{}";page_bytes=b"{}"
            if case=="unrelated_malformed":
                unrelated=base/"ProfilesV2"/"dddddddd-dddd-4ddd-8ddd-dddddddddddd";unrelated.mkdir(parents=True);(unrelated/"manifest.json").write_text("{broken",encoding="utf-8")
            identity=lambda value:hashlib.sha256(value.lower().encode()).hexdigest();request={"store":"ProfilesV2","groupId":group_id,"pageId":page_id,"manifestPath":str(page/"manifest.json"),"manifestSha256":("0"*64 if case=="hash_changed" else hashlib.sha256(page_bytes).hexdigest()),"rootManifestSha256":hashlib.sha256(root_bytes).hexdigest(),"profileNameSha256":identity("Arkamax"),"deviceUuidSha256":identity("device-1")}
            quoted=lambda value:str(value).replace("'","''");prepare=(f"$prepared=ResolveTarget '0_0' (ActionIdHash '{SETUP_ID}');if($prepared.Store-ne$request.store-or$prepared.GroupId-ne$request.groupId-or$prepared.PageId-ne$request.pageId){{throw 'prepare/apply mismatch'}};" if case=="valid" else "");script=Path(td)/"requested.ps1";script.write_text(prefix+f"\n$base=Full '{quoted(base)}';$setting=Full '{quoted(base/'Config'/'setting_source.json')}';$request=ConvertFrom-Json '{quoted(json.dumps(request))}'\ntry{{{prepare}$r=ResolveRequestedTarget $request '0_0' (ActionIdHash '{SETUP_ID}');$r|ConvertTo-Json -Compress;exit 0}}catch{{Write-Output ($_.Exception.Message+'|'+$CurrentPhase);exit 2}}",encoding="utf-8")
            return subprocess.run(["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-File",str(script)],capture_output=True,text=True)

    def test_profile_clone_uses_only_new_identity_and_preserves_device(self):
        _,source_zip=tool.read_archive(SOURCE);old_pkg,_,_,old_root,old_profiles,old_docs=tool.package_identity(source_zip);old_actions=set(tool.collect_key_values(old_docs.values(),"ActionID"))
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)/"clone.ulanziDeckProfile"
            with contextlib.redirect_stdout(io.StringIO()):tool.patch(SOURCE,out,TARGET,uuid_factory=tool.deterministic_uuid_factory("imageslide"))
            _,z=tool.read_archive(out);pkg,_,_,root,profiles,docs=tool.package_identity(z)
            self.assertNotEqual(pkg,old_pkg);self.assertFalse(profiles&old_profiles);self.assertEqual(root["Device"],old_root["Device"]);self.assertEqual(root["Name"],"Image Slideshow")
            self.assertFalse(set(tool.collect_key_values(docs.values(),"ActionID"))&old_actions)
            selected=[x for x in tool.candidates(z) if x["action"]==tool.ACTION_UUID];self.assertEqual(len(selected),1);self.assertNotIn("bigbackground",json.dumps(selected[0]["entry"]).lower())

    def test_delivered_profile_receipt_and_action_metadata(self):
        profile=ROOT/"ImageSlide.ulanziDeckProfile";receipt=json.loads(Path(str(profile)+".receipt.json").read_text(encoding="utf-8"));data=profile.read_bytes();self.assertEqual(receipt["output_sha256"],hashlib.sha256(data).hexdigest())
        _,z=tool.read_archive(profile);entry=json.loads(z.read(receipt["manifest_member"]))["Controllers"][receipt["controller_index"]]["Actions"]["3_2"]
        self.assertEqual(entry["Action"],"com.arkamax.ulanzi.imageslide.slideshow");self.assertEqual(entry["Plugin"],{"Name":"Image Slideshow","UUID":"com.arkamax.ulanzi.imageslide","Version":"0.3.0"})

    def test_helper_is_pinned_fail_closed_two_stage_and_atomic(self):
        plugin=ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin";helper=(plugin/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8");compat=json.loads((plugin/"helper"/"compatibility.json").read_text())
        self.assertEqual(compat["studio"]["fileVersion"],"3.2.11.0");self.assertEqual(compat["studio"]["sha256"],"eee2458802e36170e8b09fe58d5d8f9b616813ee362fc83ac99884b3615509c4")
        for marker in ("COMPATIBILITY_UNSUPPORTED","PROFILE_AMBIGUOUS","SLOT_UNRELATED","if(StudioRunning)","Copy-Item -LiteralPath $manifest -Destination $backup","[IO.File]::Replace($temp,$manifest,$replaceBackup)","FindRestoreCandidate","ResolveRequestedRestore","Start-Process -FilePath $studio"):
            self.assertIn(marker,helper)
        self.assertLess(helper.index("if(StudioRunning)"),helper.index("$backup=Under"));self.assertNotRegex(helper,r"(?i)Stop-Process|taskkill|TerminateProcess")
        self.assertEqual(compat["state"]["settingSource"],"Config\\setting_source.json");self.assertEqual(compat["state"]["profileStores"],["ProfilesV2","ProfilesV1"])

    def test_helper_prefers_v2_and_persists_bounded_codes(self):
        plugin=ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin";helper=(plugin/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        resolve=helper[helper.index("function ResolveTarget"):helper.index("$exitCode=0")]
        self.assertLess(resolve.index("FindStoreMatches 'ProfilesV2'"),resolve.index("FindStoreMatches 'ProfilesV1'"))
        self.assertIn("SetPhase 'TARGET_RESOLUTION'",resolve);self.assertIn("UniqueTargets",resolve)
        for code in ("PROFILE_NOT_FOUND","PROFILE_AMBIGUOUS","PAGE_INVALID","SLOT_UNRELATED","SETTINGS_SCHEMA_UNSUPPORTED","REQUEST_WRITE_FAILED","HELPER_PROCESS_FAILED"):
            self.assertIn(code,helper)
        self.assertIn("last-diagnostic.json",helper);self.assertIn("IMAGESLIDE_DIAGNOSTIC:",helper);self.assertNotIn("profileContents",helper)

    def test_apply_precheck_requires_current_versioned_request(self):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        precheck=helper[helper.index("SetPhase 'APPLY_PRECHECK';if(StudioRunning)"):helper.index("$target=$(if($Mode-eq'Prepare')")]
        self.assertIn("setup-request/v5",precheck);self.assertIn("$requestVersion-ne$PluginVersion",precheck);self.assertIn("$expires-lt[DateTime]::UtcNow",precheck)
        self.assertGreaterEqual(precheck.count("REPREPARE_REQUIRED"),10);self.assertNotIn("ResolveRequestedTarget",precheck)
        self.assertIn("pluginVersion=$PluginVersion",helper);self.assertIn("function ValidSafeSegment",helper);self.assertNotIn("not(ValidUuid $groupId)",helper)

    def test_production_shape_patch_restore_round_trip_is_byte_exact(self):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        self.assertIn("[IO.File]::Replace($temp,$manifest,$replaceBackup)",helper);self.assertIn("[IO.File]::Replace($restoreTemp,$manifest,$failedPatched)",helper)
        self.assertNotIn("[IO.File]::Replace($temp,$manifest,$null)",helper);self.assertNotIn("[IO.File]::Replace($restoreTemp,$manifest,$null)",helper)
        _,archive=tool.read_archive(SOURCE);candidate=next(item for item in tool.candidates(archive) if item["profile_id"]==TARGET);original=archive.read(candidate["manifest"])
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);manifest=root/"manifest.json";manifest.write_bytes(original);script=root/"production-shape.ps1";quoted=lambda value:str(value).replace("'","''")
            script.write_text(f'''$ErrorActionPreference='Stop'
$manifest='{quoted(manifest)}';$backup='{quoted(root/"replace-backup.json")}'
$before=[IO.File]::ReadAllBytes($manifest);$doc=Get-Content -LiteralPath $manifest -Raw -Encoding UTF8|ConvertFrom-Json
$pads=@($doc.Controllers|Where-Object{{$_.Type-eq'Keypad'-and$null-ne$_.Actions.PSObject.Properties['3_2']}});if($pads.Count-ne1){{throw 'shape'}}
$entry=[ordered]@{{Action='com.arkamax.ulanzi.imageslide.slideshow';ActionID=[guid]::NewGuid().ToString();ActionParam=[ordered]@{{SmallViewMode=2}};LinkedTitle=$true;Name='Image Slideshow';Plugin=[ordered]@{{Name='Image Slideshow';UUID='com.arkamax.ulanzi.imageslide';Version='0.3.0'}};State=0;ViewParam=@([ordered]@{{Icon='';IconRel='';Name='Image Slideshow'}})}}
$pads[0].Actions|Add-Member -NotePropertyName '3_2' -NotePropertyValue $entry -Force;$temp=$manifest+'.tmp';[IO.File]::WriteAllText($temp,($doc|ConvertTo-Json -Depth 30),(New-Object Text.UTF8Encoding($false)))
$check=Get-Content -LiteralPath $temp -Raw -Encoding UTF8|ConvertFrom-Json;if($check.Controllers[1].Actions.'3_2'.Action-ne'com.arkamax.ulanzi.imageslide.slideshow'){{throw 'temp-readback'}}
[IO.File]::Replace($temp,$manifest,$backup);$after=Get-Content -LiteralPath $manifest -Raw -Encoding UTF8|ConvertFrom-Json;$patched=[IO.File]::ReadAllBytes($manifest)
$restoreTemp=$manifest+'.restore';Copy-Item -LiteralPath $backup -Destination $restoreTemp;$failedPatched='{quoted(root/"failed-patched.json")}';[IO.File]::Replace($restoreTemp,$manifest,$failedPatched)
[pscustomobject]@{{backupMatches=([Convert]::ToBase64String([IO.File]::ReadAllBytes($backup))-eq[Convert]::ToBase64String($before));action=$after.Controllers[1].Actions.'3_2'.Action;restored=([Convert]::ToBase64String([IO.File]::ReadAllBytes($manifest))-eq[Convert]::ToBase64String($before));failedMatches=([Convert]::ToBase64String([IO.File]::ReadAllBytes($failedPatched))-eq[Convert]::ToBase64String($patched))}}|ConvertTo-Json -Compress
''',encoding="utf-8")
            run=subprocess.run(["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-File",str(script)],capture_output=True,text=True);self.assertEqual(run.returncode,0,run.stdout+run.stderr);result=json.loads(run.stdout);self.assertTrue(result["backupMatches"]);self.assertEqual(result["action"],"com.arkamax.ulanzi.imageslide.slideshow");self.assertTrue(result["restored"]);self.assertTrue(result["failedMatches"])

    def _restore_candidate_fixture(self,case):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8");prefix=helper[helper.index("$ActionUuid="):helper.index("$exitCode=0")]
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);manifest=root/"manifest.json";original=json.dumps({"Controllers":[self._keypad()]},separators=(",",":")).encode();patched=json.dumps({"Controllers":[self._keypad(action="com.arkamax.ulanzi.imageslide.slideshow")]},separators=(",",":")).encode();manifest.write_bytes(patched);backup_root=root/"backups";run=backup_root/"run-a";run.mkdir(parents=True);backup=run/"manifest.before.json";backup.write_bytes(original)
            target={"store":"ProfilesV2","groupId":"group-a","pageId":"page-a","key":"3_2"};receipt={"schema":"com.arkamax.ulanzi.imageslide.setup-receipt/v1","operation":("apply-or-repair" if case=="legacy_019" else "patch"),"result":"success","target":dict(target),"beforeSha256":hashlib.sha256(original).hexdigest(),"afterSha256":hashlib.sha256(patched).hexdigest(),"backupSha256":hashlib.sha256(original).hexdigest(),"action":"com.arkamax.ulanzi.imageslide.slideshow"}
            if case=="target_mismatch":receipt["target"]["pageId"]="page-other"
            receipt_path=run/"receipt.json";receipt_path.write_text(json.dumps(receipt,separators=(",",":")),encoding="utf-8")
            if case=="missing":receipt_path.unlink()
            if case=="tampered_backup":backup.write_bytes(b"tampered")
            if case=="multiple":
                second=backup_root/"run-b";second.mkdir();(second/"manifest.before.json").write_bytes(original);(second/"receipt.json").write_text(json.dumps(receipt,separators=(",",":")),encoding="utf-8")
            quoted=lambda value:str(value).replace("'","''");script=root/"restore.ps1";tamper="$restore.receiptSha256='0'*64;" if case=="request_tamper" else ""
            script.write_text(prefix+f"\n$backupRoot=Full '{quoted(backup_root)}';$target=[pscustomobject]@{{Store='ProfilesV2';GroupId='group-a';PageId='page-a';Manifest=(Full '{quoted(manifest)}');Kind='restore'}}\ntry{{$candidate=FindRestoreCandidate $target;$restore=[pscustomobject]@{{runId=$candidate.RunId;receiptSha256=$candidate.ReceiptSha256;backupSha256=$candidate.BackupSha256;beforeSha256=$candidate.BeforeSha256;afterSha256=$candidate.AfterSha256}};{tamper}$resolved=ResolveRequestedRestore $target $restore;[pscustomobject]@{{runId=$resolved.RunId;phase=$CurrentPhase}}|ConvertTo-Json -Compress;exit 0}}catch{{Write-Output ($_.Exception.Message+'|'+$CurrentPhase);exit 2}}",encoding="utf-8")
            return subprocess.run(["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-File",str(script)],capture_output=True,text=True)

    def test_restore_candidate_is_uniquely_bound_and_tamper_evident(self):
        run=self._restore_candidate_fixture("valid");self.assertEqual(run.returncode,0,run.stdout+run.stderr);self.assertEqual(json.loads(run.stdout)["phase"],"RESTORE_RESOLUTION")
        expected={"missing":"RESTORE_BACKUP_NOT_FOUND","tampered_backup":"RESTORE_BACKUP_NOT_FOUND","target_mismatch":"RESTORE_BACKUP_NOT_FOUND","multiple":"PROFILE_AMBIGUOUS","request_tamper":"RESTORE_BACKUP_INVALID"}
        for case,code in expected.items():
            with self.subTest(case=case):run=self._restore_candidate_fixture(case);self.assertEqual(run.returncode,2,run.stdout+run.stderr);self.assertIn(code+"|",run.stdout)

    def test_first_020_press_restores_verified_019_patch_lineage(self):
        run=self._restore_candidate_fixture("legacy_019");self.assertEqual(run.returncode,0,run.stdout+run.stderr);self.assertEqual(json.loads(run.stdout)["phase"],"RESTORE_RESOLUTION")
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8");self.assertIn("@('apply-or-repair','patch')",helper)

    def test_missing_properties_are_guarded_under_strict_mode(self):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        for marker in ("Required $state 'Devices'","Required $device 'CurrentProfile'","Required $device 'CurrentDevice'","Required $gm 'Name'","Required $gm 'Device'","Required $gm 'Pages'","Required $Document 'Controllers'","Required $largeControllers[0] 'Actions'"):
            self.assertIn(marker,helper)

    def test_duplicate_devices_resolve_to_one_canonical_target(self):
        devices=[{"CurrentProfile":"Arkamax","CurrentDevice":"device-1"}]*2
        groups=[{"id":"group-a","name":"Arkamax","device":"device-1","current":"page-a","pages":{"page-a":[{"Type":"Encoder","Actions":{}},self._keypad()]}}]
        run=self._resolve_fixture(devices,{"ProfilesV2":groups});self.assertEqual(run.returncode,0,run.stdout+run.stderr)
        result=json.loads(run.stdout);self.assertEqual((result["store"],result["groupId"],result["pageId"],result["kind"]),("ProfilesV2","group-a","page-a","patch"))

    def test_setup_state_machine_selects_patch_restore_or_refusal(self):
        devices=[{"CurrentProfile":"Arkamax","CurrentDevice":"device-1"}]
        def run_for(action):return self._resolve_fixture(devices,{"ProfilesV2":[{"id":"group-a","name":"Arkamax","device":"device-1","current":"page-a","pages":{"page-a":[self._keypad(action=action)]}}]})
        restore=run_for("com.arkamax.ulanzi.imageslide.slideshow");self.assertEqual(restore.returncode,0,restore.stdout+restore.stderr);self.assertEqual(json.loads(restore.stdout)["kind"],"restore")
        refuse=run_for("com.example.unrelated");self.assertEqual(refuse.returncode,2);self.assertIn("SLOT_UNRELATED|INTEGRITY|SLOT_VALIDATION",refuse.stdout)
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8");self.assertIn("$target.Kind-ne$requestedOperation",helper)

    def test_setup_action_id_selects_one_of_multiple_same_name_clones(self):
        devices=[{"CurrentProfile":"Arkamax","CurrentDevice":"device-1"}]
        groups=[
            {"id":"group-active","name":"Arkamax","device":"device-1","current":"page-active","pages":{"page-active":[self._keypad()]}},
            {"id":"group-old","name":"Arkamax","device":"device-1","current":"page-old","pages":{"page-old":[self._keypad(setup_id=OTHER_SETUP_ID)]}}
        ]
        run=self._resolve_fixture(devices,{"ProfilesV2":groups});self.assertEqual(run.returncode,0,run.stdout+run.stderr);self.assertEqual(json.loads(run.stdout)["groupId"],"group-active")

    def test_zero_setup_match_wrong_action_and_wrong_key_fail_stably(self):
        devices=[{"CurrentProfile":"Arkamax","CurrentDevice":"device-1"}]
        wrong_action={"id":"group-a","name":"Arkamax","device":"device-1","current":"page-a","pages":{"page-a":[self._keypad(setup_action="com.example.unrelated")]}}
        run=self._resolve_fixture(devices,{"ProfilesV2":[wrong_action]});self.assertEqual(run.returncode,2);self.assertIn("SETUP_INSTANCE_NOT_FOUND|SCHEMA|TARGET_RESOLUTION",run.stdout)
        correct={"id":"group-a","name":"Arkamax","device":"device-1","current":"page-a","pages":{"page-a":[self._keypad()]}}
        run=self._resolve_fixture(devices,{"ProfilesV2":[correct]},pressed_key="1_1");self.assertEqual(run.returncode,2);self.assertIn("SETUP_INSTANCE_NOT_FOUND|SCHEMA|TARGET_RESOLUTION",run.stdout)

    def test_apply_is_bound_to_requested_target_and_ignores_unrelated_manifests(self):
        run=self._requested_target_fixture("valid");self.assertEqual(run.returncode,0,run.stdout+run.stderr);self.assertEqual(json.loads(run.stdout)["GroupId"],"group-a")
        run=self._requested_target_fixture("unrelated_malformed");self.assertEqual(run.returncode,0,run.stdout+run.stderr);self.assertEqual(json.loads(run.stdout)["GroupId"],"group-a")
        expected={"missing":"PROFILE_NOT_FOUND","malformed_requested":"MANIFEST_INVALID","hash_changed":"PAGE_INVALID","page_changed":"PAGE_INVALID","setup_mismatch":"SETUP_INSTANCE_NOT_FOUND"}
        for case,code in expected.items():
            with self.subTest(case=case):
                run=self._requested_target_fixture(case);self.assertEqual(run.returncode,2,run.stdout+run.stderr);self.assertIn(code+"|",run.stdout)

    def test_distinct_duplicate_groups_remain_ambiguous(self):
        devices=[{"CurrentProfile":"Arkamax","CurrentDevice":"device-1"}]
        groups=[{"id":f"group-{n}","name":"Arkamax","device":"device-1","current":f"page-{n}","pages":{f"page-{n}":[self._keypad()]}} for n in ("a","b")]
        run=self._resolve_fixture(devices,{"ProfilesV2":groups});self.assertEqual(run.returncode,2);self.assertIn("PROFILE_AMBIGUOUS|AMBIGUITY|TARGET_RESOLUTION",run.stdout)

    def test_v2_target_wins_over_duplicate_v1_store(self):
        devices=[{"CurrentProfile":"Arkamax","CurrentDevice":"device-1"}]
        group={"id":"group-a","name":"Arkamax","device":"device-1","current":"page-a","pages":{"page-a":[self._keypad()]}}
        run=self._resolve_fixture(devices,{"ProfilesV2":[group],"ProfilesV1":[group]});self.assertEqual(run.returncode,0,run.stdout+run.stderr);self.assertEqual(json.loads(run.stdout)["store"],"ProfilesV2")

    def test_exactly_one_keypad_with_3_2_is_required(self):
        devices=[{"CurrentProfile":"Arkamax","CurrentDevice":"device-1"}]
        base={"id":"group-a","name":"Arkamax","device":"device-1","current":"page-a"}
        one=dict(base,pages={"page-a":[{"Type":"Keypad","Actions":{"1_1":{"Action":"other"}}},self._keypad()]})
        run=self._resolve_fixture(devices,{"ProfilesV2":[one]});self.assertEqual(run.returncode,0,run.stdout+run.stderr)
        zero=dict(base,pages={"page-a":[{"Type":"Keypad","Actions":{"0_0":{"Action":"com.arkamax.ulanzi.imageslide.setup","ActionID":SETUP_ID}}}]})
        run=self._resolve_fixture(devices,{"ProfilesV2":[zero]});self.assertEqual(run.returncode,2);self.assertIn("PAGE_INVALID|SCHEMA|PAGE_READ",run.stdout)
        multiple=dict(base,pages={"page-a":[self._keypad(),{"Type":"Keypad","Actions":{"3_2":{"Action":"com.ulanzi.ulanzideck.smallwindow.window"}}}]})
        run=self._resolve_fixture(devices,{"ProfilesV2":[multiple]});self.assertEqual(run.returncode,2);self.assertIn("PAGE_INVALID|SCHEMA|PAGE_READ",run.stdout)

    def test_only_current_page_participates_in_selection(self):
        devices=[{"CurrentProfile":"Arkamax","CurrentDevice":"device-1"}]
        group={"id":"group-a","name":"Arkamax","device":"device-1","current":"page-current","pages":{"page-current":[self._keypad()],"page-other":[self._keypad(setup_id=SETUP_ID),self._keypad(setup_id=SETUP_ID)]}}
        run=self._resolve_fixture(devices,{"ProfilesV2":[group]});self.assertEqual(run.returncode,0,run.stdout+run.stderr);self.assertEqual(json.loads(run.stdout)["pageId"],"page-current")

    def test_absent_v2_falls_back_but_unreadable_store_is_stable_failure(self):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        self.assertIn("if(-not(Test-Path -LiteralPath $store -PathType Container)){return @()}",helper)
        self.assertIn("catch{Fail 'PROFILE_STORE_UNREADABLE' 'ACCESS'}",helper)
        self.assertLess(helper.index("FindStoreMatches 'ProfilesV2'"),helper.index("FindStoreMatches 'ProfilesV1'"))

    def test_malformed_manifests_map_before_property_access(self):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        self.assertIn("ReadJson $groupManifest 'MANIFEST_INVALID' 'SCHEMA'",helper);self.assertIn("ReadJson $pageManifest 'MANIFEST_INVALID' 'SCHEMA'",helper)

    def test_failure_preserves_allowlisted_phase(self):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        final=helper[helper.rindex("}catch{"):]
        self.assertIn("WriteDiagnostic 'failed' $code $CurrentPhase $category",final);self.assertNotIn("WriteDiagnostic 'failed' $code 'complete'",final)
        for phase in ("COMPATIBILITY","SETTINGS_READ","SETTINGS_SCHEMA","V2_ENUMERATION","V1_FALLBACK","DEVICE_PROFILE_MATCH","PAGE_READ","SLOT_VALIDATION","REQUEST_WRITE"):
            self.assertIn("'"+phase+"'",helper)

    def test_compatibility_subphases_wrap_every_boundary(self):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        phases=("COMPAT_PLUGIN_ROOT","COMPAT_MANIFEST_READ","COMPAT_EXE_PATH","COMPAT_VERSION_READ","COMPAT_HASH_READ","COMPAT_ENV_PATHS")
        positions=[helper.index("SetPhase '"+phase+"'") for phase in phases];self.assertEqual(positions,sorted(positions))
        for start,end in zip(positions,positions[1:]+[helper.index("$request=$null;$bindingHash=''")]):self.assertIn("try{",helper[start:end]);self.assertIn("catch{",helper[start:end])

    def test_direct_dotnet_sha256_matches_fixture_and_pinned_executable(self):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        function=helper[helper.index("function HashFileDirect"):helper.index("function ReadJson")]
        self.assertNotIn("Get-FileHash",function);self.assertIn("SHA256]::Create",function);self.assertIn("FileShare]::ReadWrite",function);self.assertGreaterEqual(function.count(".Dispose()"),2)
        executable=Path(r"C:\Program Files (x86)\UlanziDeck\UlanziDeck.exe")
        expected="eee2458802e36170e8b09fe58d5d8f9b616813ee362fc83ac99884b3615509c4"
        with tempfile.TemporaryDirectory() as td:
            fixture=Path(td)/"fixture.bin";fixture.write_bytes(b"ImageSlidePlugin direct hash fixture\n")
            script=Path(td)/"hash-test.ps1";script.write_text(function+f"\nWrite-Output (HashFileDirect '{fixture}')\nWrite-Output (HashFileDirect '{executable}')\n",encoding="utf-8")
            run=subprocess.run(["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-File",str(script)],capture_output=True,text=True,check=True)
            hashes=[line.strip() for line in run.stdout.splitlines() if line.strip()]
        self.assertEqual(hashes,[hashlib.sha256(b"ImageSlidePlugin direct hash fixture\n").hexdigest(),expected])

    def test_request_pointer_publication_and_all_runtime_hashes_are_direct(self):
        plugin=ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin";helper=(plugin/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8");installer=(ROOT/"Install-ImageSlidePlugin.ps1").read_text(encoding="utf-8")
        self.assertNotIn("Get-FileHash",helper);self.assertNotIn("Get-FileHash",installer);self.assertIn("function Hash([string]$Path){HashFileDirect $Path}",helper)
        prefix=helper[helper.index("function Full"):helper.index("function StudioRunning")]
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);manifest=root/"manifest.json";manifest.write_text('{"before":true}',encoding="utf-8");request_root=root/"requests";script=root/"request.ps1";quoted=lambda value:str(value).replace("'","''")
            script.write_text(prefix+f'''\n$ErrorActionPreference='Stop'\n$requestRoot=Full '{quoted(request_root)}'\n$manifest=Full '{quoted(manifest)}'\n[IO.Directory]::CreateDirectory($requestRoot)|Out-Null;$now=[DateTime]::UtcNow\n$request=[ordered]@{{schema='com.arkamax.ulanzi.imageslide.setup-request/v5';pluginVersion='0.2.0';createdUtc=$now.ToString('o');manifestSha256=(Hash $manifest)}}\n$json=CanonicalJson $request;$digest=RequestHash $json;$id=[guid]::NewGuid().ToString('N');$requestFile=Under (Join-Path $requestRoot ($id+'.json')) $requestRoot;$hashFile=$requestFile+'.sha256';$tmp=$requestFile+'.tmp'\nWriteUtf8 $tmp $json;Move-Item -LiteralPath $tmp -Destination $requestFile;WriteUtf8 $hashFile ($digest+"`n")\n$pointer=[ordered]@{{schema='com.arkamax.ulanzi.imageslide.request-pointer/v1';file=[IO.Path]::GetFileName($requestFile);sha256=$digest}};WriteUtf8 (Join-Path $requestRoot 'current.json') (CanonicalJson $pointer)\n$backup=Join-Path $requestRoot 'manifest.before.json';Copy-Item $manifest $backup;$beforeHash=Hash $backup;WriteUtf8 $manifest '{{"after":true}}';$afterHash=Hash $manifest;$receipt=Join-Path $requestRoot 'receipt.json';WriteUtf8 $receipt '{{"result":"success"}}';$receiptHash=Hash $receipt\n[pscustomobject]@{{pointer=(Test-Path (Join-Path $requestRoot 'current.json'));requestHash=(Hash $requestFile);digest=$digest;backupHash=$beforeHash;afterHash=$afterHash;receiptHash=$receiptHash}}|ConvertTo-Json -Compress\n''',encoding="utf-8")
            run=subprocess.run(["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass","-File",str(script)],capture_output=True,text=True,check=True);result=json.loads(run.stdout)
            self.assertTrue(result["pointer"]);self.assertEqual(result["requestHash"],result["digest"]);self.assertEqual(result["backupHash"],hashlib.sha256(b'{"before":true}').hexdigest());self.assertEqual(result["afterHash"],hashlib.sha256(b'{"after":true}').hexdigest());self.assertEqual(result["receiptHash"],hashlib.sha256(b'{"result":"success"}').hexdigest())
        request_end=helper.index("WriteDiagnostic 'prepared'");request_start=helper.rfind("if($Mode-eq'Prepare'){",0,request_end);request_block=helper[request_start:request_end];self.assertLess(request_block.index("WriteUtf8 $hashFile"),request_block.index("current.json"))

    def test_diagnostic_record_has_privacy_bounded_fields_only(self):
        helper=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8");setup=(ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"plugin"/"setup.js").read_text(encoding="utf-8")
        record=helper[helper.index("$record=[ordered]@"):helper.index("try{WriteUtf8 $diagnosticPath")]
        self.assertIn("timestampUtc",record);self.assertIn("category",record)
        for forbidden in ("message=","path=","profile=","username=","hostname=","content="):self.assertNotIn(forbidden.lower(),record.lower())
        self.assertIn("setupActionIdSha256=$bindingHash",helper);self.assertNotIn("setupActionId=$SetupActionId",helper)
        self.assertIn('Start-ImageSlideSetup.ps1',setup);self.assertIn('stdio:"ignore"',setup);self.assertNotIn("console.log",setup);self.assertIn("diagnosticResult",setup)

    def test_installer_and_source_have_only_new_product_identity(self):
        plugin=ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin";manifest=json.loads((plugin/"manifest.json").read_text());self.assertEqual(manifest["UUID"],"com.arkamax.ulanzi.imageslide");self.assertEqual([a["UUID"] for a in manifest["Actions"]],["com.arkamax.ulanzi.imageslide.slideshow","com.arkamax.ulanzi.imageslide.setup"])
        installer=(ROOT/"Install-ImageSlidePlugin.ps1").read_text();self.assertIn("SupportsShouldProcess = $true",installer);self.assertNotIn("com.arkamax.ulanzi.bigbackground",installer);self.assertNotRegex(installer,r"(?i)Stop-Process|taskkill")

    def test_store_metadata_uses_supplied_artwork_and_declares_windows_only(self):
        store=json.loads((ROOT/"store.json").read_text(encoding="utf-8"))
        self.assertEqual(store["cover"],"assets/cover.png")
        self.assertEqual(store["screenshots"],["assets/banner.png"])
        self.assertIn("Windows only",store["longDescription"])
        self.assertIn("https://github.com/chilleno/claude-deck",store["longDescription"])
        self.assertIn("windows",store["tags"])
        self.assertEqual(tool.PNG_DIMS((ROOT/store["cover"]).read_bytes()),(1672,941))
        self.assertEqual(tool.PNG_DIMS((ROOT/store["screenshots"][0]).read_bytes()),(2172,724))
        manifest=json.loads((ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"/"manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["OS"],[{"Platform":"windows","MinimumVersion":"10"}])
        self.assertIn("https://github.com/chilleno/claude-deck",(ROOT/"README.md").read_text(encoding="utf-8"))

    def test_every_generated_slideshow_assignment_hides_the_clock(self):
        plugin=ROOT/"source"/"com.arkamax.ulanzi.imageslide.ulanziPlugin"
        helper=(plugin/"helper"/"Invoke-ImageSlideSetup.ps1").read_text(encoding="utf-8")
        tool_source=(ROOT/"tools"/"profile_tool.py").read_text(encoding="utf-8")
        self.assertIn("ActionParam=[ordered]@{SmallViewMode=2}",helper)
        self.assertIn('"ActionParam":{"SmallViewMode":2}',tool_source)
        _,archive=tool.read_archive(ROOT/"ImageSlide.ulanziDeckProfile")
        assignments=[item["entry"] for item in tool.candidates(archive) if item["action"]==tool.ACTION_UUID]
        self.assertEqual(len(assignments),1)
        self.assertEqual(assignments[0]["ActionParam"],{"SmallViewMode":2})

    def test_packages_and_checksum_manifest_read_back(self):
        plugin_root="com.arkamax.ulanzi.imageslide.ulanziPlugin"
        with zipfile.ZipFile(ROOT/(plugin_root+".zip")) as archive:
            self.assertIsNone(archive.testzip());names=archive.namelist();self.assertEqual({Path(n).parts[0] for n in names},{plugin_root})
            manifest=json.loads(archive.read(plugin_root+"/manifest.json"));self.assertEqual(manifest["Version"],"0.3.0")
            for name in names:
                if not name.endswith("/"):self.assertNotIn(b"Get-FileHash",archive.read(name))
            for member in ("plugin/app.js","plugin/images.js","plugin/setup.js","property-inspector/inspector.html","property-inspector/setup.html","helper/Start-ImageSlideSetup.ps1","helper/Invoke-ImageSlideSetup.ps1","helper/compatibility.json","node_modules/sharp/dist/index.mjs","node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64-0.35.4.node"):
                self.assertIn(plugin_root+"/"+member,names)
        for name in ("ImageSlidePlugin-source.zip","ImageSlideSetupHelper.zip"):
            with zipfile.ZipFile(ROOT/name) as archive:self.assertIsNone(archive.testzip())
        for line in (ROOT/"SHA256SUMS.txt").read_text(encoding="utf-8").splitlines():
            expected,name=line.split(None,1);self.assertEqual(hashlib.sha256((ROOT/name.strip()).read_bytes()).hexdigest(),expected)

if __name__=="__main__":unittest.main()
