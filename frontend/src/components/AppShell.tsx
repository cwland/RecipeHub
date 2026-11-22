import { useEffect, useState } from "react";
import SettingsPage from "./SettingsPage";
import GroceryPage from "./grocery/GroceryPage";
import PantryPage from "./grocery/PantryPage";
import TimerTray from "./TimerTray";
import RecipesPage from "./recipes/RecipesPage";
import PlannerPage from "./plan/PlannerPage";
import AccountMenu from "./AccountMenu";
import { APP_VERSION, showWhatsNew, versionLabel } from "../version";
import { isNewer } from "../changelog";
import { useSession } from "../session";
import { api } from "../api";
import { listAddress } from "../recipes";
import WhatsNew from "./WhatsNew";
import UpdateBar from "./UpdateBar";
import { BackgroundPill } from "./BackgroundPill";
import { InboxButton, InboxDrawer } from "./Inbox";
import { DiscoverIcon, GearIcon, GroceryIcon, Logo, PantryIcon, PlannerIcon, RecipesIcon } from "./Icons";
import DiscoveryPage from "./discovery/DiscoveryPage";

// Recipes goes back to the list as you left it (a search or tag stays on until you clear it)
const navHref = (id: string) => (id === "recipes" ? listAddress() : `#/${id}`);

type Page = "recipes" | "discover" | "plan" | "grocery" | "pantry" | "settings";
const PAGES: { id: Page; label: string; icon: JSX.Element }[] = [
  { id: "recipes", label: "Recipes", icon: <RecipesIcon /> },
  { id: "discover", label: "Discover", icon: <DiscoverIcon /> },
  { id: "plan", label: "Meal plan", icon: <PlannerIcon /> },
  { id: "grocery", label: "Grocery", icon: <GroceryIcon /> },
  { id: "pantry", label: "Pantry", icon: <PantryIcon /> },
  { id: "settings", label: "Settings", icon: <GearIcon /> },
];
const pageFromHash = (): Page => {
  const h = window.location.hash.replace("#/", "").split(/[/?]/)[0]; // "plan?week=…" -> "plan"
  return PAGES.find((p) => p.id === h)?.id ?? "recipes";
};

export default function AppShell() {
  const [page, setPage] = useState<Page>(pageFromHash);
  const { user, setUser } = useSession();
  // "What's new": once per version after signing in (until dismissed), and from the version number
  // (not during first-run setup: the wizard is over the app, and finishing it marks the version seen)
  const [news, setNews] = useState<"new" | "all" | null>(() => (user.setupDone !== false && isNewer(APP_VERSION, user.seenVersion) ? "new" : null));
  const [sinceVersion] = useState(user.seenVersion ?? null);
  useEffect(() => {
    const open = () => setNews("all");
    window.addEventListener("recipehub:whats-new", open);
    return () => window.removeEventListener("recipehub:whats-new", open);
  }, []);
  const closeNews = () => {
    setNews(null);
    if (isNewer(APP_VERSION, user.seenVersion)) {
      setUser({ ...user, seenVersion: APP_VERSION });
      void api("PUT", "/api/auth/seen-version", { version: APP_VERSION }).catch(() => {});
    }
  };

  // The inbox drawer: the rail button, the phone's account menu, or a #/inbox link (the Companion extension)
  const [inbox, setInbox] = useState(() => window.location.hash === "#/inbox");
  useEffect(() => {
    const open = () => setInbox(true);
    window.addEventListener("recipehub:inbox", open);
    return () => window.removeEventListener("recipehub:inbox", open);
  }, []);
  useEffect(() => {
    if (inbox && window.location.hash === "#/inbox") history.replaceState(null, "", "#/recipes");
  }, [inbox]);

  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === "#/inbox") return setInbox(true);
      setPage(pageFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return (
    <div className="flex min-h-screen bg-page pt-[var(--top-bar,0px)]">
      <UpdateBar />
      {/* Left icon nav */}
      <nav className="sticky top-[var(--top-bar,0px)] z-40 hidden h-[calc(100vh-var(--top-bar,0px))] w-14 shrink-0 flex-col items-center bg-container py-4 sm:flex">
        <span title="RecipeHub: your recipes, meal plans and groceries">
          <Logo className="size-8" />
        </span>
        <div className="mt-8 flex flex-col gap-2">
          {PAGES.map((p) => (
            <a
              key={p.id}
              href={navHref(p.id)}
              aria-label={p.label}
              title={p.label}
              aria-current={page === p.id ? "page" : undefined}
              className={`flex size-10 items-center justify-center rounded-lg ${page === p.id ? "bg-pressed text-action" : "text-subtle hover:bg-page"}`}
            >
              {p.icon}
            </a>
          ))}
        </div>
        <div className="mt-auto flex flex-col items-center gap-2">
          <InboxButton onOpen={() => setInbox(true)} />
          <AccountMenu variant="rail" />
          <button type="button" onClick={showWhatsNew} className="rounded px-1 text-[10px] leading-none text-muted hover:text-link hover:underline" title="What's new in this version">
            {versionLabel}
          </button>
        </div>
      </nav>

      <BackgroundPill />
      <main className="min-w-0 flex-1 pb-16 sm:pb-0">
        {page === "settings" ? <SettingsPage /> : page === "recipes" ? <RecipesPage /> : page === "discover" ? <DiscoveryPage /> : page === "plan" ? <PlannerPage /> : page === "grocery" ? <GroceryPage /> : <PantryPage />}
      </main>

      {/* Bottom bar on phones */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-center justify-around border-t border-line bg-container sm:hidden">
        {PAGES.filter((p) => p.id !== "settings").map((p) => ( // Settings: in the Account menu on phones
          <a
            key={p.id}
            href={navHref(p.id)}
            aria-label={p.label} title={p.label}
            aria-current={page === p.id ? "page" : undefined}
            className={`flex flex-col items-center text-xs ${page === p.id ? "text-action" : "text-subtle"}`}
          >
            {p.icon}
            {p.label}
          </a>
        ))}
        <AccountMenu variant="bar" />
      </nav>
      <TimerTray />
      {inbox && <InboxDrawer onClose={() => setInbox(false)} />}
      {news && <WhatsNew since={sinceVersion} all={news === "all"} onClose={closeNews} />}
    </div>
  );
}
