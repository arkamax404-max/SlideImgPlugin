import {performance} from 'node:perf_hooks';

export const FRAME_FPS=10,BACKLOG_BYTES=1024*1024;
const preparationError=error=>/^(GIF |Prepared GIF|Media cache |Invalid GIF|Truncated GIF|File is not GIF|Could not acquire media cache)/.test(error?.message||'')?error.message:'GIF preparation failed or exceeded its budget; refresh the folder or choose a smaller clip.';
export function frameAt(media,elapsed){
  const delays=media.delays.map(value=>value>0?value:100),cycle=delays.reduce((a,b)=>a+b,0);
  if(media.loop>0&&elapsed>=cycle*media.loop)return {index:delays.length-1,done:true};
  let time=Math.max(0,elapsed)%cycle;for(let index=0;index<delays.length;index++){if(time<delays[index])return {index,done:false};time-=delays[index];}return {index:delays.length-1,done:false};
}
export class AnimationPlayer {
  constructor({client,timerApi=globalThis,now=()=>performance.now()}={}){this.client=client;this.timerApi=timerApi;this.now=now;this.contexts=new Map();this.preloads=new Map();this.timer=null;this.deadline=0;this.stats={sent:0,dropped:0};}
  preload(media){
    if(media?.rejection)return Promise.reject(new Error(media.rejection));
    if(!media?.prepare||media.frames?.length)return Promise.resolve(media);
    if(this.preloads.has(media.signature))return this.preloads.get(media.signature);
    if(this.preloads.size>=2)this.preloads.delete(this.preloads.keys().next().value);
    const operation=media.prepare();this.preloads.set(media.signature,operation);operation.catch(()=>{if(this.preloads.get(media.signature)===operation)this.preloads.delete(media.signature);});return operation;
  }
  display(context,media,_legacyBackend='frames',force=false,onError=()=>{}){
    const previous=this.contexts.get(context);if(!force&&previous?.signature===media.signature&&!previous.failed)return;
    this.remove(context,false);const state={media,signature:media.signature,backend:'frames',start:this.now(),lastFrame:-1,done:false,pending:false,release:null,onError};this.contexts.set(context,state);
    if(media.kind!=='gif'){this.client.setBaseDataIcon(context,media.dataUri,'');return;}
    if(media.frames?.length){state.release=media.acquire?.();this.pump();this.schedule();return;}
    this.client.setBaseDataIcon(context,media.dataUri,'');state.pending=true;
    this.preload(media).then(prepared=>{if(this.contexts.get(context)!==state)return;state.media=prepared;state.release=prepared.acquire?.();state.pending=false;state.start=this.now();this.pump();this.schedule();},error=>{if(this.contexts.get(context)!==state)return;state.pending=false;state.done=true;state.failed=true;state.onError(preparationError(error));});
  }
  deliver(context,state,index,done,data){
    if(this.contexts.get(context)!==state)return;
    const current=frameAt(state.media,this.now()-state.start);if(current.index!==index){this.stats.dropped++;return;}
    const bytes=Buffer.byteLength(data)+1024;if(this.client.canSendFrame&&!this.client.canSendFrame(bytes,BACKLOG_BYTES)){this.stats.dropped++;return;}
    try{this.client.setBaseDataIcon(context,data,'');state.lastFrame=index;state.done=done||current.done;this.stats.sent++;}catch{this.stats.dropped++;}
  }
  pump(){
    for(const [context,state] of this.contexts){
      if(state.media.kind!=='gif'||state.done||state.pending||!state.media.frames?.length)continue;
      const {index,done}=frameAt(state.media,this.now()-state.start);if(index===state.lastFrame){state.done=done;continue;}
      const frame=state.media.frames[index],estimated=typeof frame==='string'?Buffer.byteLength(frame)+1024:(frame.size??frame.byteLength??0)*4/3+1024;
      if(this.client.canSendFrame&&!this.client.canSendFrame(estimated,BACKLOG_BYTES)){this.stats.dropped++;continue;}
      if(state.media.getFrame){state.pending=true;state.media.getFrame(index).then(data=>this.deliver(context,state,index,done,data),error=>{if(error.code==='CACHE_BUSY'){this.stats.dropped++;return;}if(this.contexts.get(context)===state){state.done=true;state.failed=true;state.onError('GIF cached frame could not be read; refresh the folder.');}}).finally(()=>{state.pending=false;this.schedule();});}
      else this.deliver(context,state,index,done,typeof frame==='string'?frame:`data:image/png;base64,${Buffer.from(frame).toString('base64')}`);
    }
  }
  schedule(){
    if(this.timer||![...this.contexts.values()].some(state=>state.media.kind==='gif'&&state.media.frames?.length&&!state.done))return;
    const time=this.now(),period=1000/FRAME_FPS;this.deadline=this.deadline>time?this.deadline:time+period;
    this.timer=this.timerApi.setTimeout(()=>{this.timer=null;this.pump();this.deadline+=period;this.schedule();},Math.max(1,this.deadline-time));
  }
  remove(context,replace=true){
    const state=this.contexts.get(context);this.contexts.delete(context);state?.release?.();this.preloads.clear();
    if(replace&&state?.media.kind==='gif')try{this.client.setBaseDataIcon(context,state.media.dataUri,'');}catch{}
    if(![...this.contexts.values()].some(state=>state.media.kind==='gif'&&state.media.frames?.length&&!state.done)){if(this.timer)this.timerApi.clearTimeout(this.timer);this.timer=null;this.deadline=0;}
  }
  close(){for(const context of [...this.contexts.keys()])this.remove(context);this.preloads.clear();}
}
