import test from 'node:test';
import assert from 'node:assert/strict';
import {SlideshowService,ACTION_UUID,normalizeSettings} from '../plugin/slideshow.js';
import {UlanziProtocolClient} from '../plugin/protocol-client.js';
import {EventEmitter} from 'node:events';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const media={kind:'gif',signature:'animation',dataUri:'poster',gifdata:'R0lG',frames:['one','two'],delays:[200,400],loop:0};
function serviceRuntime(extra={}){
  const packets=[],timerMap=new Map();let id=0,time=0;
  const timerApi={setInterval(fn){timerMap.set(++id,fn);return id;},clearInterval:id=>timerMap.delete(id),setTimeout(fn){timerMap.set(++id,fn);return id;},clearTimeout:id=>timerMap.delete(id)};
  const client={decodeContext:c=>{const [uuid,key,actionid]=c.split('___');return {uuid,key,actionid};},setBaseDataIcon:(context,data)=>packets.push({type:1,context,data}),setGifDataIcon:(context,data)=>packets.push({type:3,context,data}),getGlobalSettings(){},sendToPropertyInspector(){}};
  const configuration={defaults:normalizeSettings({}),fallbackSlides:[{signature:'static',dataUri:'static'}]};
  const service=new SlideshowService({client,configuration,timerApi,now:()=>time,watchFactory:()=>({on(){},close(){}}),logger(){},...extra});
  return {service,packets,timerMap,setTime:t=>time=t,context:`${ACTION_UUID}___3_2___one`};
}

test('GIF survives Inspector absence and unchanged rescan, no stale frames after information/settings/deactivation, reconnect add restarts',async()=>{
  const r=serviceRuntime();r.service.slides=[media];r.service.add({uuid:ACTION_UUID,context:r.context});r.service.inspectors.clear();assert.equal(r.packets.at(-1).type,1);
  r.setTime(1000);await r.service.tick();r.service.renderAll();assert.equal(r.packets.length,1);
  r.service.settings=normalizeSettings({showDateTime:true});r.service.showingDateTime=true;r.service.renderAll();assert.equal(r.packets.at(-1).type,1);
  r.service.showingDateTime=false;r.service.settings.gifBackend='frames';r.service.lastSignature.clear();r.service.renderAll();assert.equal(r.packets.at(-1).data,'one');
  await r.service.applySettings(normalizeSettings({showImages:false,showDateTime:true}),true);const count=r.packets.length;r.service.animation.pump();assert.equal(r.packets.length,count);assert.equal(r.service.animation.timer,null);
  r.service.close();assert.equal(r.timerMap.size,0);assert.equal(r.service.contexts.size,0);assert.equal(r.service.settingsRequested,false);
  r.service.settings=normalizeSettings({});r.service.slides=[media];r.service.add({uuid:ACTION_UUID,context:r.context});assert.equal(r.packets.at(-1).type,1);r.service.close();
});

test('late preparation is rejected after deactivation; rescans and async gallery ticks never overlap',async()=>{
  let release,loads=0;const pending=new Promise(resolve=>release=resolve);
  const fsApi={lstatSync:async()=>({isDirectory:()=>true,isFile:()=>true,isSymbolicLink:()=>false,size:10,mtimeMs:1}),readdirSync:async()=>[{name:'test.gif',isFile:()=>true,isSymbolicLink:()=>false}]};
  const r=serviceRuntime({fsApi,imageLoader:async()=>{loads++;await pending;return media;}});r.service.settings.folderPath='C:/synthetic';r.service.add({uuid:ACTION_UUID,context:r.context});
  const scan=r.service.rescan(true);await new Promise(resolve=>setImmediate(resolve));const another=r.service.rescan(false);assert.equal(loads,1);
  r.service.setActive({uuid:ACTION_UUID,context:r.context,active:false});release();await Promise.all([scan,another]);assert.equal(r.service.slides[0].signature,'static');assert.equal(r.service.animation.contexts.size,0);assert.equal(r.timerMap.size,0);assert.equal(r.service.slideCache.size,0);
  r.service.close();
});

test('late system probe results are rejected across settings/lifecycle changes',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve);
  const r=serviceRuntime({systemMonitor:{sample:()=>pending}});r.service.settings=normalizeSettings({showSystemStats:true});r.service.add({uuid:ACTION_UUID,context:r.context});
  const probe=r.service.refreshSystem(true);await r.service.applySettings(normalizeSettings({showImages:false,showDateTime:true}),true);const count=r.packets.length;
  release({cpu:50,gpu:20,ram:30,ramUsed:100,ramTotal:300});assert.equal(await probe,false);assert.equal(r.service.systemSlide,null);assert.equal(r.packets.length,count);r.service.close();
});

test('unchanged global settings response does not stop or replay an activated PNG-frame GIF',async()=>{
  const r=serviceRuntime();r.service.settings.folderPath='C:/synthetic';r.service.slides=[media];r.service.add({uuid:ACTION_UUID,context:r.context});
  const count=r.packets.length;await r.service.applySettings(normalizeSettings({...r.service.settings}),true);
  assert.equal(r.packets.length,count);assert.equal(r.service.animation.contexts.get(r.context).media,media);r.service.close();
});

test('transport reconnect is bounded, registers again, resets outer defaults and shutdown cancels retry',()=>{
  const sockets=[],timers=new Map();let id=0;
  class Socket extends EventEmitter {static OPEN=1;constructor(){super();sockets.push(this);}send(x){this.last=JSON.parse(x);}close(){this.emit('close');}}
  const client=new UlanziProtocolClient({WebSocketImpl:Socket,timerApi:{setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)}});
  client.connect('com.arkamax.ulanzi.imageslide');sockets[0].emit('open');assert.equal(sockets[0].last.cmd,'connected');client.key='3_2';
  sockets[0].emit('close');sockets[0].emit('close');assert.equal(timers.size,1);const fn=[...timers.values()][0];timers.clear();fn();assert.equal(sockets.length,2);assert.equal(client.key,'');
  sockets[1].emit('close');assert.equal(timers.size,1);client.close();assert.equal(timers.size,0);
});

test('Inspector keeps the original settings whitelist and does not control animation timers',async()=>{
  const source=await readFile(new URL('../property-inspector/inspector.js',import.meta.url),'utf8'),nodes=new Map(),sent=[];
  function node(id){if(!nodes.has(id))nodes.set(id,{value:'',checked:false,handlers:{},addEventListener(event,fn){this.handlers[event]=fn;}});return nodes.get(id);}
  class Socket {static OPEN=1;readyState=1;handlers={};constructor(){Socket.instance=this;}addEventListener(event,fn){this.handlers[event]=fn;}send(x){sent.push(JSON.parse(x));}}
  vm.runInNewContext(source,{URLSearchParams,location:{search:'?key=3_2&actionid=one'},document:{getElementById:node},WebSocket:Socket});
  Socket.instance.handlers.message({data:JSON.stringify({cmd:'sendToPropertyInspector',uuid:ACTION_UUID,key:'3_2',actionid:'one',payload:{profile:{label:'Test',independent:true},settings:{gifBackend:'frames',sort:'date',showDateTime:true,dateTimeEverySlides:7,showSystemStats:true}}})});
  assert.equal(nodes.has('gif-backend'),false);
  for(const cmd of ['sendToPropertyInspector','didReceiveGlobalSettings','add'])Socket.instance.handlers.message({data:JSON.stringify({cmd,uuid:ACTION_UUID,key:'3_2',actionid:'other-profile',payload:{settings:{folderPath:'C:/foreign',gifBackend:'native'}}})});
  assert.equal(node('folder').value,'');assert.equal(nodes.has('gif-backend'),false);
  node('interval').value='15';node('interval').handlers.change();assert.equal(sent.at(-1).actionid,'one');
  const settings=sent.at(-1).payload.settings;assert.equal(Object.hasOwn(settings,'gifBackend'),false);assert.equal(settings.sort,'date');assert.equal(settings.dateTimeEverySlides,7);assert.equal(settings.showSystemStats,true);assert.equal(settings.intervalSeconds,15);
  assert.equal(normalizeSettings({dateTimeOnly:true}).showImages,false);assert.equal(Object.hasOwn(normalizeSettings({}), 'gifBackend'),false);
});
