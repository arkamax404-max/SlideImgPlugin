import EventEmitter from "node:events";
import WebSocket from "ws";

const REQUEST = "REQUEST";

export class UlanziProtocolClient extends EventEmitter {
  constructor({ WebSocketImpl = WebSocket } = {}) {
    super();
    this.WebSocketImpl = WebSocketImpl;
    this.websocket = null;
    this.uuid = "";
    this.key = "";
    this.actionid = "";
  }

  connect(uuid, port = 3906, address = "127.0.0.1") {
    const [argvAddress, argvPort] = process.argv.slice(2);
    this.uuid = uuid;
    this.address = argvAddress || address;
    this.port = argvPort || port;
    this.websocket = new this.WebSocketImpl(`ws://${this.address}:${this.port}`);
    this.websocket.on("open", () => {
      this.websocket.send(JSON.stringify({ code: 0, cmd: "connected", uuid: this.uuid }));
      this.emit("connected", {});
    });
    this.websocket.on("error", () => this.emit("error", {}));
    this.websocket.on("close", () => this.emit("close", {}));
    this.websocket.on("message", (payload) => this.receive(payload));
  }

  receive(payload) {
    let data;
    try { data = JSON.parse(String(payload)); }
    catch { this.emit("error", {}); return; }
    if (!data || (data.code !== undefined && data.cmdType !== REQUEST)) return;
    if (!this.key && data.uuid === this.uuid && data.key) this.key = data.key;
    if (!this.actionid && data.uuid === this.uuid && data.actionid) this.actionid = data.actionid;
    if (this.uuid.split(".").length === 4) this.send(data.cmd, { code: 0, ...data });

    if (data.cmd === "clear") {
      const contexts = Array.isArray(data.param)
        ? data.param.map((item) => this.encodeContext(item))
        : [];
      this.emit("clear", contexts);
      return;
    }
    data.context = this.encodeContext(data);
    if (data.cmd === "setActive") data.active = Boolean(data.active ?? data.param?.active);
    if (data.cmd === "setactive") data.active = Boolean(data.active ?? data.param?.active);
    this.emit(data.cmd, data);
  }

  encodeContext(data) { return `${data.uuid}___${data.key}___${data.actionid}`; }
  decodeContext(context) {
    const [uuid, key, actionid] = String(context).split("___");
    if (!uuid || !key || !actionid) throw new Error("Invalid action context");
    return { uuid, key, actionid };
  }
  send(cmd, params) {
    if (this.websocket?.readyState !== this.WebSocketImpl.OPEN) return false;
    this.websocket.send(JSON.stringify({ cmd, uuid: this.uuid, key: this.key, actionid: this.actionid, ...params }));
    return true;
  }
  setBaseDataIcon(context, data, text = "") {
    const { uuid, key, actionid } = this.decodeContext(context);
    const sent = this.send("state", { uuid, key, actionid, param: { statelist: [{ uuid, key, actionid, type: 1, data, textData: text, showtext: Boolean(text) }] } });
    if (!sent) throw new Error("WebSocket is not open");
  }
  getGlobalSettings(context) {
    const { uuid, key, actionid } = this.decodeContext(context);
    return this.send("getGlobalSettings", { uuid, key, actionid });
  }
  setGlobalSettings(settings, context) {
    const { uuid, key, actionid } = this.decodeContext(context);
    return this.send("setGlobalSettings", { uuid, key, actionid, settings });
  }
  setSettings(settings, context) {
    const { uuid, key, actionid } = this.decodeContext(context);
    return this.send("setSettings", { uuid, key, actionid, settings });
  }
  sendToPropertyInspector(payload, context) {
    const { uuid, key, actionid } = this.decodeContext(context);
    return this.send("sendToPropertyInspector", { uuid, key, actionid, payload });
  }
  onConnected(handler) { this.on("connected", handler); return this; }
  onAdd(handler) { this.on("add", handler); return this; }
  onRun(handler) { this.on("run", handler); return this; }
  onSetActive(handler) { this.on("setActive", handler); return this; }
  onSetactive(handler) { this.on("setactive", handler); return this; }
  onSendToPlugin(handler) { this.on("sendToPlugin", handler); return this; }
  onParamFromPlugin(handler) { this.on("paramfromplugin", handler); return this; }
  onDidReceiveSettings(handler) { this.on("didReceiveSettings", handler); return this; }
  onDidReceiveGlobalSettings(handler) { this.on("didReceiveGlobalSettings", handler); return this; }
  toast(message) { return this.send("toast", { msg: String(message).slice(0, 160) }); }
  onClear(handler) { this.on("clear", handler); return this; }
  onClose(handler) { this.on("close", handler); return this; }
  onError(handler) { this.on("error", handler); return this; }
  close() { this.websocket?.close(); }
}
