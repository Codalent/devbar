/// <reference types="chrome" />
/**
 * The extension's service worker. Clicking the toolbar icon (or Alt+Shift+D) puts devbar on the
 * page: `console.js` into the page's own world, to hear its console, and `devbar.js` into the
 * extension's isolated world, where the page's CSP and scripts cannot reach the toolbar. Clicking
 * again folds or hides it. The click grants `activeTab`, which is also what lets the toolbar ask
 * for a screenshot of the tab here.
 */

import { CAPTURE } from "./shared.js";

chrome.action.onClicked.addListener((tab) => void activate(tab));

async function activate(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const target = { tabId: tab.id };
  try {
    await chrome.scripting.executeScript({ target, files: ["devbar.js"] });
    await chrome.scripting.executeScript({ target, files: ["console.js"], world: "MAIN" });
  } catch {
    // chrome:// pages, the Web Store, the PDF viewer, file:// without permission.
    await flag(tab.id, "devbar can't run on this page");
  }
}

async function flag(tabId: number, title: string): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#ff6b6b" });
  await chrome.action.setBadgeText({ tabId, text: "!" });
  await chrome.action.setTitle({ tabId, title });
  setTimeout(() => {
    void chrome.action.setBadgeText({ tabId, text: "" }).catch(() => undefined);
    void chrome.action.setTitle({ tabId, title: "" }).catch(() => undefined);
  }, 4000);
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== CAPTURE || sender.id !== chrome.runtime.id) return;
  const tab = sender.tab;
  // Only the tab that is on screen can be captured, and only the toolbar's own frame asks.
  if (!tab?.active || tab.windowId === undefined || sender.frameId !== 0) {
    reply({ error: "the tab is not on screen" });
    return;
  }
  chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" }).then(
    (dataUrl) => reply({ dataUrl }),
    (error: Error) => reply({ error: error.message }),
  );
  return true; // answers asynchronously
});
