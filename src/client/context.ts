import { toCanvas } from "html-to-image";

// ---------------------------------------------------------------------------------------------
// Console errors and warnings: a ring buffer of the last twenty, installed when the script loads.
// ---------------------------------------------------------------------------------------------

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

function push(entry: ConsoleEntry) {
  if (muted) return;
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

// ---------------------------------------------------------------------------------------------
// Page, browser and window
// ---------------------------------------------------------------------------------------------

export function pageInfo() {
  return { path: location.pathname + location.search, title: document.title, origin: location.origin };
}

interface UAData {
  brands?: Array<{ brand: string; version: string }>;
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ platformVersion?: string; fullVersionList?: Array<{ brand: string; version: string }> }>;
}

export async function browserInfo() {
  const ua = navigator.userAgent;
  let name = "Browser";
  let version = "";
  let os = "";
  const uad = (navigator as unknown as { userAgentData?: UAData }).userAgentData;
  const pick = (re: RegExp) => ua.match(re)?.[1] ?? "";
  if (/Edg\//.test(ua)) [name, version] = ["Edge", pick(/Edg\/(\d+)/)];
  else if (/OPR\//.test(ua)) [name, version] = ["Opera", pick(/OPR\/(\d+)/)];
  else if (/Firefox\//.test(ua)) [name, version] = ["Firefox", pick(/Firefox\/(\d+)/)];
  else if (/Chrome\//.test(ua)) [name, version] = ["Chrome", pick(/Chrome\/(\d+)/)];
  else if (/Safari\//.test(ua)) [name, version] = ["Safari", pick(/Version\/(\d+)/)];
  if (/iPhone|iPad|iPod/.test(ua)) os = `iOS ${pick(/OS (\d+)/)}`.trim();
  else if (/Android/.test(ua)) os = `Android ${pick(/Android (\d+)/)}`.trim();
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  // Chromium freezes the version in the user agent string; ask for the real one.
  if (uad?.getHighEntropyValues) {
    try {
      const hi = await uad.getHighEntropyValues(["platformVersion"]);
      const major = Number((hi.platformVersion ?? "").split(".")[0]);
      if (uad.platform === "macOS" && major) os = `macOS ${major}`;
      if (uad.platform === "Windows" && hi.platformVersion) os = major >= 13 ? "Windows 11" : "Windows 10";
    } catch {
      // keep what the string said
    }
  }
  if (os === "macOS") {
    const v = pick(/Mac OS X (\d+[._]\d+)/).replace("_", ".");
    if (v && v !== "10.15") os = `macOS ${v}`;
  }
  const viewport = `${window.innerWidth}x${window.innerHeight}`;
  const dpr = window.devicePixelRatio || 1;
  const touch = navigator.maxTouchPoints > 0;
  return {
    browser: `${name}${version ? ` ${version}` : ""}${os ? ` on ${os}` : ""}`,
    viewport,
    devicePixelRatio: dpr,
    touch,
    summary: `${name}${version ? ` ${version}` : ""} · ${os || "unknown OS"} · ${window.innerWidth}×${window.innerHeight} @${Math.round(dpr * 100) / 100}x · ${touch ? "touch" : "no touch"}`,
  };
}

// ---------------------------------------------------------------------------------------------
// The selected element
// ---------------------------------------------------------------------------------------------

export interface PickedElement {
  tag: string;
  id?: string;
  classes: string[];
  text?: string;
  selector: string;
  html: string;
  rect: { x: number; y: number; w: number; h: number };
}

const SIMPLE_CLASS = /^-?[A-Za-z_][\w-]*$/;

function unique(selector: string, el: Element): boolean {
  try {
    const found = document.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** A CSS selector that finds exactly this element, as short as the page allows. */
export function selectorFor(el: Element): string {
  if (el.id && unique(`#${CSS.escape(el.id)}`, el)) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    if (cur !== el && cur.id && unique(`#${CSS.escape(cur.id)}`, cur)) {
      parts.unshift(`#${CSS.escape(cur.id)}`);
    } else {
      let part = cur.tagName.toLowerCase();
      const classes = [...cur.classList].filter((c) => SIMPLE_CLASS.test(c)).slice(0, 2);
      part += classes.map((c) => `.${CSS.escape(c)}`).join("");
      const parent: Element | null = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === cur!.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
    }
    const candidate = parts.join(" > ");
    if (unique(candidate, el)) return candidate;
    if (parts[0].startsWith("#")) break;
    cur = cur.parentElement;
  }
  return parts.join(" > ");
}

export function describeElement(el: Element): PickedElement {
  const r = el.getBoundingClientRect();
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
  const shell = el.cloneNode(false) as Element;
  let open = shell.outerHTML;
  const close = `</${el.tagName.toLowerCase()}>`;
  if (open.endsWith(close)) open = open.slice(0, -close.length);
  if (open.length > 220) open = `${open.slice(0, 218)}…>`;
  const inner = el.children.length ? (text ? `${text.slice(0, 40)}${text.length > 40 ? "…" : ""}` : "…") : text.slice(0, 60);
  const isVoid = /^(img|input|br|hr|meta|link|source|area|col|embed|track|wbr)$/i.test(el.tagName);
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || undefined,
    classes: [...el.classList],
    text: text ? text.slice(0, 120) : undefined,
    selector: selectorFor(el),
    html: isVoid ? open : `${open}${inner}${close}`,
    rect: { x: round(r.left / innerWidth), y: round(r.top / innerHeight), w: round(r.width / innerWidth), h: round(r.height / innerHeight) },
  };
}

// ---------------------------------------------------------------------------------------------
// The screenshot: the page drawn into a canvas, with the toolbar left out.
// ---------------------------------------------------------------------------------------------

const MAX_SIDE = 1600;
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function pageBackground(): string {
  for (const el of [document.body, document.documentElement]) {
    if (!el) continue;
    const bg = getComputedStyle(el).backgroundColor;
    if (bg && bg !== "transparent" && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg)) return bg;
  }
  return "#ffffff";
}

/** The visible part of the page as a PNG data URL, long side at most 1600 px. */
export async function captureScreenshot(exclude: Element): Promise<{ dataUrl: string; width: number; height: number }> {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_SIDE / Math.max(w, h));
  const sx = window.scrollX;
  const sy = window.scrollY;
  const work = toCanvas(document.documentElement, {
    width: w,
    height: h,
    pixelRatio: ratio,
    skipAutoScale: true,
    backgroundColor: pageBackground(),
    imagePlaceholder: BLANK,
    filter: (node) => node !== exclude,
    // The document's own scroll: shift the page up and left, leaving fixed elements in place.
    style: { margin: "0", marginTop: `${-sy}px`, marginLeft: `${-sx}px`, height: `${h + sy}px`, width: `${w + sx}px` },
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("took longer than 20 seconds")), 20_000);
  });
  let canvas = await muteConsole(() => Promise.race([work, timeout]).finally(() => clearTimeout(timer)));
  const long = Math.max(canvas.width, canvas.height);
  if (long > MAX_SIDE) {
    const k = MAX_SIDE / long;
    const small = document.createElement("canvas");
    small.width = Math.round(canvas.width * k);
    small.height = Math.round(canvas.height * k);
    small.getContext("2d")!.drawImage(canvas, 0, 0, small.width, small.height);
    canvas = small;
  }
  const dataUrl = canvas.toDataURL("image/png");
  if (!dataUrl.startsWith("data:image/png")) throw new Error("the browser could not encode the image");
  return { dataUrl, width: canvas.width, height: canvas.height };
}
