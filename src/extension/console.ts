/**
 * Runs in the page's own world, where the page's console is. Each error and warning (and uncaught
 * error and rejection) goes to the toolbar in the isolated world as a DOM event. Injected each time
 * the icon is clicked; only the first run listens.
 */
import { forwardConsole, installConsoleBuffer } from "../client/console.js";
import { CONSOLE_EVENT } from "./shared.js";

const w = window as unknown as Record<string, unknown>;
if (!w.__devbarConsole) {
  w.__devbarConsole = true;
  forwardConsole((entry) => document.dispatchEvent(new CustomEvent(CONSOLE_EVENT, { detail: JSON.stringify(entry) })));
  installConsoleBuffer(null);
}
