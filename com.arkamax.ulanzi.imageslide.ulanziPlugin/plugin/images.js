import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import { extname } from "node:path";
import sharp from "sharp";
import { mediaPreparer } from './media-preparer.js';

export const WIDTH = 458;
export const HEIGHT = 196;
const MIME = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".svg", "image/svg+xml"]]);
const MAX_INPUT_PIXELS = 40_000_000;

export function pngDimensions(buffer) {
  const sig = Buffer.from([137,80,78,71,13,10,26,10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(sig) || buffer.toString("ascii", 12, 16) !== "IHDR") throw new Error("Invalid PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function jpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) throw new Error("Invalid JPEG");
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) break;
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length < 7) break;
      return { height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  throw new Error("JPEG dimensions not found");
}

export function svgDimensions(buffer) {
  const head = buffer.toString("utf8", 0, Math.min(buffer.length, 8192));
  if (!/<svg\b/i.test(head)) throw new Error("Invalid SVG");
  const width = /\bwidth=["']\s*(\d+(?:\.\d+)?)\s*(?:px)?["']/i.exec(head)?.[1];
  const height = /\bheight=["']\s*(\d+(?:\.\d+)?)\s*(?:px)?["']/i.exec(head)?.[1];
  if (width && height) return { width: Number(width), height: Number(height) };
  const viewBox = /\bviewBox=["']\s*[-+\d.]+\s+[-+\d.]+\s+([-+\d.]+)\s+([-+\d.]+)\s*["']/i.exec(head);
  if (viewBox) return { width: Number(viewBox[1]), height: Number(viewBox[2]) };
  throw new Error("SVG dimensions not found");
}

export async function readMedia(file) {
    const before=await lstat(file);
    if(!before.isFile()||before.isSymbolicLink()||!before.size||before.size>(extname(file).toLowerCase()==='.gif'?16:8)*1024*1024)throw new Error('Media must be a real file within the 8 MiB static / 16 MiB GIF limit');
    const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    let buffer;
    try{
      const stat=await handle.stat();
      if(!stat.isFile()||stat.ino!==before.ino||stat.dev!==before.dev||stat.size!==before.size)throw new Error('Media changed while opening; refresh again');
      buffer=Buffer.alloc(stat.size);let offset=0;
      while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,offset);if(!bytesRead)throw new Error('Media changed while reading');offset+=bytesRead;}
      const after=await handle.stat(),pathAfter=await lstat(file);
      if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ctimeMs!==stat.ctimeMs||pathAfter.isSymbolicLink()||pathAfter.ino!==stat.ino)throw new Error('Media changed while reading; refresh again');
    }finally{await handle.close();}
    return {buffer,info:before};
}

export async function loadSlide(file,{preparer=mediaPreparer}={}) {
  const extension = extname(file).toLowerCase();
  const {buffer,info}=await readMedia(file);
  const signature=createHash('sha256').update(buffer).digest('hex');
  if(extension === '.gif') {
    const described=await preparer.describe(buffer,signature,{transfer:true});
    return {...described,signature,name:file.split(/[\\/]/).pop(),modifiedMs:info.mtimeMs,prepare:async()=>{
      const cached=await preparer.store.lookup(signature);if(cached)return cached;
      const fresh=await readMedia(file);if(createHash('sha256').update(fresh.buffer).digest('hex')!==signature)throw new Error('GIF changed during preparation; refresh the folder');
      return preparer.prepare(fresh.buffer,signature,{transfer:true});
    }};
  }
  const mime = MIME.get(extension);
  if (!mime) throw new Error("Unsupported image type");
  const dimensions = extension === ".png" ? pngDimensions(buffer) : (extension === ".jpg" || extension === ".jpeg") ? jpegDimensions(buffer) : svgDimensions(buffer);
  if (!Number.isFinite(dimensions.width) || !Number.isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0 || dimensions.width * dimensions.height > MAX_INPUT_PIXELS) throw new Error("Image dimensions are unsafe");
  const resized = dimensions.width !== WIDTH || dimensions.height !== HEIGHT;
  const output = resized
    ? await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "warning" }).rotate().resize(WIDTH, HEIGHT, { fit: "cover", position: "centre" }).png({ compressionLevel: 9 }).toBuffer()
    : buffer;
  const outputMime = resized ? "image/png" : mime;
  return { name: file.split(/[\\/]/).pop(), dataUri: `data:${outputMime};base64,${output.toString("base64")}`, signature, modifiedMs: info.mtimeMs, resized };
}
