import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";

export const SETUP_UUID="com.arkamax.ulanzi.imageslide.setup";
export const PLUGIN_VERSION="0.3.1";
const REQUEST_SCHEMA="com.arkamax.ulanzi.imageslide.setup-request/v5";
const FAILURE_CODES=new Set([
  "PROFILE_NOT_FOUND","PROFILE_AMBIGUOUS","SETUP_INSTANCE_NOT_FOUND","PAGE_INVALID","SLOT_UNRELATED",
  "SETTINGS_SCHEMA_UNSUPPORTED","REQUEST_WRITE_FAILED","PROFILE_STORE_UNREADABLE",
  "MANIFEST_INVALID","COMPATIBILITY_UNSUPPORTED","HELPER_PROCESS_FAILED","REPREPARE_REQUIRED","RESTORE_BACKUP_NOT_FOUND","RESTORE_BACKUP_INVALID","RESTORED"
]);
  const PHASES=new Set(["INITIALIZING","COMPATIBILITY","COMPAT_PLUGIN_ROOT","COMPAT_MANIFEST_READ","COMPAT_EXE_PATH","COMPAT_VERSION_READ","COMPAT_HASH_READ","COMPAT_ENV_PATHS","SETTINGS_READ","SETTINGS_SCHEMA","V2_ENUMERATION","V1_FALLBACK","DEVICE_PROFILE_MATCH","PAGE_READ","TARGET_RESOLUTION","RESTORE_RESOLUTION","SLOT_VALIDATION","REQUEST_WRITE","APPLY_PRECHECK","BACKUP","PATCH_WRITE","RESTORE_WRITE","READBACK","RECEIPT","RELAUNCH"]);

function icon(label,color) {
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196"><rect width="196" height="196" rx="20" fill="${color}"/><text x="98" y="92" text-anchor="middle" fill="white" font-family="Arial" font-size="20" font-weight="bold">${label}</text><text x="98" y="125" text-anchor="middle" fill="white" font-family="Arial" font-size="15">LARGE DISPLAY</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
const ICONS={ready:icon("READY","#315d94"),launching:icon("LAUNCHING","#8a6518"),waiting:icon("CLOSE STUDIO","#98601f"),installed:icon("INSTALLED","#26734d"),restored:icon("RESTORED","#26734d"),failed:icon("FAILED","#963f3f")};

function sha256(text){return createHash("sha256").update(String(text),"utf8").digest("hex")}
export function diagnosticCode(text){
  return diagnosticResult(text).code;
}
export function diagnosticResult(text){
  const matches=[...String(text||"").matchAll(/IMAGESLIDE_DIAGNOSTIC:([A-Z0-9_]+):([A-Z0-9_]+)/g)];
  const last=matches.at(-1),code=last?.[1],phase=last?.[2];
  return {code:FAILURE_CODES.has(code)?code:"HELPER_PROCESS_FAILED",phase:PHASES.has(phase)?phase:"INITIALIZING"};
}
function safeRecord(record){
  const code=String(record?.code||"");
  const status=String(record?.status||"").toLowerCase();
  const phase=String(record?.phase||"");
  if(![...FAILURE_CODES,"PREPARING","PREPARED","SUCCESS","IDEMPOTENT","RESTORED"].includes(code))return null;
  if(!["started","failed","prepared","success","idempotent","restored"].includes(status))return null;
  if(!PHASES.has(phase))return null;
  return {code,status,phase};
}
function normalizeOperation(value){return ["install","repair","restore"].includes(value)?value:null}

export class SetupService {
  constructor({client,root,platform=process.platform,launcher,localAppData=process.env.LOCALAPPDATA,readDiagnostic,readText}={}) {
    this.client=client;this.root=root;this.platform=platform;this.contexts=new Map();
    this.launcher=launcher||((args)=>spawn("powershell.exe",args,{windowsHide:true,stdio:"ignore"}));
    this.localAppData=localAppData||"";this.readText=readText||readDiagnostic||((path)=>readFileSync(path,"utf8"));
    this.last={status:"ready",code:"READY",phase:"INITIALIZING"};this.persisted=null;this.loadLastDiagnostic();
  }
  bind(){this.client.onAdd((e)=>this.add(e));this.client.onRun((e)=>this.run(e));this.client.onSendToPlugin((e)=>this.message(e));this.client.onParamFromPlugin?.((e)=>this.receiveSettings(e));this.client.onDidReceiveSettings?.((e)=>this.receiveSettings(e));this.client.onClear((items)=>this.clear(items));}
  binding(event){if(event?.uuid!==SETUP_UUID||!event?.context)return null;try{const {key,actionid}=this.client.decodeContext(event.context);if(!/^[0-9]{1,2}_[0-9]{1,2}$/.test(key)||key==="3_2"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actionid))return null;return{key,actionid}}catch{return null}}
  accepted(event){return Boolean(this.binding(event))}
  loadLastDiagnostic(binding=null){
    if(!this.localAppData)return false;
    try{this.persisted=safeRecord(JSON.parse(this.readText(join(this.localAppData,"Arkamax","ImageSlidePlugin","last-diagnostic.json"))))}catch{this.persisted=null}
    if(!this.persisted)return false;
    if(this.persisted.status==="prepared"){
      this.last=binding&&this.validPreparedRequest(binding)?{...this.persisted,status:"waiting"}:{status:binding?"failed":"ready",code:binding?"REPREPARE_REQUIRED":"READY",phase:binding?"APPLY_PRECHECK":"INITIALIZING"};
      return this.last.status==="waiting";
    }
    if(["success","idempotent","restored"].includes(this.persisted.status)){
      const live=binding&&this.liveTerminalStatus(binding);
      if(live)this.last={...this.persisted,status:live};
      else if(!["launching","waiting"].includes(this.last.status))this.last={status:"ready",code:"READY",phase:"INITIALIZING"};
      return false;
    }
    const statuses={started:"launching",failed:"failed"};
    this.last={...this.persisted,status:statuses[this.persisted.status]||"failed"};return false;
  }
  boundRequest(binding,requireFresh=true,requireCurrentVersion=true){
    try{
      const requestRoot=join(this.localAppData,"Arkamax","ImageSlidePlugin","requests");
      const pointer=JSON.parse(this.readText(join(requestRoot,"current.json")));
      if(pointer?.schema!=="com.arkamax.ulanzi.imageslide.request-pointer/v1"||typeof pointer.file!=="string"||basename(pointer.file)!==pointer.file||!/^[0-9a-f]{32}\.json$/i.test(pointer.file)||!/^[0-9a-f]{64}$/.test(String(pointer.sha256||"")))return null;
      const requestJson=this.readText(join(requestRoot,pointer.file));
      const digest=sha256(requestJson);const sidecar=String(this.readText(join(requestRoot,`${pointer.file}.sha256`))).trim().toLowerCase();
      if(digest!==pointer.sha256||digest!==sidecar)return null;
      const request=JSON.parse(requestJson),expires=Date.parse(request.expiresUtc);
      const supportedVersion=requireCurrentVersion?request?.pluginVersion===PLUGIN_VERSION:["0.2.0","0.3.0",PLUGIN_VERSION].includes(request?.pluginVersion);
      return request?.schema===REQUEST_SCHEMA&&supportedVersion&&Number.isFinite(expires)&&(!requireFresh||expires>Date.now())&&request.setupKey===binding.key&&request.setupActionIdSha256===sha256(binding.actionid.toLowerCase())?request:null;
    }catch{return null}
  }
  validPreparedRequest(binding){return Boolean(this.boundRequest(binding,true))}
  liveTerminalStatus(binding){
    try{
      const request=this.boundRequest(binding,false,false);if(!request||typeof request.manifestPath!=="string")return null;
      const document=JSON.parse(this.readText(request.manifestPath)),controllers=Array.isArray(document?.Controllers)?document.Controllers:[];
      const setup=controllers.filter((controller)=>controller?.Type==="Keypad"&&controller.Actions?.[binding.key]?.Action===SETUP_UUID&&sha256(String(controller.Actions[binding.key].ActionID||"").toLowerCase())===sha256(binding.actionid.toLowerCase()));
      const centers=controllers.filter((controller)=>controller?.Type==="Keypad"&&controller.Actions?.["3_2"]);
      if(setup.length!==1||centers.length!==1)return null;
      const action=centers[0].Actions["3_2"].Action;
      if(action==="com.arkamax.ulanzi.imageslide.slideshow")return "installed";
      if(action==="com.ulanzi.ulanzideck.smallwindow.window")return this.persisted.status==="restored"?"restored":"ready";
      return null;
    }catch{return null}
  }
  render(context,state,text=""){try{this.client.setBaseDataIcon(context,ICONS[state]||ICONS.failed,String(text).slice(0,80))}catch{}}
  notify(context){const operation=this.contexts.get(context)?.operation||"install";try{this.client.sendToPropertyInspector({type:"setupStatus",status:this.last.status,code:this.last.code,phase:this.last.phase,operation},context)}catch{}}
  setStatus(context,status,code,phase="INITIALIZING"){this.last={status,code,phase};const keyDiagnostic=status==="failed"?`[${code}:${phase}]`:"";this.render(context,status,keyDiagnostic);this.notify(context)}
  add(event){const binding=this.binding(event);if(!binding)return;this.contexts.set(event.context,{operation:normalizeOperation(event.param?.operation)||"install"});this.loadLastDiagnostic(binding);this.render(event.context,this.last.status,this.last.code==="REPREPARE_REQUIRED"?"[REPREPARE_REQUIRED:APPLY_PRECHECK]":"");this.notify(event.context)}
  receiveSettings(event){const binding=this.binding(event),raw=event?.settings||event?.param;if(!binding||!raw)return false;return this.setOperation(event.context,raw.operation,false)}
  setOperation(context,operation,persist){const entry=this.contexts.get(context);operation=normalizeOperation(operation);if(!entry||!operation)return false;if(entry.operation===operation){this.notify(context);return true}if(["launching","waiting"].includes(this.last.status))return false;entry.operation=operation;this.last={status:"ready",code:"READY",phase:"INITIALIZING"};if(persist)this.client.setSettings?.({operation},context);this.render(context,"ready");this.notify(context);return true}
  message(event){const binding=this.binding(event);if(!binding)return;if(event.payload?.type==="updateSetupOperation"){this.setOperation(event.context,event.payload.operation,true);return}if(event.payload?.type!=="requestSetupState")return;this.loadLastDiagnostic(binding);this.render(event.context,this.last.status,this.last.status==="failed"?`[${this.last.code}:${this.last.phase}]`:"");this.notify(event.context)}
  run(event){
    if(event?.uuid!==SETUP_UUID||!event?.context)return;const binding=this.binding(event);if(!binding){this.setStatus(event.context,"failed","SETUP_INSTANCE_NOT_FOUND","TARGET_RESOLUTION");return}
    if(this.platform!=="win32"){this.setStatus(event.context,"failed","HELPER_PROCESS_FAILED","INITIALIZING");this.client.toast?.("Setup requires Windows [HELPER_PROCESS_FAILED:INITIALIZING].");return}
    if(["launching","waiting"].includes(this.last.status))return;
    const operation=this.contexts.get(event.context)?.operation||"install";this.setStatus(event.context,"launching","PREPARING","INITIALIZING");const helper=join(this.root,"helper","Start-ImageSlideSetup.ps1");const args=["-NoProfile","-ExecutionPolicy","Bypass","-File",helper,"-Operation",operation,"-PluginRoot",this.root,"-PressedKey",binding.key,"-SetupActionId",binding.actionid];
    try{const child=this.launcher(args);if(!child)throw new Error("Assistant did not start");child.once?.("error",()=>{if(this.contexts.has(event.context))this.setStatus(event.context,"failed","HELPER_PROCESS_FAILED","INITIALIZING")});child.once?.("exit",(code)=>{if(code!==0&&this.contexts.has(event.context))this.setStatus(event.context,"failed","HELPER_PROCESS_FAILED","INITIALIZING")});child.unref?.();this.client.toast?.("Setup Assistant started. Close Studio when the key asks you to.")}catch{this.setStatus(event.context,"failed","HELPER_PROCESS_FAILED","INITIALIZING")}
  }
  clear(items){for(const context of items||[])this.contexts.delete(context)}
  close(){this.contexts.clear()}
}
