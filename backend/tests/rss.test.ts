import { describe, expect, it } from "vitest";
import { feedLinkIn, matchTags, parseFeed, sanitizeHtml } from "../src/lib/rss.js";

// Discovery reads feeds with plain code: no AI anywhere in fetching, reading or filtering

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:media="http://search.yahoo.com/mrss/">
<channel>
  <title>Smitten Test Kitchen</title>
  <link>https://kitchen.example.com/</link>
  <image><url>https://kitchen.example.com/logo.png</url></image>
  <item>
    <title>Crispy Air Fryer Chicken Thighs</title>
    <link>https://kitchen.example.com/air-fryer-chicken</link>
    <guid isPermaLink="false">post-101</guid>
    <pubDate>Mon, 02 Nov 2026 14:00:00 +0000</pubDate>
    <dc:creator>Deb</dc:creator>
    <category>Dinner</category>
    <category><![CDATA[Gluten-Free]]></category>
    <description><![CDATA[<p>Juicy, <b>crispy</b> &amp; quick.</p>]]></description>
    <content:encoded><![CDATA[<p>Pat the thighs dry.</p><img src="/img/thighs.jpg" alt="Thighs"><script>alert(1)</script>]]></content:encoded>
    <media:content url="https://cdn.example.com/thighs-big.jpg" medium="image" width="1200"/>
  </item>
  <item>
    <title>Lentil Soup</title>
    <link>https://kitchen.example.com/lentil-soup</link>
    <pubDate>Sun, 01 Nov 2026 10:00:00 +0000</pubDate>
    <description>A cozy vegan soup.</description>
    <enclosure url="https://cdn.example.com/soup.jpg" type="image/jpeg" length="1000"/>
  </item>
  <item>
    <title>Notes from the market</title>
    <link>https://kitchen.example.com/market</link>
    <content:encoded><![CDATA[<p>Look:</p><p><img src="https://cdn.example.com/market.jpg"></p>]]></content:encoded>
  </item>
</channel>
</rss>`;

const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Eats</title>
  <link rel="alternate" href="https://atom.example.com/"/>
  <link rel="self" href="https://atom.example.com/feed.atom"/>
  <icon>https://atom.example.com/icon.png</icon>
  <entry>
    <title type="html">Keto &lt;em&gt;Pancakes&lt;/em&gt;</title>
    <link rel="alternate" href="https://atom.example.com/keto-pancakes"/>
    <id>tag:atom.example.com,2026:1</id>
    <published>2026-10-30T08:00:00Z</published>
    <author><name>Sam</name></author>
    <category term="breakfast"/>
    <summary>Fluffy and low carb.</summary>
    <content type="html">&lt;p&gt;Whisk the eggs.&lt;/p&gt;</content>
  </entry>
</feed>`;

describe("reading RSS 2.0", () => {
  const f = parseFeed(rss, "https://kitchen.example.com/feed");
  it("the feed's name, site and icon", () => {
    expect(f).toMatchObject({ title: "Smitten Test Kitchen", siteUrl: "https://kitchen.example.com/", iconUrl: "https://kitchen.example.com/logo.png" });
  });

  it("each post: title, link, id, date, author, categories, plain summary", () => {
    expect(f.items[0]).toMatchObject({
      guid: "post-101",
      title: "Crispy Air Fryer Chicken Thighs",
      link: "https://kitchen.example.com/air-fryer-chicken",
      pubDate: new Date("2026-11-02T14:00:00Z"),
      author: "Deb",
      categories: ["Dinner", "Gluten-Free"],
      description: "Juicy, crispy & quick.",
    });
    expect(f.items[2].guid).toBe("https://kitchen.example.com/market"); // no guid: the link
  });

  it("the picture: media:content, then an image enclosure, then the post's first image", () => {
    expect(f.items.map((i) => i.thumbnailUrl)).toEqual(["https://cdn.example.com/thighs-big.jpg", "https://cdn.example.com/soup.jpg", "https://cdn.example.com/market.jpg"]);
  });

  it("the post's own text, made safe (no scripts; links and pictures made absolute)", () => {
    expect(f.items[0].contentHtml).toBe('<p>Pat the thighs dry.</p><img src="https://kitchen.example.com/img/thighs.jpg" alt="Thighs" loading="lazy" referrerpolicy="no-referrer">');
    expect(f.items[1].contentHtml).toBe("<p>A cozy vegan soup.</p>"); // no content: the description
  });
});

describe("reading Atom", () => {
  it("entries, with HTML titles read as text", () => {
    const f = parseFeed(atom, "https://atom.example.com/feed.atom");
    expect(f).toMatchObject({ title: "Atom Eats", siteUrl: "https://atom.example.com/", iconUrl: "https://atom.example.com/icon.png" });
    expect(f.items[0]).toMatchObject({ guid: "tag:atom.example.com,2026:1", title: "Keto Pancakes", link: "https://atom.example.com/keto-pancakes", author: "Sam", categories: ["breakfast"], description: "Fluffy and low carb.", contentHtml: "<p>Whisk the eggs.</p>", pubDate: new Date("2026-10-30T08:00:00Z") });
  });
});

describe("not a feed", () => {
  it("says so", () => {
    expect(() => parseFeed("<html><body>Hi</body></html>", "https://x.example.com/")).toThrow(/isn't an RSS or Atom feed/);
    expect(() => parseFeed("not xml at all {", "https://x.example.com/")).toThrow(/isn't an RSS or Atom feed/);
  });

  it("a website's page names its feed", () => {
    const html = '<html><head><link rel="alternate" type="application/rss+xml" title="RSS" href="/feed/"></head></html>';
    expect(feedLinkIn(html, "https://kitchen.example.com/recipes/")).toBe("https://kitchen.example.com/feed/");
    expect(feedLinkIn("<html><head></head></html>", "https://x.example.com/")).toBeNull();
  });
});

describe("making a post safe to show", () => {
  it("keeps text formatting, lists, headings, links and pictures; drops the rest", () => {
    const out = sanitizeHtml(
      `<h2 onclick="x()">Ingredients</h2><ul><li>1 cup <strong>flour</strong></li></ul><a href="javascript:alert(1)">bad</a><a href="/good">good</a><iframe src="https://evil.example"></iframe><img src="data:image/png;base64,AAA" onerror="x()"><style>body{display:none}</style><p style="color:red">Hi</p>`,
      "https://kitchen.example.com/post"
    );
    expect(out).toBe('<h2>Ingredients</h2><ul><li>1 cup <strong>flour</strong></li></ul>bad<a href="https://kitchen.example.com/good" target="_blank" rel="noopener noreferrer">good</a><p>Hi</p>');
  });
});

describe("matching your tags (no AI)", () => {
  const item = { title: "Crispy Air Fryer Chicken Thighs", categories: ["Dinner", "Gluten-Free"], description: "Juicy, crispy and quick." };
  it("title, categories and summary, any case, as part of a word", () => {
    expect(matchTags(item, ["air fryer", "gluten-free", "QUICK", "keto", "chick"])).toEqual(["air fryer", "gluten-free", "QUICK", "chick"]);
    expect(matchTags(item, [])).toEqual([]);
    expect(matchTags(item, ["  "])).toEqual([]);
  });
});
