import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ACTION_UUID, PLUGIN_UUID, SlideshowService, eligibleName, enumerateFolder, loadConfiguration, normalizeSettings } from "../plugin/slideshow.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const svg=(color="#123456")=>`<svg xmlns="http://www.w3.org/2000/svg" width="458" height="196"><rect width="458" height="196" fill="${color}"/></svg>`;

function fakeRuntime() {
  const handlers={},sent=[],pi=[],saved=[];
  const client={
    onAdd(f){handlers.add=f;return this},onSetActive(f){handlers.setActive=f;return this},onSetactive(f){handlers.setactive=f;return this},onClear(f){handlers.clear=f;return this},onClose(f){handlers.close=f;return this},onError(f){handlers.error=f;return this},onSendToPlugin(f){handlers.send=f;return this},onDidReceiveGlobalSettings(f){handlers.global=f;return this},
    decodeContext(c){const [uuid,key,actionid]=c.split("___");return{uuid,key,actionid}},setBaseDataIcon(context,data){sent.push({context,data})},getGlobalSettings(context){this.requested=context},setGlobalSettings(settings,context){saved.push({settings,context})},sendToPropertyInspector(payload,context){pi.push({payload,context})}
  };
  const timers={intervals:0,cleared:0,timeouts:[],fn:null,setInterval(fn,ms){this.intervals++;this.fn=fn;this.ms=ms;return 10},clearInterval(){this.cleared++},setTimeout(fn){this.timeouts.push(fn);return this.timeouts.length},clearTimeout(){}};
  return {handlers,sent,pi,saved,client,timers};
}

test("manifest and Property Inspector use the Studio 3.2.11 contract",()=>{
  const manifest=JSON.parse(readFileSync(join(root,"manifest.json"),"utf8"));
assert.equal(PLUGIN_UUID.split(".").length,4);assert.equal(manifest.UUID,PLUGIN_UUID);assert.equal(manifest.Version,"0.2.0");assert.equal(manifest.Actions[0].UUID,ACTION_UUID);
  assert.equal(manifest.Actions[0].PropertyInspectorPath,"property-inspector/inspector.html");assert.equal(manifest.Software.MinVersion,"3.0.11");
  const pi=readFileSync(join(root,"property-inspector","inspector.js"),"utf8");
  assert.match(pi,/selectFolderDialog\(\).*send\("selectdialog",\{type:"folder"\}\)/s);assert.match(pi,/onSelectdialog\(message\).*message\.path/s);
  for(const command of ["sendToPlugin","getGlobalSettings","didReceiveGlobalSettings","sendToPropertyInspector"])assert.ok(pi.includes(command));
  assert.equal(readFileSync(join(root,"plugin","slideshow.js"),"utf8").includes("setImage"),false);
});

test("settings validation enforces a safe global configuration",()=>{
  assert.deepEqual(normalizeSettings({folderPath:"C:\\Images",intervalSeconds:5,loop:false,sort:"date"}),{folderPath:"C:\\Images",intervalSeconds:5,loop:false,sort:"date"});
  assert.throws(()=>normalizeSettings({intervalSeconds:4}),/between 5/);assert.throws(()=>normalizeSettings({loop:"yes"}),/true or false/);assert.throws(()=>normalizeSettings({sort:"random"}),/name or date/);
  const config=loadConfiguration(root);assert.equal(config.fallbackSlides.length,2);assert.ok(config.fallbackSlides.every(s=>s.signature&&s.dataUri.startsWith("data:image/svg+xml;base64,")));
});

test("folder enumeration filters, validates, hashes, and orders deterministically",()=>{
  const dir=mkdtempSync(join(tmpdir(),"imageslide-folder-"));
  try{
    writeFileSync(join(dir,"B.svg"),svg("#222222"));writeFileSync(join(dir,"a.svg"),svg("#111111"));writeFileSync(join(dir,"duplicate.svg"),svg("#111111"));
    writeFileSync(join(dir,".hidden.svg"),svg());writeFileSync(join(dir,"draft.tmp"),svg());writeFileSync(join(dir,"bad.svg"),'<svg width="1" height="1"/>');mkdirSync(join(dir,"nested"));writeFileSync(join(dir,"nested","nested.svg"),svg());
    const name=enumerateFolder(dir,"name");assert.deepEqual(name.slides.map(s=>s.name),["a.svg","B.svg"]);assert.equal(name.rejected,1);
    const old=new Date(Date.now()-20000),recent=new Date();utimesSync(join(dir,"a.svg"),old,old);utimesSync(join(dir,"B.svg"),recent,recent);
    const date=enumerateFolder(dir,"date");assert.deepEqual(date.slides.map(s=>s.name),["B.svg","duplicate.svg"]);
    assert.equal(eligibleName(".x.png"),false);assert.equal(eligibleName("x.PNG"),true);assert.equal(eligibleName("x.crdownload"),false);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test("one active-only scheduler handles slideshow and periodic rescan",()=>{
  const r=fakeRuntime(),config=loadConfiguration(root);let now=1000;let watcherClosed=0;
  const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,now:()=>now,watchFactory(){return{on(){},close(){watcherClosed++}}},logger(){}});service.bind();
  const c1=`${ACTION_UUID}___3_2___a1`,c2=`${ACTION_UUID}___3_2___a2`;r.handlers.add({uuid:ACTION_UUID,context:c1});r.handlers.add({uuid:ACTION_UUID,context:c2});
  assert.equal(r.timers.intervals,1);assert.equal(r.timers.ms,1000);assert.equal(r.sent.length,2);assert.equal(r.client.requested,c1);
  now=11000;r.timers.fn();assert.equal(r.sent.length,4);
  r.handlers.setActive({uuid:ACTION_UUID,context:c1,active:false});assert.equal(r.timers.cleared,0);r.handlers.clear([c2]);assert.equal(r.timers.cleared,1);assert.equal(service.timer,null);assert.ok(watcherClosed>=0);
});

test("PI settings persist globally and empty/error folders use bundled fallback",()=>{
  const r=fakeRuntime(),config=loadConfiguration(root),dir=mkdtempSync(join(tmpdir(),"imageslide-empty-"));
  try{
    const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,watchFactory(){throw new Error("watch unavailable")},logger(){}});service.bind();const context=`${ACTION_UUID}___3_2___x`;r.handlers.add({uuid:ACTION_UUID,context});
    r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{folderPath:dir,intervalSeconds:6,loop:false,sort:"name"}}});
    assert.equal(r.saved.length,1);assert.equal(service.slides,config.fallbackSlides);assert.match(service.status.message,/empty/);assert.equal(r.saved[0].settings.intervalSeconds,6);
    r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{folderPath:join(dir,"missing"),intervalSeconds:6,loop:false,sort:"name"}}});assert.equal(service.status.level,"error");assert.match(service.status.message,/unavailable/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test("debounced watcher tolerates atomic rename and suppresses identical frames",()=>{
  const r=fakeRuntime(),config=loadConfiguration(root),dir=mkdtempSync(join(tmpdir(),"imageslide-atomic-"));let watchCallback;
  try{
    writeFileSync(join(dir,"one.svg"),svg("#101010"));
    const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,watchFactory(_p,_o,cb){watchCallback=cb;return{on(){},close(){}}},logger(){}});service.bind();const context=`${ACTION_UUID}___3_2___x`;r.handlers.add({uuid:ACTION_UUID,context});
    r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{folderPath:dir,intervalSeconds:5,loop:true,sort:"name"}}});const afterInitial=r.sent.length;
    service.render(context,false);assert.equal(r.sent.length,afterInitial);
    writeFileSync(join(dir,".incoming.tmp"),svg("#202020"));renameSync(join(dir,".incoming.tmp"),join(dir,"two.svg"));watchCallback();watchCallback();assert.ok(r.timers.timeouts.length>=1);r.timers.timeouts.at(-1)();
    assert.equal(service.slides.length,2);assert.deepEqual(service.slides.map(s=>s.name),["one.svg","two.svg"]);
    assert.equal(r.sent.length,afterInitial);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test("non-3_2 contexts are ignored and close clears runtime",()=>{
  const r=fakeRuntime(),service=new SlideshowService({client:r.client,configuration:loadConfiguration(root),timerApi:r.timers,logger(){}});service.bind();r.handlers.add({uuid:ACTION_UUID,context:`${ACTION_UUID}___0_0___x`});assert.equal(r.sent.length,0);r.handlers.close();assert.equal(service.activeContexts.size,0);
});
