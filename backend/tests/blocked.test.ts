import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { detectBlock } from "../src/lib/blocked.js";

// Telling a blocked page (CAPTCHA, paywall, refusal) apart from a page that just isn't a recipe
const page = (head: string, body = "") => `<html><head>${head}</head><body>${body}</body></html>`;
const longText = "<p>" + "Our family loves this soup on cold nights and we make it every week. ".repeat(40) + "</p>";

describe("security checks (CAPTCHA)", () => {
  it("Cloudflare's challenge page, on a 403 or 503 or even a 200", () => {
    const cf = page("<title>Just a moment...</title>", '<div id="challenge"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>');
    for (const status of [403, 503, 200]) expect(detectBlock(status, cf)).toEqual({ reason: "captcha", by: "Cloudflare" });
    expect(detectBlock(403, page("<title>Attention Required! | Cloudflare</title>"))).toEqual({ reason: "captcha", by: "Cloudflare" });
    expect(detectBlock(403, page("", '<script>window._cf_chl_opt={cvId:"3"}</script>'))).toEqual({ reason: "captcha", by: "Cloudflare" });
  });

  it("reCAPTCHA, hCaptcha and AWS WAF", () => {
    expect(detectBlock(403, page("", '<div class="g-recaptcha" data-sitekey="x"></div><script src="https://www.google.com/recaptcha/api.js"></script>'))).toEqual({ reason: "captcha", by: "reCAPTCHA" });
    expect(detectBlock(403, page("", '<script src="https://js.hcaptcha.com/1/api.js"></script><div class="h-captcha"></div>'))).toEqual({ reason: "captcha", by: "hCaptcha" });
    expect(detectBlock(202, page("", '<script src="https://abc.token.awswaf.com/abc/challenge.js"></script><script>AwsWafIntegration.getToken()</script>'))).toEqual({ reason: "captcha", by: "AWS WAF" });
  });

  it("a normal page with a reCAPTCHA newsletter form isn't a security check", () => {
    expect(detectBlock(200, page("<title>Grandma's Soup</title>", longText + '<form><div class="g-recaptcha"></div></form><script src="https://www.google.com/recaptcha/api.js"></script>'))).toBeNull();
  });
});

describe("refused, too many requests, unavailable", () => {
  it("by status, when there's no security check on the page", () => {
    expect(detectBlock(403, "Forbidden")).toEqual({ reason: "refused" });
    expect(detectBlock(429, "")).toEqual({ reason: "rate-limited" });
    expect(detectBlock(503, "<h1>Down for maintenance</h1>")).toEqual({ reason: "unavailable" });
  });

  it("a normal page is not blocked", () => {
    expect(detectBlock(200, page("<title>Soup</title>", longText))).toBeNull();
  });
});

describe("paywalls", () => {
  it("schema.org says the page isn't free (NYT, WaPo, WSJ and others mark it)", () => {
    const ld = (v: unknown) => page(`<script type="application/ld+json">${JSON.stringify({ "@type": "Recipe", name: "Pork", isAccessibleForFree: v })}</script>`, longText);
    expect(detectBlock(200, ld(false))).toEqual({ reason: "paywall" });
    expect(detectBlock(200, ld("False"))).toEqual({ reason: "paywall" });
    expect(detectBlock(200, ld(true))).toBeNull();
    const graph = page(`<script type="application/ld+json">${JSON.stringify({ "@graph": [{ "@type": "WebPage", isAccessibleForFree: "false" }] })}</script>`);
    expect(detectBlock(200, graph)).toEqual({ reason: "paywall" });
  });

  it("wording like “Become a member” only counts once RecipeHub couldn't find a recipe (it's in plenty of footers)", () => {
    const html = page("<title>Slow-Cooker Pork</title>", '<div class="recipe-teaser">Slow-Cooker Apple Cider Pork</div><div>Become a member to unlock this recipe. Start your free trial.</div>');
    expect(detectBlock(200, html)).toBeNull();
    expect(detectBlock(200, html, { noRecipe: true })).toEqual({ reason: "paywall" });
    for (const words of ["Subscribe to unlock this recipe", "Already a subscriber? Log in", "Sign in to view the full recipe", "Unlock this recipe", '<div class="paywall-overlay"></div>'])
      expect([words, detectBlock(200, page("", words), { noRecipe: true })]).toEqual([words, { reason: "paywall" }]);
    expect(detectBlock(200, page("", longText), { noRecipe: true })).toBeNull();
  });
});

describe("real pages (fetched from a home server)", () => {
  const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  it("archive.ph's security check: a 429 with reCAPTCHA is a CAPTCHA, not just too many requests", () => {
    expect(detectBlock(429, fixture("archive-captcha.html"))).toEqual({ reason: "captcha", by: "reCAPTCHA" });
  });
  it("America's Test Kitchen marks its pages as not free, but the recipe is in the page's data", () => {
    expect(detectBlock(200, fixture("paywalled-recipe.html"))).toEqual({ reason: "paywall" });
  });
});
