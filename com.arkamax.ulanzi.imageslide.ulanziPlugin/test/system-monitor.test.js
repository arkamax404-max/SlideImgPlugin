import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { SYSTEM_REFRESH_MS, SystemMonitor, renderSystemSlide } from "../plugin/system-monitor.js";

function osFixture(){let call=0;return{cpus(){call++;return[{times:call===1?{user:100,idle:100}:{user:150,idle:110}}]},totalmem(){return 16*1024**3},freemem(){return 4*1024**3}}}

test("system monitor calculates portable CPU/RAM and Windows GPU utilization",async()=>{
  const calls=[],monitor=new SystemMonitor({osApi:osFixture(),platform:"win32",execFileImpl:async(file,args,options)=>{calls.push({file,args,options});return{stdout:"42.5"}}}),sample=await monitor.sample();
  assert.ok(Math.abs(sample.cpu-83.333)<0.01);assert.equal(sample.ram,75);assert.equal(sample.ramUsed,12*1024**3);assert.equal(sample.gpu,42.5);assert.equal(calls[0].file,"powershell.exe");assert.equal(calls[0].options.timeout,3000);assert.match(calls[0].args.at(-1),/GPUEngine/);assert.equal(SYSTEM_REFRESH_MS,2000);
});

test("macOS GPU probing supports scaled IOAccelerator values and degrades to N/A",async()=>{
  const mac=new SystemMonitor({osApi:osFixture(),platform:"darwin",execFileImpl:async()=>({stdout:'"GPU Core Utilization" = 2500000'})});assert.equal(await mac.gpuUsage(),25);
  const unavailable=new SystemMonitor({osApi:osFixture(),platform:"darwin",execFileImpl:async()=>{throw Error("unsupported")}});assert.equal(await unavailable.gpuUsage(),null);
});

test("system resource screen uses the weather card language and renders a flat D200 PNG",async()=>{
  const slide=await renderSystemSlide({cpu:37.4,gpu:null,ram:62.2,ramUsed:10*1024**3,ramTotal:16*1024**3,sampledAt:1000});assert.match(slide.dataUri,/^data:image\/png;base64,/);assert.match(slide.signature,/system:37:na:62/);
  const metadata=await sharp(Buffer.from(slide.dataUri.split(",",2)[1],"base64")).metadata();assert.equal(metadata.width,458);assert.equal(metadata.height,196);
});
