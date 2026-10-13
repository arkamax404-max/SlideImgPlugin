// Original synthetic media, no third-party GIFs. A deliberately simple reset-every-pixel LZW encoder.
export function fixtureGif({width=3,height=1,frames=[{pixels:[1,1,1],delay:20},{pixels:[2,2,2],delay:40}],loop=0}={}){
  const chunks=[Buffer.from('GIF89a','ascii')];
  const screen=Buffer.alloc(7);screen.writeUInt16LE(width,0);screen.writeUInt16LE(height,2);screen[4]=0x81;chunks.push(screen,Buffer.from([0,0,0,255,0,0,0,255,0,0,0,255]));
  if(loop!==null){const app=Buffer.from([0x21,0xff,11,...Buffer.from('NETSCAPE2.0'),3,1,0,0,0]);app.writeUInt16LE(loop,16);chunks.push(app);}
  for(const f of frames){
    const gce=Buffer.from([0x21,0xf9,4,((f.disposal??1)<<2)|1,0,0,0,0]);gce.writeUInt16LE(f.delay??0,4);chunks.push(gce);
    const descriptor=Buffer.alloc(10);descriptor[0]=0x2c;descriptor.writeUInt16LE(f.x??0,1);descriptor.writeUInt16LE(f.y??0,3);descriptor.writeUInt16LE(f.width??width,5);descriptor.writeUInt16LE(f.height??height,7);chunks.push(descriptor,Buffer.from([2]));
    const codes=f.pixels.flatMap(p=>[4,p]);codes.push(5);let bits=0,count=0,bytes=[];
    for(const code of codes){bits|=code<<count;count+=3;while(count>=8){bytes.push(bits&255);bits>>>=8;count-=8;}}if(count)bytes.push(bits&255);
    for(let i=0;i<bytes.length;i+=255){const part=bytes.slice(i,i+255);chunks.push(Buffer.from([part.length,...part]));}chunks.push(Buffer.from([0]));
  }
  chunks.push(Buffer.from([0x3b]));return Buffer.concat(chunks);
}
