import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { ACTION_UUID, PLUGIN_UUID, SlideshowService, createDateTimeSlide, eligibleName, enumerateFolder, loadConfiguration, normalizeSettings } from "../plugin/slideshow.js";
import { loadSlide, pngDimensions } from "../plugin/images.js";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const svg=(color="#123456",width=458,height=196)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${color}"/></svg>`;
const weatherResponse=(location="Madrid")=>({location:{name:location,country:"Spain"},current:{last_updated_epoch:1788858000,temp_c:22,temp_f:71.6,feelslike_c:22.5,feelslike_f:72.5,humidity:48,wind_kph:14,wind_mph:8.7,is_day:1,condition:{text:"Partly cloudy",code:1003}},forecast:{forecastday:[0,1,2].map((offset)=>({date:`2026-09-${String(8+offset).padStart(2,"0")}`,day:{mintemp_c:15+offset,maxtemp_c:24+offset,mintemp_f:59+offset,maxtemp_f:75+offset,daily_chance_of_rain:20+offset,condition:{code:offset===1?1183:1003}}}))}});

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
assert.equal(PLUGIN_UUID.split(".").length,4);assert.equal(manifest.UUID,PLUGIN_UUID);assert.equal(manifest.Version,"0.6.0");assert.equal(manifest.Actions[0].UUID,ACTION_UUID);assert.equal(manifest.Author,"Santiago P\u00e9rez");
  assert.match(manifest.Description,/automatically resizes/i);assert.match(manifest.Overview,/458 x 196/);assert.match(manifest.Overview,/without changing the originals/i);
  const icon=readFileSync(join(root,"resources","icon.svg"),"utf8");assert.match(icon,/linearGradient id="background"/);assert.equal((icon.match(/stroke="#dcecff"/g)||[]).length,2);assert.match(icon,/id="mountain"/);
  assert.equal(manifest.Actions[0].PropertyInspectorPath,"property-inspector/inspector.html");assert.equal(manifest.Software.MinVersion,"3.0.11");
  const pi=readFileSync(join(root,"property-inspector","inspector.js"),"utf8");
  assert.match(pi,/selectFolderDialog\(\).*send\("selectdialog",\{type:"folder"\}\)/s);assert.match(pi,/onSelectdialog\(message\).*message\.path/s);
  for(const control of ["date-time-only","show-date-time","date-time-every","date-time-duration","date-format","weather-only","show-weather","weather-api-key","weather-location","weather-units","weather-every","weather-duration"])assert.ok(pi.includes(control));
  for(const command of ["sendToPlugin","getGlobalSettings","didReceiveGlobalSettings","sendToPropertyInspector"])assert.ok(pi.includes(command));
  assert.equal(readFileSync(join(root,"plugin","slideshow.js"),"utf8").includes("setImage"),false);
});

test("settings validation enforces a safe global configuration",async()=>{
  assert.deepEqual(normalizeSettings({folderPath:"C:\\Images",intervalSeconds:5,loop:false,sort:"date"}),{folderPath:"C:\\Images",intervalSeconds:5,loop:false,sort:"date",showDateTime:false,dateTimeOnly:false,dateTimeEverySlides:5,dateTimeDurationSeconds:5,dateFormat:"system",showWeather:false,weatherOnly:false,weatherApiKey:"",weatherLocation:"",weatherUnits:"c",weatherEverySlides:5,weatherDurationSeconds:8});
  assert.deepEqual(normalizeSettings({showDateTime:true,dateTimeEverySlides:"3",dateTimeDurationSeconds:"8"}).dateTimeEverySlides,3);
  assert.throws(()=>normalizeSettings({intervalSeconds:4}),/between 5/);assert.throws(()=>normalizeSettings({loop:"yes"}),/true or false/);assert.throws(()=>normalizeSettings({sort:"random"}),/name or date/);assert.throws(()=>normalizeSettings({showDateTime:"yes"}),/true or false/);assert.throws(()=>normalizeSettings({dateTimeOnly:"yes"}),/true or false/);assert.throws(()=>normalizeSettings({dateTimeEverySlides:0}),/frequency/);assert.throws(()=>normalizeSettings({dateTimeDurationSeconds:1.5}),/duration/);assert.throws(()=>normalizeSettings({dateFormat:"ymd"}),/Date format/);assert.throws(()=>normalizeSettings({showWeather:"yes"}),/true or false/);assert.throws(()=>normalizeSettings({weatherUnits:"kelvin"}),/units/);assert.throws(()=>normalizeSettings({weatherEverySlides:0}),/frequency/);assert.throws(()=>normalizeSettings({dateTimeOnly:true,weatherOnly:true}),/cannot both/);
  const config=await loadConfiguration(root);assert.equal(config.fallbackSlides.length,2);assert.ok(config.fallbackSlides.every(s=>s.signature&&s.dataUri.startsWith("data:image/svg+xml;base64,")));
});

test("date and time slide follows system locale or explicit date order and includes weekday",()=>{
  const timestamp=new Date(2026,8,7,14,5,9).getTime(),decode=(slide)=>Buffer.from(slide.dataUri.split(",",2)[1],"base64").toString("utf8");
  const systemUs=decode(createDateTimeSlide(timestamp,"system","en-US")),systemGb=decode(createDateTimeSlide(timestamp,"system","en-GB"));
  const dmy=decode(createDateTimeSlide(timestamp,"dmy","en-GB")),mdy=decode(createDateTimeSlide(timestamp,"mdy","en-US")),next=createDateTimeSlide(timestamp+1000,"system","en-US");
  assert.match(systemUs,/width="458" height="196"/);assert.equal((systemUs.match(/font-weight="700"/g)||[]).length,2);assert.match(systemUs,/font-size="66"/);assert.match(systemUs,/font-size="29"/);assert.match(systemUs,/Monday, 09\/07\/2026/);assert.match(systemUs,/02:05:09.*PM/);
  assert.match(systemGb,/Monday, 07\/09\/2026/);assert.match(systemGb,/14:05:09/);assert.match(dmy,/07\/09\/2026/);assert.match(mdy,/09\/07\/2026/);assert.notEqual(createDateTimeSlide(timestamp,"system","en-US").signature,next.signature);
});

test("folder enumeration resizes with centered cover, filters, hashes, and orders deterministically",async()=>{
  const dir=mkdtempSync(join(tmpdir(),"imageslide-folder-"));
  try{
    writeFileSync(join(dir,"B.svg"),svg("#222222"));writeFileSync(join(dir,"a.svg"),svg("#111111"));writeFileSync(join(dir,"duplicate.svg"),svg("#111111"));writeFileSync(join(dir,"wide.svg"),svg("#333333",916,196));
    writeFileSync(join(dir,".hidden.svg"),svg());writeFileSync(join(dir,"draft.tmp"),svg());writeFileSync(join(dir,"bad.svg"),'<not-svg/>');mkdirSync(join(dir,"nested"));writeFileSync(join(dir,"nested","nested.svg"),svg());
    const name=await enumerateFolder(dir,"name");assert.deepEqual(name.slides.map(s=>s.name),["a.svg","B.svg","wide.svg"]);assert.equal(name.rejected,1);assert.equal(name.resized,1);
    const resized=await loadSlide(join(dir,"wide.svg")),rendered=Buffer.from(resized.dataUri.split(",",2)[1],"base64");assert.equal(resized.resized,true);assert.deepEqual(pngDimensions(rendered),{width:458,height:196});
    writeFileSync(join(dir,"centered.svg"),'<svg xmlns="http://www.w3.org/2000/svg" width="916" height="196"><rect width="229" height="196" fill="#ff0000"/><rect x="229" width="458" height="196" fill="#00ff00"/><rect x="687" width="229" height="196" fill="#0000ff"/></svg>');const centered=await loadSlide(join(dir,"centered.svg")),raw=await sharp(Buffer.from(centered.dataUri.split(",",2)[1],"base64")).raw().toBuffer({resolveWithObject:true}),pixels=raw.data,channels=raw.info.channels;assert.deepEqual([...pixels.subarray(0,3)],[0,255,0]);assert.deepEqual([...pixels.subarray(pixels.length-channels,pixels.length-channels+3)],[0,255,0]);
    writeFileSync(join(dir,"huge.svg"),svg("#ffffff",10000,5000));await assert.rejects(loadSlide(join(dir,"huge.svg")),/unsafe/);
    const cache=new Map();let loads=0;const loader=async(file)=>{loads++;return loadSlide(file)};await enumerateFolder(dir,"name",undefined,cache,loader);await enumerateFolder(dir,"name",undefined,cache,loader);assert.equal(loads,7);
    const old=new Date(Date.now()-20000),oldest=new Date(Date.now()-40000),centeredOldest=new Date(Date.now()-60000),recent=new Date();utimesSync(join(dir,"a.svg"),old,old);utimesSync(join(dir,"wide.svg"),oldest,oldest);utimesSync(join(dir,"centered.svg"),centeredOldest,centeredOldest);utimesSync(join(dir,"B.svg"),recent,recent);utimesSync(join(dir,"duplicate.svg"),recent,recent);
    const date=await enumerateFolder(dir,"date");assert.deepEqual(date.slides.map(s=>s.name),["B.svg","duplicate.svg","wide.svg","centered.svg"]);
    assert.equal(eligibleName(".x.png"),false);assert.equal(eligibleName("x.PNG"),true);assert.equal(eligibleName("x.crdownload"),false);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test("one active-only scheduler handles slideshow and periodic rescan",async()=>{
  const r=fakeRuntime(),config=await loadConfiguration(root);let now=1000;let watcherClosed=0;
  const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,now:()=>now,watchFactory(){return{on(){},close(){watcherClosed++}}},logger(){}});service.bind();
  const c1=`${ACTION_UUID}___3_2___a1`,c2=`${ACTION_UUID}___3_2___a2`;r.handlers.add({uuid:ACTION_UUID,context:c1});r.handlers.add({uuid:ACTION_UUID,context:c2});
  assert.equal(r.timers.intervals,1);assert.equal(r.timers.ms,1000);assert.equal(r.sent.length,2);assert.equal(r.client.requested,c1);
  now=11000;await r.timers.fn();assert.equal(r.sent.length,4);
  r.handlers.setActive({uuid:ACTION_UUID,context:c1,active:false});assert.equal(r.timers.cleared,0);r.handlers.clear([c2]);assert.equal(r.timers.cleared,1);assert.equal(service.timer,null);assert.ok(watcherClosed>=0);
});

test("scheduler inserts a live date and time screen after the configured image count",async()=>{
  const r=fakeRuntime(),config=await loadConfiguration(root);let now=1000;
  const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,now:()=>now,logger(){}});service.bind();const context=`${ACTION_UUID}___3_2___clock`;r.handlers.add({uuid:ACTION_UUID,context});
  await r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{folderPath:"",intervalSeconds:5,loop:true,sort:"name",showDateTime:true,dateTimeEverySlides:2,dateTimeDurationSeconds:3}}});
  now=6000;await r.timers.fn();assert.equal(service.index,1);assert.equal(service.showingDateTime,false);
  now=11000;await r.timers.fn();assert.equal(service.showingDateTime,true);const firstClock=r.sent.at(-1).data;
  now=12000;await r.timers.fn();assert.equal(service.showingDateTime,true);assert.notEqual(r.sent.at(-1).data,firstClock);
  now=14000;await r.timers.fn();assert.equal(service.showingDateTime,false);assert.equal(service.index,0);assert.equal(r.sent.at(-1).data,config.fallbackSlides[0].dataUri);
});

test("date and time only mode continuously renders the clock without scanning or advancing images",async()=>{
  const r=fakeRuntime(),config=await loadConfiguration(root);let now=1000,watchCalls=0,fsCalls=0;
  const fsApi={lstatSync(){fsCalls++;throw new Error("images disabled")},readdirSync(){fsCalls++;throw new Error("images disabled")}};
  const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,now:()=>now,fsApi,watchFactory(){watchCalls++;throw new Error("images disabled")},logger(){}});service.bind();const context=`${ACTION_UUID}___3_2___clock-only`;r.handlers.add({uuid:ACTION_UUID,context});
  await r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{folderPath:"C:\\Images",intervalSeconds:5,loop:true,sort:"name",showDateTime:false,dateTimeOnly:true,dateTimeEverySlides:2,dateTimeDurationSeconds:3,dateFormat:"dmy"}}});
  const firstClock=r.sent.at(-1).data;assert.match(Buffer.from(firstClock.split(",",2)[1],"base64").toString("utf8"),/date-time|font-size="66"/);assert.equal(fsCalls,0);assert.equal(watchCalls,0);
  now=2000;await r.timers.fn();assert.notEqual(r.sent.at(-1).data,firstClock);assert.equal(service.index,0);assert.equal(fsCalls,0);assert.equal(watchCalls,0);
});

test("scheduler inserts weather, refreshes safely, and keeps stale forecast on failure",async()=>{
  const r=fakeRuntime(),config=await loadConfiguration(root),logs=[];let now=1000,calls=0,fail=false;
  const fetchImpl=async()=>{calls++;if(fail)throw new Error("network secret");return{ok:true,text:async()=>JSON.stringify(weatherResponse())}};
  const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,now:()=>now,fetchImpl,logger:(...parts)=>logs.push(parts.join(" "))});service.bind();const context=`${ACTION_UUID}___3_2___weather`;r.handlers.add({uuid:ACTION_UUID,context});
  await r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{...service.settings,intervalSeconds:5,showWeather:true,weatherApiKey:"top-secret-key",weatherLocation:"Madrid",weatherEverySlides:2,weatherDurationSeconds:3}}});assert.equal(calls,1);assert.equal(service.weatherStatus.level,"ready");const metricSlide=service.weatherSlide.dataUri;
  now=6000;await r.timers.fn();assert.equal(service.index,1);now=11000;await r.timers.fn();assert.equal(service.showingWeather,true);assert.match(r.sent.at(-1).data,/^data:image\/png;base64,/);assert.equal(service.weatherData.location,"Madrid");
  now=14000;await r.timers.fn();assert.equal(service.showingWeather,false);assert.equal(service.index,0);
  fail=true;await service.refreshWeather(true);assert.equal(calls,2);assert.equal(service.weatherStatus.level,"warning");assert.equal(service.weatherData.location,"Madrid");
  await service.applySettings({...service.settings,weatherUnits:"f"},false);assert.equal(calls,2);assert.notEqual(service.weatherSlide.dataUri,metricSlide);
  await service.applySettings({...service.settings,weatherLocation:"Barcelona"},false);assert.equal(calls,3);assert.equal(service.weatherData,null);assert.equal(service.weatherStatus.level,"error");assert.equal(logs.some(line=>line.includes("top-secret-key")||line.includes("network secret")),false);
});

test("weather-only mode avoids image access and continuously shows the forecast",async()=>{
  const r=fakeRuntime(),config=await loadConfiguration(root);let now=1000,fsCalls=0,watchCalls=0;
  const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,now:()=>now,fsApi:{lstatSync(){fsCalls++;throw Error()},readdirSync(){fsCalls++;throw Error()}},watchFactory(){watchCalls++;throw Error()},fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify(weatherResponse())}),logger(){}});service.bind();const context=`${ACTION_UUID}___3_2___weather-only`;r.handlers.add({uuid:ACTION_UUID,context});
  await r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{...service.settings,folderPath:"C:\\Images",weatherOnly:true,weatherApiKey:"key",weatherLocation:"Madrid"}}});const frame=r.sent.at(-1).data;assert.match(frame,/^data:image\/png;base64,/);assert.equal(service.weatherData.location,"Madrid");assert.equal(fsCalls,0);assert.equal(watchCalls,0);
  now=2000;await r.timers.fn();assert.equal(service.index,0);assert.equal(fsCalls,0);assert.equal(watchCalls,0);
});

test("changing weather location discards an in-flight response for the previous city",async()=>{
  const r=fakeRuntime(),config=await loadConfiguration(root),requests=[];
  const fetchImpl=(url)=>new Promise(resolve=>requests.push({url,resolve})),service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,fetchImpl,logger(){}});
  const madrid=service.applySettings({...service.settings,showWeather:true,weatherApiKey:"key",weatherLocation:"Madrid"},false);await Promise.resolve();assert.equal(requests.length,1);
  const barcelona=service.applySettings({...service.settings,weatherLocation:"Barcelona"},false);requests[0].resolve({ok:true,text:async()=>JSON.stringify(weatherResponse("Madrid"))});await madrid;await Promise.resolve();assert.equal(requests.length,2);assert.equal(requests[1].url.searchParams.get("q"),"Barcelona");
  requests[1].resolve({ok:true,text:async()=>JSON.stringify(weatherResponse("Barcelona"))});await barcelona;assert.equal(service.weatherData.location,"Barcelona");
});

test("PI settings persist globally and empty/error folders use bundled fallback",async()=>{
  const r=fakeRuntime(),config=await loadConfiguration(root),dir=mkdtempSync(join(tmpdir(),"imageslide-empty-"));
  try{
    const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,watchFactory(){throw new Error("watch unavailable")},logger(){}});service.bind();const context=`${ACTION_UUID}___3_2___x`;r.handlers.add({uuid:ACTION_UUID,context});
    await r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{folderPath:dir,intervalSeconds:6,loop:false,sort:"name"}}});
    assert.equal(r.saved.length,1);assert.equal(service.slides,config.fallbackSlides);assert.match(service.status.message,/empty/);assert.equal(r.saved[0].settings.intervalSeconds,6);
    await r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{folderPath:join(dir,"missing"),intervalSeconds:6,loop:false,sort:"name"}}});assert.equal(service.status.level,"error");assert.match(service.status.message,/unavailable/);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test("debounced watcher tolerates atomic rename and suppresses identical frames",async()=>{
  const r=fakeRuntime(),config=await loadConfiguration(root),dir=mkdtempSync(join(tmpdir(),"imageslide-atomic-"));let watchCallback;
  try{
    writeFileSync(join(dir,"one.svg"),svg("#101010"));
    const service=new SlideshowService({client:r.client,configuration:config,timerApi:r.timers,watchFactory(_p,_o,cb){watchCallback=cb;return{on(){},close(){}}},logger(){}});service.bind();const context=`${ACTION_UUID}___3_2___x`;r.handlers.add({uuid:ACTION_UUID,context});
    await r.handlers.send({uuid:ACTION_UUID,context,payload:{type:"updateSettings",settings:{folderPath:dir,intervalSeconds:5,loop:true,sort:"name"}}});const afterInitial=r.sent.length;
    service.render(context,false);assert.equal(r.sent.length,afterInitial);
    writeFileSync(join(dir,".incoming.tmp"),svg("#202020"));renameSync(join(dir,".incoming.tmp"),join(dir,"two.svg"));watchCallback();watchCallback();assert.ok(r.timers.timeouts.length>=1);await r.timers.timeouts.at(-1)();
    assert.equal(service.slides.length,2);assert.deepEqual(service.slides.map(s=>s.name),["one.svg","two.svg"]);
    assert.equal(r.sent.length,afterInitial);
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test("non-3_2 contexts are ignored and close clears runtime",async()=>{
  const r=fakeRuntime(),service=new SlideshowService({client:r.client,configuration:await loadConfiguration(root),timerApi:r.timers,logger(){}});service.bind();r.handlers.add({uuid:ACTION_UUID,context:`${ACTION_UUID}___0_0___x`});assert.equal(r.sent.length,0);r.handlers.close();assert.equal(service.activeContexts.size,0);
});
