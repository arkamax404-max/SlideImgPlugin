import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const GIF_LIMITS = Object.freeze({inputBytes:16*1024*1024,dimension:2048,frames:600,decodedPixels:64_000_000,outputPixels:64_000_000,outputBytes:64*1024*1024,cacheBytes:4*1024*1024,queuedJobs:2,timeoutMs:30000,durationMs:20000,temporaryBytes:272*1024*1024});
const WIDTH=458, HEIGHT=196;

// Validate structural bounds before any native decoder sees the frame stack.
// LZW decoding and disposal/partial-frame compositing are deliberately delegated to libvips.
export function inspectGif(input, limits=GIF_LIMITS) {
  const b=Buffer.isBuffer(input)?input:Buffer.from(input.buffer,input.byteOffset,input.byteLength);
  if (!b.length || b.length>limits.inputBytes) throw new Error('GIF exceeds 16 MiB compressed limit');
  if (b.length<14 || !['GIF87a','GIF89a'].includes(b.toString('ascii',0,6))) throw new Error('File is not GIF content');
  const width=b.readUInt16LE(6),height=b.readUInt16LE(8);
  if (!width||!height||width>limits.dimension||height>limits.dimension) throw new Error('GIF dimensions exceed 2048 per side');
  let pos=13,frames=0,loop=1,delays=[],delay=0;
  function requireBytes(n) {if(pos+n>b.length)throw new Error('Truncated GIF');}
  function blocks(collect=false) { const parts=[];let captured=0;while(true){requireBytes(1);const size=b[pos++];if(!size)break;requireBytes(size);if(collect&&captured<32){const take=Math.min(size,32-captured);parts.push(b.subarray(pos,pos+take));captured+=take;}pos+=size;}return collect?Buffer.concat(parts):null; }
  if(b[10]&128){const bytes=3*(2**((b[10]&7)+1));requireBytes(bytes);pos+=bytes;}
  while(pos<b.length){
    const marker=b[pos++];
    if(marker===0x3b){
      if(!frames || pos!==b.length)throw new Error('Invalid GIF trailer');
      const durationMs=delays.reduce((sum,value)=>sum+(value>0?value:100),0);
      if(durationMs>limits.durationMs)throw new Error('GIF cycle exceeds 20 seconds; choose a shorter clip');
      return {width,height,frames,loop,delays,durationMs};
    }
    if(marker===0x21){
      requireBytes(1);const label=b[pos++];
      const payload=blocks(label===0xf9||label===0xff);
      if(label===0xf9){if(payload.length!==4)throw new Error('Invalid GIF frame control');delay=payload.readUInt16LE(1)*10;}
      if(label===0xff && /^(NETSCAPE2\.0|ANIMEXTS1\.0)/.test(payload.toString('ascii',0,11)) && payload.length>=14 && payload[11]===1){const repeats=payload.readUInt16LE(12);loop=repeats===0?0:repeats+1;}
      continue;
    }
    if(marker!==0x2c)throw new Error('Invalid GIF block');
    requireBytes(9);
    const x=b.readUInt16LE(pos),y=b.readUInt16LE(pos+2),w=b.readUInt16LE(pos+4),h=b.readUInt16LE(pos+6),packed=b[pos+8];pos+=9;
    if(!w||!h||x+w>width||y+h>height)throw new Error('GIF partial frame exceeds canvas');
    frames++;if(frames>limits.frames || frames*width*height>limits.decodedPixels || frames*WIDTH*HEIGHT>limits.outputPixels)throw new Error('GIF frame count or decoded pixel budget exceeded');
    delays.push(delay);delay=0;
    if(packed&128){const bytes=3*(2**((packed&7)+1));requireBytes(bytes);pos+=bytes;}
    requireBytes(1);const codeSize=b[pos++];if(codeSize<2||codeSize>8)throw new Error('Invalid GIF LZW code size');blocks();
  }
  throw new Error('Truncated GIF: missing trailer');
}

// Sampling happens AFTER native disposal/partial-frame compositing. It preserves
// total cycle time and keeps the terminal source frame for finite playback.
export function playbackPlan(source){
  const effective=source.delays.map(value=>value>0?value:100);
  if(effective.every(value=>value>=100))return effective.map((delay,index)=>({sourceFrame:index,delay}));
  const ends=[];let total=0;for(const delay of effective){total+=delay;ends.push(total);}
  const points=[];let index=0;
  for(let time=0;time<total;time+=100){while(index<ends.length-1&&time>=ends[index])index++;points.push({time,sourceFrame:index});}
  const lastStart=total-effective.at(-1);
  if(points.at(-1).sourceFrame!==effective.length-1){if(points.at(-1).time===lastStart)points.pop();points.push({time:lastStart,sourceFrame:effective.length-1});points.sort((a,b)=>a.time-b.time);}
  const plan=[];
  for(let i=0;i<points.length;i++){const delay=(points[i+1]?.time??total)-points[i].time;if(plan.at(-1)?.sourceFrame===points[i].sourceFrame)plan.at(-1).delay+=delay;else plan.push({sourceFrame:points[i].sourceFrame,delay});}
  return plan;
}

export async function describeGif(input,limits=GIF_LIMITS){
  const buffer=Buffer.isBuffer(input)?input:Buffer.from(input.buffer,input.byteOffset,input.byteLength),source=inspectGif(buffer,limits);
  const image=sharp(buffer,{pages:1,limitInputPixels:limits.decodedPixels,failOn:'warning'}).timeout({seconds:10});
  const metadata=await image.metadata();
  if(metadata.format!=='gif'||(metadata.pages||1)!==source.frames||metadata.width!==source.width||(metadata.pageHeight||metadata.height)!==source.height)throw new Error('GIF decoded metadata mismatch');
  const png=await image.resize(WIDTH,HEIGHT,{fit:'cover',position:'centre'}).png({compressionLevel:6,adaptiveFiltering:true}).toBuffer();
  return {kind:'gif',dataUri:`data:image/png;base64,${png.toString('base64')}`,sourceFrames:source.frames,durationMs:source.durationMs,loop:source.loop,resized:source.width!==WIDTH||source.height!==HEIGHT,retainedBytes:Math.ceil(png.length*4/3)+1024};
}

export async function prepareGif(input,limits=GIF_LIMITS,{temporaryRoot,onFrame}={}){
  const buffer=Buffer.isBuffer(input)?input:Buffer.from(input.buffer,input.byteOffset,input.byteLength),source=inspectGif(buffer,limits),plan=playbackPlan(source);
  const root=await mkdtemp(join(temporaryRoot||tmpdir(),'gif-pages-')),file=join(root,'composited.tiff');
  const frames=[],delays=[],indices=[],unique=new Map();let outputBytes=0;
  try {
    // Sharp stream output still returns a complete buffer. A native file sink
    // avoids materializing a source/normalized RGBA stack in JavaScript. Resize
    // each TIFF page separately: animated-stack interpolation bleeds at edges.
    await sharp(buffer,{animated:true,sequentialRead:true,limitInputPixels:limits.decodedPixels,failOn:'warning'}).timeout({seconds:20})
      .ensureAlpha().tiff({compression:'none'}).toFile(file);
    if((await stat(file)).size>limits.temporaryBytes)throw new Error('GIF temporary storage budget exceeded');
    const metadata=await sharp(file,{animated:true}).metadata();
    if((metadata.pages||1)!==source.frames||metadata.width!==source.width||(metadata.pageHeight||metadata.height)!==source.height)throw new Error('GIF composited page metadata mismatch');
    for(const item of plan){
      const raw=await sharp(file,{page:item.sourceFrame,pages:1,failOn:'warning'}).timeout({seconds:10}).ensureAlpha()
        .resize(WIDTH,HEIGHT,{fit:'cover',position:'centre'}).raw().toBuffer();
      if(raw.length!==WIDTH*HEIGHT*4)throw new Error('GIF frame dimensions mismatch');
      const pixelHash=createHash('sha256').update(raw).digest('hex');
      let entry=unique.get(pixelHash);
      if(!entry){const png=await sharp(raw,{raw:{width:WIDTH,height:HEIGHT,channels:4}}).png({compressionLevel:6,adaptiveFiltering:true}).toBuffer();outputBytes+=png.length;
        if(outputBytes>limits.outputBytes)throw new Error('Prepared GIF exceeds 64 MiB');
        entry={frame:onFrame?await onFrame(png):png,pixelHash};unique.set(pixelHash,entry);
      }
      if(indices.length&&unique.get(pixelHash).pixelHash===frames.at(-1)?.pixelHash){delays[delays.length-1]+=item.delay;continue;}
      frames.push(entry);delays.push(item.delay);indices.push(item.sourceFrame);
    }
    const result={kind:'gif',frames:frames.map(entry=>entry.frame),delays,loop:source.loop,width:WIDTH,height:HEIGHT,sourceFrames:source.frames,uniqueFrames:unique.size,durationMs:source.durationMs,selectedSourceIndices:indices,preparedBytes:outputBytes,resized:source.width!==WIDTH||source.height!==HEIGHT};
    if(!onFrame)result.dataUri=`data:image/png;base64,${Buffer.from(result.frames[0]).toString('base64')}`;
    return result;
  }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
