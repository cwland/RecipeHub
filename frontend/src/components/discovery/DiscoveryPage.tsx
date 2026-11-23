import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../../api";
import { Popup } from "../Popup";
import type { ImportJob } from "../recipes/ImportDialog";
import { CaloriesByIngredient, NutritionFacts } from "../recipes/NutritionCard";
import type { Nutrition } from "../../recipes";
import { BackIcon, ChefIcon, DiscoverIcon, FeedIcon, LinkOutIcon, RefreshIcon } from "../Icons";
import { gridClass, loadDiscoverAcross, saveDiscoverAcross } from "../recipes/recipeView";
import { TilesAcross } from "../TilesAcross";

// Discovery: recipes from the household's RSS / Atom feeds, as cards. Fetching, reading, filtering
// and showing them is plain code on the server: no AI. #/discover is the grid, #/discover/:id one
// post as the feed sent it.

export interface DiscoveryFeed {
  id: number;
  url: string;
  title: string;
  siteUrl: string | null;
  iconUrl: string | null;
  lastFetchedAt: string | null;
  lastError: string | null;
  items: number;
}
export interface DiscoveryItem {
  id: number;
  feedId: number;
  feedTitle: string;
  feedIcon: string | null;
  title: string;
  link: string | null;
  pubDate: string | null;
  author: string | null;
  categories: string[];
  description: string | null;
  thumbnailUrl: string | null;
  matchedTags: string[];
  recipeId: number | null; // in your recipes: imported from here, or saved from the same link
  contentHtml?: string | null;
  feedSite?: string | null;
}
// The recipe on a post's page, read when it's opened (nothing saved until Import Recipe)
export interface PreviewRecipe {
  title: string;
  description: string | null;
  ingredients: string[];
  steps: (string | { section: string })[];
  servings: number | null;
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  imageUrl: string | null;
  sourceUrl: string | null;
  nutrition: Nutrition | null;
}
export interface RecipePreview {
  recipe: PreviewRecipe | null;
  how: "schema.org" | "text" | "ai" | null;
  from: "site" | "copy" | "feed" | null;
  savedCopy?: { from: string; url: string; date?: string }; // from "copy": the site kept RecipeHub out
  problem: string | null;
  canAi: boolean;
}
// The tags you've highlighted to filter by, remembered in this browser
const PICKED = "recipehub.discover.tags";
const readPicked = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(PICKED) ?? "[]");
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : [];
  } catch {
    return [];
  }
};
const keepPicked = (tags: string[]) => {
  try {
    localStorage.setItem(PICKED, JSON.stringify(tags));
  } catch {
    /* private window: just this visit */
  }
};

export const ago = (iso: string | null) => {
  if (!iso) return "";
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 60) return min < 1 ? "just now" : `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const postFromHash = () => {
  const m = window.location.hash.match(/^#\/discover\/(\d+)/);
  return m ? Number(m[1]) : null;
};

export default function DiscoveryPage() {
  const [post, setPost] = useState(postFromHash);
  useEffect(() => {
    const onHash = () => setPost(postFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return post ? <Post id={post} /> : <Grid />;
}

// ---------- the grid ----------

const button = "flex items-center gap-2 rounded-lg border border-line bg-container px-3 py-2 text-sm font-semibold hover:bg-pressed disabled:opacity-60";

function Grid() {
  const [feeds, setFeeds] = useState<DiscoveryFeed[] | null>(null);
  const [feed, setFeed] = useState<number | "all">("all");
  const [tags, setTags] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>(readPicked);
  const [items, setItems] = useState<DiscoveryItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [managing, setManaging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [said, setSaid] = useState("");
  // tiles across, like the recipe list (its own number, kept in this browser)
  const [across, setAcrossState] = useState(loadDiscoverAcross);
  const setAcross = (n: number) => {
    setAcrossState(n);
    saveDiscoverAcross(n);
  };
  const asked = useRef(0);

  const loadFeeds = useCallback(() => {
    api<DiscoveryFeed[]>("GET", "/api/discovery/feeds")
      .then(setFeeds)
      .catch((e) => setError((e as Error).message));
  }, []);
  // A page of posts: the first (more = false), or the next one
  const loadItems = useCallback(
    (more = false, after: string | null = null) => {
      const n = ++asked.current;
      const q = new URLSearchParams();
      if (feed !== "all") q.set("feed", String(feed));
      if (picked.length) q.set("tags", picked.join(","));
      if (more && after) q.set("before", after);
      api<{ items: DiscoveryItem[]; more: boolean; next: string | null }>("GET", `/api/discovery/items?${q}`)
        .then((r) => {
          if (n !== asked.current) return; // a newer list was asked for since
          setItems((old) => (more ? [...(old ?? []), ...r.items] : r.items));
          setNext(r.next);
        })
        .catch((e) => setError((e as Error).message));
    },
    [feed, picked]
  );
  useEffect(() => {
    loadFeeds();
    api<{ tags: string[] }>("GET", "/api/discovery/tags")
      .then((r) => {
        setTags(r.tags);
        setPicked((old) => {
          const still = old.filter((t) => r.tags.includes(t));
          if (still.length !== old.length) keepPicked(still);
          return still.length === old.length ? old : still;
        });
      })
      .catch(() => {});
  }, [loadFeeds]);
  useEffect(() => {
    setItems(null);
    loadItems();
  }, [loadItems]);

  const pick = (next: string[]) => {
    setPicked(next);
    keepPicked(next);
  };
  // a tag highlighted (filter by it) or not
  const toggle = (t: string) => pick(picked.includes(t) ? picked.filter((x) => x !== t) : [...picked, t]);
  const saveTags = (next: string[]) => {
    setTags(next);
    if (picked.some((t) => !next.includes(t))) pick(picked.filter((t) => next.includes(t))); // removed: not filtering by it
    void api<{ tags: string[] }>("PUT", "/api/discovery/tags", { tags: next })
      .then((r) => setTags(r.tags))
      .catch((e) => setError((e as Error).message));
  };
  const refresh = async () => {
    setRefreshing(true);
    setSaid("");
    try {
      const r = await api<{ feeds: number; added: number; failed: number }>("POST", "/api/discovery/refresh");
      setSaid([r.added ? plural(r.added, "new post") : "No new posts", r.failed ? `${plural(r.failed, "feed")} couldn't be checked` : ""].filter(Boolean).join(" · "));
      loadFeeds();
      loadItems();
    } catch (e) {
      setError((e as Error).message);
    }
    setRefreshing(false);
  };

  const noFeeds = feeds && !feeds.length;
  return (
    <div className="px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-2xl font-bold sm:text-3xl">Discover</h1>
        <button type="button" onClick={() => void refresh()} disabled={refreshing || !feeds?.length} className={button}>
          <RefreshIcon className={`size-4 ${refreshing ? "animate-spin" : ""}`} /> Refresh
        </button>
        <button type="button" onClick={() => setManaging(true)} className={button}>
          <FeedIcon /> Feeds
        </button>
      </header>
      <p className="mt-1 text-subtle">New recipes from sites you follow. Open one to read it; import the ones you want to keep.</p>
      {said && (
        <p role="status" className="mt-3 text-sm font-semibold text-action">
          {said}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      {noFeeds ? (
        <section className="mt-6 flex flex-col items-center rounded-2xl bg-container px-6 py-14 text-center">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-brand-subtle text-action">
            <DiscoverIcon className="size-8" />
          </span>
          <h2 className="mt-4 text-xl font-bold">Follow your favorite recipe sites</h2>
          <p className="mt-1 max-w-md text-subtle">Add a site's RSS feed (most food blogs have one), or just its address, and its new recipes show up here.</p>
          <button type="button" onClick={() => setManaging(true)} className="mt-5 rounded-lg bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed">
            Add a feed
          </button>
        </section>
      ) : (
        <>
          <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-container p-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold text-subtle">
                Feed
                <select aria-label="Feed" value={feed} onChange={(e) => setFeed(e.target.value === "all" ? "all" : Number(e.target.value))} className="rounded-lg border border-line bg-page px-2 py-1.5 text-sm font-normal text-ink">
                  <option value="all">All feeds</option>
                  {feeds?.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
                </select>
              </label>
              <span className="ml-auto flex items-center rounded-lg border border-line bg-page p-1 max-sm:hidden">
                <TilesAcross across={across} onChange={setAcross} />
              </span>
            </div>
            <Tags tags={tags} picked={picked} onToggle={toggle} onChange={saveTags} />
          </div>

          {items && !items.length && <p className="mt-6 text-center text-subtle">{picked.length ? "No posts match the tags you picked yet." : "No posts yet: try Refresh, or check Feeds."}</p>}
          {!!items?.length && (
            <ul aria-label="Recipes from your feeds" data-across={across} className={`mt-4 grid gap-3 sm:gap-4 ${gridClass(across)}`}>
              {items.map((i) => (
                <li key={i.id}>
                  <Card item={i} showTags={picked.length > 0} />
                </li>
              ))}
            </ul>
          )}
          {next && (
            <div className="mt-6 flex justify-center">
              <button type="button" onClick={() => loadItems(true, next)} className={button}>
                Show more
              </button>
            </div>
          )}
        </>
      )}
      {managing && (
        <Feeds
          feeds={feeds ?? []}
          onChanged={() => {
            loadFeeds();
            loadItems();
          }}
          onClose={() => setManaging(false)}
        />
      )}
    </div>
  );
}

function Card({ item, showTags }: { item: DiscoveryItem; showTags: boolean }) {
  return (
    <a href={`#/discover/${item.id}`} className="group @container flex h-full flex-col overflow-hidden rounded-2xl bg-container shadow-[0_1px_3px_rgba(0,0,0,0.06)] transition hover:-translate-y-0.5 hover:shadow-[0_6px_18px_rgba(0,0,0,0.1)]">
      <FeedImage src={item.thumbnailUrl} className="aspect-[4/3] w-full" />
      {/* text follows the tile's width (like recipe cards), so small tiles don't cut it off */}
      <div className="flex flex-1 flex-col p-2.5 @[12rem]:p-3 @[20rem]:p-4">
        <h3 className="line-clamp-2 min-h-[2lh] text-sm font-semibold leading-snug group-hover:text-action @[12rem]:text-base @[20rem]:text-lg">{item.title}</h3>
        <p className="mt-1 flex min-w-0 gap-1 overflow-hidden whitespace-nowrap text-[11px] text-subtle @[12rem]:text-xs @[20rem]:text-sm">
          <span className="min-w-0 truncate">{item.feedTitle}</span>
          {item.pubDate && <span className="shrink-0">· {ago(item.pubDate)}</span>}
        </p>
        {item.recipeId != null && <p className="mt-2"><span className="rounded-full bg-success-subtle px-2 py-0.5 text-xs font-semibold text-success">In your recipes</span></p>}
        {showTags && !!item.matchedTags.length && (
          <p className="mt-2 flex flex-wrap gap-1">
            {item.matchedTags.map((t) => (
              <span key={t} className="rounded-full bg-brand-subtle px-2 py-0.5 text-xs font-semibold text-action">
                {t}
              </span>
            ))}
          </p>
        )}
      </div>
    </a>
  );
}

// A feed's picture comes from another site: loaded lazily, without telling it where it's shown
// (none: on a post, a picture that doesn't load leaves nothing behind)
function FeedImage({ src, className, none = false }: { src: string | null; className: string; none?: boolean }) {
  const [broken, setBroken] = useState(false);
  if (src && !broken) return <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className={`object-cover ${className}`} />;
  if (none) return null;
  return (
    <div aria-hidden className={`flex items-center justify-center bg-brand-subtle text-action/70 ${className}`}>
      <ChefIcon />
    </div>
  );
}

// Your tags: the box adds them (Enter or a comma); under it, a chip for each. Click a chip to
// filter by it (highlighted), again to stop; several highlighted show posts matching any. × removes it.
function Tags({ tags, picked, onToggle, onChange }: { tags: string[]; picked: string[]; onToggle: (t: string) => void; onChange: (t: string[]) => void }) {
  const [text, setText] = useState("");
  const addAll = (parts: string[]) => {
    const next = [...tags];
    for (const t of parts.map((p) => p.trim()).filter(Boolean)) if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    if (next.length !== tags.length) onChange(next);
  };
  const add = (e?: FormEvent) => {
    e?.preventDefault();
    addAll([text]);
    setText("");
  };
  // a comma, typed or pasted: the tags before it are added
  const typed = (value: string) => {
    if (!value.includes(",")) return setText(value);
    const parts = value.split(",");
    const rest = parts.pop()!;
    addAll(parts);
    setText(rest.trimStart());
  };
  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-subtle">Tags</span>
        <input
          aria-label="Add a tag"
          placeholder={tags.length ? "Add a tag" : "Add a tag, like keto or air fryer"}
          value={text}
          maxLength={40}
          onChange={(e) => typed(e.target.value)}
          className="min-w-40 flex-1 rounded-lg border border-line bg-page px-3 py-1.5 text-sm outline-none focus:border-action"
        />
      </form>
      {!!tags.length && (
        <>
          <ul aria-label="Your tags" className="flex flex-wrap gap-2">
            {tags.map((t) => {
              const on = picked.includes(t);
              return (
                <li key={t} className={`flex items-center rounded-full border text-sm font-semibold transition ${on ? "border-action bg-action text-white" : "border-line bg-page text-ink hover:border-action"}`}>
                  <button type="button" aria-pressed={on} onClick={() => onToggle(t)} className="py-1 pl-3 pr-1.5">
                    {t}
                  </button>
                  <button type="button" aria-label={`Remove ${t}`} title={`Remove ${t}`} onClick={() => onChange(tags.filter((x) => x !== t))} className={`mr-1 flex size-5 items-center justify-center rounded-full ${on ? "hover:bg-white/20" : "text-subtle hover:bg-pressed"}`}>
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-subtle">{picked.length ? "Showing posts that mention any highlighted tag. Click a tag again to stop filtering by it." : "Click a tag to see only the posts that mention it."}</p>
        </>
      )}
    </div>
  );
}

// ---------- your feeds ----------

function Feeds({ feeds, onChanged, onClose }: { feeds: DiscoveryFeed[]; onChanged: () => void; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState<number | null>(null);
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setMsg(null);
    try {
      const f = await api<DiscoveryFeed>("POST", "/api/discovery/feeds", { url: url.trim() });
      setMsg({ ok: true, text: `Added “${f.title}”: ${plural(f.items, "post")}.` });
      setUrl("");
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  };
  const remove = async (f: DiscoveryFeed) => {
    try {
      await api("DELETE", `/api/discovery/feeds/${f.id}`);
      setAsking(null);
      onChanged();
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
  };
  const site = (f: DiscoveryFeed) => {
    try {
      return new URL(f.siteUrl ?? f.url).hostname.replace(/^www\./, "");
    } catch {
      return f.url;
    }
  };
  return (
    <Popup title="Your feeds" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <form onSubmit={(e) => void add(e)} className="flex flex-col gap-2">
          <label htmlFor="feed-url" className="text-sm font-semibold text-subtle">
            Add a feed
          </label>
          <div className="flex gap-2">
            <input id="feed-url" aria-label="Feed or website address" placeholder="https://www.example.com/feed, or just the site" value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-line bg-page px-3 py-2 outline-none focus:border-action" />
            <button type="submit" disabled={busy || !url.trim()} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
              {busy ? "Reading…" : "Add"}
            </button>
          </div>
          <p className="text-xs text-muted">A site's address works too: RecipeHub finds the feed it names. Everyone in the household sees the same feeds.</p>
          {msg && (
            <p role={msg.ok ? "status" : "alert"} className={`text-sm font-semibold ${msg.ok ? "text-success" : "text-error"}`}>
              {msg.text}
            </p>
          )}
        </form>
        {!!feeds.length && (
          <ul aria-label="Feeds" className="flex flex-col">
            {feeds.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-3 first:border-0">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{f.title}</p>
                  <p className={`text-xs ${f.lastError ? "text-error" : "text-subtle"}`}>
                    {site(f)} · {plural(f.items, "post")}
                    {f.lastError ? ` · ${f.lastError}` : f.lastFetchedAt ? ` · checked ${ago(f.lastFetchedAt)}` : ""}
                  </p>
                </div>
                {asking === f.id ? (
                  <span className="flex items-center gap-2 text-sm">
                    <button type="button" onClick={() => void remove(f)} className="rounded-lg bg-error px-3 py-1.5 font-semibold text-white">
                      Remove it
                    </button>
                    <button type="button" onClick={() => setAsking(null)} className="font-semibold text-subtle hover:underline">
                      Keep
                    </button>
                  </span>
                ) : (
                  <button type="button" aria-label={`Remove ${f.title}`} onClick={() => setAsking(f.id)} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-subtle hover:bg-pressed">
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Popup>
  );
}

// ---------- one post ----------

function Post({ id }: { id: number }) {
  const [p, setP] = useState<DiscoveryItem | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<RecipePreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  useEffect(() => {
    setP(null);
    setPreview(null);
    setPreviewError("");
    api<DiscoveryItem>("GET", `/api/discovery/items/${id}`)
      .then((post) => {
        setP(post);
        // the recipe on its page, read with plain code (no AI)
        if (post.link)
          api<RecipePreview>("GET", `/api/discovery/items/${id}/recipe`)
            .then(setPreview)
            .catch((e) => setPreviewError((e as Error).message));
      })
      .catch((e) => setError((e as Error).message));
  }, [id]);
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <a href="#/discover" className="inline-flex items-center gap-1 text-sm font-semibold text-subtle hover:text-ink">
        <BackIcon className="size-4" /> Discover
      </a>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
      {p && (
        <div className="mt-3 overflow-hidden rounded-2xl bg-container">
          <FeedImage src={p.thumbnailUrl} none className="max-h-[420px] w-full" />
          <div className="p-5 sm:p-8">
            <h1 className="text-2xl font-bold leading-tight sm:text-3xl">{p.title}</h1>
            <p className="mt-2 text-sm text-subtle">{[p.author, p.feedTitle, ago(p.pubDate)].filter(Boolean).join(" · ")}</p>
            {/* the feed's short description, under the picture and title */}
            {p.description && <p className="mt-3 leading-relaxed text-ink">{p.description}</p>}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {p.link && (p.recipeId != null || preview?.recipe) && <ImportButton post={p} />}
              {p.link && (
                <a href={p.link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-pressed">
                  Open original site <LinkOutIcon />
                </a>
              )}
            </div>
            {p.link && <Preview id={p.id} postTitle={p.title} preview={preview} error={previewError} onChange={setPreview} />}
            {/* No link, so no recipe to preview: the post as the feed sent it, made safe on the
                server (lib/rss.ts sanitizeHtml). With a link, the description above and the preview
                cover it. */}
            {!p.link &&
              (p.contentHtml ? (
                <article aria-label="The post" className="feed-post mt-6" dangerouslySetInnerHTML={{ __html: p.contentHtml }} />
              ) : (
                !p.description && (
                  <article aria-label="The post" className="mt-6 text-subtle">
                    The feed sent no text for this post.
                  </article>
                )
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

const minutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr${m % 60 ? ` ${m % 60} min` : ""}`);
const copyDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const copyName = (pv: RecipePreview) => (pv.savedCopy ? `a saved copy (${[pv.savedCopy.from, pv.savedCopy.date && copyDate(pv.savedCopy.date)].filter(Boolean).join(", ")})` : "a saved copy");
const howRead = (pv: RecipePreview) => {
  const where = pv.from === "feed" ? "the feed's post" : pv.from === "copy" ? copyName(pv) : "the recipe's site";
  return pv.how === "ai" ? `Read with AI from ${where}` : `Read from ${where}, without AI`;
};

// The staging area: the recipe as read from its page, before anything is saved. Read with AI and
// Calculate nutrition are the only AI here, and only when pressed.
function Preview({ id, postTitle, preview: pv, error, onChange }: { id: number; postTitle: string; preview: RecipePreview | null; error: string; onChange: (p: RecipePreview) => void }) {
  const [busy, setBusy] = useState<"" | "ai" | "nutrition">("");
  const [failed, setFailed] = useState("");
  const run = async (what: "ai" | "nutrition") => {
    setBusy(what);
    setFailed("");
    try {
      onChange(await api<RecipePreview>("POST", `/api/discovery/items/${id}/recipe/${what}`));
    } catch (e) {
      setFailed((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const r = pv?.recipe;
  const n = r?.nutrition;
  // Read with AI / Calculate nutrition: clearly buttons (green outline, tinted), next to the green Import
  const button = "inline-flex items-center gap-2 rounded-lg border-2 border-action bg-brand-subtle px-4 py-2 text-sm font-semibold text-action hover:bg-action hover:text-white disabled:opacity-60";
  const alert = (text: string) => (
    <p role="alert" className="mt-3 rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
      {text}
    </p>
  );
  return (
    <section aria-label="Recipe preview" className="mt-6 rounded-xl border border-line p-4 sm:p-6">
      {!pv && !error && <p className="text-sm text-subtle">Reading the recipe from its page…</p>}
      {error && alert(error)}
      {pv && !r && (
        <div>
          <p className="text-sm text-subtle">{pv.problem ?? "No recipe was found on its page."}</p>
          {pv.canAi ? (
            <button type="button" onClick={() => void run("ai")} disabled={!!busy} className={`${button} mt-3`}>
              <ChefIcon className="size-4" /> {busy === "ai" ? "Reading with AI…" : "Read with AI"}
            </button>
          ) : (
            <p className="mt-2 text-sm text-subtle">Turn on AI in Settings › AI to read it with AI, or open the original site.</p>
          )}
        </div>
      )}
      {pv && r && (
        <>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">{howRead(pv)}</p>
          {(pv.from === "feed" || pv.from === "copy") && pv.problem && <p className="mt-1 text-xs text-subtle">The recipe's site: {pv.problem}</p>}
          {pv.from === "copy" && pv.savedCopy && (
            <a href={pv.savedCopy.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-link hover:underline">
              Open the saved copy <LinkOutIcon className="size-3" />
            </a>
          )}
          {/* the recipe's own name, when the post calls it something else */}
          {r.title.trim().toLowerCase() !== postTitle.trim().toLowerCase() && <h2 className="mt-2 text-xl font-bold">{r.title}</h2>}
          {(() => {
            const facts = [r.servings ? `Serves ${r.servings}` : r.yieldText, r.prepMinutes ? `Prep ${minutes(r.prepMinutes)}` : null, r.cookMinutes ? `Cook ${minutes(r.cookMinutes)}` : !r.prepMinutes && r.totalMinutes ? `Total ${minutes(r.totalMinutes)}` : null].filter(Boolean);
            return facts.length ? <p className="mt-1 text-sm text-subtle">{facts.join(" · ")}</p> : null;
          })()}
          <div className="mt-4 grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div>
              <h3 className="font-semibold">Ingredients</h3>
              <ul aria-label="Ingredients" className="mt-2 space-y-1.5 text-sm">
                {r.ingredients.map((line, i) =>
                  /:\s*$/.test(line) ? (
                    <li key={i} role="presentation" className="pt-2 font-semibold text-subtle">
                      {line.replace(/:\s*$/, "")}
                    </li>
                  ) : (
                    <li key={i} className="flex gap-2">
                      <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-action" />
                      <span>{line}</span>
                    </li>
                  ),
                )}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold">Steps</h3>
              <ol aria-label="Steps" className="mt-2 space-y-3 text-sm">
                {(() => {
                  let n = 0;
                  return r.steps.map((st, i) =>
                    typeof st === "string" ? (
                      <li key={i} className="flex gap-3">
                        <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-bold text-action">
                          {++n}
                        </span>
                        <span>{st}</span>
                      </li>
                    ) : (
                      <li key={i} role="presentation" className="pt-1 font-semibold text-subtle">
                        {st.section}
                      </li>
                    ),
                  );
                })()}
              </ol>
            </div>
          </div>
          <div className="mt-5 border-t border-line pt-4">
            {pv.canAi && (
              <button type="button" onClick={() => void run("nutrition")} disabled={!!busy} className={button}>
                {busy === "nutrition" ? "Calculating…" : n ? "Re-calculate nutrition" : "Calculate nutrition"}
              </button>
            )}
            {n && (
              <section aria-label="Nutrition" className="mt-4 grid gap-6 md:grid-cols-2">
                <div className="rounded-xl border-2 border-ink p-3">
                  <h3 className="text-2xl font-black">Nutrition Facts</h3>
                  <p className="text-sm">per serving{n.servings ? `, ${n.servings} servings` : ""}</p>
                  <NutritionFacts value={n} />
                </div>
                <CaloriesByIngredient value={n} />
              </section>
            )}
          </div>
        </>
      )}
      {failed && alert(failed)}
    </section>
  );
}

// Import Recipe: the recipe's own site first; if it keeps RecipeHub out, the feed's copy of the post
// (the server decides). Then a link to the recipe, or why it couldn't be imported.
function ImportButton({ post }: { post: DiscoveryItem }) {
  const [job, setJob] = useState<ImportJob | null>(null);
  const [error, setError] = useState("");
  const busy = !!job && (job.status === "queued" || job.status === "running");
  useEffect(() => {
    if (!job || !busy) return;
    const t = setTimeout(
      () =>
        void api<ImportJob>("GET", `/api/imports/${job.id}`)
          .then(setJob)
          .catch((e) => (setError((e as Error).message), setJob(null))),
      900,
    );
    return () => clearTimeout(t);
  }, [job, busy]);
  useEffect(() => {
    if (job?.status === "failed") (setError(job.error ?? "That couldn't be imported"), setJob(null));
    // imported: straight to the new recipe, where the AI check wizard opens
    if (job?.status === "done" && job.result?.recipeId && !job.result.duplicateOf) window.location.hash = `#/recipes/${job.result.recipeId}?imported=1`;
  }, [job]);

  const start = async () => {
    setError("");
    try {
      setJob(await api<ImportJob>("POST", `/api/discovery/items/${post.id}/import`));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const done = job?.status === "done" ? job.result : null;
  const saved = done ? null : post.recipeId;
  const pill = "inline-flex items-center gap-2 rounded-lg bg-success-subtle px-3 py-2 text-sm text-success";
  const open = "font-semibold underline";
  if (done?.recipeId && !done.duplicateOf)
    return (
      <p role="status" className={pill}>
        Imported. Opening the recipe…
      </p>
    );
  if (done?.duplicateOf)
    return (
      <p role="status" className={pill}>
        Already in your recipes. <a href={`#/recipes/${done.duplicateOf}`} className={open}>Open the recipe</a>
      </p>
    );
  if (saved != null)
    return (
      <p className={pill}>
        <span>In your recipes</span>·<a href={`#/recipes/${saved}`} className={open}>Open the recipe</a>
      </p>
    );
  return (
    <>
      <button type="button" onClick={() => void start()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-action px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60">
        <ChefIcon className="size-4" /> {busy ? "Importing…" : "Import Recipe"}
      </button>
      {error && (
        <p role="alert" className="w-full rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}
    </>
  );
}
