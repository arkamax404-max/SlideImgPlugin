(() => {
  "use strict";
  const uuid="com.arkamax.ulanzi.imageslide.setup",query=new URLSearchParams(location.search),box=document.getElementById("status"),operation=document.getElementById("operation");
  const state={key:query.get("key")||"",actionid:query.get("actionid")||"",socket:null};
  function send(payload){if(state.socket?.readyState===WebSocket.OPEN)state.socket.send(JSON.stringify({cmd:"sendToPlugin",uuid,key:state.key,actionid:state.actionid,payload}));}
  function paint(payload){const status=String(payload?.status||"unknown").toLowerCase(),code=String(payload?.code||"UNAVAILABLE"),phase=String(payload?.phase||"INITIALIZING");box.className=`status ${status}`;box.textContent=`Status: ${status.toUpperCase()} [${code}:${phase}]`;if(["install","repair","restore"].includes(payload?.operation))operation.value=payload.operation;}
  function receive(event){let message;try{message=JSON.parse(String(event.data))}catch{return}if(message.key)state.key=message.key;if(message.actionid)state.actionid=message.actionid;if(message.cmd==="sendToPropertyInspector"&&message.payload?.type==="setupStatus")paint(message.payload)}
  document.getElementById("refresh").addEventListener("click",()=>send({type:"requestSetupState"}));
  operation.addEventListener("change",()=>send({type:"updateSetupOperation",operation:operation.value}));
  state.socket=new WebSocket(`ws://${query.get("address")||"127.0.0.1"}:${query.get("port")||"3906"}`);state.socket.addEventListener("message",receive);state.socket.addEventListener("open",()=>{state.socket.send(JSON.stringify({code:0,cmd:"connected",uuid}));send({type:"requestSetupState"})});state.socket.addEventListener("close",()=>paint({status:"failed",code:"HELPER_PROCESS_FAILED",phase:"INITIALIZING"}));state.socket.addEventListener("error",()=>paint({status:"failed",code:"HELPER_PROCESS_FAILED",phase:"INITIALIZING"}));
  const timer=setInterval(()=>send({type:"requestSetupState"}),1000);addEventListener("beforeunload",()=>clearInterval(timer),{once:true});
})();
