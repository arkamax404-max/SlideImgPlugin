import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {mkdtemp,writeFile,rm,stat,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixtureGif} from './gif-fixtures.js';
import {inspectGif,prepareGif,GIF_LIMITS} from '../plugin/gif-media.js';
import {loadSlide} from '../plugin/images.js';
import {enumerateFolder} from '../plugin/slideshow.js';
import {mediaPreparer,MediaPreparer} from '../plugin/media-preparer.js';
import {EventEmitter} from 'node:events';

test('GIF validation rejects extension-content mismatch, truncation, excess dimensions/frames/pixels/bytes',()=>{
  const gif=fixtureGif();assert.equal(inspectGif(gif).frames,2);
  assert.throws(()=>inspectGif(Buffer.from('not a gif')),/not GIF|limit/);
  assert.throws(()=>inspectGif(gif.subarray(0,-1)),/Truncated/);
  const giant=Buffer.from(gif);giant.writeUInt16LE(2049,6);assert.throws(()=>inspectGif(giant),/dimensions/);
  for(const limits of [{frames:1},{decodedPixels:5},{outputPixels:1},{inputBytes:1}])assert.throws(()=>inspectGif(gif,{...GIF_LIMITS,...limits}));
});

test('binary PNG frames preserve effective timing and loop counts, merge duplicate frames and keep per-page sizing',async()=>{
  for(const loop of [null,0,2]){
    const result=await prepareGif(fixtureGif({loop,frames:[{pixels:[1,1,1],delay:0},{pixels:[2,2,2],delay:7},{pixels:[2,2,2],delay:17}]}));
    assert.equal(result.gifdata,undefined);assert.equal(result.frames.length,2);assert.deepEqual(result.delays,[100,240]);assert.equal(result.durationMs,340);assert.equal(result.loop,loop===null?1:loop===0?0:3);
    for(const frame of result.frames){assert.ok(Buffer.isBuffer(frame));const metadata=await sharp(frame).metadata();assert.equal(metadata.width,458);assert.equal(metadata.height,196);}
    assert.deepEqual([...(await sharp(result.frames[0]).ensureAlpha().raw().toBuffer()).subarray(0,4)],[255,0,0,255]);
    assert.deepEqual([...(await sharp(result.frames[1]).ensureAlpha().raw().toBuffer()).subarray(0,4)],[0,255,0,255]);
  }
  const single=await prepareGif(fixtureGif({loop:null,frames:[{pixels:[3,3,3],delay:10}]}));assert.equal(single.frames.length,1);assert.equal(single.loop,1);
});

test('partial-frame transparency and disposal 2/3 compose to known expected RGBA pixels and temporal output',async()=>{
  for(const disposal of [2,3]){
    const gif=fixtureGif({frames:[{pixels:[1,1,1],delay:20},{x:1,width:1,pixels:[2],delay:30,disposal},{x:2,width:1,pixels:[3],delay:40}]});
    const {data}=await sharp(gif,{animated:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const red=[255,0,0,255],green=[0,255,0,255],blue=[0,0,255,255],clear=[0,0,0,0];
    const expected=[...red,...red,...red,...red,...green,...red,...red,...(disposal===3?red:clear),...blue];
    assert.deepEqual([...data],expected);
    const prepared=await prepareGif(gif);
    for(let i=0;i<3;i++){
      const expectedFrame=await sharp(Buffer.from(expected.slice(i*12,(i+1)*12)),{raw:{width:3,height:1,channels:4}}).resize(458,196,{fit:'cover',position:'centre'}).png().toBuffer();
      const actual=await sharp(prepared.frames[i]).raw().toBuffer();
      assert.deepEqual(actual,await sharp(expectedFrame).raw().toBuffer());
    }
    assert.deepEqual(prepared.delays,[200,300,400]);
  }
});

test('PNG playback matches known composited pixels over an exact low-rate temporal sequence',async()=>{
  const input=fixtureGif({width:458,height:196,loop:1,frames:[{pixels:Array(458*196).fill(1),delay:20},{x:219,y:88,width:20,height:20,pixels:Array(400).fill(2),delay:30,disposal:3},{x:400,y:88,width:20,height:20,pixels:Array(400).fill(3),delay:40}]});
  const media=await prepareGif(input);assert.equal(media.loop,2);assert.deepEqual(media.delays,[200,300,400]);
  const decoded=Buffer.concat(await Promise.all(media.frames.map(frame=>sharp(frame).ensureAlpha().raw().toBuffer())));
  const pixel=(frame,x,y)=>[...decoded.subarray(((frame*196+y)*458+x)*4,((frame*196+y)*458+x)*4+4)];
  assert.deepEqual(pixel(0,228,98),[255,0,0,255]);assert.deepEqual(pixel(1,228,98),[0,255,0,255]);assert.deepEqual(pixel(2,228,98),[255,0,0,255]);assert.deepEqual(pixel(2,409,98),[0,0,255,255]);
  await assert.rejects(prepareGif(input,{...GIF_LIMITS,outputBytes:1}),/Prepared GIF/);
});

test('uppercase GIF participates in deterministic mixed discovery, full-content dedup, same-stat explicit refresh',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'gif-gallery-'));
  try{
    const a=fixtureGif(),b=fixtureGif({frames:[{pixels:[1,1,1],delay:20},{pixels:[3,3,3],delay:40}]});
    await writeFile(join(dir,'b.GIF'),a);await writeFile(join(dir,'copy.gif'),a);await writeFile(join(dir,'c.gif'),b);
    await writeFile(join(dir,'bad.gif'),'not GIF');await writeFile(join(dir,'a.png'),await sharp({create:{width:458,height:196,channels:3,background:'#123456'}}).png().toBuffer());
    const cache=new Map();const result=await enumerateFolder(dir,'name',undefined,cache);
    assert.deepEqual(result.slides.map(s=>s.name),['a.png','b.GIF','c.gif']);assert.equal(result.rejected,1);assert.notEqual(result.slides[1].signature,result.slides[2].signature);
    const before=await stat(join(dir,'b.GIF'));assert.equal(a.length,b.length);await writeFile(join(dir,'b.GIF'),b);await utimes(join(dir,'b.GIF'),before.atime,before.mtime);
    cache.clear();const refreshed=await enumerateFolder(dir,'name',undefined,cache);assert.equal(refreshed.slides.find(s=>s.name==='b.GIF').signature,result.slides[2].signature);
    await assert.rejects(loadSlide(join(dir,'bad.gif')));
  }finally{mediaPreparer.cancel();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('worker queue shares jobs, enforces timeout and concurrency, cancellation rejects late completion',async()=>{
  const workers=[];class FakeWorker extends EventEmitter{constructor(){super();workers.push(this);}postMessage(){}terminate(){this.terminated=true;return Promise.resolve();}}
  const store={lookup:async()=>null,begin:async()=>({path:'synthetic',name:'synthetic'}),abort:async()=>{},clearMemory(){}};
  const preparer=new MediaPreparer({WorkerImpl:FakeWorker,store,limits:{...GIF_LIMITS,timeoutMs:40,queuedJobs:1}});
  const first=preparer.prepare(Buffer.from('a'),'a');assert.equal(first,preparer.prepare(Buffer.from('a'),'a'));const firstCheck=assert.rejects(first,/30 seconds/);
  await new Promise(resolve=>setImmediate(resolve));const second=preparer.prepare(Buffer.from('b'),'b'),secondCheck=assert.rejects(second,/cancelled/);await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(preparer.prepare(Buffer.from('c'),'c'),/queue full/);assert.equal(workers.length,1);
  await firstCheck;await new Promise(resolve=>setImmediate(resolve));assert.equal(workers.length,2);preparer.cancel();await secondCheck;
  workers[0].emit('message',{media:{preparedBytes:1}});assert.ok(workers.every(worker=>worker.terminated));
});

test('shutdown waits for an in-flight atomic commit, rejects its stale result and terminates the reusable worker before cache release',async()=>{
  let release,closed=false;const committing=new Promise(done=>release=done),workers=[];
  class FakeWorker extends EventEmitter{constructor(){super();workers.push(this);}postMessage(){}terminate(){this.terminated=true;return Promise.resolve();}}
  const store={lookup:async()=>null,begin:async()=>({path:'synthetic',name:'synthetic'}),commit:async()=>committing,abort:async()=>{},clearMemory(){},close:async()=>{closed=true;}};
  const preparer=new MediaPreparer({WorkerImpl:FakeWorker,store}),preparing=preparer.prepare(Buffer.from('synthetic'),'synthetic');const rejected=assert.rejects(preparing,/cancelled/);
  await new Promise(done=>setImmediate(done));workers[0].emit('message',{media:{preparedBytes:1}});await new Promise(done=>setImmediate(done));
  const shutdown=preparer.shutdown();await new Promise(done=>setImmediate(done));assert.equal(closed,false);
  release({kind:'gif',frames:['one'],preparedBytes:1});await shutdown;await rejected;assert.equal(closed,true);assert.equal(workers[0].terminated,true);assert.equal(preparer.active,null);
});
