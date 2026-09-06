import assert from "node:assert/strict";
import test from "node:test";
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { apply, main, prepare } from "../helper/Invoke-ImageSlideSetup.mjs";

const execute=promisify(execFile);
const setup="com.arkamax.ulanzi.imageslide.setup";
const slide="com.arkamax.ulanzi.imageslide.slideshow";
const builtIn="com.ulanzi.ulanzideck.smallwindow.window";
const actionId="11111111-1111-4111-8111-111111111111";

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),"imageslide-macos-")),data=join(root,"data"),state=join(root,"state"),group="group-a",page="page-a",manifest=join(data,"ProfilesV2",group,"Profiles",page,"manifest.json");
  await mkdir(join(data,"Config"),{recursive:true});
  await mkdir(join(data,"ProfilesV2",group,"Profiles",page),{recursive:true});
  await writeFile(join(data,"Config","setting_source.json"),JSON.stringify({Devices:[{CurrentProfile:"Test",CurrentDevice:"device-a"}]}));
  await writeFile(join(data,"ProfilesV2",group,"manifest.json"),JSON.stringify({Name:"Test",Device:{UUID:"device-a",Model:"D200"},Pages:{Current:page,Pages:[page]}}));
  await writeFile(manifest,JSON.stringify({Controllers:[{Type:"Keypad",Actions:{"0_0":{Action:setup,ActionID:actionId,ActionParam:{operation:"install"}},"1_0":{Action:"example.safe",Name:"Preserve me"},"3_2":{Action:builtIn}}}]}));
  return{root,data,state,manifest};
}

async function readPage(f){return JSON.parse(await readFile(f.manifest,"utf8"))}
async function writePage(f,page,compact=false){await writeFile(f.manifest,JSON.stringify(page,null,compact?0:2))}
async function install(f){await prepare({dataRoot:f.data,stateRoot:f.state,key:"0_0",setupActionId:actionId});return apply({dataRoot:f.data,stateRoot:f.state,isStudioClosed:async()=>true})}
async function patchRun(f){for(const name of await readdir(join(f.state,"backups"))){const receiptPath=join(f.state,"backups",name,"receipt.json");try{const receipt=JSON.parse(await readFile(receiptPath,"utf8"));if(receipt.operation==="patch")return{name,receiptPath,receipt}}catch{}}throw new Error("Patch receipt not found")}
async function rejectRestore(f,code="RESTORE_BACKUP_INVALID"){await assert.rejects(prepare({dataRoot:f.data,stateRoot:f.state,key:"0_0",setupActionId:actionId,operation:"restore"}),error=>error.code===code&&error.phase==="RESTORE_RESOLUTION")}

test("macOS helper records semantic center lineage and restores its exact backup",async()=>{const f=await fixture();try{const patched=await install(f),run=await patchRun(f);let page=await readPage(f);assert.equal(page.Controllers[0].Actions["3_2"].Action,slide);assert.equal(page.Controllers[0].Actions["3_2"].ActionParam.SmallViewMode,2);assert.match(run.receipt.centerActionFingerprintSha256,/^[0-9a-f]{64}$/);await prepare({dataRoot:f.data,stateRoot:f.state,key:"0_0",setupActionId:actionId,operation:"restore"});const restored=await apply({dataRoot:f.data,stateRoot:f.state,isStudioClosed:async()=>true});page=await readPage(f);assert.equal(patched.result,"success");assert.equal(restored.result,"restored");assert.equal(page.Controllers[0].Actions["3_2"].Action,builtIn)}finally{await rm(f.root,{recursive:true,force:true})}});

test("restore permits JSON compaction, slideshow Plugin normalization, and Setup operation persistence",async()=>{const f=await fixture();try{await install(f);const page=await readPage(f);page.Controllers[0].Actions["3_2"].Plugin={};page.Controllers[0].Actions["0_0"].ActionParam.operation="restore";await writePage(f,page,true);await prepare({dataRoot:f.data,stateRoot:f.state,key:"0_0",setupActionId:actionId,operation:"restore"});const receipt=await apply({dataRoot:f.data,stateRoot:f.state,isStudioClosed:async()=>true});assert.equal(receipt.result,"restored");assert.equal((await readPage(f)).Controllers[0].Actions["3_2"].Action,builtIn)}finally{await rm(f.root,{recursive:true,force:true})}});

test("restore canonicalizes an initially empty Setup ActionParam against Studio operation persistence",async()=>{const f=await fixture();try{const original=await readPage(f);original.Controllers[0].Actions["0_0"].ActionParam={};await writePage(f,original);await install(f);const current=await readPage(f);current.Controllers[0].Actions["0_0"].ActionParam={operation:"restore"};await writePage(f,current);await prepare({dataRoot:f.data,stateRoot:f.state,key:"0_0",setupActionId:actionId,operation:"restore"});const receipt=await apply({dataRoot:f.data,stateRoot:f.state,isStudioClosed:async()=>true});assert.equal(receipt.result,"restored");assert.deepEqual((await readPage(f)).Controllers[0].Actions["0_0"].ActionParam,{})}finally{await rm(f.root,{recursive:true,force:true})}});

test("restore rejects unknown operations and additional Setup parameters",async()=>{for(const params of [{operation:"unknown"},{operation:"restore",unexpected:true}]){const f=await fixture();try{await install(f);const page=await readPage(f);page.Controllers[0].Actions["0_0"].ActionParam=params;await writePage(f,page);await rejectRestore(f)}finally{await rm(f.root,{recursive:true,force:true})}}});

test("restore rejects center replacement, identity changes, and required parameter tampering",async()=>{const mutations=[
  action=>{action.Action="example.replacement"},
  action=>{action.ActionID="22222222-2222-4222-8222-222222222222"},
  action=>{action.ActionParam.SmallViewMode=1},
  action=>{action.LinkedTitle=false},
  action=>{action.Plugin={Name:"Tampered"}},
];for(const mutate of mutations){const f=await fixture();try{await install(f);const page=await readPage(f);mutate(page.Controllers[0].Actions["3_2"]);await writePage(f,page);if(page.Controllers[0].Actions["3_2"].Action===slide)await rejectRestore(f);else await assert.rejects(prepare({dataRoot:f.data,stateRoot:f.state,key:"0_0",setupActionId:actionId,operation:"restore"}),error=>error.code==="SLOT_UNRELATED")}finally{await rm(f.root,{recursive:true,force:true})}}});

test("restore rejects unrelated semantic page edits",async()=>{const f=await fixture();try{await install(f);const page=await readPage(f);page.Controllers[0].Actions["1_0"].Name="Changed outside the center";await writePage(f,page);await rejectRestore(f)}finally{await rm(f.root,{recursive:true,force:true})}});

test("restore rejects ambiguous valid lineage",async()=>{const f=await fixture();try{await install(f);const run=await patchRun(f);await cp(join(f.state,"backups",run.name),join(f.state,"backups","duplicate-lineage"),{recursive:true});await rejectRestore(f,"PROFILE_AMBIGUOUS")}finally{await rm(f.root,{recursive:true,force:true})}});

test("bounded legacy recovery reconstructs the original helper output before accepting normalization",async()=>{const f=await fixture();try{await install(f);const run=await patchRun(f);delete run.receipt.centerActionFingerprintSha256;await writeFile(run.receiptPath,JSON.stringify(run.receipt));const page=await readPage(f);page.Controllers[0].Actions["3_2"].Plugin={};page.Controllers[0].Actions["0_0"].ActionParam.operation="restore";await writePage(f,page,true);const request=await prepare({dataRoot:f.data,stateRoot:f.state,key:"0_0",setupActionId:actionId,operation:"restore"});assert.match(request.restore.centerActionFingerprintSha256,/^[0-9a-f]{64}$/);assert.equal((await apply({dataRoot:f.data,stateRoot:f.state,isStudioClosed:async()=>true})).result,"restored")}finally{await rm(f.root,{recursive:true,force:true})}});

test("restore diagnostics distinguish missing lineage from bound integrity mismatch",async()=>{const missing=await fixture();try{const page=await readPage(missing);page.Controllers[0].Actions["3_2"]={Action:slide,ActionID:"33333333-3333-4333-8333-333333333333",ActionParam:{SmallViewMode:2},LinkedTitle:true,Name:"Image Slideshow",Plugin:{},State:0,ViewParam:[{Icon:"",IconRel:"",Name:"Image Slideshow"}]};await writePage(missing,page);await rejectRestore(missing,"RESTORE_BACKUP_NOT_FOUND")}finally{await rm(missing.root,{recursive:true,force:true})}const invalid=await fixture();try{await install(invalid);const run=await patchRun(invalid);run.receipt.afterSha256="0".repeat(64);await writeFile(run.receiptPath,JSON.stringify(run.receipt));await rejectRestore(invalid,"RESTORE_BACKUP_INVALID")}finally{await rm(invalid.root,{recursive:true,force:true})}});

test("restore requires exact store, profile, and page receipt binding",async()=>{const f=await fixture();try{await install(f);const run=await patchRun(f);run.receipt.target.groupId="other-profile";await writeFile(run.receiptPath,JSON.stringify(run.receipt));await rejectRestore(f,"RESTORE_BACKUP_NOT_FOUND")}finally{await rm(f.root,{recursive:true,force:true})}});

test("macOS helper fails closed when Studio is open or a prepared manifest changes",async()=>{const f=await fixture();try{await prepare({dataRoot:f.data,stateRoot:f.state,key:"0_0",setupActionId:actionId});await assert.rejects(apply({dataRoot:f.data,stateRoot:f.state,isStudioClosed:async()=>false}),error=>error.code==="HELPER_PROCESS_FAILED");await writeFile(f.manifest,JSON.stringify({Controllers:[]}));await assert.rejects(apply({dataRoot:f.data,stateRoot:f.state,isStudioClosed:async()=>true}),error=>error.code==="PAGE_INVALID")}finally{await rm(f.root,{recursive:true,force:true})}});

test("macOS helper rolls the page back byte-for-byte after a post-rename failure",async()=>{const f=await fixture();try{const before=await readFile(f.manifest);await prepare({dataRoot:f.data,stateRoot:f.state,key:"0_0",setupActionId:actionId});await assert.rejects(apply({dataRoot:f.data,stateRoot:f.state,isStudioClosed:async()=>true,afterRename:async()=>{throw new Error("injected post-rename failure")}}),/injected post-rename failure/);assert.deepEqual(await readFile(f.manifest),before);const names=await readdir(join(f.data,"ProfilesV2","group-a","Profiles","page-a"));assert.ok(names.every(name=>!name.includes(".imageslide-")))}finally{await rm(f.root,{recursive:true,force:true})}});

test("direct execution runs from a path containing spaces and writes a bounded failure",async()=>{const root=await mkdtemp(join(await realpath(tmpdir()),"imageslide path with spaces-")),helper=join(root,"Invoke ImageSlide Setup.mjs"),state=join(root,"state");try{await cp(new URL("../helper/Invoke-ImageSlideSetup.mjs",import.meta.url),helper);await assert.rejects(execute(process.execPath,[helper,"--mode","assistant","--state-root",state]),error=>error.code===1);const status=JSON.parse(await readFile(join(state,"last-diagnostic.json"),"utf8"));assert.equal(status.status,"failed");assert.equal(status.code,"COMPATIBILITY_UNSUPPORTED");assert.equal(status.phase,"COMPAT_PLUGIN_ROOT");assert.match(status.handshakeId,/^[0-9a-f-]{36}$/i)}finally{await rm(root,{recursive:true,force:true})}});

test("main writes started, prepared, failed, and manual-reopen terminal states using temp fixtures only",async()=>{const f=await fixture(),pluginRoot=join(f.root,"plugin"),helperRoot=join(pluginRoot,"helper"),failedState=join(f.root,"failed-state"),seen=[];try{await mkdir(helperRoot,{recursive:true});await writeFile(join(helperRoot,"compatibility.json"),JSON.stringify({schema:"com.arkamax.ulanzi.imageslide.compatibility/v1",studio:{macos:{bundleIdentifiers:["test.bundle"]}}}));assert.equal(await main(["--mode","assistant","--state-root",failedState],{readBundleIdentifier:async()=>"test.bundle"}),false);const failed=JSON.parse(await readFile(join(failedState,"last-diagnostic.json"),"utf8"));assert.equal(failed.status,"failed");assert.equal(failed.code,"COMPATIBILITY_UNSUPPORTED");assert.equal(await main(["--mode","assistant","--plugin-root",pluginRoot,"--data-root",f.data,"--state-root",f.state,"--pressed-key","0_0","--setup-action-id",actionId,"--operation","install"],{readBundleIdentifier:async()=>{seen.push(JSON.parse(await readFile(join(f.state,"last-diagnostic.json"),"utf8")).status);return"test.bundle"},isStudioClosed:async()=>{seen.push(JSON.parse(await readFile(join(f.state,"last-diagnostic.json"),"utf8")).status);return true}}),true);const terminal=JSON.parse(await readFile(join(f.state,"last-diagnostic.json"),"utf8"));assert.deepEqual(seen,["started","prepared","prepared"]);assert.equal(terminal.status,"success");assert.equal(terminal.code,"SUCCESS");assert.equal(terminal.phase,"MANUAL_REOPEN")}finally{await rm(f.root,{recursive:true,force:true})}});

test("production macOS compatibility is ProfilesV2-only and requires manual reopen",async()=>{const compatibility=JSON.parse(await readFile(new URL("../helper/compatibility.json",import.meta.url),"utf8"));assert.deepEqual(compatibility.studio.macos,{bundleIdentifiers:["ulanzi.UlanziStudio"],processNames:["UlanziDeck"],dataRoots:["Library/Application Support/Ulanzi/UlanziDeck"],profileStores:["ProfilesV2"],relaunch:"manual"});assert.deepEqual(compatibility.state.profileStores,["ProfilesV2","ProfilesV1"],"Windows compatibility must remain unchanged")});
