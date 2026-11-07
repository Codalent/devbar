/**
 * The script-tag build, `dist/devbar.js`:
 *
 *   <script src="…/devbar.js" data-server="https://api.example.com/devbar"></script>
 *
 * `data-server` is the backend. Without it there is none: Save downloads each item. The Node
 * backend serves this same file as `/devbar.js` with the marker below switched on, so a tag that
 * loads the script from a backend talks to that backend (the script's address without the final
 * `/devbar.js`) with no `data-server`; `data-server=""` turns that off. `data-enabled="false"`
 * renders nothing and requests nothing. A backend with a key needs it on the tag: `data-key`, or
 * `?key=` on the script's own address.
 */
import { GLOBAL_NAME } from "../name.js";
import { installConsoleBuffer } from "./context.js";
import { mount } from "./index.js";

// Kept as a string the minifier cannot fold: the backend serves the file with "=0" made "=1".
const SERVED = ["devbar:served-by-backend=0"][0];
const servedByBackend = SERVED.charAt(SERVED.length - 1) === "1";

const script = document.currentScript as HTMLScriptElement | null;
const enabled = script?.dataset.enabled !== "false";
if (enabled && !(window as unknown as Record<string, unknown>)[GLOBAL_NAME]) {
  let server = script?.dataset.server;
  let key = script?.dataset.key;
  if (script?.src) {
    const src = new URL(script.src, location.href);
    if (server === undefined && servedByBackend) server = src.origin + src.pathname.replace(/\/[^/]*$/, "");
    key ||= src.searchParams.get("key") ?? undefined;
  }
  // Listen from the first moment, before the page has a body, so early errors are kept.
  installConsoleBuffer(script?.src ?? null);
  mount({ server: server || undefined, enabled: true, key });
}
