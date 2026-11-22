import { useState } from "react";
import ImportDialog from "./ImportDialog";
import { takeSentPage } from "../../receiveRelay";

// #/recipes/receive: the page the Send to RecipeHub bookmark sent (kept by /receive.html). Any site
// could send one, so this asks before importing.
const titleOf = (html: string) => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.querySelector('meta[property="og:title"]')?.getAttribute("content") || doc.title || "";
};

export default function ReceivePage() {
  const [sent] = useState(takeSentPage);
  const [importing, setImporting] = useState(false);
  const tooBig = /[?&]too-big=1/.test(window.location.hash);
  const host = sent ? new URL(sent.url).hostname.replace(/^www\./, "") : "";
  const title = sent ? titleOf(sent.html) : "";

  return (
    <div className="mx-auto max-w-[640px] px-3 pb-16 pt-6 sm:px-6">
      <h1 className="text-2xl font-semibold">Send to RecipeHub</h1>
      {tooBig && (
        <p role="alert" className="mt-3 rounded-lg bg-error-subtle px-4 py-3 text-error">
          That page is too big to send. Copy the recipe and use Paste the recipe instead.
        </p>
      )}
      {!sent && !tooBig && (
        <p className="mt-3 text-subtle">
          This page receives recipes from the Send to RecipeHub bookmark. Open a recipe in your browser, then tap the bookmark. Add it in Settings › Recipes.
        </p>
      )}
      {sent && !importing && (
        <section aria-label="Sent page" className="mt-4 rounded-lg bg-container p-4">
          <p className="font-semibold">Import the recipe from {host}?</p>
          {title && <p className="mt-1 text-subtle">{title}</p>}
          <p className="mt-1 break-all text-sm text-subtle">{sent.url}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setImporting(true)} className="rounded bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed">
              Import
            </button>
            <a href="#/recipes" className="rounded px-4 py-2.5 font-semibold text-subtle hover:bg-pressed">
              Cancel
            </a>
          </div>
        </section>
      )}
      {sent && importing && <ImportDialog page={sent} onClose={() => {}} />}
    </div>
  );
}
