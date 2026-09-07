/* Protocol 2.1.2 PI bridge. Official contract: selectFolderDialog() sends
   selectdialog {type:'folder'} and onSelectdialog receives message.path. */
(() => {
  "use strict";
  const ACTION_UUID="com.arkamax.ulanzi.imageslide.slideshow";
  const query=new URLSearchParams(location.search);
  const state={uuid:ACTION_UUID,key:query.get("key")||"",actionid:query.get("actionid")||"",settings:{folderPath:"",intervalSeconds:10,loop:true,sort:"name",showDateTime:false,dateTimeOnly:false,dateTimeEverySlides:5,dateTimeDurationSeconds:5,dateFormat:"system"},socket:null};
  const el=(id)=>document.getElementById(id);
  function send(cmd,fields={}){if(state.socket?.readyState===WebSocket.OPEN)state.socket.send(JSON.stringify({cmd,uuid:state.uuid,key:state.key,actionid:state.actionid,...fields}));}
  function sendToPlugin(payload){send("sendToPlugin",{payload});}
  function getGlobalSettings(){send("getGlobalSettings");}
  function selectFolderDialog(){send("selectdialog",{type:"folder"});}
  function onSelectdialog(message){if(typeof message.path==="string"&&message.path){state.settings.folderPath=message.path;paintSettings();save();}}
  function paintSettings(){el("folder").value=state.settings.folderPath||"";el("interval").value=state.settings.intervalSeconds;el("loop").checked=state.settings.loop;el("sort").value=state.settings.sort;el("date-time-only").checked=state.settings.dateTimeOnly;el("show-date-time").checked=state.settings.showDateTime;el("date-time-every").value=state.settings.dateTimeEverySlides;el("date-time-duration").value=state.settings.dateTimeDurationSeconds;el("date-format").value=state.settings.dateFormat;el("date-time-schedule").hidden=!state.settings.showDateTime||state.settings.dateTimeOnly;el("date-format-options").hidden=!state.settings.showDateTime&&!state.settings.dateTimeOnly;}
  function paintStatus(status){const box=el("status");box.className=`status ${status?.level||"warning"}`;box.textContent=status?.message||"Waiting for plugin status…";}
  function save(){const intervalSeconds=Number(el("interval").value),dateTimeEverySlides=Number(el("date-time-every").value),dateTimeDurationSeconds=Number(el("date-time-duration").value);if(!Number.isFinite(intervalSeconds)||intervalSeconds<5){paintStatus({level:"error",message:"Interval must be at least 5 seconds."});return;}if(!Number.isInteger(dateTimeEverySlides)||dateTimeEverySlides<1||!Number.isInteger(dateTimeDurationSeconds)||dateTimeDurationSeconds<1){paintStatus({level:"error",message:"Date/time frequency and duration must be positive whole numbers."});return;}state.settings={folderPath:state.settings.folderPath,intervalSeconds,loop:el("loop").checked,sort:el("sort").value,dateTimeOnly:el("date-time-only").checked,showDateTime:el("show-date-time").checked,dateTimeEverySlides,dateTimeDurationSeconds,dateFormat:el("date-format").value};paintSettings();sendToPlugin({type:"updateSettings",settings:state.settings});}
  function receive(event){let message;try{message=JSON.parse(String(event.data));}catch{return;}if(message.key)state.key=message.key;if(message.actionid)state.actionid=message.actionid;if(message.cmd==="selectdialog")onSelectdialog(message);if(message.cmd==="didReceiveGlobalSettings"&&message.settings){state.settings={...state.settings,...message.settings};paintSettings();}if(message.cmd==="sendToPropertyInspector"&&message.payload){if(message.payload.settings){state.settings={...state.settings,...message.payload.settings};paintSettings();}paintStatus(message.payload.status);}}
  el("select").addEventListener("click",selectFolderDialog);el("refresh").addEventListener("click",()=>sendToPlugin({type:"refresh"}));
  for(const id of ["interval","loop","sort","date-time-only","show-date-time","date-time-every","date-time-duration","date-format"])el(id).addEventListener("change",save);
  const address=query.get("address")||"127.0.0.1",port=query.get("port")||"3906";
  state.socket=new WebSocket(`ws://${address}:${port}`);state.socket.addEventListener("message",receive);state.socket.addEventListener("open",()=>{state.socket.send(JSON.stringify({code:0,cmd:"connected",uuid:ACTION_UUID}));getGlobalSettings();sendToPlugin({type:"requestState"});});state.socket.addEventListener("close",()=>paintStatus({level:"error",message:"Disconnected from Ulanzi Studio."}));state.socket.addEventListener("error",()=>paintStatus({level:"error",message:"Unable to connect to Ulanzi Studio."}));
  paintSettings();
})();
