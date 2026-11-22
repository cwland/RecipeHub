import * as cheerio from "cheerio";
import type { AnyNode, Element } from "domhandler";

// Discovery's feed reader: RSS 2.0, RSS 1.0 (RDF) and Atom, read with plain code (no AI anywhere in
// fetching, reading, filtering or showing a feed). Each post's own HTML is made safe here, once,
// before it's stored: only text formatting, lists, headings, tables, links and pictures are kept.

export interface FeedItem {
  guid: string;
  title: string;
  link: string | null;
  pubDate: Date | null;
  author: string | null;
  categories: string[];
  description: string | null; // plain text, for cards and tag matching
  contentHtml: string | null; // safe HTML, for the detail view
  thumbnailUrl: string | null;
}
export interface Feed {
  title: string;
  siteUrl: string | null;
  iconUrl: string | null;
  items: FeedItem[];
}

const NOT_A_FEED = "That address isn't an RSS or Atom feed";

// ---------- small helpers ----------

const absolute = (url: string | undefined | null, base: string): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url.trim(), base);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
};
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
// HTML (or text with entities) to plain text
const textOf = (html: string) => clean(cheerio.load(`<div>${html}</div>`, null, false)("div").text());
const isImageUrl = (u: string) => /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i.test(u);
const date = (s: string | undefined) => {
  if (!s?.trim()) return null;
  const d = new Date(s.trim());
  return Number.isNaN(d.getTime()) ? null : d;
};

// ---------- making HTML safe ----------

const KEEP = new Set(["p", "br", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "strong", "b", "em", "i", "u", "blockquote", "figure", "figcaption", "a", "img", "hr", "table", "thead", "tbody", "tr", "td", "th", "pre", "code", "sup", "sub"]);
const DROP = new Set(["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "noscript", "svg", "math", "template", "link", "meta", "head", "title", "video", "audio", "canvas"]);
const VOID = new Set(["br", "img", "hr"]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escAttr = (s: string) => esc(s).replace(/"/g, "&quot;");

export function sanitizeHtml(html: string, base: string): string {
  const $ = cheerio.load(html, null, false);
  const out: string[] = [];
  const walk = (nodes: AnyNode[]) => {
    for (const n of nodes) {
      if (n.type === "text") out.push(esc((n as unknown as { data: string }).data));
      else if (n.type === "tag" || n.type === "script" || n.type === "style") {
        const el = n as Element;
        let tag = el.tagName.toLowerCase();
        if (DROP.has(tag)) continue;
        if (tag === "h1") tag = "h2"; // the page has its own title
        if (!KEEP.has(tag)) {
          walk(el.children); // a wrapper (div, span, section…): keep what's inside
          continue;
        }
        let attrs = "";
        if (tag === "a") {
          const href = absolute(el.attribs.href, base);
          if (!href) {
            walk(el.children); // a link to somewhere unsafe: just its text
            continue;
          }
          attrs = ` href="${escAttr(href)}" target="_blank" rel="noopener noreferrer"`;
        }
        if (tag === "img") {
          const src = absolute(el.attribs.src ?? el.attribs["data-src"], base);
          if (!src) continue;
          // lazy, and without telling the site which page shows it
          attrs = ` src="${escAttr(src)}"${el.attribs.alt ? ` alt="${escAttr(el.attribs.alt)}"` : ""} loading="lazy" referrerpolicy="no-referrer"`;
        }
        out.push(`<${tag}${attrs}>`);
        if (VOID.has(tag)) continue;
        walk(el.children);
        out.push(`</${tag}>`);
      }
      // comments, processing instructions, CDATA wrappers: CDATA's text comes through as text
      else if (n.type === "cdata") walk((n as unknown as { children: AnyNode[] }).children);
    }
  };
  walk($.root().contents().toArray());
  return out.join("").trim();
}

// ---------- reading a feed ----------

// The children of el named exactly `name` (feeds use namespaced names like content:encoded)
function kids(el: Element, name: string): Element[] {
  return el.children.filter((c): c is Element => c.type === "tag" && (c as Element).tagName.toLowerCase() === name);
}
const kid = (el: Element, name: string) => kids(el, name)[0];
const txt = ($: cheerio.CheerioAPI, el: Element | undefined) => (el ? $(el).text().trim() : "");

export function parseFeed(xml: string, feedUrl: string): Feed {
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(xml, { xml: { xmlMode: true, decodeEntities: true } });
  } catch {
    throw new Error(NOT_A_FEED);
  }
  const root = $.root().children().toArray().find((n): n is Element => n.type === "tag");
  const rootName = root?.tagName.toLowerCase();
  if (!root || !["rss", "feed", "rdf:rdf"].includes(rootName!)) throw new Error(NOT_A_FEED);

  if (rootName === "feed") return atomFeed($, root, feedUrl);
  const channel = rootName === "rss" ? kid(root, "channel") : kid(root, "channel");
  if (!channel) throw new Error(NOT_A_FEED);
  const siteUrl = absolute(txt($, kid(channel, "link")), feedUrl);
  const image = kid(channel, "image");
  const iconUrl = absolute(image && txt($, kid(image, "url")), feedUrl) ?? absolute($(kid(channel, "itunes:image")).attr("href"), feedUrl);
  // RSS 2.0: items in the channel; RSS 1.0: items beside it
  const itemEls = rootName === "rss" ? kids(channel, "item") : kids(root, "item");
  const items = itemEls.map((it) => rssItem($, it, feedUrl)).filter((i): i is FeedItem => !!i);
  return { title: txt($, kid(channel, "title")) || new URL(feedUrl).hostname, siteUrl, iconUrl, items };
}

function pictureIn(html: string | null, base: string): string | null {
  if (!html) return null;
  const src = cheerio.load(html, null, false)("img").first().attr("src");
  return absolute(src, base);
}

function rssItem($: cheerio.CheerioAPI, it: Element, feedUrl: string): FeedItem | null {
  const link = absolute(txt($, kid(it, "link")) || $(kid(it, "link")).attr("href"), feedUrl);
  const base = link ?? feedUrl;
  const title = textOf(txt($, kid(it, "title")));
  const descHtml = txt($, kid(it, "description"));
  const contentRaw = txt($, kid(it, "content:encoded"));
  const contentSource = contentRaw || descHtml;
  const contentHtml = contentSource ? sanitizeHtml(/<[a-z]/i.test(contentSource) ? contentSource : `<p>${esc(contentSource)}</p>`, base) || null : null;
  const description = descHtml ? textOf(descHtml).slice(0, 600) : contentRaw ? textOf(contentRaw).slice(0, 600) : null;
  const guid = txt($, kid(it, "guid")) || link || `${title}|${txt($, kid(it, "pubdate"))}`;
  if (!title && !link) return null;
  // the picture: media:content (an image), media:thumbnail, an image enclosure, itunes:image, the post's first image
  const media = [...kids(it, "media:content"), ...kids(it, "media:group").flatMap((g) => kids(g, "media:content"))].find((m) => m.attribs.medium === "image" || /^image\//.test(m.attribs.type ?? "") || isImageUrl(m.attribs.url ?? ""));
  const thumb = kid(it, "media:thumbnail");
  const enclosure = kids(it, "enclosure").find((e) => /^image\//.test(e.attribs.type ?? "") || isImageUrl(e.attribs.url ?? ""));
  const thumbnailUrl =
    absolute(media?.attribs.url, base) ?? absolute(thumb?.attribs.url, base) ?? absolute(enclosure?.attribs.url, base) ?? absolute($(kid(it, "itunes:image")).attr("href"), base) ?? pictureIn(contentRaw, base) ?? pictureIn(descHtml, base);
  const categories = [...kids(it, "category"), ...kids(it, "dc:subject")].map((c) => textOf($(c).text())).filter(Boolean);
  return {
    guid: guid.slice(0, 1000),
    title: (title || link || "Untitled").slice(0, 300),
    link,
    pubDate: date(txt($, kid(it, "pubdate"))) ?? date(txt($, kid(it, "dc:date"))),
    author: (txt($, kid(it, "dc:creator")) || txt($, kid(it, "author")) || null)?.slice(0, 200) ?? null,
    categories: [...new Set(categories)].slice(0, 30),
    description,
    contentHtml,
    thumbnailUrl,
  };
}

function atomFeed($: cheerio.CheerioAPI, feed: Element, feedUrl: string): Feed {
  const linkOf = (el: Element) => {
    const links = kids(el, "link");
    const alt = links.find((l) => !l.attribs.rel || l.attribs.rel === "alternate") ?? links.find((l) => l.attribs.rel !== "self");
    return absolute(alt?.attribs.href, feedUrl);
  };
  const textish = (el: Element | undefined) => {
    if (!el) return "";
    const t = $(el).text();
    return el.attribs.type === "html" || el.attribs.type === "xhtml" ? textOf(t) : clean(t);
  };
  const items = kids(feed, "entry")
    .map((e): FeedItem | null => {
      const link = linkOf(e);
      const base = link ?? feedUrl;
      const title = textish(kid(e, "title"));
      if (!title && !link) return null;
      const content = kid(e, "content");
      const summary = kid(e, "summary");
      const contentRaw = content ? $(content).text() : "";
      const summaryRaw = summary ? $(summary).text() : "";
      const html = contentRaw || summaryRaw;
      const isHtml = (el: Element | undefined) => !!el && (el.attribs.type === "html" || el.attribs.type === "xhtml" || /<[a-z]/i.test($(el).text()));
      const contentHtml = html ? sanitizeHtml(isHtml(content ?? summary) ? html : `<p>${esc(html)}</p>`, base) || null : null;
      const media = kids(e, "media:content").find((m) => m.attribs.medium === "image" || isImageUrl(m.attribs.url ?? ""));
      const enclosure = kids(e, "link").find((l) => l.attribs.rel === "enclosure" && /^image\//.test(l.attribs.type ?? ""));
      return {
        guid: (txt($, kid(e, "id")) || link || title).slice(0, 1000),
        title: (title || link || "Untitled").slice(0, 300),
        link,
        pubDate: date(txt($, kid(e, "published"))) ?? date(txt($, kid(e, "updated"))),
        author: (kid(e, "author") && txt($, kid(kid(e, "author"), "name"))) || null,
        categories: [...new Set(kids(e, "category").map((c) => clean(c.attribs.term ?? c.attribs.label ?? $(c).text())).filter(Boolean))].slice(0, 30),
        description: (summaryRaw ? textOf(summaryRaw) : contentRaw ? textOf(contentRaw) : "").slice(0, 600) || null,
        contentHtml,
        thumbnailUrl: absolute(media?.attribs.url, base) ?? absolute($(kid(e, "media:thumbnail")).attr("url"), base) ?? absolute(enclosure?.attribs.href, base) ?? pictureIn(contentRaw || summaryRaw, base),
      };
    })
    .filter((i): i is FeedItem => !!i);
  return {
    title: textish(kid(feed, "title")) || new URL(feedUrl).hostname,
    siteUrl: linkOf(feed),
    iconUrl: absolute(txt($, kid(feed, "icon")) || txt($, kid(feed, "logo")), feedUrl),
    items,
  };
}

// A website's page that names its feed (<link rel="alternate" type="application/rss+xml" href=…>)
export function feedLinkIn(html: string, pageUrl: string): string | null {
  const $ = cheerio.load(html);
  const link = $('link[rel~="alternate"]')
    .toArray()
    .find((l) => /application\/(rss|atom)\+xml|application\/xml|text\/xml/i.test($(l).attr("type") ?? ""));
  return link ? absolute($(link).attr("href"), pageUrl) : null;
}

// ---------- your tags ----------

// Which of your tags a post matches: its title, categories and summary, any case, as part of a word
export function matchTags(item: { title: string; categories: string[]; description: string | null }, tags: string[]): string[] {
  const hay = [item.title, ...item.categories, item.description ?? ""].join("\n").toLowerCase();
  return tags.filter((t) => t.trim() && hay.includes(t.trim().toLowerCase()));
}
