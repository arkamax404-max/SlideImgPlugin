import {Worker} from 'node:worker_threads';
import {GIF_LIMITS} from './gif-media.js';
import {PreparedMediaStore,ByteLRU} from './prepared-media-store.js';

// One reusable worker, two waiting buffers, coalesced source identities. Prepared
// PNGs live in a bounded private disk cache, not every gallery's JavaScript heap.
export class MediaPreparer {
  constructor({limits=GIF_LIMITS,WorkerImpl=Worker,store=new PreparedMediaStore()}={}){this.limits=limits;this.WorkerImpl=WorkerImpl;this.store=store;this.queue=[];this.active=null;this.pending=new Map();this.posters=new ByteLRU(limits.cacheBytes);this.worker=null;this.idle=null;this.generation=0;this.stats={describes:0,prepares:0};}
  describe(buffer,signature,options={}){return this.request('describe',buffer,signature,options);}
  prepare(buffer,signature,options={}){return this.request('prepare',buffer,signature,options);}
  request(kind,buffer,signature,{transfer=false}={}){
    const key=`${kind}:${signature}`;if(this.pending.has(key))return this.pending.get(key);
    if(kind==='describe'){const hit=this.posters.get(signature);if(hit)return Promise.resolve(hit);}
    const generation=this.generation;
    const promise=(async()=>{
      if(this.shutdownPromise)await this.shutdownPromise;const disk=await this.store.lookup(signature);if(generation!==this.generation)throw new Error('GIF preparation cancelled');if(disk)return disk;
      if(this.queue.length>=this.limits.queuedJobs)throw new Error('GIF preparation queue full; refresh after current media completes');
      return new Promise((resolve,reject)=>{const job={kind,buffer,signature,key,resolve,reject,generation,transfer};if(kind==='prepare')this.queue.unshift(job);else this.queue.push(job);this.pump();});
    })();this.pending.set(key,promise);promise.finally(()=>{if(this.pending.get(key)===promise)this.pending.delete(key);}).catch(()=>{});return promise;
  }
  async pump(){
    if(this.active||!this.queue.length)return;
    if(this.idle){clearTimeout(this.idle);this.idle=null;}
    const job=this.queue.shift(),active={job,stage:null,timer:null,done:false};this.active=active;
    const finish=(error,media)=>{if(active.completion)return active.completion;active.done=true;active.completion=complete(error,media);return active.completion;};
    const complete=async(error,media)=>{
      clearTimeout(active.timer);this.worker?.removeListener('message',onMessage);
      try{
        if(error){const worker=this.worker;this.worker=null;await worker?.terminate();if(active.stagePromise)active.stage=await active.stagePromise;if(active.stage)await this.store.abort(active.stage);job.reject(error);}
        else if(job.kind==='prepare'){const result=await this.store.commit(active.stage,media);if(job.generation!==this.generation)throw new Error('GIF preparation cancelled');job.resolve(result);}
        else{this.posters.set(job.signature,media,media.retainedBytes);job.resolve(media);}
      }catch(failure){if(active.stage)await this.store.abort(active.stage).catch(()=>{});job.reject(failure);}
      finally{if(this.active===active)this.active=null;if(this.queue.length)this.pump();else if(this.worker){this.idle=setTimeout(()=>{this.idle=null;const worker=this.worker;this.worker=null;void worker?.terminate();},10000);this.idle.unref?.();}}
    };
    const onMessage=result=>{void finish(result.error?new Error(result.error):null,result.media);};active.finish=finish;
    active.timer=setTimeout(()=>{void finish(new Error('GIF preparation exceeded 30 seconds'));},this.limits.timeoutMs);
    try{
      if(job.kind==='prepare'){active.stagePromise=this.store.begin(job.signature);active.stage=await active.stagePromise;}
      if(active.done||job.generation!==this.generation){if(active.stage)await this.store.abort(active.stage);return;}
      if(!this.worker){this.worker=new this.WorkerImpl(new URL('./media-worker.js',import.meta.url));const worker=this.worker;worker.on('error',error=>{if(this.worker===worker)void this.active?.finish(error);});worker.on('exit',()=>{if(this.worker===worker){this.worker=null;if(this.active&&!this.active.done)void this.active.finish(new Error('GIF worker exited'));}});}
      this.worker.once('message',onMessage);this.stats[job.kind==='prepare'?'prepares':'describes']++;
      const payload={kind:job.kind,buffer:job.buffer,stagePath:active.stage?.path,limits:this.limits};
      this.worker.postMessage(payload,job.transfer&&job.buffer.byteOffset===0&&job.buffer.buffer.byteLength===job.buffer.byteLength?[job.buffer.buffer]:[]);job.buffer=null;
    }catch(error){void finish(error);}
  }
  shutdown(){if(this.shutdownPromise)return this.shutdownPromise;this.cancel();const operation=(async()=>{await this.cancellation;if(this.idle)clearTimeout(this.idle);this.idle=null;const worker=this.worker;this.worker=null;await worker?.terminate();await this.store.close?.();})();this.shutdownPromise=operation;operation.finally(()=>{if(this.shutdownPromise===operation)this.shutdownPromise=null;}).catch(()=>{});return operation;}
  cancel(){this.generation++;this.pending.clear();if(this.idle)clearTimeout(this.idle);this.idle=null;for(const job of this.queue.splice(0))job.reject(new Error('GIF preparation cancelled'));if(this.active)this.cancellation=this.active.finish(new Error('GIF preparation cancelled'));else{const worker=this.worker;this.worker=null;void worker?.terminate();}this.posters.clear();this.store.clearMemory();}
}
export const mediaPreparer=new MediaPreparer();
