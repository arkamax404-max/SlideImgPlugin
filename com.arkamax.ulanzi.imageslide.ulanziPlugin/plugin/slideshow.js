import { lstatSync, readdirSync, watch } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { loadSlide } from "./images.js";
import { WEATHER_REFRESH_MS, WEATHER_RETRY_MS, createWeatherSlide, fetchWeatherForecast, renderWeatherSlide } from "./weather.js";
import { SYSTEM_REFRESH_MS, SystemMonitor, renderSystemSlide } from "./system-monitor.js";

export const PLUGIN_UUID = "com.arkamax.ulanzi.imageslide";
export const ACTION_UUID = `${PLUGIN_UUID}.slideshow`;
export const MIN_INTERVAL_SECONDS = 5;
export const RESCAN_INTERVAL_MS = 5000;
export const WATCH_DEBOUNCE_MS = 350;
export const MAX_DATE_TIME_FREQUENCY = 10000;
export const MAX_DATE_TIME_DURATION_SECONDS = 3600;
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".svg"]);
const TEMP_SUFFIXES = [".tmp", ".temp", ".part", ".crdownload", ".download"];
const DEFAULT_SETTINGS = { folderPath: "", intervalSeconds: 10, loop: true, sort: "name", showImages: true, showDateTime: false, dateTimeEverySlides: 5, dateTimeDurationSeconds: 5, dateFormat: "system", showWeather: false, weatherApiKey: "", weatherLocation: "", weatherUnits: "c", weatherEverySlides: 5, weatherDurationSeconds: 8, showSystemStats: false, systemEverySlides: 5, systemDurationSeconds: 5 };

export async function loadConfiguration(root) {
  const slides = await Promise.all(["sample-blue.svg", "sample-sunset.svg"].map((name) => loadSlide(join(root, "slides", name))));
  return { defaults: { ...DEFAULT_SETTINGS }, fallbackSlides: slides };
}

export function normalizeSettings(value, defaults = DEFAULT_SETTINGS) {
  const raw = value && typeof value === "object" ? value : {};
  const intervalSeconds = Number(raw.intervalSeconds ?? defaults.intervalSeconds);
  if (!Number.isFinite(intervalSeconds) || intervalSeconds < MIN_INTERVAL_SECONDS || intervalSeconds > 86400) throw new Error(`Interval must be between ${MIN_INTERVAL_SECONDS} and 86400 seconds.`);
  if (raw.loop !== undefined && typeof raw.loop !== "boolean") throw new Error("Loop must be true or false.");
  if (raw.showImages !== undefined && typeof raw.showImages !== "boolean") throw new Error("Show images must be true or false.");
  if (raw.showDateTime !== undefined && typeof raw.showDateTime !== "boolean") throw new Error("Show date and time must be true or false.");
  if (raw.dateTimeOnly !== undefined && typeof raw.dateTimeOnly !== "boolean") throw new Error("Date and time only must be true or false.");
  if (raw.showWeather !== undefined && typeof raw.showWeather !== "boolean") throw new Error("Show weather must be true or false.");
  if (raw.weatherOnly !== undefined && typeof raw.weatherOnly !== "boolean") throw new Error("Weather only must be true or false.");
  if (raw.showSystemStats !== undefined && typeof raw.showSystemStats !== "boolean") throw new Error("Show system resources must be true or false.");
  const dateTimeEverySlides = Number(raw.dateTimeEverySlides ?? defaults.dateTimeEverySlides ?? DEFAULT_SETTINGS.dateTimeEverySlides);
  if (!Number.isInteger(dateTimeEverySlides) || dateTimeEverySlides < 1 || dateTimeEverySlides > MAX_DATE_TIME_FREQUENCY) throw new Error(`Date and time frequency must be between 1 and ${MAX_DATE_TIME_FREQUENCY} slides.`);
  const dateTimeDurationSeconds = Number(raw.dateTimeDurationSeconds ?? defaults.dateTimeDurationSeconds ?? DEFAULT_SETTINGS.dateTimeDurationSeconds);
  if (!Number.isInteger(dateTimeDurationSeconds) || dateTimeDurationSeconds < 1 || dateTimeDurationSeconds > MAX_DATE_TIME_DURATION_SECONDS) throw new Error(`Date and time duration must be between 1 and ${MAX_DATE_TIME_DURATION_SECONDS} seconds.`);
  const sort = raw.sort ?? defaults.sort;
  if (!new Set(["name", "date"]).has(sort)) throw new Error("Sort must be name or date.");
  const dateFormat = raw.dateFormat ?? defaults.dateFormat ?? DEFAULT_SETTINGS.dateFormat;
  if (!new Set(["system", "dmy", "mdy"]).has(dateFormat)) throw new Error("Date format must be system, dmy, or mdy.");
  const weatherApiKey = raw.weatherApiKey ?? defaults.weatherApiKey ?? "";
  if (typeof weatherApiKey !== "string" || weatherApiKey.length > 256 || weatherApiKey.includes("\0")) throw new Error("WeatherAPI key is invalid.");
  const weatherLocation = raw.weatherLocation ?? defaults.weatherLocation ?? "";
  if (typeof weatherLocation !== "string" || weatherLocation.length > 200 || weatherLocation.includes("\0")) throw new Error("Weather location is invalid.");
  const weatherUnits = raw.weatherUnits ?? defaults.weatherUnits ?? DEFAULT_SETTINGS.weatherUnits;
  if (!new Set(["c", "f"]).has(weatherUnits)) throw new Error("Weather units must be Celsius or Fahrenheit.");
  const weatherEverySlides = Number(raw.weatherEverySlides ?? defaults.weatherEverySlides ?? DEFAULT_SETTINGS.weatherEverySlides);
  if (!Number.isInteger(weatherEverySlides) || weatherEverySlides < 1 || weatherEverySlides > MAX_DATE_TIME_FREQUENCY) throw new Error(`Weather frequency must be between 1 and ${MAX_DATE_TIME_FREQUENCY} slides.`);
  const weatherDurationSeconds = Number(raw.weatherDurationSeconds ?? defaults.weatherDurationSeconds ?? DEFAULT_SETTINGS.weatherDurationSeconds);
  if (!Number.isInteger(weatherDurationSeconds) || weatherDurationSeconds < 1 || weatherDurationSeconds > MAX_DATE_TIME_DURATION_SECONDS) throw new Error(`Weather duration must be between 1 and ${MAX_DATE_TIME_DURATION_SECONDS} seconds.`);
  const systemEverySlides = Number(raw.systemEverySlides ?? defaults.systemEverySlides ?? DEFAULT_SETTINGS.systemEverySlides);
  if (!Number.isInteger(systemEverySlides) || systemEverySlides < 1 || systemEverySlides > MAX_DATE_TIME_FREQUENCY) throw new Error(`System frequency must be between 1 and ${MAX_DATE_TIME_FREQUENCY} slides.`);
  const systemDurationSeconds = Number(raw.systemDurationSeconds ?? defaults.systemDurationSeconds ?? DEFAULT_SETTINGS.systemDurationSeconds);
  if (!Number.isInteger(systemDurationSeconds) || systemDurationSeconds < 1 || systemDurationSeconds > MAX_DATE_TIME_DURATION_SECONDS) throw new Error(`System duration must be between 1 and ${MAX_DATE_TIME_DURATION_SECONDS} seconds.`);
  const folderPath = raw.folderPath ?? defaults.folderPath;
  if (typeof folderPath !== "string" || folderPath.length > 32767 || folderPath.includes("\0")) throw new Error("Folder path is invalid.");
  const legacyDateTimeOnly=raw.dateTimeOnly===true,legacyWeatherOnly=raw.weatherOnly===true,showImages=raw.showImages??(legacyDateTimeOnly||legacyWeatherOnly?false:defaults.showImages??true),showDateTime=(raw.showDateTime??defaults.showDateTime??false)||legacyDateTimeOnly,showWeather=(raw.showWeather??defaults.showWeather??false)||legacyWeatherOnly,showSystemStats=raw.showSystemStats??defaults.showSystemStats??false;
  if(!showImages&&!showDateTime&&!showWeather&&!showSystemStats)throw new Error("Enable an information screen when images are disabled.");
  return { folderPath, intervalSeconds, loop: raw.loop ?? defaults.loop, sort, showImages, showDateTime, dateTimeEverySlides, dateTimeDurationSeconds, dateFormat, showWeather, weatherApiKey: weatherApiKey.trim(), weatherLocation: weatherLocation.trim(), weatherUnits, weatherEverySlides, weatherDurationSeconds, showSystemStats, systemEverySlides, systemDurationSeconds };
}

export function createDateTimeSlide(timestamp, dateFormat = "system", locale = undefined) {
  const value = new Date(timestamp), pad = (part) => String(part).padStart(2, "0");
  const localDate = new Intl.DateTimeFormat(locale, { year:"numeric", month:"2-digit", day:"2-digit" }).format(value);
  const date = dateFormat === "dmy" ? `${pad(value.getDate())}/${pad(value.getMonth()+1)}/${value.getFullYear()}` : dateFormat === "mdy" ? `${pad(value.getMonth()+1)}/${pad(value.getDate())}/${value.getFullYear()}` : localDate;
  const weekday = new Intl.DateTimeFormat(locale, { weekday:"long" }).format(value);
  const time = new Intl.DateTimeFormat(locale, { hour:"2-digit", minute:"2-digit", second:"2-digit" }).format(value);
  const escapeXml = (text) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
  const dateLine=`${weekday}, ${date}`,timeSize=time.length>9?50:58,dateSize=dateLine.length>20?26:30;
  const clockIcon='<g transform="translate(26 27) scale(2)" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6h4"/></g>';
  const calendarIcon='<g transform="translate(26 116) scale(2)" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v3M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01"/></g>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="458" height="196" viewBox="0 0 458 196"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#111827"/><stop offset="1" stop-color="#1e3a5f"/></linearGradient></defs><rect width="458" height="196" rx="16" fill="url(#bg)"/><g data-panel="time"><rect x="10" y="10" width="438" height="82" rx="14" fill="#ffffff" fill-opacity=".08"/><rect x="10" y="10" width="6" height="82" rx="3" fill="#60a5fa"/>${clockIcon}<text x="278" y="70" fill="#f8fafc" font-family="Arial, sans-serif" font-size="${timeSize}" font-weight="700" text-anchor="middle">${escapeXml(time)}</text></g><g data-panel="date"><rect x="10" y="102" width="438" height="84" rx="14" fill="#ffffff" fill-opacity=".08"/><rect x="10" y="102" width="6" height="84" rx="3" fill="#4ade80"/>${calendarIcon}<text x="278" y="157" fill="#f8fafc" font-family="Arial, sans-serif" font-size="${dateSize}" font-weight="700" text-anchor="middle">${escapeXml(dateLine)}</text></g></svg>`;
  return { name: "date-time", dataUri: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, signature: `date-time:${dateFormat}:${Math.floor(timestamp/1000)}` };
}

export function eligibleName(name) {
  if (!name || name.startsWith(".") || name.startsWith("~") || name.endsWith("~")) return false;
  const lower = name.toLowerCase();
  if (TEMP_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return false;
  const dot = lower.lastIndexOf(".");
  return dot >= 0 && IMAGE_EXTENSIONS.has(lower.slice(dot));
}

export async function enumerateFolder(folderPath, sort = "name", fsApi = { lstatSync, readdirSync }, cache = new Map(), imageLoader = loadSlide) {
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
      candidates.push({ file, name: entry.name, modifiedMs: info.mtimeMs, size: info.size });
    } catch { /* A file can disappear during an atomic replace; the next rescan will see it. */ }
  }
  candidates.sort((a, b) => sort === "date"
    ? (b.modifiedMs - a.modifiedMs || compareNames(a.name, b.name))
    : compareNames(a.name, b.name));
  const slides = [], signatures = new Set(), errors = [], cacheKeys = new Set();
  for (const item of candidates) {
    const cacheKey=`${item.file}\0${item.size}\0${item.modifiedMs}`;cacheKeys.add(cacheKey);
    try {
      let slide;if(cache.has(cacheKey))slide=cache.get(cacheKey);else{slide=await imageLoader(item.file);cache.set(cacheKey,slide)}
      if(!slide)throw new Error("Cached image rejection");
      if (signatures.has(slide.signature)) continue;
      signatures.add(slide.signature); slides.push(slide);
    } catch { cache.set(cacheKey,null);errors.push(item.name); }
  }
  return { slides, rejected: errors.length, resized: slides.filter((slide) => slide.resized).length, cacheKeys };
}

function compareNames(a, b) {
  const aa = a.toLowerCase(), bb = b.toLowerCase();
  return aa < bb ? -1 : aa > bb ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

export class SlideshowService {
  constructor({ client, configuration, timerApi = globalThis, now = Date.now, fsApi, watchFactory = watch, fetchImpl = globalThis.fetch, systemMonitor = new SystemMonitor(), logger = console.log } = {}) {
    this.client=client; this.defaults=configuration.defaults; this.fallbackSlides=configuration.fallbackSlides;
    this.settings={...this.defaults}; this.slides=this.fallbackSlides; this.status={level:"ready",message:"Using included sample slides.",count:this.slides.length};
    this.timerApi=timerApi; this.now=now; this.fsApi=fsApi; this.watchFactory=watchFactory; this.fetchImpl=fetchImpl; this.systemMonitor=systemMonitor; this.logger=logger;
    this.contexts=new Map(); this.activeContexts=new Set(); this.inspectors=new Set(); this.lastSignature=new Map();
    this.index=0; this.timer=null; this.watcher=null; this.watchDebounce=null; this.nextSlideAt=0; this.nextRescanAt=0; this.settingsRequested=false; this.scanGeneration=0; this.slideCache=new Map();
    this.showingDateTime=false; this.dateTimeUntil=0; this.imagesSinceDateTime=1;
    this.showingWeather=false; this.weatherUntil=0; this.imagesSinceWeather=1; this.weatherData=null; this.weatherSlide=null; this.weatherRefresh=null; this.weatherRefreshGeneration=-1; this.weatherGeneration=0; this.nextWeatherRefreshAt=0; this.weatherStatus={level:"warning",message:"Weather is disabled."};
    this.showingSystem=false; this.systemUntil=0; this.imagesSinceSystem=1; this.systemSlide=null; this.systemRefresh=null; this.nextSystemRefreshAt=0; this.systemStatus={level:"warning",message:"System resources are disabled."};
    this.informationView="dateTime"; this.presentationQueue=[];
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
  async receiveSettings(event) {
    try { await this.applySettings(normalizeSettings(event?.settings, this.defaults), true); }
    catch (error) { this.setStatus("error", error.message, 0); }
  }
  async fromInspector(event) {
    const context=event?.context; if (!this.accepted(event) && !this.contexts.has(context)) return;
    this.inspectors.add(context); const payload=event?.payload||{};
    if (payload.type==="requestState") { this.sendStatus(context); return; }
    if (payload.type==="refresh") { await this.rescan(true); return; }
    if (payload.type==="refreshWeather") { await this.refreshWeather(true); return; }
    if (payload.type!=="updateSettings") return;
    try {
      const settings=normalizeSettings(payload.settings,this.settings); this.client.setGlobalSettings?.(settings,context); await this.applySettings(settings,true);
    } catch (error) { this.setStatus("error",error.message,0); }
  }
  async applySettings(settings, renderNow) {
    const folderChanged=settings.folderPath!==this.settings.folderPath || settings.sort!==this.settings.sort;
    const weatherLocationChanged=settings.weatherLocation!==this.settings.weatherLocation, weatherUnitsChanged=settings.weatherUnits!==this.settings.weatherUnits, wasWeatherEnabled=this.settings.showWeather, willWeatherBeEnabled=settings.showWeather, weatherChanged=settings.weatherApiKey!==this.settings.weatherApiKey||weatherLocationChanged||wasWeatherEnabled!==willWeatherBeEnabled;
    if(weatherChanged||weatherUnitsChanged)this.weatherGeneration++;
    if(weatherLocationChanged){this.weatherData=null;this.weatherSlide=null}
    this.settings=settings; this.showingDateTime=false; this.dateTimeUntil=0; this.imagesSinceDateTime=0; this.showingWeather=false; this.weatherUntil=0; this.imagesSinceWeather=0; this.showingSystem=false; this.systemUntil=0; this.imagesSinceSystem=0; this.informationView=this.informationViews()[0]||"dateTime"; this.presentationQueue=[];
    if (folderChanged) { this.index=0; this.stopWatcher(); this.slideCache.clear(); }
    if(weatherUnitsChanged&&this.weatherData)this.weatherSlide=await renderWeatherSlide(this.weatherData,settings.weatherUnits);
    await this.refreshWeather(weatherChanged||(weatherUnitsChanged&&!this.weatherData));if(!settings.showSystemStats)await this.refreshSystem(false);else if(!settings.showImages&&this.informationView==="system")await this.refreshSystem(true);else{this.systemStatus={level:"warning",message:"System resources update when their panel is shown."};this.nextSystemRefreshAt=0}await this.rescan(renderNow); this.nextSlideAt=this.now()+(settings.showImages?settings.intervalSeconds*1000:this.informationDurationMs()); this.imagesSinceDateTime=1; this.imagesSinceWeather=1; this.imagesSinceSystem=1; this.ensureRuntime(); this.broadcastStatus();
  }
  weatherEnabled() { return this.settings.showWeather; }
  async refreshWeather(force=false) {
    if(!this.weatherEnabled()){this.weatherStatus={level:"warning",message:"Weather is disabled."};this.nextWeatherRefreshAt=Infinity;return false}
    if(!this.settings.weatherApiKey||!this.settings.weatherLocation){this.weatherData=null;this.weatherSlide=null;this.weatherStatus={level:"warning",message:"Enter a WeatherAPI key and location."};this.nextWeatherRefreshAt=Infinity;this.broadcastStatus();if(!this.settings.showImages)this.renderAll(false);return false}
    if(!force&&this.now()<this.nextWeatherRefreshAt)return false;
    const generation=this.weatherGeneration;
    if(this.weatherRefresh){if(this.weatherRefreshGeneration===generation)return this.weatherRefresh;await this.weatherRefresh;return this.refreshWeather(force)}
    this.nextWeatherRefreshAt=this.now()+WEATHER_RETRY_MS;
    this.weatherRefreshGeneration=generation;
    const apiKey=this.settings.weatherApiKey,location=this.settings.weatherLocation;
    const refresh=(async()=>{try{const data=await fetchWeatherForecast({apiKey,location,fetchImpl:this.fetchImpl});if(generation!==this.weatherGeneration)return false;const slide=await renderWeatherSlide(data,this.settings.weatherUnits);if(generation!==this.weatherGeneration)return false;this.weatherData=data;this.weatherSlide=slide;this.weatherStatus={level:"ready",message:`${data.location}: 3-day forecast updated.`};this.nextWeatherRefreshAt=this.now()+WEATHER_REFRESH_MS;this.log("weather-refresh");return true}catch(error){if(generation!==this.weatherGeneration)return false;this.weatherStatus={level:this.weatherData?"warning":"error",message:this.weatherData?"Weather refresh failed; showing the last forecast.":error.message};this.log("weather-error");return false}finally{if(this.weatherRefresh===refresh)this.weatherRefresh=null;if(generation===this.weatherGeneration){this.broadcastStatus();if(!this.settings.showImages||this.showingWeather)this.renderAll(false)}}})();
    this.weatherRefresh=refresh;return refresh;
  }
  async refreshSystem(force=false) {
    if(!this.settings.showSystemStats){this.systemStatus={level:"warning",message:"System resources are disabled."};this.nextSystemRefreshAt=Infinity;return false}
    if(!force&&this.now()<this.nextSystemRefreshAt)return false;if(this.systemRefresh)return this.systemRefresh;this.nextSystemRefreshAt=this.now()+SYSTEM_REFRESH_MS;
    const refresh=(async()=>{try{const metrics=await this.systemMonitor.sample();this.systemSlide=await renderSystemSlide(metrics);this.systemStatus={level:"ready",message:"CPU, GPU, and RAM updated."};this.log("system-refresh");return true}catch{const hadSample=Boolean(this.systemSlide);if(!hadSample)try{this.systemSlide=await renderSystemSlide({cpu:null,gpu:null,ram:null,ramUsed:0,ramTotal:0,sampledAt:this.now()})}catch{}this.systemStatus={level:hadSample?"warning":"error",message:hadSample?"System refresh failed; showing the last sample.":"System resources are unavailable."};this.log("system-error");return false}finally{if(this.systemRefresh===refresh)this.systemRefresh=null;this.broadcastStatus();if(!this.settings.showImages||this.showingSystem)this.renderAll(false)}})();this.systemRefresh=refresh;return refresh;
  }
  async rescan(renderNow=false) {
    const generation=++this.scanGeneration;
    this.nextRescanAt=this.now()+RESCAN_INTERVAL_MS;
    if (!this.settings.showImages) { this.stopWatcher(); if(renderNow)this.renderAll(false); return; }
    if (!this.settings.folderPath) { this.useFallback("Using included sample slides.",renderNow); return; }
    try {
      const result=await enumerateFolder(this.settings.folderPath,this.settings.sort,this.fsApi||undefined,this.slideCache);
      if(generation!==this.scanGeneration)return;
      for(const key of this.slideCache.keys())if(!result.cacheKeys.has(key))this.slideCache.delete(key);
      if (!result.slides.length) { this.useFallback(result.rejected ? "No supported images; using sample slides." : "Folder is empty; using sample slides.",renderNow); return; }
      const current=this.slides[this.index]?.signature; this.slides=result.slides;
      const retained=this.slides.findIndex((slide)=>slide.signature===current); this.index=retained>=0?retained:0;
      const details=[`${result.slides.length} image(s) loaded`,result.resized?`${result.resized} resized with centered cover`:"",result.rejected?`${result.rejected} rejected`:""].filter(Boolean).join("; ")+".";
      this.setStatus(result.rejected?"warning":"ready",details,result.slides.length);
      this.ensureWatcher(); if (renderNow) this.renderAll(false);
    } catch { if(generation===this.scanGeneration)this.useFallback("Folder unavailable; using sample slides.",renderNow,"error"); }
  }
  useFallback(message,renderNow,level="warning") { this.slides=this.fallbackSlides; this.index=Math.min(this.index,this.slides.length-1); this.setStatus(level,message,this.slides.length); this.stopWatcher(); if(renderNow)this.renderAll(false); }
  setStatus(level,message,count) { this.status={level,message,count}; this.broadcastStatus(); this.log(`status-${level}`); }
  snapshot() { return { type:"state", settings:this.settings, status:this.status, weatherStatus:this.weatherStatus, systemStatus:this.systemStatus }; }
  sendStatus(context) { try { this.client.sendToPropertyInspector?.(this.snapshot(),context); } catch { this.log("inspector-send-error"); } }
  broadcastStatus() { for (const context of this.inspectors) this.sendStatus(context); }
  currentSlide() { if(!this.settings.showImages)return this.informationSlide(this.informationView);if(this.showingDateTime)return createDateTimeSlide(this.now(),this.settings.dateFormat);if(this.showingWeather)return this.weatherSlide||createWeatherSlide(null,this.settings.weatherUnits,undefined,this.weatherStatus.message);if(this.showingSystem)return this.systemSlide;return this.slides[this.index]||this.fallbackSlides[0]; }
  informationSlide(view) { if(view==="dateTime")return createDateTimeSlide(this.now(),this.settings.dateFormat);if(view==="weather")return this.weatherSlide||createWeatherSlide(null,this.settings.weatherUnits,undefined,this.weatherStatus.message);return this.systemSlide; }
  render(context,force=false) {
    const slide=this.currentSlide(); if(!slide)return;
    if(!force && this.lastSignature.get(context)===slide.signature)return;
    try { this.client.setBaseDataIcon(context,slide.dataUri,""); this.lastSignature.set(context,slide.signature); this.log("render",slide.name); }
    catch { this.log("render-error"); }
  }
  renderAll(force=false) { for(const context of this.activeContexts)this.render(context,force); }
  async tick() {
    const time=this.now();
    if(this.weatherEnabled()&&time>=this.nextWeatherRefreshAt)await this.refreshWeather(false);
    if(!this.settings.showImages){const views=this.informationViews();if(views.length>1&&time>=this.nextSlideAt){const index=views.indexOf(this.informationView);this.informationView=views[(index+1)%views.length];if(this.informationView==="system")await this.refreshSystem(true);this.nextSlideAt=this.now()+this.informationDurationMs();this.renderAll(false);return}if(this.informationView==="system"&&time>=this.nextSystemRefreshAt)await this.refreshSystem(false);if(this.informationView==="dateTime")this.renderAll(false);return;}
    if(time>=this.nextRescanAt)await this.rescan(false);
    if(this.showingWeather){
      if(time<this.weatherUntil)return;
      this.showingWeather=false;this.weatherUntil=0;this.imagesSinceWeather=0;const pending=this.finishPresentation(time);if(pending)await pending;return;
    }
    if(this.showingDateTime){
      if(time<this.dateTimeUntil){this.renderAll(false);return;}
      this.showingDateTime=false;this.dateTimeUntil=0;this.imagesSinceDateTime=0;const pending=this.finishPresentation(time);if(pending)await pending;return;
    }
    if(this.showingSystem){
      if(time<this.systemUntil){if(time>=this.nextSystemRefreshAt)await this.refreshSystem(false);return;}
      this.showingSystem=false;this.systemUntil=0;this.imagesSinceSystem=0;const pending=this.finishPresentation(time);if(pending)await pending;return;
    }
    if(time<this.nextSlideAt)return;
    this.presentationQueue=[this.settings.showDateTime&&this.imagesSinceDateTime>=this.settings.dateTimeEverySlides?"dateTime":null,this.settings.showWeather&&this.weatherData&&this.imagesSinceWeather>=this.settings.weatherEverySlides?"weather":null,this.settings.showSystemStats&&this.imagesSinceSystem>=this.settings.systemEverySlides?"system":null].filter(Boolean);
    if(this.presentationQueue[0]==="system")await this.refreshSystem(true);if(this.startNextPresentation(this.now()))return;
    this.nextSlideAt=time+this.settings.intervalSeconds*1000;this.advanceImage();
  }
  startNextPresentation(time) { const type=this.presentationQueue.shift();if(!type)return false;if(type==="dateTime"){this.showingDateTime=true;this.dateTimeUntil=time+this.settings.dateTimeDurationSeconds*1000;this.nextSlideAt=this.dateTimeUntil}else if(type==="weather"){this.showingWeather=true;this.weatherUntil=time+this.settings.weatherDurationSeconds*1000;this.nextSlideAt=this.weatherUntil}else{this.showingSystem=true;this.systemUntil=time+this.settings.systemDurationSeconds*1000;this.nextSlideAt=this.systemUntil}this.renderAll(false);return true; }
  finishPresentation(time) { if(this.presentationQueue[0]==="system")return this.refreshSystem(true).then(()=>{this.startNextPresentation(this.now())});if(this.startNextPresentation(time))return null;this.advanceImage();this.nextSlideAt=time+this.settings.intervalSeconds*1000;this.renderAll(false);return null; }
  informationViews() { return [this.settings.showDateTime?"dateTime":null,this.settings.showWeather?"weather":null,this.settings.showSystemStats?"system":null].filter(Boolean); }
  informationDurationMs() { return (this.informationView==="weather"?this.settings.weatherDurationSeconds:this.informationView==="system"?this.settings.systemDurationSeconds:this.settings.dateTimeDurationSeconds)*1000; }
  advanceImage() { const last=this.slides.length-1;if(this.index>=last&&!this.settings.loop)return false;this.index=this.index>=last?0:this.index+1;this.imagesSinceDateTime++;this.imagesSinceWeather++;this.imagesSinceSystem++;this.renderAll(false);return true; }
  ensureRuntime() {
    if(this.activeContexts.size===0)return; this.ensureWatcher();
    if(!this.nextRescanAt)this.nextRescanAt=this.now()+RESCAN_INTERVAL_MS;
    if(!this.nextSlideAt)this.nextSlideAt=this.now()+this.settings.intervalSeconds*1000;
    if(!this.timer)this.timer=this.timerApi.setInterval(()=>void this.tick(),1000);
  }
  ensureWatcher() {
    if(!this.settings.showImages||this.watcher||!this.settings.folderPath||this.status.count===0||this.slides===this.fallbackSlides)return;
    try { this.watcher=this.watchFactory(this.settings.folderPath,{persistent:false},()=>this.queueRescan()); this.watcher.on?.("error",()=>this.queueRescan()); }
    catch { this.watcher=null; }
  }
  queueRescan() {
    if(this.watchDebounce)this.timerApi.clearTimeout(this.watchDebounce);
    this.watchDebounce=this.timerApi.setTimeout(async()=>{this.watchDebounce=null;await this.rescan(true);},WATCH_DEBOUNCE_MS);
  }
  stopWatcher() { try{this.watcher?.close();}catch{} this.watcher=null; if(this.watchDebounce)this.timerApi.clearTimeout(this.watchDebounce); this.watchDebounce=null; }
  stopRuntime() { this.scanGeneration++; if(this.timer)this.timerApi.clearInterval(this.timer); this.timer=null; this.nextSlideAt=0; this.nextRescanAt=0; this.showingDateTime=false; this.dateTimeUntil=0; this.imagesSinceDateTime=1; this.showingWeather=false; this.weatherUntil=0; this.imagesSinceWeather=1; this.showingSystem=false; this.systemUntil=0; this.imagesSinceSystem=1; this.presentationQueue=[]; this.stopWatcher(); }
  close() { this.stopRuntime(); this.activeContexts.clear(); this.contexts.clear(); this.inspectors.clear(); this.lastSignature.clear(); this.slideCache.clear(); }
  log(event,slide="") { const safe=/^[A-Za-z0-9._-]{1,128}$/.test(slide)?slide:""; this.logger(`[imageslide] ${JSON.stringify({event,slide:safe,active:this.activeContexts.size})}`); }
}
