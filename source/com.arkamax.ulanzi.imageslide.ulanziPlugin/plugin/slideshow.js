import { lstatSync, readdirSync, watch } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { loadSlide } from "./images.js";

export const PLUGIN_UUID = "com.arkamax.ulanzi.imageslide";
export const ACTION_UUID = `${PLUGIN_UUID}.slideshow`;
export const MIN_INTERVAL_SECONDS = 5;
export const RESCAN_INTERVAL_MS = 5000;
export const WATCH_DEBOUNCE_MS = 350;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const TEMP_SUFFIXES = [".tmp", ".temp", ".part", ".crdownload", ".download"];

export function loadConfiguration(root) {
  const slides = ["sample-blue.svg", "sample-sunset.svg"].map((name) => loadSlide(join(root, "slides", name)));
  return { defaults: { folderPath: "", intervalSeconds: 10, loop: true, sort: "name" }, fallbackSlides: slides };
}

export function normalizeSettings(value, defaults = { folderPath: "", intervalSeconds: 10, loop: true, sort: "name" }) {
  const raw = value && typeof value === "object" ? value : {};
  const intervalSeconds = Number(raw.intervalSeconds ?? defaults.intervalSeconds);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS || intervalSeconds > 86400) throw new Error(`Interval must be between ${MIN_INTERVAL_SECONDS} and 86400 seconds.`);
  if (raw.loop !== undefined && typeof raw.loop !== "boolean") throw new Error("Loop must be true or false.");
  const sort = raw.sort ?? defaults.sort;
  if (!new Set(["name", "date"]).has(sort)) throw new Error("Sort must be name or date.");
  const folderPath = raw.folderPath ?? defaults.folderPath;
  if (typeof folderPath !== "string" || folderPath.length > 32767 || folderPath.includes("\0")) throw new Error("Folder path is invalid.");
  return { folderPath, intervalSeconds, loop: raw.loop ?? defaults.loop, sort };
}

export function eligibleName(name) {
  if (!name || name.startsWith(".") || name.startsWith("~") || name.endsWith("~")) return false;
  const lower = name.toLowerCase();
  if (TEMP_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return false;
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTENSIONS.has(lower.slice(dot));
}

export function enumerateFolder(folderPath, sort = "name", fsApi = { lstatSync, readdirSync }) {
  if (!folderPath || !isAbsolute(folderPath)) throw new Error("Select an absolute folder path.");
  const rootInfo = fsApi.lstatSync(folderPath);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Selected path must be a real directory, not a link.");
  const candidates = [];
  for (const entry of fsApi.readdirSync(folderPath, { withFileTypes: true })) {
    if (!entry.isFile() || entry.isSymbolicLink?.() || !eligibleName(entry.name) || basename(entry.name) !== entry.name) continue;
    const file = join(folderPath, entry.name);
    try {
      const info = fsApi.lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink()) continue;
      candidates.push({ file, name: entry.name, modifiedMs: info.mtimeMs });
    } catch { /* A file can disappear during an atomic replace; the next rescan will see it. */ }
  }
  candidates.sort((a, b) => sort === "date"
    ? (b.modifiedMs - a.modifiedMs || compareNames(a.name, b.name))
    : compareNames(a.name, b.name));
  const slides = [], signatures = new Set(), errors = [];
  for (const item of candidates) {
    try {
      const slide = loadSlide(item.file);
      if (signatures.has(slide.signature)) continue;
      signatures.add(slide.signature); slides.push(slide);
    } catch { errors.push(item.name); }
  }
  return { slides, rejected: errors.length };
}

function compareNames(a, b) {
  const aa = a.toLowerCase(), bb = b.toLowerCase();
  return aa < bb ? -1 : aa > bb ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

export class SlideshowService {
  constructor({ client, configuration, timerApi = globalThis, now = Date.now, fsApi, watchFactory = watch, logger = console.log } = {}) {
    this.client=client; this.defaults=configuration.defaults; this.fallbackSlides=configuration.fallbackSlides;
    this.settings={...this.defaults}; this.slides=this.fallbackSlides; this.status={level:"ready",message:"Using included sample slides.",count:this.slides.length};
    this.timerApi=timerApi; this.now=now; this.fsApi=fsApi; this.watchFactory=watchFactory; this.logger=logger;
    this.contexts=new Map(); this.activeContexts=new Set(); this.inspectors=new Set(); this.lastSignature=new Map();
    this.index=0; this.timer=null; this.watcher=null; this.watchDebounce=null; this.nextSlideAt=0; this.nextRescanAt=0; this.settingsRequested=false;
  }
  bind() {
    this.client.onAdd((e)=>this.add(e)); this.client.onSetActive((e)=>this.setActive(e)); this.client.onSetactive?.((e)=>this.setActive(e));
    this.client.onClear((c)=>this.clear(c)); this.client.onSendToPlugin?.((e)=>this.fromInspector(e)); this.client.onDidReceiveGlobalSettings?.((e)=>this.receiveSettings(e));
    this.client.onClose(()=>this.close()); this.client.onError(()=>this.log("connection-error"));
  }
  accepted(event) {
    if (event?.uuid !== ACTION_UUID || !event?.context) return false;
    try { return this.client.decodeContext(event.context).key === "3_2"; } catch { return false; }
  }
  add(event) {
    if (!this.accepted(event)) { this.log("context-ignored"); return; }
    this.contexts.set(event.context,{active:true}); this.activeContexts.add(event.context); this.inspectors.add(event.context);
    if (!this.settingsRequested) { this.settingsRequested=true; this.client.getGlobalSettings?.(event.context); }
    this.render(event.context,true); this.sendStatus(event.context); this.ensureRuntime();
  }
  setActive(event) {
    if (!this.accepted(event) && !this.contexts.has(event?.context)) return;
    if (event.active) {
      this.contexts.set(event.context,{active:true}); this.activeContexts.add(event.context); this.inspectors.add(event.context);
      this.render(event.context,true); this.ensureRuntime();
    } else {
      this.activeContexts.delete(event.context); this.contexts.set(event.context,{active:false}); this.lastSignature.delete(event.context);
      if (this.activeContexts.size===0) this.stopRuntime();
    }
  }
  clear(contexts) {
    for (const context of contexts||[]) { this.activeContexts.delete(context); this.contexts.delete(context); this.inspectors.delete(context); this.lastSignature.delete(context); }
    if (this.activeContexts.size===0) this.stopRuntime();
  }
  receiveSettings(event) {
    try { this.applySettings(normalizeSettings(event?.settings, this.defaults), true); }
    catch (error) { this.setStatus("error", error.message, 0); }
  }
  fromInspector(event) {
    const context=event?.context; if (!this.accepted(event) && !this.contexts.has(context)) return;
    this.inspectors.add(context); const payload=event?.payload||{};
    if (payload.type==="requestState") { this.sendStatus(context); return; }
    if (payload.type==="refresh") { this.rescan(true); return; }
    if (payload.type!=="updateSettings") return;
    try {
      const settings=normalizeSettings(payload.settings,this.settings); this.client.setGlobalSettings?.(settings,context); this.applySettings(settings,true);
    } catch (error) { this.setStatus("error",error.message,0); }
  }
  applySettings(settings, renderNow) {
    const folderChanged=settings.folderPath!==this.settings.folderPath || settings.sort!==this.settings.sort;
    this.settings=settings; this.nextSlideAt=this.now()+settings.intervalSeconds*1000;
    if (folderChanged) { this.index=0; this.stopWatcher(); }
    this.rescan(renderNow); this.ensureRuntime(); this.broadcastStatus();
  }
  rescan(renderNow=false) {
    this.nextRescanAt=this.now()+RESCAN_INTERVAL_MS;
    if (!this.settings.folderPath) { this.useFallback("Using included sample slides.",renderNow); return; }
    try {
      const result=enumerateFolder(this.settings.folderPath,this.settings.sort,this.fsApi||undefined);
      if (!result.slides.length) { this.useFallback(result.rejected ? "No valid 458x196 images; using sample slides." : "Folder is empty; using sample slides.",renderNow); return; }
      const current=this.slides[this.index]?.signature; this.slides=result.slides;
      const retained=this.slides.findIndex((slide)=>slide.signature===current); this.index=retained>=0?retained:0;
      this.setStatus(result.rejected?"warning":"ready",result.rejected?`${result.slides.length} image(s) loaded; ${result.rejected} rejected.`:`${result.slides.length} image(s) loaded.`,result.slides.length);
      this.ensureWatcher(); if (renderNow) this.renderAll(false);
    } catch { this.useFallback("Folder unavailable; using sample slides.",renderNow,"error"); }
  }
  useFallback(message,renderNow,level="warning") { this.slides=this.fallbackSlides; this.index=Math.min(this.index,this.slides.length-1); this.setStatus(level,message,this.slides.length); this.stopWatcher(); if(renderNow)this.renderAll(false); }
  setStatus(level,message,count) { this.status={level,message,count}; this.broadcastStatus(); this.log(`status-${level}`); }
  snapshot() { return { type:"state", settings:this.settings, status:this.status }; }
  sendStatus(context) { try { this.client.sendToPropertyInspector?.(this.snapshot(),context); } catch { this.log("inspector-send-error"); } }
  broadcastStatus() { for (const context of this.inspectors) this.sendStatus(context); }
  currentSlide() { return this.slides[this.index]||this.fallbackSlides[0]; }
  render(context,force=false) {
    const slide=this.currentSlide(); if(!slide)return;
    if(!force && this.lastSignature.get(context)===slide.signature)return;
    try { this.client.setBaseDataIcon(context,slide.dataUri,""); this.lastSignature.set(context,slide.signature); this.log("render",slide.name); }
    catch { this.log("render-error"); }
  }
  renderAll(force=false) { for(const context of this.activeContexts)this.render(context,force); }
  tick() {
    const time=this.now();
    if(time>=this.nextRescanAt)this.rescan(false);
    if(time<this.nextSlideAt)return;
    this.nextSlideAt=time+this.settings.intervalSeconds*1000;
    const last=this.slides.length-1;
    if(this.index>=last&&!this.settings.loop)return;
    this.index=this.index>=last?0:this.index+1; this.renderAll(false);
  }
  ensureRuntime() {
    if(this.activeContexts.size===0)return; this.ensureWatcher();
    if(!this.nextRescanAt)this.nextRescanAt=this.now()+RESCAN_INTERVAL_MS;
    if(!this.nextSlideAt)this.nextSlideAt=this.now()+this.settings.intervalSeconds*1000;
    if(!this.timer)this.timer=this.timerApi.setInterval(()=>this.tick(),1000);
  }
  ensureWatcher() {
    if(this.watcher||!this.settings.folderPath||this.status.count===0||this.slides===this.fallbackSlides)return;
    try { this.watcher=this.watchFactory(this.settings.folderPath,{persistent:false},()=>this.queueRescan()); this.watcher.on?.("error",()=>this.queueRescan()); }
    catch { this.watcher=null; }
  }
  queueRescan() {
    if(this.watchDebounce)this.timerApi.clearTimeout(this.watchDebounce);
    this.watchDebounce=this.timerApi.setTimeout(()=>{this.watchDebounce=null;this.rescan(true);},WATCH_DEBOUNCE_MS);
  }
  stopWatcher() { try{this.watcher?.close();}catch{} this.watcher=null; if(this.watchDebounce)this.timerApi.clearTimeout(this.watchDebounce); this.watchDebounce=null; }
  stopRuntime() { if(this.timer)this.timerApi.clearInterval(this.timer); this.timer=null; this.nextSlideAt=0; this.nextRescanAt=0; this.stopWatcher(); }
  close() { this.stopRuntime(); this.activeContexts.clear(); this.contexts.clear(); this.inspectors.clear(); this.lastSignature.clear(); }
  log(event,slide="") { const safe=/^[A-Za-z0-9._-]{1,128}$/.test(slide)?slide:""; this.logger(`[imageslide] ${JSON.stringify({event,slide:safe,active:this.activeContexts.size})}`); }
}
