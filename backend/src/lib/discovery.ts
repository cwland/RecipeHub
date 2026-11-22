import { isOn } from "./features.js";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { discoveryFeeds, discoveryItems } from "../db/schema.js";
import { fetchUrl, type FetchOptions } from "./fetchPage.js";
import { feedLinkIn, parseFeed, type Feed } from "./rss.js";
import { logEvent } from "./appLog.js";

// Discovery's feeds: fetched with the same guarded fetch as imports (no private addresses), read
// with plain code (lib/rss.ts), stored; checked every few hours. No AI anywhere in here.

const KEEP_DAYS = 60;
const FEED_TYPES = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.5, */*;q=0.1";

// Fetch an address and read it as a feed. A website's page that names its feed: that feed.
export async function readFeedAt(url: string, opts: FetchOptions = {}): Promise<{ url: string; feed: Feed }> {
  const page = await fetchUrl(url, { ...opts, accept: FEED_TYPES, maxBytes: 8 * 1024 * 1024 });
  const body = page.body.toString("utf8");
  try {
    return { url: page.url, feed: parseFeed(body, page.url) };
  } catch (e) {
    const named = /<html[\s>]/i.test(body) ? feedLinkIn(body, page.url) : null;
    if (!named || named === page.url) throw e;
    const again = await fetchUrl(named, { ...opts, accept: FEED_TYPES, maxBytes: 8 * 1024 * 1024 });
    return { url: again.url, feed: parseFeed(again.body.toString("utf8"), again.url) };
  }
}

const iconFor = (feed: Feed, feedUrl: string) => feed.iconUrl ?? `${new URL(feed.siteUrl ?? feedUrl).origin}/favicon.ico`;

// Store what a feed has now: new posts added, changed ones updated, all marked as seen
export async function storeItems(db: Db, feedId: number, feed: Feed) {
  const now = new Date();
  const seen = new Map(feed.items.map((i) => [i.guid, i])); // a guid listed twice: the first one
  const rows = [...seen.values()].map((i) => ({ feedId, guid: i.guid, title: i.title, link: i.link, pubDate: i.pubDate, author: i.author, categories: i.categories, description: i.description, contentHtml: i.contentHtml, thumbnailUrl: i.thumbnailUrl, lastSeenAt: now }));
  if (!rows.length) return 0;
  const before = rows.length ? (await db.select({ guid: discoveryItems.guid }).from(discoveryItems).where(and(eq(discoveryItems.feedId, feedId), inArray(discoveryItems.guid, rows.map((r) => r.guid))))).length : 0;
  await db
    .insert(discoveryItems)
    .values(rows)
    .onConflictDoUpdate({
      target: [discoveryItems.feedId, discoveryItems.guid],
      set: { title: sql`excluded.title`, link: sql`excluded.link`, pubDate: sql`coalesce(excluded.pub_date, ${discoveryItems.pubDate})`, author: sql`excluded.author`, categories: sql`excluded.categories`, description: sql`excluded.description`, contentHtml: sql`excluded.content_html`, thumbnailUrl: sql`excluded.thumbnail_url`, lastSeenAt: sql`excluded.last_seen_at` },
    });
  return rows.length - before;
}

export async function refreshFeed(db: Db, feedId: number, opts: FetchOptions = {}) {
  const [f] = await db.select().from(discoveryFeeds).where(eq(discoveryFeeds.id, feedId));
  if (!f) return { added: 0, error: null };
  try {
    const { feed } = await readFeedAt(f.url, opts);
    const added = await storeItems(db, f.id, feed);
    await db.update(discoveryFeeds).set({ title: feed.title, siteUrl: feed.siteUrl, iconUrl: iconFor(feed, f.url), lastFetchedAt: new Date(), lastError: null }).where(eq(discoveryFeeds.id, f.id));
    return { added, error: null };
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    await db.update(discoveryFeeds).set({ lastFetchedAt: new Date(), lastError: error }).where(eq(discoveryFeeds.id, f.id));
    return { added: 0, error };
  }
}

// Every feed, then posts gone from their feed for 60 days are dropped
export async function refreshAllFeeds(db: Db, opts: FetchOptions = {}) {
  const feeds = await db.select({ id: discoveryFeeds.id, title: discoveryFeeds.title }).from(discoveryFeeds);
  let added = 0;
  const failed: string[] = [];
  for (const f of feeds) {
    const r = await refreshFeed(db, f.id, opts);
    added += r.added;
    if (r.error) failed.push(`${f.title}: ${r.error}`);
  }
  await db.delete(discoveryItems).where(lt(discoveryItems.lastSeenAt, new Date(Date.now() - KEEP_DAYS * 86400_000)));
  if (failed.length) await logEvent(db, { category: "import", level: "warning", source: "Discovery", event: `${failed.length} feed${failed.length === 1 ? "" : "s"} couldn't be checked`, detail: failed.join("\n").slice(0, 2000) });
  return { feeds: feeds.length, added, failed: failed.length };
}

// Every few hours (DISCOVERY_HOURS, 0 turns it off); one at a time
// The timed check: only while the Discovery refresh switch is on (null: switched off)
export async function scheduledRefresh(db: Db, opts: FetchOptions) {
  if (!(await isOn(db, "discoveryRefresh"))) return null;
  return refreshAllFeeds(db, opts);
}

export function startDiscoverySchedule(db: Db, opts: FetchOptions, hours: number, onError: (e: unknown) => void) {
  if (!(hours > 0)) return () => {};
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    await scheduledRefresh(db, opts).catch(onError);
    running = false;
  };
  const timer = setInterval(run, hours * 3600_000);
  timer.unref();
  setTimeout(run, 60_000).unref();
  return () => clearInterval(timer);
}

export const newFeedRow = (url: string, feed: Feed, createdBy: number | null) => ({ url, title: feed.title, siteUrl: feed.siteUrl, iconUrl: iconFor(feed, url), lastFetchedAt: new Date(), createdBy });
