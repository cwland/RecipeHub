import dns from "node:dns/promises";
import net from "node:net";
import { HttpError } from "./errors.js";
import { BlockedError, detectBlock } from "./blocked.js";

// Fetching pages and photos for imports. Anyone with a Recipe push key can ask the server to fetch
// a link, so before each request (and each redirect) the address is checked: the server itself
// (localhost) and link-local addresses (169.254.x.x, where cloud metadata lives) are refused.
// Your LAN is allowed on purpose: a recipe on a home wiki or a NAS imports fine.

export type FetchImpl = (url: string, init: { headers: Record<string, string>; redirect: "manual"; signal: AbortSignal }) => Promise<Response>;
export type Resolve = (host: string) => Promise<string[]>;

export interface FetchOptions {
  fetchImpl?: FetchImpl;
  resolve?: Resolve; // tests skip DNS
  maxBytes?: number;
  timeoutMs?: number;
  accept?: string;
  userAgent?: string; // archives: say who we are (they turn away apps dressed as a browser)
}

export class FetchError extends Error {}

// Looks like a normal browser: many recipe sites turn away anything that doesn't
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 RecipeHub/1.0",
  "accept-language": "en-US,en;q=0.9",
};

const defaultResolve: Resolve = async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address);

export function blockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 127 || a === 0 || (a === 169 && b === 254) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return blockedAddress(v.slice(7));
  return v === "::1" || v === "::" || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
}

async function checkUrl(raw: string, resolve: Resolve) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new HttpError(400, "That doesn't look like a web address");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new HttpError(400, "Only http:// and https:// links can be imported");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : await resolve(host).catch(() => {
    throw new FetchError(`Couldn't find ${host} (check the address)`);
  });
  if (!addresses.length || addresses.some(blockedAddress)) throw new FetchError(`RecipeHub doesn't fetch from ${host} (that address points at the server itself)`);
  return u;
}

export async function fetchUrl(url: string, opts: FetchOptions = {}): Promise<{ url: string; contentType: string; body: Buffer }> {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchImpl);
  const resolve = opts.resolve ?? defaultResolve;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20000);
  try {
    let current = url;
    for (let hop = 0; hop < 6; hop++) {
      const u = await checkUrl(current, resolve);
      let res: Response;
      try {
        res = await fetchImpl(u.toString(), { headers: { ...HEADERS, ...(opts.userAgent ? { "user-agent": opts.userAgent } : {}), accept: opts.accept ?? "text/html,application/xhtml+xml,*/*;q=0.8" }, redirect: "manual", signal: controller.signal });
      } catch (e) {
        throw new FetchError(controller.signal.aborted ? "The site took too long to answer" : `Couldn't reach ${u.hostname} (${(e as Error).message})`);
      }
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, u).toString();
        continue;
      }
      // Turned away: read the reply page (a little of it) to tell a security check from a refusal
      if ([401, 402, 403, 429, 503].includes(res.status)) {
        const page = Buffer.from(await res.arrayBuffer().catch(() => new ArrayBuffer(0))).subarray(0, 512 * 1024).toString("utf8");
        throw new BlockedError(detectBlock(res.status, page) ?? { reason: "refused" }, u.hostname, res.status);
      }
      if (!res.ok) throw new FetchError(`${u.hostname} answered ${res.status}`);
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > maxBytes) throw new FetchError("That page is too large to import");
      const body = Buffer.from(await res.arrayBuffer());
      if (body.length > maxBytes) throw new FetchError("That page is too large to import");
      return { url: u.toString(), contentType: res.headers.get("content-type") ?? "", body };
    }
    throw new FetchError("Too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
