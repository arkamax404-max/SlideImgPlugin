import assert from 'node:assert/strict';
import test from 'node:test';
import {AnimationPlayer,frameAt} from '../plugin/animation-player.js';
import {UlanziProtocolClient} from '../plugin/protocol-client.js';
const media={kind:'gif',signature:'hash',gifdata:'R0lG',dataUri:'poster',frames:['red','green','blue'],delays:[200,400,600],loop:0};

function runtime(){let time=0,blocked=false;const sends=[],timers=new Map();let id=0;
  const timerApi={setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}};
  const client={setBaseDataIcon:(context,data)=>sends.push({context,data}),setGifDataIcon:(context,data)=>sends.push({context,data}),canSendFrame:()=>!blocked};
  const player=new AnimationPlayer({client,timerApi,now:()=>time});
  return {player,sends,timers,setTime:t=>time=t,block:b=>blocked=b,fire(){const [id,{fn}]=timers.entries().next().value;timers.delete(id);fn();}};
}
test('PNG-only playback deduplicates unchanged media, replaces with static and stops on deactivation',()=>{
  const r=runtime();r.player.display('a',media);r.player.display('a',{...media});assert.equal(r.sends.length,1);assert.equal(r.timers.size,1);
  r.player.display('a',{signature:'static',dataUri:'png'});assert.equal(r.sends.at(-1).data,'png');r.player.pump();assert.equal(r.sends.length,2);
  r.player.display('a',media);r.player.remove('a');assert.equal(r.sends.at(-1).data,'poster');assert.equal(r.player.contexts.size,0);
});
test('one scheduler shares media across contexts, obeys delays and skips lag/backpressure without a queue',()=>{
  const r=runtime();r.player.display('a',media,'frames');r.player.display('b',media,'frames');assert.equal(r.timers.size,1);assert.equal(r.player.contexts.get('a').media,r.player.contexts.get('b').media);
  r.setTime(150);r.fire();assert.equal(r.sends.length,2);
  r.setTime(200);r.fire();assert.deepEqual(r.sends.slice(-2).map(x=>x.data),['green','green']);
  r.block(true);r.setTime(700);r.fire();assert.equal(r.sends.length,4);assert.equal(r.player.stats.dropped,2);
  r.block(false);r.setTime(1800);r.fire();assert.deepEqual(r.sends.slice(-2).map(x=>x.data),['blue','blue']);assert.equal(r.timers.size,1);
  r.player.display('a',{signature:'clock',dataUri:'clock'});r.player.remove('b');assert.equal(r.timers.size,0);const count=r.sends.length;r.player.pump();assert.equal(r.sends.length,count);
});
test('finite loops hold final frame; zero delays have explicit 100 ms frame-backend policy',()=>{
  assert.deepEqual(frameAt({...media,loop:1},1200),{index:2,done:true});
  assert.equal(frameAt({...media,delays:[0,0,0]},150).index,1);
  const r=runtime();r.player.display('a',{...media,loop:1},'frames');r.setTime(1300);r.fire();assert.equal(r.sends.at(-1).data,'blue');assert.equal(r.timers.size,0);
});

test('async disk reads drop outdated results, apply backpressure and cannot write after static replacement or removal',async()=>{
  const r=runtime();let resolve,reads=0,released=0;const pending=new Promise(done=>resolve=done);
  const stored={...media,frames:[{size:20},{size:20},{size:20}],getFrame:()=>{reads++;return pending;},acquire:()=>()=>released++};
  r.player.display('a',stored);r.player.pump();assert.equal(reads,1);r.setTime(700);resolve('old-red');await new Promise(done=>setImmediate(done));assert.equal(r.sends.length,0);assert.ok(r.player.stats.dropped>0);
  r.block(true);r.player.pump();assert.equal(reads,1);r.block(false);
  r.player.display('a',{signature:'static',dataUri:'static'});await new Promise(done=>setImmediate(done));assert.equal(released,1);assert.equal(r.sends.at(-1).data,'static');assert.equal(r.timers.size,0);
  let late;const preparing={kind:'gif',signature:'lazy',dataUri:'loading-poster',prepare:()=>new Promise(done=>late=done)};
  r.player.display('b',preparing);r.player.remove('b');const count=r.sends.length;late(media);await new Promise(done=>setImmediate(done));assert.equal(r.sends.length,count);assert.equal(r.player.contexts.has('b'),false);
});

test('lazy preparation errors retain a loading poster and report actionable failure without repeated preparation',async()=>{
  const r=runtime();let calls=0,message;const lazy={kind:'gif',signature:'bad-source',dataUri:'poster',prepare:async()=>{calls++;throw new Error('invalid data');}};
  r.player.display('a',lazy,'frames',false,value=>message=value);await new Promise(done=>setImmediate(done));assert.match(message,/refresh|smaller/);assert.equal(r.sends.at(-1).data,'poster');assert.equal(r.player.contexts.get('a').failed,true);assert.equal(r.timers.size,0);r.player.close();assert.equal(calls,1);
});
