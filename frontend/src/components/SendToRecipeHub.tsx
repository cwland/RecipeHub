import { useEffect, useRef, useState } from "react";
import { bookmarklet } from "../bookmarklet";

// Settings › Recipes: the Send to RecipeHub bookmark, for recipes RecipeHub can't fetch itself (a
// security check, a paywall you're signed in to). The link's address is set directly so React
// doesn't fuss about a javascript: link.
export function SendToRecipeHub() {
  const code = bookmarklet(window.location.origin);
  const link = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => link.current?.setAttribute("href", code), [code]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      window.prompt("Copy the bookmark:", code);
    }
  };
  return (
    <section aria-label="Send to RecipeHub" className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold">Send to RecipeHub</h2>
      <p className="mt-1 text-sm text-subtle">
        For recipes RecipeHub can't get by itself: a site with a security check, or a paywall you're signed in to. Open the recipe in your browser, tap the bookmark, and the page you see comes to RecipeHub. It asks before importing.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a ref={link} onClick={(e) => e.preventDefault()} draggable className="cursor-grab rounded-lg bg-brand-subtle px-4 py-2 font-semibold text-action">
          Send to RecipeHub
        </a>
        <button type="button" onClick={() => void copy()} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-pressed">
          {copied ? "Copied" : "Copy the bookmark"}
        </button>
      </div>
      <p className="mt-3 text-sm text-subtle">
        Computer: Drag the button to your bookmarks bar. Phone: copy the bookmark, add any page to your bookmarks, then edit it and paste this in as its address. Your browser may ask you to allow pop-ups the first time.
      </p>
    </section>
  );
}
