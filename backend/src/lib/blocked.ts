// Was the page kept from us? A security check (CAPTCHA), a paywall, or a plain refusal, so the
// import can say what happened (and try a saved copy) instead of a vague "couldn't import".
//
// Only the signs are read here. A page with the recipe in its data imports anyway, even if it's
// marked as paywalled (some big recipe sites do that), so callers check for a recipe first.

export type BlockReason = "captcha" | "paywall" | "refused" | "rate-limited" | "unavailable";
export interface Block {
  reason: BlockReason;
  by?: string; // who runs the security check: Cloudflare, reCAPTCHA, hCaptcha, AWS WAF
}

const CHECKS: [string, RegExp][] = [
  ["Cloudflare", /challenges\.cloudflare\.com|_cf_chl_opt|cf-chl-|cf-turnstile|<title>\s*Just a moment\.\.\.|Attention Required! \| Cloudflare/i],
  ["AWS WAF", /awswaf\.com|AwsWafIntegration|aws-waf-token/i],
  ["hCaptcha", /hcaptcha\.com|class="h-captcha"/i],
  ["reCAPTCHA", /google\.com\/recaptcha|recaptcha\.net\/recaptcha|class="g-recaptcha"/i],
];

// Paywall wording. Plenty of normal pages have "Become a member" in a footer, so it only counts
// once RecipeHub couldn't find a recipe on the page (noRecipe).
const PAYWALL_WORDS = /subscribe to (unlock|continue|read|view)|become a member|start (your )?free trial|already a (subscriber|member)\??|(to|and) (view|see|unlock|read) (this|the full) recipe|sign in to (view|see|continue|read)|unlock (this|the) recipe|class="[^"]*\bpaywall/i;

// The words a person would see, roughly (enough to tell a short challenge page from a real one)
const visibleText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// schema.org says the page (or part of it) isn't free: "isAccessibleForFree": false (or "False")
const markedNotFree = (html: string) => /"isAccessibleForFree"\s*:\s*(false|"false")/i.test(html);

export function detectBlock(status: number, html: string, opts: { noRecipe?: boolean } = {}): Block | null {
  const ok = status >= 200 && status < 300;
  // A security check. On a page that came back fine it has to look like a challenge page (little
  // to read), so a blog with a reCAPTCHA newsletter form isn't mistaken for one.
  const check = CHECKS.find(([, re]) => re.test(html));
  if (check && (!ok || visibleText(html).length < 1500)) return { reason: "captcha", by: check[0] };
  if (status === 429) return { reason: "rate-limited" };
  // 402 "Payment Required": Allrecipes and the other Dotdash Meredith sites answer apps with it
  if (status === 403 || status === 401 || status === 402) return { reason: "refused" };
  if (status === 503) return { reason: "unavailable" };
  if (!ok) return null;
  if (markedNotFree(html)) return { reason: "paywall" };
  if (opts.noRecipe && PAYWALL_WORDS.test(html)) return { reason: "paywall" };
  return null;
}

// What the person reads
export function blockMessage(b: Block, host: string, status?: number): string {
  switch (b.reason) {
    case "captcha":
      return `${host} asked for a security check (a CAPTCHA${b.by ? `, by ${b.by}` : ""}), so RecipeHub couldn't read the page.`;
    case "paywall":
      return `${host} keeps this recipe behind a paywall or sign-in, so RecipeHub couldn't read it.`;
    case "rate-limited":
      return `${host} turned the request away (429): it's limiting requests right now. Try again in a few minutes.`;
    case "unavailable":
      return `${host} is unavailable right now (503).`;
    default:
      return `${host} turned the request away (${status ?? 403}). Some sites block apps.`;
  }
}

export class BlockedError extends Error {
  constructor(
    public block: Block,
    public host: string,
    status?: number,
  ) {
    super(blockMessage(block, host, status));
  }
}
