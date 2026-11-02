/**
 * The script-tag build, served as /devbar.js:
 *   <script src="http://127.0.0.1:4711/devbar.js"></script>
 * The server is the script's own origin unless `data-server` says otherwise;
 * `data-enabled="false"` renders nothing and requests nothing.
 */
import { GLOBAL_NAME } from "../name.js";
import { installConsoleBuffer } from "./context.js";
import { mount } from "./index.js";

const script = document.currentScript as HTMLScriptElement | null;
const enabled = script?.dataset.enabled !== "false";
if (enabled && !(window as unknown as Record<string, unknown>)[GLOBAL_NAME]) {
  let server = script?.dataset.server;
  if (!server && script?.src) server = new URL(script.src, location.href).origin;
  // Listen from the first moment, before the page has a body, so early errors are kept.
  installConsoleBuffer(script?.src ?? null);
  mount({ server: server || "http://127.0.0.1:4711", enabled: true });
}
