import { eq } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { appSettings } from "../db/schema.js";
import { isOn } from "./features.js";
import { decryptSecret, encryptSecret } from "./secrets.js";
import { HttpError } from "./errors.js";
import { logEvent } from "./appLog.js";

// AI services for RecipeHub (recipe import, photo reading, nutrition, grocery sorting...). Settings live in
// app_settings under "ai" (the API key encrypted). Five kinds of provider:
//  - openai, openrouter, local: the OpenAI chat-completions format (local = Ollama, LM Studio,
//    LocalAI, vLLM ... at a base URL you give, key optional)
//  - anthropic: Claude's Messages API
//  - gemini: Google's generateContent API

export const AI_PROVIDERS = ["openai", "anthropic", "gemini", "openrouter", "local"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

const DEFAULT_BASE: Record<AiProvider, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  openrouter: "https://openrouter.ai/api/v1",
  local: "",
};

// One AI service in the list (tried in order: the first, then the next if it's down)
export interface StoredService {
  id: string;
  name: string; // "Home AI", "OpenAI backup" ...
  enabled: boolean;
  provider: AiProvider;
  model: string;
  baseUrl: string | null; // local (required) or an override
  apiKeyEnc: string | null;
  // Model cascading: which jobs this service takes. A cheap, fast model can do the quick jobs
  // and a stronger one the rest; services that can't see pictures are skipped for photos.
  quick: boolean; // quick jobs: sorting the grocery list, nutrition, meal ideas
  photos: boolean; // can read photos (recipe cards, cookbook pages)
}

// What a request needs: "recipe" (reading a recipe, any service), "quick", or "photo"
export type AiTask = "recipe" | "quick" | "photo";
export interface AiImage {
  mime: string; // image/jpeg ...
  base64: string;
}

export interface StoredAi {
  enabled: boolean;
  mode: "auto" | "manual"; // (not used yet)
  maxPerRun: number; // most items sent in one go (keeps costs predictable)
  timeoutSec: number; // give up on a service after this long and try the next one
  askNextOnNoMatch: boolean; // when one service finds no good fit, ask the next one too
  services: StoredService[];
}

// Settings saved before backup services existed: one provider at the top level
interface LegacyAi {
  enabled: boolean;
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  apiKeyEnc: string | null;
  mode: "auto" | "manual";
  maxPerRun: number;
}

export interface AiConfig {
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
}
export type ActiveService = AiConfig & { id: string; name: string; quick?: boolean; photos?: boolean };

// Most hosted chat models read pictures; a home server depends on the model, so it starts off
const photosByDefault = (p: AiProvider) => p !== "local";

export const PROVIDER_NAMES: Record<AiProvider, string> = { openai: "OpenAI", anthropic: "Claude", gemini: "Gemini", openrouter: "OpenRouter", local: "Home AI" };

export interface ServiceInput {
  id?: string;
  name?: string;
  enabled?: boolean;
  provider: AiProvider;
  model: string;
  baseUrl: string | null;
  apiKey?: string | null; // undefined = keep the saved one, "" or null = remove it
  quick?: boolean;
  photos?: boolean;
}
export interface SaveInput {
  enabled?: boolean; // left out: keep the saved choice
  mode?: StoredAi["mode"];
  maxPerRun: number;
  timeoutSec?: number;
  askNextOnNoMatch?: boolean;
  services: ServiceInput[];
}

// Tests swap in a fake
export type AiFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  body?: ReadableStream<Uint8Array> | null; // read piece by piece for streamed answers
}>;

export class AiError extends Error {}
// The request was stopped on purpose (the person skipped this service or closed the window)
export class AiStopped extends AiError {}

// What's happening during a request, for screens that show progress (AI Enhance)
export type AiProgress =
  | { kind: "asking"; service: string; model: string; serviceId: string; next: { id: string; name: string } | null }
  | { kind: "thinking"; service: string }
  | { kind: "writing"; service: string; words: number }
  | { kind: "failover"; from: string; to: string; reason: string };
// reasoning: how much an OpenRouter model may think first ("low" leaves the room for the answer)
type StreamOpts = { stream?: boolean; signal?: AbortSignal; onProgress?: (p: AiProgress) => void; reasoning?: "low" };
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

const trimSlash = (s: string) => s.replace(/\/+$/, "");
const newId = () => Math.random().toString(36).slice(2, 10);

// Every saved service is used: AI is turned on and off with the switch in Settings > AI. Services saved
// back when each had its own switch are all used now; if every one was switched off, AI was
// effectively off, so it stays off.
function normalize(v: StoredAi | LegacyAi): StoredAi {
  if ("services" in v && Array.isArray(v.services)) {
    const allOff = v.services.length > 0 && v.services.every((sv) => sv.enabled === false);
    return {
      ...v,
      enabled: v.enabled && !allOff,
      timeoutSec: v.timeoutSec ?? 15,
      askNextOnNoMatch: v.askNextOnNoMatch ?? false,
      services: v.services.map((sv) => ({ ...sv, enabled: true, quick: sv.quick ?? true, photos: sv.photos ?? photosByDefault(sv.provider) })),
    };
  }
  const l = v as LegacyAi;
  return {
    enabled: l.enabled,
    mode: l.mode,
    maxPerRun: l.maxPerRun,
    timeoutSec: 15,
    askNextOnNoMatch: false,
    services: [{ id: "first", name: PROVIDER_NAMES[l.provider] ?? "AI", enabled: true, provider: l.provider, model: l.model, baseUrl: l.baseUrl, apiKeyEnc: l.apiKeyEnc, quick: true, photos: photosByDefault(l.provider) }],
  };
}

export class AiService {
  constructor(
    private db: Db,
    private secret: string,
    private fetchImpl: AiFetch = fetch as unknown as AiFetch,
    private timeScale = 1 // tests shrink the waits
  ) {}

  async stored(): Promise<StoredAi | null> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, "ai"));
    return row?.value ? normalize(row.value as StoredAi | LegacyAi) : null;
  }

  async save(input: SaveInput) {
    const current = await this.stored();
    const services: StoredService[] = input.services.map((sv) => {
      const prev = sv.id ? current?.services.find((c) => c.id === sv.id) : undefined;
      const apiKeyEnc = sv.apiKey === undefined ? prev?.apiKeyEnc ?? null : sv.apiKey ? encryptSecret(sv.apiKey, this.secret) : null;
      return {
        id: prev?.id ?? sv.id ?? newId(),
        name: sv.name?.trim() || PROVIDER_NAMES[sv.provider],
        enabled: true, // always used (no per-service switch)
        provider: sv.provider,
        model: sv.model,
        baseUrl: sv.baseUrl,
        apiKeyEnc,
        quick: sv.quick ?? prev?.quick ?? true,
        photos: sv.photos ?? prev?.photos ?? photosByDefault(sv.provider),
      };
    });
    const value: StoredAi = {
      enabled: input.enabled ?? current?.enabled ?? false,
      mode: input.mode ?? current?.mode ?? "auto",
      maxPerRun: input.maxPerRun,
      timeoutSec: input.timeoutSec ?? current?.timeoutSec ?? 15,
      askNextOnNoMatch: input.askNextOnNoMatch ?? current?.askNextOnNoMatch ?? false,
      services,
    };
    await this.db
      .insert(appSettings)
      .values({ key: "ai", value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }

  async clear() {
    await this.db.delete(appSettings).where(eq(appSettings.key, "ai"));
  }

  // A saved service's key (the first service when no id is given)
  async savedKey(id?: string) {
    const s = await this.stored();
    const sv = id ? s?.services.find((x) => x.id === id) : s?.services[0];
    if (!sv?.apiKeyEnc) return { key: null, unreadable: false };
    const key = decryptSecret(sv.apiKeyEnc, this.secret);
    return { key, unreadable: key === null };
  }

  // What the Settings page shows (keys included, for the eye button; signed-in page only).
  // The first service is also repeated at the top level (older screens read it there).
  async summary() {
    const s = await this.stored();
    if (!s) return null;
    const services = s.services.map(({ apiKeyEnc, ...sv }) => {
      const key = apiKeyEnc ? decryptSecret(apiKeyEnc, this.secret) : null;
      return { ...sv, apiKey: key, apiKeyUnreadable: !!apiKeyEnc && key === null };
    });
    const first = services[0];
    // Settings > AI's master switch: off hides the AI settings and AI isn't used at all
    const available = await isOn(this.db, "ai");
    // At least one complete service is set up
    const ready = s.services.some((sv) => sv.model && (sv.provider !== "local" || sv.baseUrl));
    return {
      available,
      ready,
      enabled: s.enabled,
      mode: s.mode,
      maxPerRun: s.maxPerRun,
      timeoutSec: s.timeoutSec,
      askNextOnNoMatch: s.askNextOnNoMatch,
      services,
      provider: first?.provider ?? null,
      model: first?.model ?? "",
      baseUrl: first?.baseUrl ?? null,
      apiKey: first?.apiKey ?? null,
      apiKeyUnreadable: first?.apiKeyUnreadable ?? false,
    };
  }

  // What's in use, or null when AI is off or no service is ready. Services in their order, only the
  // ones that take this kind of job (quick jobs fall back to every service if none is marked quick).
  async active(task: AiTask = "recipe"): Promise<{ mode: StoredAi["mode"]; maxPerRun: number; timeoutSec: number; askNextOnNoMatch: boolean; services: ActiveService[] } | null> {
    const s = await this.stored();
    if (!s) return null;
    if (!(await isOn(this.db, "ai"))) return null; // Settings > AI switched off
    let services = s.services
      .filter((sv) => sv.model && (sv.provider !== "local" || sv.baseUrl))
      .map((sv) => ({ id: sv.id, name: sv.name, provider: sv.provider, model: sv.model, baseUrl: sv.baseUrl, apiKey: sv.apiKeyEnc ? decryptSecret(sv.apiKeyEnc, this.secret) : null, quick: sv.quick, photos: sv.photos }));
    if (task === "photo") services = services.filter((sv) => sv.photos);
    if (task === "quick" && services.some((sv) => sv.quick)) services = services.filter((sv) => sv.quick);
    if (!services.length) return null;
    return { mode: s.mode, maxPerRun: s.maxPerRun, timeoutSec: s.timeoutSec, askNextOnNoMatch: s.askNextOnNoMatch, services };
  }

  /**
   * Try the services in order until one answers. A service that can't be reached, times out, or
   * returns an error is skipped. Throws only when every one failed.
   */
  async chatWithFailover(services: ActiveService[], system: string, user: string, maxTokens: number, timeoutMs: number, images: AiImage[] = [], onProgress?: (p: AiProgress) => void, opts: StreamOpts = {}) {
    const failures: string[] = [];
    for (const [index, sv] of services.entries()) {
      const next = services[index + 1];
      onProgress?.({ kind: "asking", service: sv.name, model: sv.model, serviceId: sv.id, next: next ? { id: next.id, name: next.name } : null });
      try {
        const { text, stop } = opts.stream
          ? await this.streamRaw(sv, system, user, maxTokens, timeoutMs, images, { signal: opts.signal, onProgress, reasoning: opts.reasoning })
          : await this.chatRaw(sv, system, user, maxTokens, timeoutMs, images, opts.reasoning);
        return { text, stop, service: sv, index, failures };
      } catch (e) {
        if (e instanceof AiStopped) throw e; // stopped on purpose: don't move on to the next one
        if (!(e instanceof AiError) && !(e instanceof HttpError)) throw e;
        failures.push(`${sv.name}: ${(e as Error).message}`);
        if (next) onProgress?.({ kind: "failover", from: sv.name, to: next.name, reason: (e as Error).message });
        await logEvent(this.db, {
          category: "ai",
          level: next ? "warning" : "error",
          source: sv.name,
          event: next ? `${sv.name} didn't answer, asking ${next.name} instead` : services.length > 1 ? `${sv.name} didn't answer, and no AI service is left to ask` : `${sv.name} didn't answer`,
          detail: (e as Error).message,
        });
      }
    }
    throw new AiError(services.length === 1 ? failures[0].slice(services[0].name.length + 2) : `None of your AI services answered. ${failures.join(" ")}`);
  }

  // The same request, with the answer read as the model writes it. Waits up to firstMs for it to
  // start (loading a model and thinking take a while), then gives up only if it goes quiet for a
  // minute: a slow model that keeps writing is never cut off.
  private async streamRaw(c: AiConfig, system: string, user: string, maxTokens: number, firstMs: number, images: AiImage[], o: { signal?: AbortSignal; onProgress?: (p: AiProgress) => void; reasoning?: "low" }): Promise<{ text: string; stop: string | null }> {
    if (c.provider !== "local" && !c.apiKey) throw new HttpError(400, "Enter an API key first");
    if (!c.model) throw new HttpError(400, "Choose a model first");
    const base = this.base(c);
    const { url, body } = this.requestFor(c, base, system, user, maxTokens, images, true, o.reasoning);
    const idleMs = 60000 * this.timeScale;
    const abort = new AbortController();
    let why: AiError | null = null;
    const stopNow = () => {
      why = new AiStopped("The AI check was stopped.");
      abort.abort();
    };
    if (o.signal?.aborted) throw new AiStopped("The AI check was stopped.");
    o.signal?.addEventListener("abort", stopNow);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let started = false;
    let text = "";
    let thinkingShown = false;
    let lastWords = 0;
    let lastShown = 0;
    const words = () => (text.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").match(/[\p{L}\p{N}]+/gu) ?? []).length;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        why = new AiError(
          started
            ? `The AI service stopped sending for ${plural(Math.round(idleMs / 1000), "second")} (after ${plural(words(), "word")}).`
            : `The AI service didn't start answering within ${plural(Math.round(firstMs / 1000), "second")}.`
        );
        abort.abort();
      }, started ? idleMs : firstMs);
    };
    const failed = (e: unknown): never => {
      if (why) throw why;
      if (e instanceof AiError || e instanceof HttpError) throw e;
      throw new AiError(`Couldn't reach the AI service (${(e as Error).message}).`);
    };
    try {
      arm();
      const res = await this.fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...this.authHeaders(c) }, body: JSON.stringify(body), signal: abort.signal }).catch(failed);
      if (!res.ok || !res.body) {
        const json = (await res.json().catch(() => ({}))) as any;
        if (!res.ok) throw httpError(res.status, json);
        return readReply(c.provider, json); // a server that ignored "stream": the whole answer at once
      }
      let stop: string | null = null;
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let raw = ""; // everything, in case the server ignored "stream" and sent plain JSON
      let sawData = false;
      const thinking = () => {
        if (!thinkingShown) o.onProgress?.({ kind: "thinking", service: (c as ActiveService).name ?? "The AI" });
        thinkingShown = true;
      };
      for (;;) {
        const { value, done } = await reader.read().catch(failed);
        if (value) {
          if (!started) started = true;
          arm();
          const chunk = dec.decode(value, { stream: true });
          buf += chunk;
          if (!sawData && raw.length < 2_000_000) raw += chunk;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            sawData = true;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            let d: any;
            try {
              d = JSON.parse(data);
            } catch {
              continue;
            }
            const piece = readPiece(c.provider, d);
            if (piece.error) throw new AiError(`The AI service returned an error: ${piece.error}`);
            if (piece.thinking) thinking();
            if (piece.text) {
              text += piece.text;
              if (/^\s*<think>/.test(text) && !text.includes("</think>")) thinking();
              const n = words();
              const now = Date.now();
              if (n > lastWords && (now - lastShown >= 1000 || lastWords === 0)) {
                o.onProgress?.({ kind: "writing", service: (c as ActiveService).name ?? "The AI", words: n });
                lastShown = now;
                lastWords = n;
              }
            }
            if (piece.stop) stop = piece.stop;
          }
        }
        if (done) break;
      }
      if (!sawData && raw.trim().startsWith("{")) {
        // The whole answer in one piece, not streamed
        let json: any = null;
        try {
          json = JSON.parse(raw);
        } catch {
          /* not JSON after all */
        }
        if (json) return readReply(c.provider, json);
      }
      return { text: text.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), stop };
    } catch (e) {
      return failed(e);
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", stopNow);
    }
  }

  private base(c: AiConfig) {
    const b = c.baseUrl?.trim() || DEFAULT_BASE[c.provider];
    if (!b) throw new HttpError(400, "Enter the address of your AI server (for example http://192.168.1.20:11434/v1)");
    return trimSlash(b);
  }

  private async request(url: string, headers: Record<string, string>, body?: unknown, method = "POST", timeoutMs = 60000) {
    let res;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timedOut = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          abort.abort();
          reject(new AiError(`The AI service didn't answer within ${Math.round(timeoutMs / 1000)} seconds.`));
        }, timeoutMs);
      });
      res = await Promise.race([
        this.fetchImpl(url, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, signal: abort.signal }),
        timedOut,
      ]);
    } catch (e) {
      if (e instanceof AiError) throw e;
      throw new AiError(`Couldn't reach the AI service (${(e as Error).message}).`);
    } finally {
      clearTimeout(timer);
    }
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) throw httpError(res.status, json);
    return json;
  }

  private authHeaders(c: AiConfig): Record<string, string> {
    switch (c.provider) {
      case "anthropic":
        return { "x-api-key": c.apiKey ?? "", "anthropic-version": "2023-06-01" };
      case "gemini":
        return { "x-goog-api-key": c.apiKey ?? "" };
      case "openrouter":
        return { authorization: `Bearer ${c.apiKey ?? ""}`, "x-title": "RecipeHub" };
      default:
        return c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {};
    }
  }

  // Send one prompt, get the reply text. Asks for JSON where the provider supports it.
  async chat(c: AiConfig, system: string, user: string, maxTokens = 2000, timeoutMs = 60000, images: AiImage[] = []): Promise<string> {
    return (await this.chatRaw(c, system, user, maxTokens, timeoutMs, images)).text;
  }

  // The reply text, and why the model stopped ("length" = it ran out of room)
  private async chatRaw(c: AiConfig, system: string, user: string, maxTokens: number, timeoutMs: number, images: AiImage[] = [], reasoning?: "low"): Promise<{ text: string; stop: string | null }> {
    if (c.provider !== "local" && !c.apiKey) throw new HttpError(400, "Enter an API key first");
    if (!c.model) throw new HttpError(400, "Choose a model first");
    const { url, body } = this.requestFor(c, this.base(c), system, user, maxTokens, images, false, reasoning);
    return readReply(c.provider, await this.request(url, this.authHeaders(c), body, "POST", timeoutMs));
  }

  // Each provider's address and request body (stream: the answer comes in pieces)
  private requestFor(c: AiConfig, base: string, system: string, user: string, maxTokens: number, images: AiImage[], stream: boolean, reasoning?: "low"): { url: string; body: unknown } {
    if (c.provider === "anthropic")
      return {
        url: `${base}/messages`,
        body: {
          model: c.model,
          max_tokens: maxTokens,
          temperature: 0,
          system,
          messages: [{ role: "user", content: images.length ? [...images.map((i) => ({ type: "image", source: { type: "base64", media_type: i.mime, data: i.base64 } })), { type: "text", text: user }] : user }],
          ...(stream && { stream: true }),
        },
      };
    if (c.provider === "gemini") {
      const model = encodeURIComponent(c.model.replace(/^models\//, ""));
      return {
        url: stream ? `${base}/models/${model}:streamGenerateContent?alt=sse` : `${base}/models/${model}:generateContent`,
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.base64 } })), { text: user }] }],
          generationConfig: { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
        },
      };
    }
    // OpenAI, OpenRouter and local servers share the chat-completions format
    return {
      url: `${base}/chat/completions`,
      body: {
        model: c.model,
        temperature: 0,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: images.length ? [{ type: "text", text: user }, ...images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.base64}` } }))] : user },
        ],
        ...(stream && { stream: true }),
        ...(reasoning && c.provider === "openrouter" && { reasoning: { effort: reasoning } }),
      },
    };
  }

  // One job for AI: the right services for it, failover, and the reply read as JSON. Throws AiError
  // when AI is off (or no service takes this job) or no answer could be read.
  async ask(task: AiTask, system: string, user: string, opts: { maxTokens?: number; images?: AiImage[]; off?: string; minWaitSec?: number; onProgress?: (p: AiProgress) => void; stream?: boolean; signal?: AbortSignal; skip?: string[]; reasoning?: "low" } = {}) {
    const found = await this.active(task);
    // Services the person chose to skip this time (too slow)
    const active = found && opts.skip?.length ? { ...found, services: found.services.filter((sv) => !opts.skip!.includes(sv.id)) } : found;
    if (found && active && !active.services.length) throw new AiError("There's no other AI service to ask. Try again without skipping, or add another service in Settings › AI.");
    if (!active) throw new AiError(opts.off ?? (task === "photo" ? "Reading photos needs an AI service that can see pictures. Turn on AI in Settings › AI, and tick “Can read photos” on a service." : "This needs AI. Turn it on in Settings › AI."));
    // An answer that can't be read (cut off because it ran out of room, or not JSON) is like a
    // service that's down: the next one is asked
    let left = active.services;
    for (;;) {
      const { text, stop, service } = await this.chatWithFailover(left, system, user, opts.maxTokens ?? 2000, Math.max(active.timeoutSec, opts.minWaitSec ?? (task === "quick" ? 30 : 60)) * 1000 * this.timeScale, opts.images, opts.onProgress, { stream: opts.stream, signal: opts.signal, reasoning: opts.reasoning });
      const json = parseJsonReply(text);
      if (json !== null && typeof json === "object") return { json: json as Record<string, unknown>, service };
      // Keep what it said, so Settings › Logs shows why
      await logEvent(this.db, { category: "ai", level: "warning", source: service.name, event: `${service.name}'s answer couldn't be read`, detail: `Stopped: ${stop ?? "unknown"}. It said: ${typeof text === "string" ? text.slice(0, 600) : JSON.stringify(text).slice(0, 600)}` });
      left = left.slice(left.findIndex((sv) => sv.id === service.id) + 1);
      if (!left.length || opts.signal?.aborted) throw new AiError(`${service.name}'s answer couldn't be read${stop && /length|max_tokens/i.test(stop) ? " (it ran out of room)" : ""}. Try again, or try another AI service.`);
      opts.onProgress?.({ kind: "failover", from: service.name, to: left[0].name, reason: "its answer couldn't be read" });
    }
  }

  // For the app: is AI there, and can it read photos? (no settings or keys)
  async status() {
    const ready = !!(await this.active());
    return { ready, photos: !!(await this.active("photo")), enhance: ready && (await isOn(this.db, "aiEnhance")) };
  }

  // Model names the provider offers (for the picker)
  async models(c: AiConfig): Promise<string[]> {
    if (c.provider !== "local" && !c.apiKey) throw new HttpError(400, "Enter an API key first");
    const base = this.base(c);
    const r = await this.request(c.provider === "gemini" ? `${base}/models?pageSize=200` : `${base}/models`, this.authHeaders(c), undefined, "GET", 20000);
    const list: string[] =
      c.provider === "gemini"
        ? (r.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? ["generateContent"]).includes("generateContent")).map((m: any) => String(m.name).replace(/^models\//, ""))
        : (r.data ?? r.models ?? []).map((m: any) => String(m.id ?? m.name ?? m.model ?? ""));
    return [...new Set(list.filter(Boolean))].sort();
  }

  // A tiny round trip to prove the key, address and model work
  async test(c: AiConfig, timeoutMs = 60000) {
    // Room for models that think before answering (Qwen3, DeepSeek-R1, gpt-oss): their thinking counts too
    const { text, stop } = await this.chatRaw(c, "You reply with JSON only.", 'Reply with exactly this JSON: {"ok": true}', 1000, timeoutMs);
    const outOfRoom = !!stop && /length|max_tokens/i.test(stop);
    if (!text.trim())
      throw new AiError(
        `The model sent back an empty answer${outOfRoom ? " (it ran out of room before answering)" : ""}. Models that think before answering can use up their room that way. Try a version without thinking (an "instruct" model), or Save anyway: real jobs give it more room.`
      );
    const parsed = parseJsonReply(text);
    if (!parsed || (parsed as any).ok !== true) throw new AiError(`The model answered, but not with the expected JSON${outOfRoom ? " (it ran out of room)" : ""}. It said: ${text.slice(0, 120)}`);
  }
}

// A refused request, said plainly
function httpError(status: number, json: any) {
  const msg = json?.error?.message ?? json?.message ?? (typeof json?.error === "string" ? json.error : "") ?? "";
  if (status === 401 || status === 403) return new AiError(`The AI service didn't accept the API key${msg ? `: ${msg}` : "."}`);
  if (status === 404) return new AiError(`Not found. Check the model name and address${msg ? ` (${msg})` : ""}.`);
  if (status === 429) return new AiError(`The AI service says too many requests or out of credit${msg ? `: ${msg}` : ""}.`);
  return new AiError(`The AI service returned ${status}${msg ? `: ${msg}` : ""}`);
}

// A whole answer: its text, and why the model stopped ("length" = it ran out of room)
function readReply(provider: string, r: any): { text: string; stop: string | null } {
  if (provider === "anthropic") return { text: (r.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text).join(""), stop: r.stop_reason ?? null };
  if (provider === "gemini") return { text: (r.candidates?.[0]?.content?.parts ?? []).filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join(""), stop: r.candidates?.[0]?.finishReason ?? null };
  return { text: r.choices?.[0]?.message?.content ?? "", stop: r.choices?.[0]?.finish_reason ?? null };
}

// One piece of a streamed answer: answer text, thinking, why it stopped, or an error
function readPiece(provider: string, d: any): { text?: string; thinking?: boolean; stop?: string; error?: string } {
  if (d?.error) return { error: d.error.message ?? String(d.error) };
  if (provider === "anthropic") {
    if (d.type === "content_block_delta") return d.delta?.type === "text_delta" ? { text: d.delta.text } : d.delta?.type === "thinking_delta" ? { thinking: true } : {};
    if (d.type === "message_delta") return { stop: d.delta?.stop_reason ?? undefined };
    return {};
  }
  if (provider === "gemini") {
    const parts = d.candidates?.[0]?.content?.parts ?? [];
    return { text: parts.filter((p: any) => !p.thought).map((p: any) => p.text ?? "").join(""), thinking: parts.some((p: any) => p.thought), stop: d.candidates?.[0]?.finishReason ?? undefined };
  }
  const delta = d.choices?.[0]?.delta ?? {};
  return { text: delta.content ?? undefined, thinking: !!(delta.reasoning || delta.reasoning_content), stop: d.choices?.[0]?.finish_reason ?? undefined };
}

// Models often wrap JSON in ```json fences or add a sentence; pull out the JSON
export function parseJsonReply(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  for (const candidate of [cleaned, cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1), cleaned.slice(cleaned.indexOf("["), cleaned.lastIndexOf("]") + 1)]) {
    try {
      if (candidate) return JSON.parse(candidate);
    } catch {
      // try the next shape
    }
  }
  return null;
}
