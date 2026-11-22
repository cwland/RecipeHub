import { useEffect, useState, type FormEvent } from "react";
import { api, downloadFile, fetchFile, getToken } from "../../api";
import { Popup } from "../Popup";
import { EXPORT_FORMATS, type ExportFormat } from "../../exportFormats";
import { EmailNeeded, useEmailReady } from "../../email";

// Open a server page (with the sign-in) in a new tab and print it: the print dialog's
// "Save as PDF" makes the PDF. The tab is opened first, so the click isn't treated as a pop-up.
export async function printPage(path: string) {
  const w = window.open("", "_blank");
  const token = getToken();
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const html = await res.text();
  if (!w) throw new Error("Allow pop-ups for this site to print");
  w.document.open();
  w.document.write(html);
  w.document.close();
  const go = () => (w.focus(), w.print());
  if (w.document.readyState === "complete") setTimeout(go, 300);
  else w.addEventListener("load", () => setTimeout(go, 100));
}

interface Link {
  path: string;
  url: string;
  on: boolean;
}
type Attach = "none" | ExportFormat;

// Share a recipe, in two tabs. Link & downloads: its public link (copy it, the share sheet, your mail
// app, with a file if you like), a file of it to download, or print it. Email: sent from RecipeHub
// (to, note, then the file to attach), with a warning when email isn't set up.
export default function ShareDialog({ recipe, onClose }: { recipe: { id: number; title: string }; onClose: () => void }) {
  const [link, setLink] = useState<Link | null>(null);
  const [attach, setAttach] = useState<Attach>("none");
  const [tab, setTab] = useState<"link" | "email">("link");
  const [note, setNoteMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const exportPath = (f: ExportFormat) => `/api/recipes/${recipe.id}/export?format=${f}`;
  const failed = (e: unknown) => setNoteMsg({ ok: false, text: (e as Error).message });

  useEffect(() => {
    api<Link>("GET", `/api/recipes/${recipe.id}/share-link`).then(setLink).catch(failed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe.id]);

  const canShare = typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link!.url);
      setNoteMsg({ ok: true, text: "Link copied" });
    } catch {
      setNoteMsg({ ok: false, text: "Couldn't copy here. Select the link and copy it instead." });
    }
  };
  // The share sheet (Messages, WhatsApp, Mail…): the link, and the file where it takes files
  const share = async () => {
    setNoteMsg(null);
    const data: ShareData = { title: recipe.title, text: recipe.title, url: link!.url };
    try {
      if (attach !== "none") {
        const f = await fetchFile(exportPath(attach));
        const file = new File([f.blob], f.name, { type: f.type });
        if (navigator.canShare?.({ files: [file] })) data.files = [file];
        else setNoteMsg({ ok: false, text: "This share sheet only takes the link. Download the file to send it as well." });
      }
      await navigator.share(data);
    } catch (e) {
      if ((e as Error).name !== "AbortError") failed(e);
    }
  };
  // Your mail app: a mailto: link can't carry a file, so a chosen file is downloaded first
  const mailApp = async () => {
    setNoteMsg(null);
    let name = "";
    try {
      if (attach !== "none") name = await downloadFile(exportPath(attach));
    } catch (e) {
      return failed(e);
    }
    const body = `${recipe.title}\n${link!.url}${name ? `\n\n(${name} is attached.)` : ""}`;
    window.open(`mailto:?subject=${encodeURIComponent(recipe.title)}&body=${encodeURIComponent(body)}`, "_self");
    if (name) setNoteMsg({ ok: true, text: `${name} is in your downloads: attach it to the email.` });
  };

  const button = "rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-pressed";
  return (
    <Popup title={`Share ${recipe.title}`} onClose={onClose}>
      <div role="tablist" aria-label="Share" className="flex gap-1 border-b border-line px-5 pt-3">
        {(
          [
            ["link", "Link & downloads"],
            ["email", "Email"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" id={`share-tab-${id}`} aria-selected={tab === id} aria-controls={`share-panel-${id}`} onClick={() => setTab(id)} className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-semibold ${tab === id ? "border-action text-action" : "border-transparent text-subtle hover:text-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "link" ? (
        <div role="tabpanel" id="share-panel-link" aria-labelledby="share-tab-link" className="flex flex-col gap-5 p-5">
          <PublicLink recipeId={recipe.id} link={link} setLink={setLink} onError={failed}>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => void copy()} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-pressed">
                Copy link
              </button>
              {canShare && (
                <button type="button" onClick={() => void share()} className={button}>
                  Share…
                </button>
              )}
              <button type="button" onClick={() => void mailApp()} className={button}>
                Mail app
              </button>
            </div>
            <AttachPick id="share-attach" value={attach} onChange={setAttach} hint={`Goes with ${canShare ? "Share… and " : ""}Mail app. The recipe's notes stay out.`} />
          </PublicLink>
          {note && (
            <p role={note.ok ? "status" : "alert"} className={`-mt-2 text-sm font-semibold ${note.ok ? "text-success" : "text-error"}`}>
              {note.text}
            </p>
          )}

          <section aria-label="Download" className="flex flex-col gap-2 border-t border-line pt-4">
            <h3 className="font-bold">Download</h3>
            <div className="flex flex-wrap gap-2">
              {EXPORT_FORMATS.map((f) => (
                <button key={f.id} type="button" title={f.hint} onClick={() => void downloadFile(exportPath(f.id)).catch(failed)} className={button}>
                  {f.name}
                </button>
              ))}
            </div>
            <p className="text-xs text-subtle">Downloads from here include the recipe's notes; the public link's leave them out.</p>
          </section>
          <button type="button" className="-mt-2 self-start text-sm font-semibold text-subtle hover:underline" onClick={() => void printPage(`/api/recipes/${recipe.id}/print`).catch(failed)}>
            Print it
          </button>
        </div>
      ) : (
        <div role="tabpanel" id="share-panel-email" aria-labelledby="share-tab-email" className="p-5">
          <SendEmail recipeId={recipe.id} />
        </div>
      )}
    </Popup>
  );
}

// Send from RecipeHub: the email (photo, Open the recipe button, the recipe), with the chosen file
function SendEmail({ recipeId }: { recipeId: number }) {
  const ready = useEmailReady();
  const [attach, setAttach] = useState<Attach>("none");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ sent: number }>("POST", `/api/recipes/${recipeId}/email`, { to, ...(note.trim() ? { note } : {}), attach });
      setMsg({ ok: true, text: `Sent to ${r.sent === 1 ? to.trim() : `${r.sent} people`}.` });
      setTo("");
      setNote("");
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    }
    setBusy(false);
  };
  const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2.5 font-normal text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/15";
  return (
    <form aria-label="Send from RecipeHub" onSubmit={send} className="flex flex-col gap-3">
      <h3 className="font-bold">Send from RecipeHub</h3>
      {ready === false && <EmailNeeded what="RecipeHub can't send this yet" />}
      <label className="text-sm font-semibold text-subtle">
        To
        <input id="share-to" type="text" inputMode="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="mom@example.com (commas for more)" className={field} />
      </label>
      <label className="text-sm font-semibold text-subtle">
        Note <span className="font-normal">(optional)</span>
        <textarea id="share-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="We loved this one!" className={field} />
      </label>
      <AttachPick id="share-email-attach" value={attach} onChange={setAttach} hint="Sent with the email. The recipe's notes stay out." />
      <button type="submit" disabled={busy || ready === false || !to.trim()} className="self-start rounded-lg bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">
        {busy ? "Sending…" : "Send"}
      </button>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-success" : "text-error"}>
          {msg.text}
        </p>
      )}
    </form>
  );
}

// "Attach a file": none, or one of the export formats
function AttachPick({ id, value, onChange, hint }: { id: string; value: Attach; onChange: (a: Attach) => void; hint: string }) {
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-semibold text-subtle">
        Attach a file
      </label>
      <select id={id} aria-describedby={`${id}-hint`} value={value} onChange={(e) => onChange(e.target.value as Attach)} className="rounded-lg border border-line bg-page px-3 py-2.5 font-normal text-ink">
        <option value="none">None, just the link</option>
        {EXPORT_FORMATS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
      <span id={`${id}-hint`} className="text-subtle">
        {hint}
      </span>
    </div>
  );
}

// The recipe's public read-only link, with the ways to send it (children), and New link
function PublicLink({ recipeId, link, setLink, onError, children }: { recipeId: number; link: Link | null; setLink: (l: Link) => void; onError: (e: unknown) => void; children: React.ReactNode }) {
  const [asking, setAsking] = useState(false);
  const replace = async () => {
    try {
      setLink(await api<Link>("POST", `/api/recipes/${recipeId}/share-link/new`));
      setAsking(false);
    } catch (e) {
      onError(e);
    }
  };
  return (
    <section aria-label="Public link" className="flex flex-col gap-2">
      <h3 className="font-bold">Public link</h3>
      {link && !link.on && <p className="text-sm text-subtle">Public share links are off. The owner can turn them on in Settings › Recipes.</p>}
      {link?.on && (
        <>
          <p className="text-sm text-subtle">Anyone with the link can see this recipe, without signing in. It can't be changed from there.</p>
          <input aria-label="Public link" readOnly value={link.url} onFocus={(e) => e.target.select()} className="w-full rounded-lg border border-line bg-page px-3 py-2 text-sm" />
          {children}
          {!asking ? (
            <button type="button" onClick={() => setAsking(true)} className="self-start text-sm font-semibold text-subtle hover:underline">
              New link
            </button>
          ) : (
            <div className="rounded-lg bg-page p-3 text-sm">
              <p>The current link will stop working, for everyone you've sent it to. Make a new one?</p>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => void replace()} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-pressed">
                  Make a new link
                </button>
                <button type="button" onClick={() => setAsking(false)} className="px-3 py-2 text-sm font-semibold text-subtle hover:underline">
                  Keep this one
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
