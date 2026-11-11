/** Names the extension's scripts share. The session's shapes are in ../session/model.ts. */

/** The toolbar asks the service worker for a screenshot of the tab. */
export const CAPTURE = "devbar:capture";

/** The page-world listener hands a console entry to the toolbar (detail: the entry as JSON). */
export const CONSOLE_EVENT = "devbar:console";

/** chrome.storage.local keys. Only the service worker writes them; the pages read and listen. */
export const SESSION_KEY = "session";
export const shotKey = (commentId: string): string => `shot:${commentId}`;
