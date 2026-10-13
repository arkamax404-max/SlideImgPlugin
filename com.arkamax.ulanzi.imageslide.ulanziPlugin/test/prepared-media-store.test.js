import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,writeFile,readFile,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import sharp from 'sharp';
import {spawnSync} from 'node:child_process';
import {PreparedMediaStore,CACHE_POLICY,ByteLRU} from '../plugin/prepared-media-store.js';
import {MediaPreparer} from '../plugin/media-preparer.js';
import {prepareGif,inspectGif,playbackPlan} from '../plugin/gif-media.js';
import {fixtureGif} from './gif-fixtures.js';
import {loadSlide} from '../plugin/images.js';

const hash=input=>createHash('sha256').update(input).digest('hex');
async function fixture(options={}){const root=await mkdtemp(join(tmpdir(),'png-cache-'));const store=new PreparedMediaStore({root:join(root,'cache'),...options}),preparer=new MediaPreparer({store});return {root,store,preparer,async close(){preparer.cancel();await new Promise(resolve=>setTimeout(resolve,50));await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}};}

test('real worker stores binary PNG packs once; shared reads and a new cache instance reuse them without decoding',async()=>{
  const f=await fixture();try{
    const input=fixtureGif(),key=hash(input),media=await f.preparer.prepare(input,key);assert.equal(media.gifdata,undefined);assert.equal(f.preparer.stats.prepares,1);
    assert.equal(typeof media.frames[0],'object');const firstRead=media.getFrame(0);assert.equal(f.store.leases.has(key),true);const [a,b]=await Promise.all([firstRead,media.getFrame(0)]);assert.equal(f.store.leases.has(key),false);assert.equal(a,b);assert.equal(f.store.stats.frameReads,1);
    const png=Buffer.from(a.split(',')[1],'base64'),metadata=await sharp(png).metadata();assert.equal(metadata.width,458);assert.equal(metadata.height,196);
    await f.preparer.prepare(input,key);assert.equal(f.preparer.stats.prepares,1);assert.equal(f.store.stats.frameReads,1);
    const reopened=new PreparedMediaStore({root:f.store.root});const cached=await reopened.lookup(key);assert.ok(cached);assert.equal(await cached.getFrame(0),a);assert.equal((await readdir(f.store.root)).filter(name=>name.startsWith('.pending')).length,0);
    assert.ok(f.store.binary.bytes<=CACHE_POLICY.binaryBytes);assert.ok(f.store.uris.bytes<=CACHE_POLICY.uriBytes);assert.ok(f.store.metadata.bytes<=CACHE_POLICY.metadataBytes);
  }finally{await f.close();}
});

test('discovery decodes only posters; current media prepares once, duplicate paths share disk media and atomic source replacement rejects late work',async()=>{
  const f=await fixture();try{
    const input=fixtureGif(),first=join(f.root,'first.gif'),copy=join(f.root,'copy.GIF');await writeFile(first,input);await writeFile(copy,input);
    const a=await loadSlide(first,{preparer:f.preparer}),b=await loadSlide(copy,{preparer:f.preparer});assert.equal(f.preparer.stats.prepares,0);assert.equal(f.preparer.stats.describes,1);assert.equal(a.signature,b.signature);assert.equal(a.frames,undefined);
    await a.prepare();await b.prepare();assert.equal(f.preparer.stats.prepares,1);
    const other=join(f.root,'changed.gif');await writeFile(other,fixtureGif({loop:3}));const stale=await loadSlide(other,{preparer:f.preparer});await writeFile(other,fixtureGif({loop:4}));await assert.rejects(stale.prepare(),/changed during preparation/);
  }finally{await f.close();}
});

test('corrupted PNG pack fails integrity, blocks its cached identity and rebuilds atomically after release',async()=>{
  const f=await fixture();try{const input=fixtureGif(),key=hash(input),media=await f.preparer.prepare(input,key),release=media.acquire();
    const path=join(f.store.root,key,'frames.dat'),buffer=await readFile(path);buffer[buffer.length-1]^=1;await writeFile(path,buffer);f.store.clearMemory();
    await assert.rejects(media.getFrame(media.frames.length-1),/integrity/);assert.equal(await f.store.lookup(key),null);release();
    const rebuilt=await f.preparer.prepare(input,key);assert.ok(await rebuilt.getFrame(rebuilt.frames.length-1));assert.equal(f.preparer.stats.prepares,2);
    const meta=join(f.store.root,key,'metadata.json');await writeFile(meta,'{}');f.store.metadata.clear();assert.equal(await f.store.lookup(key),null);
  }finally{await f.close();}
});

test('disk eviction preserves leased playback, rejects a full active cache and bounds binary/URI LRUs',async()=>{
  const f=await fixture({policy:{...CACHE_POLICY,diskBytes:150000}});try{
    const first=fixtureGif(),second=fixtureGif({frames:[{pixels:[3,3,3],delay:20}]}),key=hash(first),media=await f.preparer.prepare(first,key),release=media.acquire();
    await assert.rejects(f.preparer.prepare(second,hash(second)),/full with active/);assert.ok(await media.getFrame(0));release();
    await f.preparer.prepare(second,hash(second));assert.equal(await f.store.lookup(key),null);assert.ok(f.store.diskBytes<=150000);
    const lru=new ByteLRU(4);lru.set('a','a',2);lru.set('b','b',2);lru.get('a');lru.set('c','c',2);assert.equal(lru.get('b'),undefined);assert.equal(lru.bytes,4);lru.set('large','large',10);assert.equal(lru.bytes,4);
  }finally{await f.close();}
});

test('sampled high-rate clips preserve total duration and terminal pixels after disposal, finite loops and duplicate reuse',async()=>{
  const input=fixtureGif({width:3,height:1,loop:1,frames:[{pixels:[1,1,1],delay:2},{x:1,width:1,pixels:[2],delay:2,disposal:3},{x:2,width:1,pixels:[3],delay:2},{pixels:[2,2,2],delay:2},{pixels:[3,3,3],delay:2}]}),source=inspectGif(input),plan=playbackPlan(source),media=await prepareGif(input);
  assert.equal(source.durationMs,100);assert.equal(plan.at(-1).sourceFrame,4);assert.equal(media.delays.reduce((a,b)=>a+b,0),100);assert.equal(media.loop,2);assert.deepEqual(media.selectedSourceIndices,[0,4]);
  const last=await sharp(media.frames.at(-1)).ensureAlpha().raw().toBuffer();assert.deepEqual([...last.subarray(0,4)],[0,0,255,255]);
  const repeated=await prepareGif(fixtureGif({frames:[{pixels:[1,1,1],delay:20},{pixels:[2,2,2],delay:20},{pixels:[1,1,1],delay:20}]}));assert.equal(repeated.uniqueFrames,2);assert.equal(repeated.frames[0],repeated.frames[2]);assert.deepEqual(repeated.delays,[200,200,200]);
  assert.throws(()=>inspectGif(fixtureGif({frames:[{pixels:[1,1,1],delay:2001}]})),/20 seconds/);
  const partial=await prepareGif(fixtureGif({frames:[{pixels:[1,1,1],delay:2},{x:1,width:1,pixels:[2],delay:2,disposal:3},{x:2,width:1,pixels:[3],delay:2,disposal:2},{x:0,width:1,pixels:[2],delay:2,disposal:3},{x:2,width:1,pixels:[1],delay:2},{x:2,width:1,pixels:[3],delay:2}]}));
  assert.deepEqual(partial.selectedSourceIndices,[0,5]);assert.deepEqual(partial.delays,[100,20]);
  const expected=await sharp(Buffer.from([255,0,0,255,255,0,0,255,0,0,255,255]),{raw:{width:3,height:1,channels:4}}).resize(458,196,{fit:'cover',position:'centre'}).raw().toBuffer();
  assert.deepEqual(await sharp(partial.frames[1]).ensureAlpha().raw().toBuffer(),expected);
});

test('temporary page files are removed when encoding fails and cache paths reject traversal and links',async()=>{
  const root=await mkdtemp(join(tmpdir(),'png-failure-'));try{
    await assert.rejects(prepareGif(fixtureGif(),undefined,{temporaryRoot:root,onFrame:async()=>{throw new Error('synthetic write failure');}}),/synthetic/);assert.deepEqual(await readdir(root),[]);
    const store=new PreparedMediaStore({root:join(root,'cache')});assert.throws(()=>store.child('../escape'),/Unsafe/);await assert.rejects(store.lookup('not-a-hash'),/identity/);
    // Junctions on Windows can be created without administrator symlink privileges.
    await symlink(root,join(root,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(new PreparedMediaStore({root:join(root,'linked')}).initialize(),/Unsafe/);
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});

test('cache ownership refuses another live process and shutdown releases it while preserving prepared media',async()=>{
  const f=await fixture();try{
    const input=fixtureGif(),key=hash(input);await f.preparer.prepare(input,key);
    const module=new URL('../plugin/prepared-media-store.js',import.meta.url).href;
    const code=`import {PreparedMediaStore} from ${JSON.stringify(module)};try{await new PreparedMediaStore({root:${JSON.stringify(f.store.root)}}).initialize();process.exitCode=1;}catch(error){if(!error.message.includes('another plugin process'))throw error;}`;
    const child=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8',timeout:10000});assert.equal(child.status,0,child.stderr);
    await f.preparer.shutdown();assert.equal((await readdir(f.store.root)).includes('.owner.json'),false);
    const restored=await f.preparer.prepare(input,key);assert.ok(await restored.getFrame(0));assert.equal(f.preparer.stats.prepares,1);
  }finally{await f.close();}
});

test('detailed posters larger than metadata allowance stay in the binary pack, not serialized JSON',async()=>{
  const f=await fixture();try{
    let seed=1;const pixels=Buffer.alloc(458*196*3);for(let i=0;i<pixels.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels[i]=seed>>>24;}
    const input=await sharp(pixels,{raw:{width:458,height:196,channels:3}}).gif({colours:256,dither:0,effort:1}).toBuffer(),key=hash(input),media=await f.preparer.prepare(input,key);
    assert.ok(media.dataUri.length>128*1024);const encoded=await readFile(join(f.store.root,key,'metadata.json'));assert.ok(encoded.length<128*1024);assert.equal(JSON.parse(encoded).dataUri,undefined);assert.ok(await media.getFrame(0));
  }finally{await f.close();}
});
