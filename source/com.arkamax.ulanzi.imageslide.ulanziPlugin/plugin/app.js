import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UlanziProtocolClient } from "./protocol-client.js";
import { ACTION_UUID, PLUGIN_UUID, SlideshowService, loadConfiguration } from "./slideshow.js";
import { SetupService } from "./setup.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const client = new UlanziProtocolClient();
const service = new SlideshowService({ client, configuration: await loadConfiguration(root) });
const setup = new SetupService({ client, root });
service.bind();
setup.bind();
client.connect(PLUGIN_UUID);

function shutdown() { service.close(); setup.close(); client.close(); }
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

export { ACTION_UUID, PLUGIN_UUID };
