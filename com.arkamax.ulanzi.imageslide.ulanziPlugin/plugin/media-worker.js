import {parentPort} from 'node:worker_threads';
import {prepareGif,describeGif} from './gif-media.js';
import {open} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
sharp.concurrency(1);sharp.cache(false);
parentPort.on('message',async ({kind,buffer,stagePath,limits})=>{
  try{
    if(kind==='describe'){parentPort.postMessage({media:await describeGif(buffer,limits)});return;}
    const handle=await open(join(stagePath,'frames.dat'),'wx',0o600);let offset=0;
    try{const media=await prepareGif(buffer,limits,{temporaryRoot:stagePath,onFrame:async png=>{const frame={offset,size:png.length,hash:createHash('sha256').update(png).digest('hex')};let written=0;while(written<png.length){const result=await handle.write(png,written,png.length-written,offset+written);if(!result.bytesWritten)throw new Error('Could not write prepared frame');written+=result.bytesWritten;}offset+=png.length;return frame;}});await handle.sync();parentPort.postMessage({media});}finally{await handle.close();}
  }catch(error){parentPort.postMessage({error:error.message});}
});
