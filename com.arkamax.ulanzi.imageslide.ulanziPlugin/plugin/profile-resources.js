import {watch} from 'node:fs';
import {createHash} from 'node:crypto';
import {WEATHER_REFRESH_MS} from './weather.js';
import {SYSTEM_REFRESH_MS,SystemMonitor} from './system-monitor.js';

export class SharedGalleryClock {
  constructor(timers=globalThis){this.timers=timers;this.callbacks=new Map();this.next=0;this.interval=null;}
  setInterval(fn,ms){if(ms!==1000)throw new Error('Unsupported gallery cadence');const id=++this.next;this.callbacks.set(id,fn);if(!this.interval)this.interval=this.timers.setInterval(()=>{for(const callback of this.callbacks.values())void Promise.resolve(callback()).catch(()=>{});},1000);return id;}
  clearInterval(id){this.callbacks.delete(id);if(!this.callbacks.size&&this.interval){this.timers.clearInterval(this.interval);this.interval=null;}}
  setTimeout(fn,ms){return this.timers.setTimeout(fn,ms);}
  clearTimeout(id){this.timers.clearTimeout(id);}
  close(){if(this.interval)this.timers.clearInterval(this.interval);this.interval=null;this.callbacks.clear();}
}
export class SharedGalleryBudget {
  constructor(limit=32*1024*1024){this.limit=limit;this.leases=new Map();}
  select(key,slides){
    const used=new Map();for(const [owner,media] of this.leases)if(owner!==key)for(const slide of media)used.set(slide.signature,slide);
    let bytes=[...used.values()].reduce((sum,slide)=>sum+(slide.retainedBytes??slide.preparedBytes??Buffer.byteLength(slide.dataUri)),0);const accepted=[],rejected=[];
    for(const slide of slides){const size=slide.retainedBytes??slide.preparedBytes??Buffer.byteLength(slide.dataUri);if(!used.has(slide.signature)&&bytes+size>this.limit){rejected.push(slide);continue;}const shared=used.get(slide.signature);const value=shared?{...slide,dataUri:shared.dataUri}:slide;if(!shared){used.set(slide.signature,value);bytes+=size;}accepted.push(value);}
    this.leases.set(key,accepted);return {accepted,rejected};
  }
  release(key){this.leases.delete(key);}
}
export class SharedFolderWatchers {
  constructor(factory=watch){this.factory=factory;this.folders=new Map();}
  watch(path,options,callback){
    let item=this.folders.get(path);if(!item){item={callbacks:new Set(),errors:new Set()};item.watcher=this.factory(path,options,()=>{for(const cb of item.callbacks)cb();});item.watcher.on?.('error',()=>{for(const cb of item.errors)cb();});this.folders.set(path,item);}
    item.callbacks.add(callback);let errorHandler=null,closed=false;
    return {on(event,fn){if(event==='error'){errorHandler=fn;item.errors.add(fn);}},close:()=>{if(closed)return;closed=true;item.callbacks.delete(callback);if(errorHandler)item.errors.delete(errorHandler);if(!item.callbacks.size){item.watcher.close();this.folders.delete(path);}}};
  }
  close(){for(const item of this.folders.values())item.watcher.close();this.folders.clear();}
}
export class SharedWeatherRequests {
  constructor({fetchImpl=globalThis.fetch,now=Date.now}={}){this.fetch=fetchImpl;this.now=now;this.cache=new Map();this.pending=new Map();}
  async request(url,options){
    const key=createHash('sha256').update(String(url)).digest('hex'),cached=this.cache.get(key);if(cached&&cached.until>this.now())return this.response(cached);
    if(this.pending.has(key))return this.response(await this.pending.get(key));
    const promise=(async()=>{const response=await this.fetch(url,options),body=await response.text();if(body.length>512*1024)throw new Error('Weather response is too large.');const result={ok:response.ok,status:response.status,body,until:this.now()+WEATHER_REFRESH_MS};if(response.ok){while(this.cache.size>=4)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,result);}return result;})();this.pending.set(key,promise);
    try{return this.response(await promise);}finally{this.pending.delete(key);}
  }
  response(value){return {ok:value.ok,status:value.status,text:async()=>value.body};}
}
export class SharedSystemSamples {
  constructor({monitor=new SystemMonitor(),now=Date.now}={}){this.monitor=monitor;this.now=now;this.value=null;this.until=0;this.pending=null;}
  async sample(){if(this.value&&this.now()<this.until)return this.value;if(this.pending)return this.pending;this.pending=this.monitor.sample().then(value=>{this.value=value;this.until=this.now()+SYSTEM_REFRESH_MS;return value;});try{return await this.pending;}finally{this.pending=null;}}
}
