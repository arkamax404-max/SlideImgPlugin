import assert from "node:assert/strict";
import test from "node:test";
import { UlanziProtocolClient } from "../plugin/protocol-client.js";

test("setBaseDataIcon emits the SDK 2.1.2 state envelope", () => {
  const frames = []; class FakeSocket {} FakeSocket.OPEN = 1;
  const client = new UlanziProtocolClient({WebSocketImpl:FakeSocket});
  client.uuid = "com.arkamax.ulanzi.imageslide";
  client.websocket = {readyState:1,send(frame){frames.push(JSON.parse(frame))}};
  client.setBaseDataIcon("com.arkamax.ulanzi.imageslide.slideshow___3_2___instance-1", "data:image/svg+xml;base64,PHN2Zy8+");
  assert.equal(frames.length,1); const frame=frames[0];
  assert.equal(frame.cmd,"state"); assert.equal(frame.uuid,"com.arkamax.ulanzi.imageslide.slideshow");
  assert.equal(frame.key,"3_2"); assert.equal(frame.actionid,"instance-1"); assert.equal(frame.param.statelist[0].type,1);
});

test("global, action, and Property Inspector frames follow the official field contract", () => {
  const frames=[];class FakeSocket{}FakeSocket.OPEN=1;const client=new UlanziProtocolClient({WebSocketImpl:FakeSocket});client.uuid="com.arkamax.ulanzi.imageslide";client.websocket={readyState:1,send(frame){frames.push(JSON.parse(frame))}};
  const context="com.arkamax.ulanzi.imageslide.slideshow___3_2___instance-1";
  client.getGlobalSettings(context);client.setGlobalSettings({folderPath:"C:\\Images",intervalSeconds:5,loop:true,sort:"name"},context);client.setSettings({operation:"restore"},context);client.sendToPropertyInspector({type:"state"},context);
  assert.deepEqual(frames.map(f=>f.cmd),["getGlobalSettings","setGlobalSettings","setSettings","sendToPropertyInspector"]);
  assert.equal(frames[1].settings.folderPath,"C:\\Images");assert.deepEqual(frames[2].settings,{operation:"restore"});assert.deepEqual(frames[3].payload,{type:"state"});assert.ok(frames.every(f=>f.key==="3_2"&&f.actionid==="instance-1"));
});
