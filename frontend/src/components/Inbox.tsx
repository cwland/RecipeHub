import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useLive } from "../live";
import ImportDialog from "./recipes/ImportDialog";
import { InboxIcon } from "./Icons";

// The inbox: links, notes and recipe data sent in by other apps (the RecipeHub Companion browser
// extension) to look at later. Shared by the household. The button shows how many are waiting;
// the drawer lists them, with Import (the usual import window) and Dismiss.

export type InboxType = "RECIPE_LINK" | "INSTAGRAM_LINK" | "TEXT_NOTE" | "RAW_RECIPE_DATA";
export interface InboxItem {
  id: number;
  type: InboxType;
  title: string;
  url: string | null;
  content: string | null;
  sourceApp: string | null;
  metadata: { pageTitle?: string; favIconUrl?: string; capturedAt?: string } | null;
  status: "PENDING" | "PROCESSED" | "DISMISSED";
  sentBy: string | null;
  recipeId?: number | null; // imported: the recipe it became (null once that recipe is deleted)
  createdAt: string;
  reviewedAt: string | null;
}

type Tab = "PENDING" | "PROCESSED" | "DISMISSED";
const TABS: Tab[] = ["PENDING", "PROCESSED", "DISMISSED"];
const TAB_LABEL: Record<Tab, string> = { PENDING: "Waiting", PROCESSED: "Imported", DISMISSED: "Dismissed" };

const TYPE_LABEL: Record<InboxType, string> = { RECIPE_LINK: "Recipe link", INSTAGRAM_LINK: "Instagram", TEXT_NOTE: "Note", RAW_RECIPE_DATA: "Recipe data" };

// Anything changed the inbox here (so the badge catches up without waiting for the server's event)
const CHANGED = "recipehub:inbox-changed";
const changed = () => window.dispatchEvent(new Event(CHANGED));

// Open the inbox from anywhere (the account menu on phones, #/inbox)
export const openInbox = () => window.dispatchEvent(new Event("recipehub:inbox"));

function useWaiting() {
  const [n, setN] = useState<number | null>(null);
  const load = useCallback(() => {
    api<{ pending: number }>("GET", "/api/inbox/count")
      .then((r) => setN(r.pending))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, [load]);
  useLive(["inbox"], load);
  return n;
}

export function InboxButton({ onOpen }: { variant?: "rail"; onOpen: () => void }) {
  const n = useWaiting();
  const label = n ? `Inbox, ${n} waiting` : "Inbox";
  const badge = !!n && (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-error px-1 text-[10px] font-bold leading-none text-white">{n > 99 ? "99+" : n}</span>
  );
  return (
    <button type="button" aria-label={label} title={label} onClick={onOpen} className="relative flex size-10 items-center justify-center rounded-lg text-subtle hover:bg-page">
      <InboxIcon />
      {badge}
    </button>
  );
}

// How many are waiting, for a dot on the phone's Account button
export function useInboxWaiting() {
  return useWaiting();
}

const ago = (iso: string) => {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  return days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : new Date(iso).toLocaleDateString();
};
const siteOf = (url: string | null) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

// Recipe data (copied JSON-LD or HTML) goes to the import as the page it came from
function pageFor(item: InboxItem) {
  const content = item.content ?? "";
  if (content.trim().startsWith("<")) return { url: item.url!, html: content };
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  return { url: item.url!, html: `<!DOCTYPE html><html><head><title>${esc(item.title)}</title><script type="application/ld+json">${content.replace(/<\/script/gi, "<\\/script")}</script></head><body></body></html>` };
}

export function InboxDrawer({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("PENDING");
  const [items, setItems] = useState<InboxItem[] | null>(null);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState<InboxItem | null>(null);

  // only the newest list counts: a slow answer for a tab you've left is dropped
  const asked = useRef(0);
  const load = useCallback(() => {
    const n = ++asked.current;
    api<InboxItem[]>("GET", `/api/inbox${tab === "PENDING" ? "" : `?status=${tab}`}`)
      .then((list) => n === asked.current && setItems(list))
      .catch((e) => n === asked.current && setError((e as Error).message));
  }, [tab]);
  useEffect(() => {
    setItems(null);
    load();
  }, [load]);
  useLive(["inbox"], load);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !importing && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, importing]);

  const act = async (item: InboxItem, fn: () => Promise<unknown>) => {
    setError("");
    try {
      await fn();
      setItems((list) => list?.filter((i) => i.id !== item.id) ?? null);
      changed();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const setStatus = (item: InboxItem, status: InboxItem["status"]) => act(item, () => api("PATCH", `/api/inbox/${item.id}`, { status }));

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label="Inbox" className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-container shadow-xl">
        <header className="flex items-center gap-3 border-b border-line px-5 py-4">
          <InboxIcon className="size-5 text-action" />
          <h2 className="text-lg font-semibold">Inbox</h2>
          <button type="button" onClick={onClose} aria-label="Close the inbox" title="Close" className="ml-auto flex size-9 items-center justify-center rounded-lg text-xl text-subtle hover:bg-pressed">
            ×
          </button>
        </header>
        <div role="tablist" aria-label="Inbox" className="mx-5 mt-4 inline-flex self-start rounded-lg bg-page p-1 text-sm font-semibold">
          {TABS.map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 ${tab === t ? "bg-container shadow-sm" : "text-subtle"}`}>
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="mx-5 mt-3 rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
            {error}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {items && !items.length && (
            <div className="rounded-xl bg-page p-5 text-center text-subtle">
              {tab === "PENDING" ? (
                <>
                  <p className="font-semibold text-ink">Nothing waiting.</p>
                  <p className="mt-1 text-sm">Links, notes and recipes you send from the RecipeHub Companion browser extension land here, to import when you're ready. Make it a key in Settings › API keys (Inbox only).</p>
                </>
              ) : tab === "PROCESSED" ? (
                <p>Nothing imported yet. Recipes imported from here, or straight from the RecipeHub Companion, are listed here.</p>
              ) : (
                <p>Nothing dismissed.</p>
              )}
            </div>
          )}
          {!!items?.length && (
            <ul aria-label={TAB_LABEL[tab]} className="flex flex-col gap-3">
              {items.map((item) => (
                <Card key={item.id} item={item}>
                  {tab === "PENDING" ? (
                    <>
                      <button type="button" onClick={() => setImporting(item)} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-pressed">
                        Import
                      </button>
                      <button type="button" onClick={() => void setStatus(item, "DISMISSED")} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-pressed">
                        Dismiss
                      </button>
                    </>
                  ) : tab === "PROCESSED" ? (
                    <>
                      {item.recipeId ? (
                        <a href={`#/recipes/${item.recipeId}`} onClick={onClose} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-pressed">
                          Open the recipe
                        </a>
                      ) : (
                        <span className="self-center text-sm text-subtle">The recipe was deleted since.</span>
                      )}
                      <button type="button" onClick={() => void act(item, () => api("DELETE", `/api/inbox/${item.id}`))} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-subtle hover:bg-pressed">
                        Remove from the list
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => void setStatus(item, "PENDING")} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-pressed">
                        Bring back
                      </button>
                      <button type="button" onClick={() => void act(item, () => api("DELETE", `/api/inbox/${item.id}`))} className="rounded-lg px-3 py-1.5 text-sm font-semibold text-error hover:bg-error-subtle">
                        Delete
                      </button>
                    </>
                  )}
                </Card>
              ))}
            </ul>
          )}
        </div>
      </aside>
      {importing && (
        <ImportDialog
          {...(importing.type === "RAW_RECIPE_DATA" && importing.url && importing.content
            ? { page: pageFor(importing) }
            : { initial: importing.type === "TEXT_NOTE" ? (importing.content ?? importing.title) : (importing.url ?? importing.content ?? "") })}
          onClose={() => setImporting(null)}
          onImported={(recipeId) => {
            const item = importing;
            // it's a recipe now: into Imported, with a link to it
            void api("PATCH", `/api/inbox/${item.id}`, { status: "PROCESSED", recipeId })
              .then(() => changed())
              .catch(() => {});
            setItems((list) => list?.filter((i) => i.id !== item.id) ?? null);
            onClose();
          }}
        />
      )}
    </>
  );
}

// A note's text under its title, without repeating the first line when that's the title
const noteRest = (item: InboxItem) => {
  const text = item.content?.trim() ?? "";
  const [first, ...rest] = text.split("\n");
  return first.trim() === item.title ? rest.join("\n").trim() : text;
};

function Card({ item, children }: { item: InboxItem; children: React.ReactNode }) {
  const [iconOk, setIconOk] = useState(!!item.metadata?.favIconUrl);
  const site = siteOf(item.url);
  return (
    <li className="rounded-xl border border-line bg-page p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-container text-sm font-bold text-subtle">
          {iconOk ? <img src={item.metadata!.favIconUrl} alt="" referrerPolicy="no-referrer" onError={() => setIconOk(false)} className="size-5" /> : (site ?? item.title).charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer noopener" className="block truncate font-semibold hover:text-link hover:underline">
              {item.title}
            </a>
          ) : (
            <p className="truncate font-semibold">{item.title}</p>
          )}
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle">
            {item.status === "PROCESSED" && <span className="rounded-full bg-success-subtle px-2 py-0.5 font-semibold text-success">Imported</span>}
            <span className="rounded-full bg-brand-subtle px-2 py-0.5 font-semibold text-action">{TYPE_LABEL[item.type]}</span>
            {site && <span>{site}</span>}
            <span>{ago(item.createdAt)}</span>
            {item.sentBy && <span>· {item.sentBy}</span>}
          </p>
          {item.type === "TEXT_NOTE" && noteRest(item) && <p className="mt-2 line-clamp-3 whitespace-pre-line text-sm">{noteRest(item)}</p>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </li>
  );
}
