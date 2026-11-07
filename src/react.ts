"use client";
import { useEffect } from "react";

export interface DevBarProps {
  /**
   * Your devbar backend, e.g. `http://127.0.0.1:4711` (the local server) or
   * `https://api.example.com/devbar`. Leave it out and there is no backend: Save downloads each
   * item as a Markdown file (a zip when it has a screenshot), and there is no board.
   */
  server?: string;
  /**
   * Force it on or off. By default it renders only when process.env.NODE_ENV is "development",
   * so a production build renders nothing and loads nothing.
   */
  enabled?: boolean;
  /** The backend's shared key, when it has one. (`key` itself is reserved by React.) */
  apiKey?: string;
}

/** Whether <DevBar /> loads anything, for these props in this build. */
export function shouldLoad(props: DevBarProps = {}): boolean {
  if (props.enabled !== undefined) return props.enabled;
  try {
    return process.env.NODE_ENV === "development";
  } catch {
    return false;
  }
}

type Client = typeof import("@codalent/devbar/client");
let client: Promise<Client> | null = null;

/** The widget module, loaded once; it starts keeping console errors the moment it arrives. */
function load(): Promise<Client> {
  client ??= import("@codalent/devbar/client").then((m) => {
    m.listen();
    return m;
  });
  return client;
}

/**
 * The toolbar. Render it once, in the root layout. The widget is a separate chunk your bundler
 * loads only when it is on, so a production build carries none of it.
 */
export function DevBar(props: DevBarProps): null {
  const on = shouldLoad(props);
  // Start loading during the first render rather than after it, to hear errors from hydration.
  if (on && typeof window !== "undefined") void load();
  const { server, apiKey } = props;
  useEffect(() => {
    if (!on) return;
    void load().then((m) => m.mount({ server, key: apiKey, enabled: true }));
  }, [on, server, apiKey]);
  return null;
}

export default DevBar;
