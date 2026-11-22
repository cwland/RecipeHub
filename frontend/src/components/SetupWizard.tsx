import { UnitsPills } from "./settingsUi";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { forgetAiStatus } from "../ai";
import { addPasskey, passkeyError, passkeysAvailable } from "../passkeys";
import { initialsOf, type User } from "../session";
import { PROVIDERS } from "./AiSettings";
import { PRESETS } from "./EmailSettings";
import { Logo } from "./Icons";
import { bestModel, SUGGESTIONS } from "../aiModels";

// The first sign-in: a wizard over the app (the app shows, blurred, behind it). One short page per
// step, so nothing scrolls. The owner: Welcome, Passkey, Choose an AI, Connect your AI, Backup AI,
// Fine-Tune AI, Email, Recipe & Meal Planning, Done. A member: Welcome, Passkey, Recipe & Meal
// Planning, Done. Skip Setup is always there; a step with a test (AI, email) goes on once the test
// works, or is skipped. Finish (or Skip Setup) marks setup done; the app then points at Add recipe.

type StepId = "welcome" | "passkey" | "ai" | "connect" | "backup" | "aiPrefs" | "email" | "prefs" | "done";
const TITLES: Record<StepId, string> = { welcome: "Welcome to RecipeHub", passkey: "Sign in with a passkey", ai: "Choose an AI", connect: "Connect", backup: "Backup AI", aiPrefs: "Fine-Tune AI", email: "Email", prefs: "Recipe & Meal Planning", done: "You're all set! 🎉" };
const EMOJI: Record<StepId, string> = { welcome: "👋", passkey: "🔑", ai: "✨", connect: "🔌", backup: "🛟", aiPrefs: "🎛️", email: "📬", prefs: "🍳", done: "" };
const SHORT: Record<string, string> = { local: "Local", openai: "OpenAI", anthropic: "Anthropic", gemini: "Gemini", openrouter: "OpenRouter" };
const COMPANION = "https://github.com/cwland/RecipeHub-Companion";

const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2 font-normal text-ink outline-none focus:border-action focus:ring-2 focus:ring-action/15";
const label = "block text-sm font-semibold text-subtle";
const primary = "rounded-lg bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed disabled:opacity-50";
const secondary = "rounded-lg border border-line px-4 py-2 font-semibold hover:bg-pressed disabled:opacity-50";
const link = "text-sm font-semibold text-link hover:underline";

type StepProps = { step: (ready: boolean, save: () => Promise<void>) => void };
type Result = { ok: boolean; text: string } | null;

export default function SetupWizard({ user, onDone, start = 0, aiReady = false }: { user: User; onDone: (u: User) => void; start?: number; aiReady?: boolean }) {
  const owner = user.role !== "member";
  const steps: StepId[] = owner ? ["welcome", "passkey", "ai", "connect", "backup", "aiPrefs", "email", "prefs", "done"] : ["welcome", "passkey", "prefs", "done"];
  const [at, setAt] = useState(start);
  const [trail, setTrail] = useState<number[]>([]); // where Back goes (skipped steps aren't in it)
  const [me, setMe] = useState(user);
  const [aiSaved, setAiSaved] = useState(aiReady);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  // the AI services live here: chosen on one step, connected on the next
  const main = useService("local");
  const backup = useService("openrouter");
  // ready: this step's checks pass; save: what Next does first
  const [ready, setReady] = useState(false);
  const save = useRef<() => Promise<void>>(async () => {});
  const id = steps[at];
  const last = at === steps.length - 1;
  const title = id === "connect" ? `Connect ${SHORT[main.provider]}` : TITLES[id];

  // Done (or skipped): remembered, then the wizard fades away
  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ user: User }>("POST", "/api/profile/setup-done");
      setLeaving(true);
      setTimeout(() => onDone(r.user), 300);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  const reset = () => {
    setReady(false);
    save.current = async () => {};
    setError("");
  };
  const go = (n: number) => {
    reset();
    setTrail((t) => [...t, at]);
    setAt(n);
  };
  // Skip AI Setup (on Choose or Connect): Back from Fine-Tune comes back to Choose an AI
  const skipTo = (n: number) => {
    if (id !== "ai" && id !== "connect") return go(n);
    const choose = steps.indexOf("ai");
    reset();
    setTrail((t) => [...t.filter((x) => x < choose), choose]);
    setAt(n);
  };
  const back = () => {
    reset();
    setAt(trail.at(-1) ?? at - 1);
    setTrail((t) => t.slice(0, -1));
  };
  const onNext = async () => {
    if (last) return finish();
    setBusy(true);
    setError("");
    try {
      await save.current();
      if (id === "connect" || id === "backup") setAiSaved(true);
      go(at + 1);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  // each step tells the wizard whether it's ready and what Next saves
  const step = (ok: boolean, fn: () => Promise<void>) => {
    save.current = fn;
    if (ok !== ready) setReady(ok);
  };
  const skips: Partial<Record<StepId, [string, number]>> = {
    ai: ["Skip AI Setup", steps.indexOf("aiPrefs")],
    connect: ["Skip AI Setup", steps.indexOf("aiPrefs")],
    backup: ["Skip Backup", steps.indexOf("aiPrefs")],
    passkey: ["Not now", at + 1],
    email: ["Skip Email Setup", at + 1],
  };
  const skip = skips[id];
  const nextLabel = last ? "Finish & Open RecipeHub" : "Next →";

  return (
    <div className={`fixed inset-0 z-[60] flex items-center justify-center bg-ink/30 p-3 backdrop-blur-[8px] transition-opacity duration-300 sm:p-6 ${leaving ? "opacity-0" : "opacity-100"}`}>
      <div role="dialog" aria-modal="true" aria-label="Set up RecipeHub" className="flex h-[min(39rem,calc(100dvh-1.5rem))] w-full max-w-[40rem] flex-col overflow-hidden rounded-3xl bg-container shadow-[0_24px_60px_rgba(16,24,32,0.28)]">
        {/* the logo, where you are, and Skip Setup */}
        <header className="flex items-center gap-3 bg-gradient-to-br from-brand-subtle via-container to-[#fff6e0] px-5 py-3 sm:px-7">
          <Logo className="size-8" />
          <div className="mr-auto">
            <p className="text-sm font-semibold">
              Step {at + 1} of {steps.length}
            </p>
            <div role="progressbar" aria-label="Setup progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={at + 1} className="mt-1 flex gap-1.5">
              {steps.map((s, i) => (
                <span key={s} className={`h-1.5 rounded-full transition-all duration-300 ${i === at ? "w-5 bg-action" : i < at ? "w-1.5 bg-action/60" : "w-1.5 bg-strong/50"}`} />
              ))}
            </div>
          </div>
          <button type="button" onClick={() => void finish()} disabled={busy} className="rounded-lg px-3 py-2 text-sm font-semibold text-subtle hover:bg-container/70 hover:text-ink disabled:opacity-50">
            Skip Setup
          </button>
        </header>

        <section aria-label={`Step ${at + 1} of ${steps.length}: ${title}`} className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 py-5 sm:px-7">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {EMOJI[id] && <span aria-hidden>{EMOJI[id]}</span>}
            {title}
          </h1>
          {id === "welcome" && <Welcome user={me} step={step} onSaved={setMe} />}
          {id === "passkey" && <Passkey step={step} />}
          {id === "ai" && <ChooseAi s={main} step={step} />}
          {id === "connect" && <Connect s={main} step={step} />}
          {id === "backup" && <Backup main={main} s={backup} step={step} />}
          {id === "aiPrefs" && <AiPrefs step={step} aiOn={aiSaved} />}
          {id === "email" && <Email user={me} step={step} />}
          {id === "prefs" && <Prefs user={me} owner={owner} step={step} />}
          {id === "done" && <Done step={step} />}
          {error && (
            <p role="alert" className="rounded-lg bg-error-subtle px-3 py-2 text-sm text-error">
              {error}
            </p>
          )}
        </section>

        <footer className="flex items-center gap-2 whitespace-nowrap border-t border-line px-5 py-3 sm:gap-3 sm:px-7">
          {at > 0 && (
            <button type="button" onClick={back} className="px-1 py-2.5 font-semibold text-subtle hover:underline">
              ← Back
            </button>
          )}
          <span className="ml-auto" />
          {skip && (
            <button type="button" aria-label={skip[0]} onClick={() => skipTo(skip[1])} className={secondary}>
              <span className="sm:hidden">{skip[0] === "Not now" ? "Not now" : "Skip"}</span>
              <span className="hidden sm:inline">{skip[0]}</span>
            </button>
          )}
          <button type="button" disabled={!ready || busy} onClick={() => void onNext()} className={primary}>
            {busy ? "Saving…" : nextLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ---------- pieces ----------

function Status({ r }: { r: Result }) {
  if (!r) return null;
  return (
    <p role={r.ok ? "status" : "alert"} className={`text-sm font-semibold ${r.ok ? "text-success" : "text-error"}`}>
      {r.text}
    </p>
  );
}

// An on/off switch with a one-line explanation (needs: why it can't be switched now)
function Switch({ on, set, title, hint, needs }: { on: boolean; set: (v: boolean) => void; title: string; hint: string; needs?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border border-line px-4 py-2.5 ${needs ? "opacity-70" : ""}`}>
      <span className="flex-1">
        <span className="font-semibold">{title}</span>
        <span className="block text-sm text-subtle">{needs ?? hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on && !needs}
        aria-label={title}
        disabled={!!needs}
        onClick={() => set(!on)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${on && !needs ? "bg-action" : "bg-strong"} disabled:cursor-not-allowed`}
      >
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-all ${on && !needs ? "left-[1.375rem]" : "left-0.5"}`} />
      </button>
    </div>
  );
}

// ---------- welcome ----------
function Welcome({ user, step, onSaved }: StepProps & { user: User; onSaved: (u: User) => void }) {
  const [name, setName] = useState(user.displayName ?? "");
  const [username, setUsername] = useState(user.username);
  const [email, setEmail] = useState(user.email ?? "");
  const ok = !!name.trim() && !!username.trim() && /^\S+@\S+\.\S+$/.test(email.trim());
  useEffect(() => {
    step(ok, async () => {
      onSaved(await api<User>("PATCH", "/api/profile", { displayName: name.trim(), username: username.trim(), email: email.trim() }));
    });
  });
  return (
    <>
      <p className="text-subtle">Your own recipe box and meal planner. Let's start with you.</p>
      <div className="flex items-center gap-4">
        <span aria-label="Your initials" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-action text-xl font-bold text-white shadow-inner">
          {initialsOf({ ...user, displayName: name })}
        </span>
        <label className={`${label} flex-1`}>
          Your name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="First and last name" className={field} />
        </label>
      </div>
      <label className={label}>
        Username
        <input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={100} autoComplete="username" className={field} />
      </label>
      <label className={label}>
        Email address
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" className={field} />
      </label>
    </>
  );
}

// ---------- passkey ----------
function Passkey({ step }: StepProps) {
  const [passkeys, setPasskeys] = useState<number | null>(null);
  const [info, setInfo] = useState(false);
  const [keyError, setKeyError] = useState("");
  const can = passkeysAvailable();
  useEffect(() => {
    api<unknown[]>("GET", "/api/auth/passkeys")
      .then((l) => setPasskeys(l.length))
      .catch(() => setPasskeys(0));
  }, []);
  useEffect(() => step(true, async () => {}));
  const add = async () => {
    setKeyError("");
    try {
      await addPasskey();
      setPasskeys((n) => (n ?? 0) + 1);
    } catch (e) {
      const msg = passkeyError(e);
      if (msg) setKeyError(msg);
    }
  };
  return (
    <>
      <p className="flex items-center gap-2 text-subtle">
        Sign in without a password, on any of your devices.
        <button type="button" aria-label="What's a passkey?" title="What's a passkey?" aria-expanded={info} onClick={() => setInfo(!info)} className="flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-bold text-subtle hover:bg-pressed">
          i
        </button>
      </p>
      {info && <p className="rounded-lg bg-page p-3 text-sm">It uses Touch ID, Face ID, Windows Hello or your phone, it only works on this RecipeHub, and a fake site can't trick it out of you. Your password still works too.</p>}
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-line p-6 text-center">
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${passkeys ? "bg-success-subtle text-success" : "bg-page text-subtle"}`}>{passkeys === null ? "Checking…" : passkeys ? "Passkey registered" : "No passkey yet"}</span>
        {can ? (
          <button type="button" onClick={() => void add()} className={primary}>
            {passkeys ? "Add another passkey" : "Add Passkey"}
          </button>
        ) : (
          <p className="text-sm text-subtle">This browser can't add one here (passkeys need https:// or localhost). You can add one later in Settings › Security.</p>
        )}
        {keyError && <p role="alert" className="text-sm text-error">{keyError}</p>}
      </div>
    </>
  );
}

// ---------- AI services (shared by Connect and Backup) ----------
type Provider = (typeof PROVIDERS)[number]["id"];
// How to get a key, provider by provider (the link is the provider's own key page)
const GUIDE: Record<Provider, ReactNode[]> = {
  local: [
    <>Install Ollama (ollama.com) or LM Studio on a computer with a graphics card.</>,
    <>
      Download a model, e.g. <code>ollama pull qwen3-vl:8b</code>.
    </>,
    <>
      Let other computers reach it (Ollama: set <code>OLLAMA_HOST=0.0.0.0</code>), then enter its address below: <code>http://&lt;that computer&gt;:11434/v1</code>.
    </>,
  ],
  openai: ["Sign in at platform.openai.com.", "Add a little credit under Billing (pay as you go).", "Create a key under API keys, and paste it below."],
  anthropic: ["Sign in at console.anthropic.com.", "Add a little credit under Billing.", "Create a key under Settings › API keys, and paste it below."],
  gemini: ["Sign in to Google AI Studio with your Google account.", "Click Create API key (there's a free tier).", "Paste it below."],
  openrouter: ["Sign in at openrouter.ai.", "Add a little credit (one key reaches many providers' models).", "Create a key under Keys, and paste it below."],
};
// Models worth starting with (Settings › AI's (i) has more); "Load models" shows what's there today
const reads = (provider: string, model: string) => provider !== "local" || /vl|vision|llava|gemma3|minicpm-v/i.test(model);

// One AI service: Validate (at the end of the key or address box) lists its models and picks the best
// one for RecipeHub; Next then asks that model once before saving (see check)
function useService(initial: Provider) {
  const [provider, setProviderRaw] = useState<Provider>(initial);
  const [baseUrl, setBaseUrlRaw] = useState("");
  const [apiKey, setApiKeyRaw] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [validated, setValidated] = useState<Result>(null);
  const [busy, setBusy] = useState(false);
  const p = PROVIDERS.find((x) => x.id === provider)!;
  const body = { name: p.name, enabled: true, provider, model: model.trim(), baseUrl: provider === "local" ? baseUrl.trim() : null, apiKey: provider === "local" ? "" : apiKey.trim(), quick: true, photos: reads(provider, model) };
  // a new key, address or service: validate again
  const fresh = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setModels([]);
    setModel("");
    setValidated(null);
  };
  const canValidate = provider === "local" ? !!baseUrl.trim() : !!apiKey.trim();
  const validate = async () => {
    setBusy(true);
    setValidated(null);
    try {
      const r = await api<{ models: string[] }>("POST", "/api/settings/ai/models", { ...body, model: body.model || "check" });
      const list = [...new Set(r.models)].sort((a, b) => a.localeCompare(b));
      setModels(list);
      setModel(bestModel(provider, list));
      const n = `${list.length} model${list.length === 1 ? "" : "s"}`;
      setValidated(list.length ? { ok: true, text: provider === "local" ? `Connected: ${n}.` : `Key works: ${n}.` } : { ok: false, text: provider === "local" ? "Connected, but no models are installed yet. Pull one (see below), then Validate again." : "The key works, but no models came back." });
    } catch (e) {
      setModels([]);
      setModel("");
      setValidated({ ok: false, text: (e as Error).message });
    }
    setBusy(false);
  };
  // Next: the chosen model answers once before it's saved
  const check = async () => void (await api("POST", "/api/settings/ai/test", body));
  return { provider, setProvider: fresh(setProviderRaw), p, baseUrl, setBaseUrl: fresh(setBaseUrlRaw), apiKey, setApiKey: fresh(setApiKeyRaw), model, setModel, models, validated, busy, validate, canValidate, check, body, works: validated?.ok === true && !!model };
}
type Service = ReturnType<typeof useService>;

function ServiceFields({ s, id }: { s: Service; id: string }) {
  const local = s.provider === "local";
  return (
    <>
      <div>
        <label htmlFor={`${id}-key`} className={label}>
          {local ? "Address" : "API key"}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id={`${id}-key`}
            type={local ? "text" : "password"}
            value={local ? s.baseUrl : s.apiKey}
            onChange={(e) => (local ? s.setBaseUrl : s.setApiKey)(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && s.canValidate && (e.preventDefault(), void s.validate())}
            placeholder={local ? "http://192.168.1.20:11434/v1" : "Paste your key"}
            autoComplete="off"
            className={`${field} mt-0 flex-1`}
          />
          <button type="button" disabled={s.busy || !s.canValidate} onClick={() => void s.validate()} className={`${secondary} shrink-0`}>
            {s.busy ? "Checking…" : "Validate"}
          </button>
        </div>
      </div>
      <Status r={s.validated} />
      <label className={label}>
        Model
        <select aria-label="Model" value={s.model} disabled={!s.models.length} onChange={(e) => s.setModel(e.target.value)} className={`${field} disabled:opacity-60`}>
          {!s.models.length && <option value="">Validate first</option>}
          {s.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <p className="text-sm text-subtle">💡 {SUGGESTIONS[s.provider]}</p>
    </>
  );
}

// ---------- choose an AI ----------
function ChooseAi({ s, step }: StepProps & { s: Service }) {
  useEffect(() => step(true, async () => {}));
  const rows: [string, string, string][] = [
    ["Import from a link", "Recipe sites", "Any page"],
    ["Photos and PDFs", "No", "Reads them"],
    ["Nutrition", "Type it in", "Worked out"],
    ["Categories and tags", "You pick", "Suggested"],
  ];
  return (
    <>
      <p className="text-subtle">
        <strong className="text-ink">Optional but recommended.</strong> A home AI (like Ollama) keeps everything on your network.
      </p>
      <table aria-label="With and without AI" className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="py-1 pr-2 font-semibold">Feature</th>
            <th className="px-2 py-1 font-semibold">Without AI</th>
            <th className="px-2 py-1 font-semibold">With AI</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([f, without, withAi]) => (
            <tr key={f} className="border-t border-line">
              <th scope="row" className="py-1 pr-2 text-left font-semibold">
                {f}
              </th>
              <td className="px-2 py-1 text-subtle">{without}</td>
              <td className="px-2 py-1 font-semibold text-action">{withAi}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div role="radiogroup" aria-label="AI provider" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PROVIDERS.map((x) => (
          <label key={x.id} className={`flex cursor-pointer flex-col rounded-xl border-2 px-3 py-1.5 text-sm transition ${s.provider === x.id ? "border-action bg-brand-subtle" : "border-line hover:border-strong"}`}>
            <input type="radio" name="ai-provider" checked={s.provider === x.id} onChange={() => s.setProvider(x.id)} className="sr-only" />
            <span className="font-semibold">{SHORT[x.id]}</span>
            <span className="text-xs text-subtle">{x.id === "local" ? "Free and private" : x.id === "openrouter" ? "Many models, one key" : "Pay as you go"}</span>
          </label>
        ))}
      </div>
    </>
  );
}

// "How to get a key" (or set up a home AI): one link, the steps open under it
function Guide({ s }: { s: Service }) {
  const [open, setOpen] = useState(false);
  const name = s.provider === "local" ? "How to set up a home AI" : "How to get a key";
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={link}>
        {name}
      </button>
      {open && (
        <ol aria-label={name} className="mt-2 list-decimal space-y-1 rounded-xl bg-page py-2.5 pl-8 pr-3 text-sm text-subtle">
          {GUIDE[s.provider].map((g, i) => (
            <li key={i}>{g}</li>
          ))}
          {s.p.keyUrl && (
            <li>
              Key page:{" "}
              <a href={s.p.keyUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-link hover:underline">
                {new URL(s.p.keyUrl).host} ↗
              </a>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}

// ---------- connect your AI ----------
function Connect({ s, step }: StepProps & { s: Service }) {
  useEffect(() =>
    step(s.works, async () => {
      await s.check();
      await api("PUT", "/api/settings/ai", { maxPerRun: 50, timeoutSec: 15, askNextOnNoMatch: false, services: [s.body] });
      forgetAiStatus();
    })
  );
  return (
    <>
      <Guide s={s} />
      <ServiceFields s={s} id="ai-main" />
    </>
  );
}

// ---------- backup AI ----------
function Backup({ main, s, step }: StepProps & { main: Service; s: Service }) {
  useEffect(() =>
    step(s.works, async () => {
      await s.check();
      await api("PUT", "/api/settings/ai", { maxPerRun: 50, timeoutSec: 15, askNextOnNoMatch: false, services: [main.body, { ...s.body, name: `${s.p.name} (backup)` }] });
      forgetAiStatus();
    })
  );
  return (
    <>
      <p className="text-subtle">Optional. Asked when the first one is down, slow or out of credit.</p>
      <label className={label}>
        Service
        <select value={s.provider} onChange={(e) => s.setProvider(e.target.value as Provider)} className={field}>
          {PROVIDERS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      <ServiceFields s={s} id="ai-backup" />
    </>
  );
}

// ---------- fine-tune AI ----------
function AiPrefs({ step, aiOn }: StepProps & { aiOn: boolean }) {
  const [enhance, setEnhance] = useState(true);
  const [nutrition, setNutrition] = useState(true);
  const [copies, setCopies] = useState(true);
  const needs = aiOn ? undefined : "Needs AI: set it up any time in Settings › AI.";
  useEffect(() => step(true, async () => void (await api("PUT", "/api/settings/features", aiOn ? { aiEnhance: enhance, autoNutrition: nutrition, savedCopies: copies } : { savedCopies: copies }))));
  return (
    <>
      <p className="text-subtle">Where AI lends a hand. All of these are in Settings later.</p>
      <Switch on={enhance} set={setEnhance} needs={needs} title="Improve with AI" hint="Checks each new recipe and suggests fixes, categories and tags." />
      <Switch on={nutrition} set={setNutrition} needs={needs} title="Auto nutrition" hint="Works out nutrition, and again when ingredients change." />
      <Switch on={copies} set={setCopies} title="Saved copies for blocked sites" hint="When a site won't let RecipeHub in, read a web archive copy." />
    </>
  );
}

// ---------- email ----------
// Optional: RecipeHub sends email (password resets, sharing, meal plan reminders). A test email has to
// arrive before it's saved. Another server, RecipeHub's address and the notes are under More options.
function Email({ user, step }: StepProps & { user: User }) {
  const [provider, setProvider] = useState("gmail");
  const preset = PRESETS.find((p) => p.id === provider);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [from, setFrom] = useState("");
  const [appUrl, setAppUrl] = useState(window.location.origin);
  const [tested, setTested] = useState<Result>(null);
  const [testing, setTesting] = useState(false);
  const [more, setMore] = useState(false);
  const settings = {
    enabled: true,
    host: preset?.host ?? host.trim(),
    port: preset?.port ?? Number(port),
    security: preset?.security ?? (Number(port) === 465 ? "ssl" : "starttls"),
    username: username.trim(),
    password,
    fromName: "RecipeHub",
    fromAddress: from.trim(),
    appUrl: appUrl.trim(),
  };
  const filled = !!(settings.username || password || settings.fromAddress || (!preset && settings.host));
  // a change means testing again
  const changed = <T,>(set: (v: T) => void) => (v: T) => (set(v), setTested(null));
  useEffect(() => step(!filled || !!tested?.ok, async () => void (filled ? await api("PUT", "/api/settings/email", settings) : undefined)));
  const test = async () => {
    setTesting(true);
    try {
      const r = await api<{ message: string }>("POST", "/api/settings/email/test", { settings, ...(user.email ? { to: user.email } : {}) });
      setTested({ ok: true, text: r.message });
    } catch (e) {
      setTested({ ok: false, text: (e as Error).message });
    }
    setTesting(false);
  };
  return (
    <>
      <p className="text-subtle">Optional: for password resets, sharing and reminders.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          Provider
          <select value={provider} onChange={(e) => changed(setProvider)(e.target.value)} className={field}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value="custom">Another server</option>
          </select>
        </label>
        <label className={label}>
          From address
          <input type="email" value={from} onChange={(e) => changed(setFrom)(e.target.value)} placeholder="recipes@example.com" className={field} />
        </label>
        <label className={label}>
          Username
          <input value={username} onChange={(e) => changed(setUsername)(e.target.value)} autoComplete="off" className={field} />
        </label>
        <label className={label}>
          Password
          <input type="password" value={password} onChange={(e) => changed(setPassword)(e.target.value)} autoComplete="new-password" className={field} />
        </label>
      </div>
      {!preset && (
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <label className={label}>
            Server
            <input value={host} onChange={(e) => changed(setHost)(e.target.value)} placeholder="smtp.example.com" className={field} />
          </label>
          <label className={label}>
            Port
            <input value={port} inputMode="numeric" onChange={(e) => changed(setPort)(e.target.value)} className={field} />
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={testing || !settings.host || !settings.fromAddress} onClick={() => void test()} className={secondary}>
          {testing ? "Sending…" : "Send a test email"}
        </button>
        <button type="button" aria-expanded={more} onClick={() => setMore(!more)} className={link}>
          More options
        </button>
      </div>
      <Status r={tested} />
      {more && (
        <div className="flex flex-col gap-2 rounded-xl bg-page p-3 text-sm text-subtle">
          {preset && <p>{preset.hint}</p>}
          <p>Another server: pick it under Provider. Ports: 587 with STARTTLS (most), or 465 with SSL/TLS.</p>
          <label className={label}>
            RecipeHub's address
            <input value={appUrl} onChange={(e) => changed(setAppUrl)(e.target.value)} className={field} />
          </label>
          <p className="text-xs">For links in emails: the address people reach RecipeHub on.</p>
        </div>
      )}
    </>
  );
}

// ---------- recipe & meal planning ----------
function Prefs({ user, owner, step }: StepProps & { user: User; owner: boolean }) {
  const [units, setUnits] = useState<string>(user.units ?? "original");
  const [awake, setAwake] = useState(user.keepAwake ?? true);
  const [feeds, setFeeds] = useState(true);
  useEffect(() =>
    step(true, async () => {
      await api("PATCH", "/api/profile", { units, keepAwake: awake });
      if (owner) await api("PUT", "/api/settings/features", { discoveryRefresh: feeds });
    })
  );
  return (
    <>
      <div>
        <p className="mb-2 font-semibold">📏 Measurements</p>
        <UnitsPills value={units as "original" | "metric" | "us"} onChange={setUnits} />
      </div>
      <Switch on={awake} set={setAwake} title="Keep the screen awake in Cook mode" hint="Your phone or tablet stays on while you cook." />
      {owner && <Switch on={feeds} set={setFeeds} title="Check feeds by themselves" hint="Discover looks for new recipes every few hours." />}
    </>
  );
}

// ---------- done ----------
function Done({ step }: StepProps) {
  useEffect(() => step(true, async () => {}));
  return (
    <>
      <p className="text-subtle">RecipeHub is ready for your recipes.</p>
      <div className="flex flex-col gap-2 rounded-2xl bg-gradient-to-br from-brand-subtle to-[#fff6e0] p-4">
        <p className="font-semibold">🧩 RecipeHub Companion</p>
        <p className="text-sm text-subtle">Clip a recipe from any site in one click (Chrome, Brave, Edge).</p>
        <a href={COMPANION} target="_blank" rel="noopener noreferrer" className="self-start rounded-lg bg-container px-4 py-2 text-sm font-semibold text-action shadow-sm hover:bg-pressed">
          Get the RecipeHub Companion ↗
        </a>
      </div>
      <p className="rounded-xl bg-page p-3 text-sm text-subtle">👉 Add your first recipe with Add recipe, at the top right. We'll point it out.</p>
    </>
  );
}
