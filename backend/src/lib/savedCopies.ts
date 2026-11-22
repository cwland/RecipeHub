import { BlockedError, detectBlock } from "./blocked.js";
import { fetchUrl, type FetchOptions } from "./fetchPage.js";
import { HttpError } from "./errors.js";
import { APP_VERSION } from "./version.js";

// A saved copy of a page the site kept from us: the Wayback Machine first (its raw copy keeps the
// recipe data), then archive.ph and its other addresses (archive.today, .is, .li: one service, so
// a security check on one is on them all, and RecipeHub stops there and hands you the link).
//
// Archives are asked as RecipeHub, not as a browser: the Wayback Machine turns away apps dressed as
// a browser, and answers RecipeHub fine.

export const ARCHIVE_AGENT = `RecipeHub/${APP_VERSION} (self-hosted recipe manager; +https://github.com/cwland/RecipeHub)`;
const ARCHIVE_PH = ["archive.ph", "archive.today", "archive.is", "archive.li"];

export type CopyOutcome = "none" | "captcha" | "failed" | "no-recipe";
export interface CopyAttempt {
  from: string;
  outcome: CopyOutcome;
  link?: string; // a security check: open it yourself
}
export interface Copy {
  from: string;
  url: string; // the copy, to show people
  date?: string; // YYYY-MM-DD
  html: string;
  pageUrl: string; // where the html came from (for relative links)
}

// read(copy) gives the recipe or null (no recipe there); trying(name) says which archive is next
export async function findSavedCopy<R>(url: string, opts: FetchOptions, read: (copy: Copy) => Promise<R | null>, trying: (from: string) => Promise<void> = async () => {}) {
  const tried: CopyAttempt[] = [];
  const fetchOpts = { ...opts, userAgent: ARCHIVE_AGENT };
  const fetchHtml = (u: string) => fetchUrl(u, fetchOpts).then((p) => ({ ...p, html: p.body.toString("utf8") }));
  const failed = (e: unknown): CopyOutcome => (e instanceof BlockedError && e.block.reason === "captcha" ? "captcha" : /answered 404/.test((e as Error).message) ? "none" : "failed");

  // Wayback Machine: ask for the newest copy, then fetch it raw (id_: the page as it was, no toolbar)
  await trying("Wayback Machine");
  try {
    const api = await fetchUrl(`https://archive.org/wayback/available?url=${encodeURIComponent(url)}`, { ...fetchOpts, accept: "application/json" });
    const closest = (JSON.parse(api.body.toString("utf8")) as { archived_snapshots?: { closest?: { available?: boolean; status?: string; timestamp?: string } } }).archived_snapshots?.closest;
    const ts = closest?.available && closest.status === "200" && /^\d{14}$/.test(closest.timestamp ?? "") ? closest.timestamp! : null;
    if (!ts) tried.push({ from: "Wayback Machine", outcome: "none" });
    else {
      const shown = `https://web.archive.org/web/${ts}/${url}`;
      try {
        const page = await fetchHtml(`https://web.archive.org/web/${ts}id_/${url}`);
        const copy: Copy = { from: "Wayback Machine", url: shown, date: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`, html: page.html, pageUrl: url };
        const r = await read(copy);
        if (r) return { found: { recipe: r, copy }, tried };
        tried.push({ from: "Wayback Machine", outcome: "no-recipe" });
      } catch (e) {
        const outcome = failed(e);
        tried.push({ from: "Wayback Machine", outcome, ...(outcome === "captcha" ? { link: shown } : {}) });
      }
    }
  } catch (e) {
    if (e instanceof HttpError) throw e; // not a web address at all
    tried.push({ from: "Wayback Machine", outcome: failed(e) });
  }

  // archive.ph and its other addresses: /newest/ goes to the latest copy
  for (const host of ARCHIVE_PH) {
    await trying(host);
    const link = `https://${host}/newest/${url}`;
    try {
      const page = await fetchHtml(link);
      const check = detectBlock(200, page.html);
      if (check?.reason === "captcha") throw new BlockedError(check, host);
      const copy: Copy = { from: host, url: page.url, html: page.html, pageUrl: page.url };
      const r = await read(copy);
      if (r) return { found: { recipe: r, copy }, tried };
      tried.push({ from: host, outcome: "no-recipe" });
      break; // the same copy on every address
    } catch (e) {
      const outcome = failed(e);
      tried.push({ from: host, outcome, ...(outcome === "captcha" ? { link } : {}) });
      if (outcome === "captcha") break; // one security check for them all
    }
  }
  return { found: null, tried };
}

// "No saved copy could be found either." / "…read either: archive.ph asked for a security check."
export function copiesMessage(tried: CopyAttempt[]) {
  if (tried.every((t) => t.outcome === "none")) return "No saved copy could be found either.";
  const check = tried.find((t) => t.outcome === "captcha");
  return `No saved copy could be read either${check ? `: ${check.from} asked for a security check` : ""}.`;
}
