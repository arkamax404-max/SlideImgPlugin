import os from "node:os";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";

export const SYSTEM_REFRESH_MS = 2000;
const execFile = promisify(execFileCallback);

function cpuSnapshot(cpus) {
  let idle=0,total=0;
  for(const cpu of cpus||[])for(const [name,value] of Object.entries(cpu.times||{})){total+=value;if(name==="idle")idle+=value}
  return {idle,total};
}

function percentage(value) {
  return Math.max(0,Math.min(100,Number(value)));
}

function parseMacGpu(output) {
  const direct=/"Device Utilization %"\s*=\s*(\d+(?:\.\d+)?)/.exec(output)?.[1];
  if(direct!==undefined)return percentage(direct);
  const scaled=/"GPU Core Utilization"\s*=\s*(\d+(?:\.\d+)?)/.exec(output)?.[1];
  if(scaled===undefined)return null;
  const value=Number(scaled);return percentage(value>100?value/100000:value);
}

export class SystemMonitor {
  constructor({osApi=os,platform=process.platform,execFileImpl=execFile}={}){this.osApi=osApi;this.platform=platform;this.execFile=execFileImpl;this.previous=cpuSnapshot(osApi.cpus())}
  cpuUsage(){const current=cpuSnapshot(this.osApi.cpus()),total=current.total-this.previous.total,idle=current.idle-this.previous.idle;this.previous=current;return total>0?percentage((1-idle/total)*100):0}
  async gpuUsage(){
    try{
      if(this.platform==="win32"){
        const script="$v=Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop|Where-Object{$_.Name -match 'engtype_3D'}|Measure-Object -Property UtilizationPercentage -Maximum;if($null-ne$v.Maximum){[Console]::Write([double]$v.Maximum)}";
        const {stdout}=await this.execFile("powershell.exe",["-NoProfile","-Command",script],{windowsHide:true,timeout:3000,maxBuffer:65536}),text=String(stdout).trim();if(!text)return null;const value=Number(text);return Number.isFinite(value)?percentage(value):null;
      }
      if(this.platform==="darwin"){
        for(const type of ["IOAccelerator","AGXAccelerator"]){try{const {stdout}=await this.execFile("ioreg",["-r","-d","1","-w","0","-c",type],{timeout:3000,maxBuffer:262144});const value=parseMacGpu(String(stdout));if(value!==null)return value}catch{}}
      }
    }catch{}
    return null;
  }
  async sample(){const total=Number(this.osApi.totalmem()),free=Number(this.osApi.freemem()),used=Math.max(0,total-free);return{cpu:this.cpuUsage(),gpu:await this.gpuUsage(),ram:total>0?percentage(used/total*100):0,ramUsed:used,ramTotal:Math.max(0,total),sampledAt:Date.now()}}
}

function card(x,label,value,color,detail="") {
  const available=Number.isFinite(value),display=available?`${Math.round(value)}%`:"N/A",bar=available?Math.round(118*percentage(value)/100):0;
  return `<g><rect x="${x}" y="43" width="142" height="139" rx="14" fill="#ffffff" fill-opacity=".08"/><text x="${x+71}" y="70" fill="#dbeafe" font-family="Arial, sans-serif" font-size="20" font-weight="700" text-anchor="middle">${label}</text><text x="${x+71}" y="125" fill="${color}" font-family="Arial, sans-serif" font-size="43" font-weight="700" text-anchor="middle">${display}</text><rect x="${x+12}" y="142" width="118" height="10" rx="5" fill="#0b1425"/><rect x="${x+12}" y="142" width="${bar}" height="10" rx="5" fill="${color}"/><text x="${x+71}" y="171" fill="#b9d7f5" font-family="Arial, sans-serif" font-size="14" font-weight="700" text-anchor="middle">${detail}</text></g>`;
}

export async function renderSystemSlide(metrics) {
  const gib=1024**3,ramDetail=metrics.ramTotal?`${(metrics.ramUsed/gib).toFixed(1)} / ${(metrics.ramTotal/gib).toFixed(1)} GB`:"Memory",gpuDetail=Number.isFinite(metrics.gpu)?"Utilization":"Not available";
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="458" height="196" viewBox="0 0 458 196"><defs><linearGradient id="system-bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#121d35"/><stop offset="1" stop-color="#243d63"/></linearGradient></defs><rect width="458" height="196" rx="16" fill="url(#system-bg)"/><text x="14" y="29" fill="#f8fafc" font-family="Arial, sans-serif" font-size="20" font-weight="700">System resources</text><text x="444" y="28" fill="#8facce" font-family="Arial, sans-serif" font-size="12" text-anchor="end">Updated every 2 seconds</text>${card(10,"CPU",metrics.cpu,"#60a5fa","Processor")}${card(158,"GPU",metrics.gpu,"#c084fc",gpuDetail)}${card(306,"RAM",metrics.ram,"#4ade80",ramDetail)}</svg>`;
  const png=await sharp(Buffer.from(svg),{density:144}).resize(458,196).png({compressionLevel:9}).toBuffer();
  return{name:"system",dataUri:`data:image/png;base64,${png.toString("base64")}`,signature:`system:${Math.round(metrics.cpu)}:${Number.isFinite(metrics.gpu)?Math.round(metrics.gpu):"na"}:${Math.round(metrics.ram)}:${Math.floor(metrics.sampledAt/SYSTEM_REFRESH_MS)}`};
}
