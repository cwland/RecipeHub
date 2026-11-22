import { afterEach, describe, expect, it, vi } from "vitest";
import { bookmarklet } from "./bookmarklet";

// The Send to RecipeHub bookmark, run on a recipe page
describe("the Send to RecipeHub bookmark", () => {
  afterEach(() => vi.useRealTimers());

  it("is a bookmark address for this RecipeHub", () => {
    const code = bookmarklet("https://recipes.home.test");
    expect(code.startsWith("javascript:")).toBe(true);
    expect(decodeURIComponent(code)).toContain('var C="https://recipes.home.test"');
    expect(code.length).toBeLessThan(2000); // some browsers cut longer bookmarks
  });

  it("opens RecipeHub and sends it the page: its link and HTML, with the recipe data kept and the site's scripts and styles left out", () => {
    vi.useFakeTimers();
    document.head.innerHTML = '<title>Pork</title><style>body{}</style><script>track()</script><script type="application/ld+json">{"@type":"Recipe","name":"Pork"}</script>';
    document.body.innerHTML = "<h1>Pork</h1><p>2 lb pork</p><iframe></iframe>";
    const sent: { message: any; origin: string }[] = [];
    const popup = { postMessage: (message: unknown, origin: string) => sent.push({ message, origin }) };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    new Function(decodeURIComponent(bookmarklet("https://recipes.home.test").slice("javascript:".length)))();
    expect(open).toHaveBeenCalledWith("https://recipes.home.test/receive.html", "_blank");
    vi.advanceTimersByTime(600);
    expect(sent[0].origin).toBe("https://recipes.home.test");
    expect(sent[0].message).toMatchObject({ recipehub: "page", url: window.location.href });
    const html: string = sent[0].message.html;
    expect(html).toContain('"@type":"Recipe"');
    expect(html).toContain("2 lb pork");
    expect(html).not.toContain("track()");
    expect(html).not.toContain("<style>");
    expect(html).not.toContain("<iframe>");
    // RecipeHub says it got it: no more sending
    window.dispatchEvent(new MessageEvent("message", { data: "recipehub:got", origin: "https://recipes.home.test" }));
    const count = sent.length;
    vi.advanceTimersByTime(5000);
    expect(sent.length).toBe(count);
    open.mockRestore();
  });
});
