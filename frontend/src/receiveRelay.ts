// /receive.html, the Send to RecipeHub relay. The bookmark opens it from the recipe's tab and sends
// the page. The app itself can't be handed it (its Cross-Origin-Opener-Policy cuts the link to
// that tab), so this page takes it, keeps it in this browser for a moment, and opens the app at
// #/recipes/receive, which asks before importing. Only the tab that opened it is listened to.

const KEY = "recipehub-sent-page";
const FRESH = 10 * 60_000; // a page older than this isn't offered
const MAX = 8 * 1024 * 1024; // what the server takes

export interface SentPage {
  url: string;
  html: string;
}

export function relay(win: Window) {
  let done = false;
  win.addEventListener("message", (e: MessageEvent) => {
    if (done || !win.opener || e.source !== win.opener) return;
    const d = e.data as { recipehub?: string; url?: unknown; html?: unknown } | null;
    if (!d || d.recipehub !== "page" || typeof d.url !== "string" || !/^https?:\/\//i.test(d.url) || typeof d.html !== "string" || d.html.length > MAX) return;
    done = true;
    (e.source as Window).postMessage("recipehub:got", "*"); // stop sending (it carries nothing)
    try {
      localStorage.setItem(KEY, JSON.stringify({ url: d.url, html: d.html, at: Date.now() }));
      win.location.replace("/#/recipes/receive");
    } catch {
      win.location.replace("/#/recipes/receive?too-big=1"); // more than this browser will keep
    }
  });
}

// The app: the page the relay kept (once; then it's gone)
export function takeSentPage(): SentPage | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    const p = JSON.parse(raw) as { url?: unknown; html?: unknown; at?: unknown };
    if (typeof p.url !== "string" || !/^https?:\/\//i.test(p.url) || typeof p.html !== "string" || typeof p.at !== "number" || Date.now() - p.at > FRESH) return null;
    return { url: p.url, html: p.html };
  } catch {
    return null;
  }
}
