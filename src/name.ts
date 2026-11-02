/**
 * The product's name lives here and in package.json `name`, nowhere else. Renaming the package is
 * changing these two places: the data folder, the CLI banner, the custom element, the
 * localStorage keys and the one global all derive from it.
 */
export const NAME = "devbar";

/** The data folder in the project root. */
export const DIR_NAME = `.${NAME}`;

/** The one global the widget sets, for debugging. */
export const GLOBAL_NAME = `__${NAME}`;

/** The custom element the widget registers (must contain a hyphen). */
export const ELEMENT_NAME = `${NAME}-toolbar`;

/** Prefix for the widget's localStorage keys. */
export const STORAGE_PREFIX = `${NAME}:`;

export const DEFAULT_PORT = 4711;

/** Fixed in v1, in board order. `ready` means "approved, ready to build". */
export const STATUSES = ["backlog", "open", "in-progress", "ready", "closed"] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  backlog: "Backlog",
  open: "Open",
  "in-progress": "In progress",
  ready: "Ready",
  closed: "Closed",
};

export const TYPES = ["task", "bug", "idea"] as const;
export type ItemType = (typeof TYPES)[number];

export const PRIORITIES = ["low", "normal", "high"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CONTEXT_KEYS = ["screenshot", "page", "browser", "console", "element"] as const;
export type ContextKey = (typeof CONTEXT_KEYS)[number];
export type Toggles = Record<ContextKey, boolean>;

/** Defaults per item type: everything for a bug, page and browser for a task, page for an idea. */
export const DEFAULT_TOGGLES: Record<ItemType, Toggles> = {
  bug: { screenshot: true, page: true, browser: true, console: true, element: true },
  task: { screenshot: false, page: true, browser: true, console: false, element: false },
  idea: { screenshot: false, page: true, browser: false, console: false, element: false },
};

export type Position = "bottom-right" | "bottom-left" | "top-right" | "top-left";

/** What the widget learns from the server (part of GET /api/health). */
export interface WidgetConfig {
  project: string;
  dir: string;
  position: Position;
  shortcut: string;
  toggles: Partial<Record<ItemType, Partial<Toggles>>>;
  folders: Record<Status, string>;
  /** The screenshots folder, inside the data folder. */
  assets: string;
}
