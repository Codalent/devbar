/**
 * The script-tag build, served as /devbar.js:
 *   <script src="http://127.0.0.1:4711/devbar.js"></script>
 * The server is the script's own address without the final `/devbar.js` (so a handler mounted at
 * /devbar in your app serves it as /devbar/devbar.js) unless `data-server` says otherwise;
 * `data-enabled="false"` renders nothing and requests nothing. A server started with a key needs
 * it on the tag: `data-key`, or `?key=` on the script's own address.
 */
import { GLOBAL_NAME } from "../name.js";
import { installConsoleBuffer } from "./context.js";
import { mount } from "./index.js";

const script = document.currentScript as HTMLScriptElement | null;
const enabled = script?.dataset.enabled !== "false";
if (enabled && !(window as unknown as Record<string, unknown>)[GLOBAL_NAME]) {
  let server = script?.dataset.server;
  let key = script?.dataset.key;
  if (script?.src) {
    const src = new URL(script.src, location.href);
    if (!server) server = src.origin + src.pathname.replace(/\/[^/]*$/, "");
    key ||= src.searchParams.get("key") ?? undefined;
  }
  // Listen from the first moment, before the page has a body, so early errors are kept.
  installConsoleBuffer(script?.src ?? null);
  mount({ server: server || "http://127.0.0.1:4711", enabled: true, key });
}
