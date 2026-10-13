import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,readdir,readFile,writeFile,open,rename,rm,unlink} from 'node:fs/promises';
import {join,resolve,relative,dirname} from 'node:path';
import {homedir,tmpdir} from 'node:os';

export const CACHE_POLICY=Object.freeze({diskBytes:256*1024*1024,binaryBytes:8*1024*1024,uriBytes:2*1024*1024,metadataBytes:4*1024*1024,entries:512,reads:4});
const SCHEMA='imageslide-png-pages/v2-sharp0355-fps10',HASH=/^[a-f0-9]{64}$/;
const digest=value=>createHash('sha256').update(value).digest('hex');
export class ByteLRU {
  constructor(limit){this.limit=limit;this.bytes=0;this.values=new Map();}
  get(key){const item=this.values.get(key);if(!item)return;this.values.delete(key);this.values.set(key,item);return item.value;}
  set(key,value,bytes){this.delete(key);if(bytes>this.limit)return;while(this.bytes+bytes>this.limit){this.delete(this.values.keys().next().value);}this.values.set(key,{value,bytes});this.bytes+=bytes;}
  delete(key){const item=this.values.get(key);if(item){this.bytes-=item.bytes;this.values.delete(key);}}
  clear(){this.values.clear();this.bytes=0;}
}
async function directory(path){
  try{const info=await lstat(path);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe media cache directory');}
  catch(error){if(error.code!=='ENOENT')throw error;const parent=dirname(path);if(parent===path)throw error;await directory(parent);await mkdir(path,{mode:0o700});}
}
async function safeText(path,limit){
  const parent=await lstat(dirname(path)),info=await lstat(path);
  if(!parent.isDirectory()||parent.isSymbolicLink()||!info.isFile()||info.isSymbolicLink()||info.size>limit)throw new Error('Unsafe cached metadata');
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{const opened=await handle.stat();if(opened.ino!==info.ino||opened.dev!==info.dev||opened.size!==info.size)throw new Error('Cached metadata changed while opening');const text=await handle.readFile('utf8');const after=await handle.stat(),pathAfter=await lstat(path),parentAfter=await lstat(dirname(path));
    if(after.size!==info.size||after.mtimeMs!==info.mtimeMs||after.ctimeMs!==info.ctimeMs||pathAfter.isSymbolicLink()||pathAfter.ino!==info.ino||parentAfter.isSymbolicLink()||parentAfter.ino!==parent.ino)throw new Error('Cached metadata changed while reading');return {text,info};
  }finally{await handle.close();}
}
export class PreparedMediaStore {
  constructor({root=process.env.SLIDEIMG_CACHE_ROOT?join(process.env.SLIDEIMG_CACHE_ROOT,String(process.pid)):join(process.platform==='win32'?(process.env.LOCALAPPDATA||tmpdir()):process.platform==='darwin'?join(homedir(),'Library','Caches'):tmpdir(),'Ulanzi','PluginMediaCache','com.arkamax.ulanzi.imageslide','png-v2'),policy=CACHE_POLICY}={}){
    this.root=resolve(root);this.policy=policy;this.index=new Map();this.leases=new Map();this.invalid=new Set();this.epoch=0;this.binary=new ByteLRU(policy.binaryBytes);this.uris=new ByteLRU(policy.uriBytes);this.metadata=new ByteLRU(policy.metadataBytes);this.pending=new Map();this.diskBytes=0;this.initialization=null;this.ownerToken=null;this.reads=0;this.stats={diskHits:0,frameReads:0};
  }
  child(name){const path=resolve(this.root,name);if(!relative(this.root,path)||relative(this.root,path).startsWith('..')||dirname(path)!==this.root)throw new Error('Unsafe media cache path');return path;}
  async remove(name){const path=this.child(name),info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(!info)return;if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Unsafe media cache entry');await rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
  async initialize(){
    if(!this.initialization)this.initialization=(async()=>{await directory(this.root);await this.own();let recency={};try{const saved=JSON.parse((await safeText(join(this.root,'.recency.json'),128*1024)).text);if(saved.schema==='imageslide-recency/v1'&&saved.items&&typeof saved.items==='object'&&!Array.isArray(saved.items))recency=saved.items;}catch(error){if(error.code!=='ENOENT'&&error.message.includes('Unsafe'))throw error;}const entries=await readdir(this.root,{withFileTypes:true});if(entries.length>1024)throw new Error('Media cache inventory limit exceeded');
      for(const entry of entries){if(entry.isSymbolicLink())throw new Error('Linked media cache entries are not supported');if(/^\.recency-[a-f0-9-]{36}\.tmp$/.test(entry.name)&&entry.isFile()){await unlink(this.child(entry.name));continue;}if(/^\.pending-[a-f0-9-]{36}$/.test(entry.name)){await this.remove(entry.name);continue;}if(!HASH.test(entry.name)||!entry.isDirectory())continue;
        try{const path=join(this.child(entry.name),'frames.dat'),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>64*1024*1024)throw new Error('Invalid media pack');this.index.set(entry.name,{bytes:info.size+128*1024,last:Number.isSafeInteger(recency[entry.name])&&recency[entry.name]>=0&&recency[entry.name]<=Date.now()?recency[entry.name]:info.mtimeMs});this.diskBytes+=info.size+128*1024;}catch{await this.remove(entry.name);}}
      await this.evict(0);
    })();return this.initialization;
  }
  async own(){
    const file=join(this.root,'.owner.json');
    for(let attempt=0;attempt<2;attempt++){
      try{const handle=await open(file,'wx',0o600);this.ownerToken=randomUUID();try{await handle.writeFile(JSON.stringify({schema:'imageslide-cache-owner/v1',pid:process.pid,token:this.ownerToken}));await handle.sync();}finally{await handle.close();}return;}
      catch(error){if(error.code!=='EEXIST')throw error;const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>1024)throw new Error('Unsafe cache ownership file');const owner=JSON.parse((await safeText(file,1024)).text);
        if(owner.schema!=='imageslide-cache-owner/v1'||!Number.isInteger(owner.pid)||owner.pid<=0||typeof owner.token!=='string')throw new Error('Invalid media cache ownership');
        if(owner.pid===process.pid){this.ownerToken=owner.token;return;}
        let alive=true;try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}if(alive)throw new Error('Media cache is used by another plugin process; close duplicate Studio instances');
        const reclaim=this.child('.reclaim');try{await mkdir(reclaim,{mode:0o700});}catch(error){if(error.code==='EEXIST')throw new Error('Media cache recovery is busy; retry after restarting Studio');throw error;}
        try{const current=JSON.parse((await safeText(file,1024)).text);if(current.pid!==owner.pid||current.token!==owner.token)throw new Error('Media cache ownership changed; retry');await unlink(file);}finally{await this.remove('.reclaim');}
      }
    }throw new Error('Could not acquire media cache ownership');
  }
  async close(){
    await Promise.allSettled([...this.pending.values()]);
    if(this.ownerToken)for(const key of [...this.invalid])if(this.index.has(key)&&!this.leases.has(key)){await this.remove(key);this.diskBytes-=this.index.get(key).bytes;this.index.delete(key);this.invalid.delete(key);}
    if(this.ownerToken&&this.index.size){const name=`.recency-${randomUUID()}.tmp`,path=this.child(name);try{const text=JSON.stringify({schema:'imageslide-recency/v1',items:Object.fromEntries([...this.index].map(([key,value])=>[key,Math.floor(value.last)]))});await writeFile(path,text,{encoding:'utf8',flag:'wx',mode:0o600});await rename(path,join(this.root,'.recency.json'));}finally{await unlink(path).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
    this.clearMemory();this.index.clear();this.invalid.clear();this.epoch++;this.leases.clear();this.diskBytes=0;this.initialization=null;
    if(this.ownerToken){const file=join(this.root,'.owner.json');try{const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new Error('Unsafe media cache ownership');const owner=JSON.parse((await safeText(file,1024)).text);if(owner.pid===process.pid&&owner.token===this.ownerToken)await unlink(file);}catch(error){if(error.code!=='ENOENT')throw error;}this.ownerToken=null;}
  }
  async evict(extra,protectedKey){
    while(this.diskBytes+extra>this.policy.diskBytes||this.index.size>=this.policy.entries&&extra>0){
      const candidates=[...this.index].filter(([key])=>key!==protectedKey&&!this.leases.has(key)).sort((a,b)=>a[1].last-b[1].last);
      if(!candidates.length)throw new Error('Media disk cache is full with active clips; use fewer simultaneous displays');const [key,item]=candidates[0];await this.remove(key);this.index.delete(key);this.invalid.delete(key);this.metadata.delete(key);this.diskBytes-=item.bytes;
    }
  }
  async begin(key){if(!HASH.test(key))throw new Error('Invalid media identity');await this.initialize();const name=`.pending-${randomUUID()}`,path=this.child(name);await mkdir(path,{mode:0o700});return {name,path,key};}
  async abort(stage){await this.remove(stage.name);}
  async commit(stage,media){
    const file=join(stage.path,'frames.dat'),info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==media.preparedBytes)throw new Error('Prepared media size mismatch');
    const first=media.frames[0],handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));let poster;
    try{poster=Buffer.alloc(first.size);const result=await handle.read(poster,0,poster.length,first.offset);if(result.bytesRead!==poster.length||digest(poster)!==first.hash)throw new Error('Prepared poster integrity mismatch');}finally{await handle.close();}
    const record={...media,schema:SCHEMA,signature:stage.key};const text=JSON.stringify(record);if(Buffer.byteLength(text)>128*1024)throw new Error('Prepared metadata budget exceeded');
    await writeFile(join(stage.path,'metadata.json'),text,{encoding:'utf8',flag:'wx',mode:0o600});const bytes=info.size+128*1024;await this.evict(bytes,stage.key);
    if(this.invalid.has(stage.key)&&this.index.has(stage.key)&&!this.leases.has(stage.key)){await this.remove(stage.key);this.diskBytes-=this.index.get(stage.key).bytes;this.index.delete(stage.key);this.invalid.delete(stage.key);}
    if(this.index.has(stage.key)){await this.abort(stage);const cached=await this.lookup(stage.key);if(!cached)throw new Error('Prepared media is still in use; switch media and refresh');return cached;}
    await rename(stage.path,this.child(stage.key));this.index.set(stage.key,{bytes,last:Date.now()});this.diskBytes+=bytes;record.dataUri=`data:image/png;base64,${poster.toString('base64')}`;this.metadata.set(stage.key,record,Buffer.byteLength(text)+Buffer.byteLength(record.dataUri));return this.attach(record);
  }
  attach(record){return {...record,retainedBytes:Buffer.byteLength(record.dataUri)+record.frames.length*160,getFrame:index=>this.frameData(record,index).catch(error=>{if(error.code!=='CACHE_BUSY'){this.invalid.add(record.signature);this.metadata.delete(record.signature);}throw error;}),acquire:()=>this.lease(record.signature)};}
  lease(key){const epoch=this.epoch;this.leases.set(key,(this.leases.get(key)||0)+1);let done=false;return ()=>{if(done)return;done=true;if(epoch!==this.epoch)return;const count=this.leases.get(key)||0;if(count<=1)this.leases.delete(key);else this.leases.set(key,count-1);};}
  async lookup(key){
    if(!HASH.test(key))throw new Error('Invalid media identity');await this.initialize();if(!this.index.has(key)||this.invalid.has(key))return null;
    let record=this.metadata.get(key);
    if(!record){try{const path=join(this.child(key),'metadata.json'),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>128*1024)throw new Error('Invalid cached metadata');record=JSON.parse((await safeText(path,128*1024)).text);
      if(record.schema!==SCHEMA||record.signature!==key||record.kind!=='gif'||record.width!==458||record.height!==196||!Array.isArray(record.frames)||!record.frames.length||record.frames.length>201||record.delays?.length!==record.frames.length||!record.delays.every(value=>Number.isInteger(value)&&value>0)||record.delays.reduce((a,b)=>a+b,0)>20000||!Number.isInteger(record.loop)||record.loop<0||record.loop>65536||!Number.isInteger(record.sourceFrames)||record.sourceFrames<1||record.sourceFrames>600||!Number.isInteger(record.uniqueFrames)||record.uniqueFrames<1||record.uniqueFrames>record.frames.length||record.durationMs!==record.delays.reduce((a,b)=>a+b,0))throw new Error('Invalid cached frame metadata');
      for(const frame of record.frames)if(!Number.isInteger(frame.offset)||!Number.isInteger(frame.size)||frame.offset<0||frame.size<24||frame.size>1024*1024||frame.offset+frame.size>record.preparedBytes||!HASH.test(frame.hash))throw new Error('Invalid cached frame reference');
      const pack=await lstat(join(this.child(key),'frames.dat'));if(!pack.isFile()||pack.isSymbolicLink()||pack.size!==record.preparedBytes)throw new Error('Invalid cached pack');record.dataUri=await this.frameData(record,0);this.metadata.set(key,record,info.size+Buffer.byteLength(record.dataUri));
    }catch{if(!this.leases.has(key)){await this.remove(key);this.diskBytes-=this.index.get(key).bytes;this.index.delete(key);}return null;}}
    this.index.get(key).last=Date.now();this.stats.diskHits++;return this.attach(record);
  }
  async frameData(record,index){
    const frame=record.frames[index];if(!frame)throw new Error('Invalid frame index');const cacheKey=frame.hash,uri=this.uris.get(cacheKey);if(uri)return uri;
    if(this.pending.has(cacheKey))return this.pending.get(cacheKey);if(this.reads>=this.policy.reads){const error=new Error('Frame read budget busy');error.code='CACHE_BUSY';throw error;}
    this.reads++;const release=this.lease(record.signature);const operation=(async()=>{let buffer=this.binary.get(cacheKey);if(!buffer){
      const parent=await lstat(this.child(record.signature));if(!parent.isDirectory()||parent.isSymbolicLink())throw new Error('Unsafe cached frame directory');
      const path=join(this.child(record.signature),'frames.dat'),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size!==record.preparedBytes)throw new Error('Cached frame pack changed; refresh the folder');
      const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{const current=await handle.stat();if(current.ino!==info.ino||current.dev!==info.dev)throw new Error('Cached frame changed while opening');buffer=Buffer.alloc(frame.size);let offset=0;while(offset<buffer.length){const result=await handle.read(buffer,offset,buffer.length-offset,frame.offset+offset);if(!result.bytesRead)throw new Error('Truncated cached frame');offset+=result.bytesRead;}}finally{await handle.close();}
      if(digest(buffer)!==frame.hash||buffer.toString('ascii',12,16)!=='IHDR'||buffer.readUInt32BE(16)!==458||buffer.readUInt32BE(20)!==196)throw new Error('Cached frame integrity failed; refresh the folder');this.binary.set(cacheKey,buffer,buffer.length);this.stats.frameReads++;
    }const value=`data:image/png;base64,${buffer.toString('base64')}`;this.uris.set(cacheKey,value,Buffer.byteLength(value));return value;})();this.pending.set(cacheKey,operation);
    try{return await operation;}finally{this.reads--;this.pending.delete(cacheKey);release();}
  }
  clearMemory(){this.binary.clear();this.uris.clear();this.metadata.clear();}
}
