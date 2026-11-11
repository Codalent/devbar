/**
 * Console errors and warnings: a ring buffer of the last twenty, installed when the script loads.
 * Kept apart from the rest of the context so the browser extension's page-world listener stays small.
 */

export interface ConsoleEntry {
  level: "error" | "warn";
  message: string;
  source?: string;
  time: number;
}

const LIMIT = 20;
const buffer: ConsoleEntry[] = [];
let installed = false;
let muted = 0;
let forward: ((entry: ConsoleEntry) => void) | null = null;

/** Our own noise (the screenshot library's warnings) is not the page's. */
export function muteConsole<T>(work: () => Promise<T>): Promise<T> {
  muted++;
  return work().finally(() => muted--);
}

function format(args: unknown[]): string {
  // printf-style substitution, as React's development warnings use it.
  let rest = [...args];
  let out = "";
  if (typeof rest[0] === "string" && /%[sdifoOc]/.test(rest[0])) {
    const fmt = rest.shift() as string;
    out = fmt.replace(/%([sdifoOc%])/g, (m, k) => {
      if (k === "%") return "%";
      if (!rest.length) return m;
      const v = rest.shift();
      if (k === "c") return "";
      if (k === "d" || k === "i") return String(parseInt(String(v), 10));
      if (k === "f") return String(parseFloat(String(v)));
      return describe(v);
    });
  }
  return [out, ...rest.map(describe)].filter((s) => s !== "").join(" ");
}

function describe(v: unknown): string {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name === "Error" ? "" : `${v.name}: `}${v.message}` || String(v);
  if (v === undefined) return "undefined";
  try {
    const json = JSON.stringify(v);
    return json && json.length > 300 ? `${json.slice(0, 299)}…` : String(json);
  } catch {
    return String(v);
  }
}

/** `page.tsx:42` from the first stack frame that is not this script. */
function callerSource(skipScript: string | null): string | undefined {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n").slice(1)) {
    if (skipScript && line.includes(skipScript)) continue;
    const m = line.match(/(?:\(|@|at )((?:https?|file|webpack[^:]*):\/\/[^\s)]+?):(\d+)(?::\d+)?\)?\s*$/);
    if (m) {
      const file = m[1].split(/[?#]/)[0].split("/").pop() || m[1];
      return `${file}:${m[2]}`;
    }
  }
  return undefined;
}

const listeners = new Set<(entry: ConsoleEntry) => void>();

/** Hear each entry as it is kept (a feedback session keeps them per page). Returns a function that stops. */
export function onConsoleEntry(fn: (entry: ConsoleEntry) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function push(entry: ConsoleEntry) {
  if (muted) return;
  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      // a listener's problem is not the page's
    }
  }
  if (forward) {
    forward(entry);
    return;
  }
  buffer.push(entry);
  if (buffer.length > LIMIT) buffer.splice(0, buffer.length - LIMIT);
}

export function installConsoleBuffer(ownScript: string | null): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  for (const level of ["error", "warn"] as const) {
    const original = console[level];
    console[level] = function (this: Console, ...args: unknown[]) {
      try {
        const err = args.find((a): a is Error => a instanceof Error);
        const fromStack = err?.stack?.split("\n").slice(1).map((l) => l.match(/\/([^/\s)]+?):(\d+)(?::\d+)?\)?\s*$/)).find(Boolean);
        push({
          level,
          message: format(args),
          source: fromStack ? `${fromStack[1].split(/[?#]/)[0]}:${fromStack[2]}` : callerSource(ownScript),
          time: Date.now(),
        });
      } catch {
        // never break the page's console
      }
      return original.apply(this, args);
    };
  }
  window.addEventListener(
    "error",
    (event) => {
      const target = event.target as Element | null;
      if (target && target !== (window as unknown as Element) && "tagName" in target) {
        // A resource that failed to load (img, script, link): the browser logs it, scripts never see it.
        const src = (target as HTMLImageElement).currentSrc || (target as HTMLImageElement).src || (target as HTMLLinkElement).href;
        push({ level: "error", message: `Failed to load ${target.tagName.toLowerCase()} ${src ?? ""}`.trim(), time: Date.now() });
        return;
      }
      const file = event.filename ? `${event.filename.split(/[?#]/)[0].split("/").pop()}:${event.lineno}` : undefined;
      push({ level: "error", message: `Uncaught ${event.error instanceof Error ? describe(event.error) : event.message}`, source: file, time: Date.now() });
    },
    true,
  );
  window.addEventListener("unhandledrejection", (event) => {
    push({ level: "error", message: `Unhandled rejection: ${describe(event.reason)}`, time: Date.now() });
  });
}

export const consoleEntries = (): ConsoleEntry[] => buffer.slice();

/**
 * Hand each entry to `fn` instead of keeping it. The browser extension listens in the page's own
 * world, where the page's console is, and passes entries to the toolbar in its isolated world.
 */
export function forwardConsole(fn: (entry: ConsoleEntry) => void): void {
  forward = fn;
}

/** Keep an entry that was caught elsewhere (see forwardConsole). */
export function addConsoleEntry(entry: ConsoleEntry): void {
  push(entry);
}
