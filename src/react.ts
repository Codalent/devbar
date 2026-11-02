"use client";
import { createElement, useEffect, version } from "react";

export interface DevBarProps {
  /** The devbar server. Default http://127.0.0.1:4711. */
  server?: string;
  /**
   * Force it on or off. By default it renders only when process.env.NODE_ENV is "development",
   * so a production build renders nothing and loads nothing.
   */
  enabled?: boolean;
}

const DEFAULT_SERVER = "http://127.0.0.1:4711";
const GLOBAL = "__devbar";
const MARK = "data-devbar-loader";

/** Whether <DevBar /> loads anything, for these props in this build. */
export function shouldLoad(props: DevBarProps = {}): boolean {
  if (props.enabled !== undefined) return props.enabled;
  try {
    return process.env.NODE_ENV === "development";
  } catch {
    return false;
  }
}

const reactMajor = Number.parseInt(version, 10) || 0;

/**
 * Loads the toolbar from the local devbar server, once. Render it once in the root layout.
 * React 19 hoists the script into <head> (so it hears console errors from the start); on React 18
 * it is added after the first render.
 */
export function DevBar(props: DevBarProps): ReturnType<typeof createElement> | null {
  const on = shouldLoad(props);
  const src = `${(props.server ?? DEFAULT_SERVER).replace(/\/+$/, "")}/devbar.js`;
  useEffect(() => {
    if (!on || reactMajor >= 19) return;
    const w = window as unknown as Record<string, unknown>;
    if (w[GLOBAL] || document.querySelector(`script[${MARK}]`)) return;
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.setAttribute(MARK, "");
    document.head.appendChild(script);
  }, [on, src]);
  if (!on || reactMajor < 19) return null;
  return createElement("script", { src, async: true, [MARK]: "" });
}

export default DevBar;
