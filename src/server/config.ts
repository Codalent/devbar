import { readFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_PORT, STATUSES, type ItemType, type Position, type Status, type Toggles } from "../name.js";

export interface Config {
  /** Shown in the board's header. */
  project: string;
  port: number;
  /** Where the dot sits until someone drags it. */
  position: Position;
  /** Opens and closes the board. `mod` is Ctrl on Windows and Linux, ⌘ on macOS. */
  shortcut: string;
  /** Folder name per status, inside the data folder, plus `assets` for screenshots. */
  folders: Record<Status, string> & { assets: string };
  /** Overrides of the default context toggles per item type. */
  toggles: Partial<Record<ItemType, Partial<Toggles>>>;
}

export function defaultConfig(project: string): Config {
  return {
    project,
    port: DEFAULT_PORT,
    position: "bottom-right",
    shortcut: "mod+shift+.",
    folders: {
      backlog: "backlog",
      open: "open",
      "in-progress": "in-progress",
      ready: "ready",
      closed: "closed",
      assets: "assets",
    },
    toggles: {},
  };
}

const SAFE_FOLDER = /^[A-Za-z0-9._-]+$/;

/** Reads config.json from the data folder; anything missing or malformed falls back to the default. */
export async function loadConfig(dataDir: string): Promise<{ config: Config; warnings: string[] }> {
  const fallbackProject = path.basename(path.dirname(path.resolve(dataDir)));
  const config = defaultConfig(fallbackProject);
  const warnings: string[] = [];
  let raw: string;
  try {
    raw = await readFile(path.join(dataDir, "config.json"), "utf8");
  } catch {
    return { config, warnings };
  }
  let parsed: Partial<Config>;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warnings.push(`config.json is not valid JSON (${(error as Error).message}); using defaults.`);
    return { config, warnings };
  }
  if (typeof parsed.project === "string" && parsed.project.trim()) config.project = parsed.project.trim();
  if (Number.isInteger(parsed.port) && parsed.port! > 0 && parsed.port! < 65536) config.port = parsed.port!;
  if (["bottom-right", "bottom-left", "top-right", "top-left"].includes(parsed.position as string)) {
    config.position = parsed.position as Position;
  }
  if (typeof parsed.shortcut === "string" && parsed.shortcut.trim()) config.shortcut = parsed.shortcut.trim();
  if (parsed.folders && typeof parsed.folders === "object") {
    for (const key of [...STATUSES, "assets"] as const) {
      const value = (parsed.folders as Record<string, unknown>)[key];
      if (value === undefined) continue;
      if (typeof value === "string" && SAFE_FOLDER.test(value) && value !== "." && value !== "..") {
        config.folders[key] = value;
      } else {
        warnings.push(`config.json folders.${key} must be a plain folder name; using "${config.folders[key]}".`);
      }
    }
    const names = Object.values(config.folders);
    if (new Set(names).size !== names.length) {
      warnings.push("config.json folders must all differ; using the default folder names.");
      config.folders = defaultConfig(config.project).folders;
    }
  }
  if (parsed.toggles && typeof parsed.toggles === "object") {
    for (const type of ["task", "bug", "idea"] as const) {
      const t = (parsed.toggles as Record<string, unknown>)[type];
      if (!t || typeof t !== "object") continue;
      const clean: Partial<Toggles> = {};
      for (const [k, v] of Object.entries(t)) {
        if (["screenshot", "page", "browser", "console", "element"].includes(k) && typeof v === "boolean") {
          clean[k as keyof Toggles] = v;
        }
      }
      config.toggles[type] = clean;
    }
  }
  return { config, warnings };
}
