import { describe, expect, it } from "vitest";
import { imageOf, matchCategories, minutesOf, normalizeUrl, pageInfo, plain, recipeFromJsonLd, recipeFromText, stepsOf, yieldOf } from "../src/lib/importRecipe.js";
import { blockedAddress } from "../src/lib/fetchPage.js";

const page = (ld: unknown, extra = "") => `<html><head><title>Site</title><script type="application/ld+json">${JSON.stringify(ld)}</script>${extra}</head><body><p>Long story...</p></body></html>`;

describe("schema.org recipes", () => {
  it("reads a recipe inside a @graph, with sections, times, yield and the biggest image", () => {
    const html = page({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebSite", name: "Food Blog" },
        {
          "@type": ["Recipe", "NewsArticle"],
          name: "Mac &amp; Cheese",
          description: "<p>Creamy &amp; <b>easy</b>.</p>",
          recipeIngredient: ["8 oz elbow macaroni", "2 cups shredded cheddar", " "],
          recipeInstructions: [
            { "@type": "HowToSection", name: "Pasta", itemListElement: [{ "@type": "HowToStep", text: "Boil the pasta." }] },
            { "@type": "HowToSection", name: "Sauce", itemListElement: [{ "@type": "HowToStep", text: "Melt butter." }, { "@type": "HowToStep", name: "Stir in cheese." }] },
          ],
          recipeYield: ["4", "4 servings"],
          prepTime: "PT10M",
          cookTime: "PT1H5M",
          totalTime: "P0DT1H15M",
          image: [{ url: "/small.jpg", width: 300 }, { url: "https://cdn.example.com/big.jpg", width: 1200 }],
          keywords: "comfort food, Pasta",
          recipeCuisine: "American",
          recipeCategory: ["Main Course"],
        },
      ],
    });
    const r = recipeFromJsonLd(html, "https://blog.example.com/mac")!;
    expect(r).toMatchObject({
      title: "Mac & Cheese",
      description: "Creamy & easy.",
      ingredients: ["8 oz elbow macaroni", "2 cups shredded cheddar"],
      steps: [{ section: "Pasta" }, "Boil the pasta.", { section: "Sauce" }, "Melt butter.", "Stir in cheese."],
      servings: 4,
      yieldText: "4 servings",
      prepMinutes: 10,
      cookMinutes: 65,
      totalMinutes: 75,
      imageUrl: "https://cdn.example.com/big.jpg",
      tags: ["comfort food", "pasta", "american"],
      categories: ["main course"],
    });
  });

  it("instructions as one block of text, and pages without a recipe", () => {
    const r = recipeFromJsonLd(page({ "@type": "Recipe", name: "Toast", recipeIngredient: ["bread"], recipeInstructions: "1. Toast it.\n2. Butter it." }), "https://x.test/")!;
    expect(r.steps).toEqual(["Toast it.", "Butter it."]);
    expect(recipeFromJsonLd(page({ "@type": "Article", name: "Not food" }), "https://x.test/")).toBeNull();
    expect(recipeFromJsonLd("<html><script type='application/ld+json'>{broken</script></html>", "https://x.test/")).toBeNull();
    // a recipe with no ingredients isn't one
    expect(recipeFromJsonLd(page({ "@type": "Recipe", name: "Empty" }), "https://x.test/")).toBeNull();
  });

  it("small readers", () => {
    expect([minutesOf("PT1H30M"), minutesOf("PT0M"), minutesOf("45 minutes"), minutesOf("1 hour 10 mins"), minutesOf(""), minutesOf(20)]).toEqual([90, null, 45, 70, null, 20]);
    expect(yieldOf("Makes 24 cookies")).toEqual({ servings: 24, yieldText: "Makes 24 cookies" });
    expect(yieldOf(6)).toEqual({ servings: 6, yieldText: null });
    expect(imageOf({ url: "javascript:alert(1)" })).toBeNull();
    expect(imageOf("/img.jpg", "https://site.test/recipe/")).toBe("https://site.test/img.jpg");
    expect(plain("a<br>b &amp; c")).toBe("a\nb & c");
    expect(stepsOf([{ "@type": "HowToStep", text: "Step 1. Chop." }])).toEqual(["Chop."]);
  });
});

describe("page text for AI", () => {
  it("keeps the article, drops scripts and menus, finds the site name and a video description", () => {
    const html = `<html><head><meta property="og:site_name" content="TikTok"><meta property="og:image" content="https://p.test/cover.jpg"><link rel="canonical" href="https://t.test/v/1"></head>
      <body><nav>Home Shop</nav><article><h1>Garlic noodles</h1><p>2 tbsp butter</p><script>var x=1</script></article><footer>(c)</footer>
      <script>{"shortDescription":"Ingredients:\\n1 lb noodles\\n4 cloves garlic"}</script></body></html>`;
    const info = pageInfo(html, "https://www.tiktok.com/@cook/video/1");
    expect(info.text).toContain("Garlic noodles");
    expect(info.text).toContain("2 tbsp butter");
    expect(info.text).not.toMatch(/Home Shop|var x|\(c\)/);
    expect(info).toMatchObject({ siteName: "TikTok", image: "https://p.test/cover.jpg", canonical: "https://t.test/v/1", videoDescription: "Ingredients:\n1 lb noodles\n4 cloves garlic" });
  });
});

describe("pasted text without AI", () => {
  it("reads title, ingredients and steps by their headings", () => {
    const r = recipeFromText(`Grandma's Pancakes
Fluffy every time. Serves 4. Prep time: 10 minutes

Ingredients
1 1/2 cups flour
2 eggs

Instructions
Whisk everything.

Cook on a hot griddle.

Notes
Use buttermilk if you have it.`)!;
    expect(r).toMatchObject({ title: "Grandma's Pancakes", ingredients: ["1 1/2 cups flour", "2 eggs"], steps: ["Whisk everything.", "Cook on a hot griddle."], servings: 4, prepMinutes: 10 });
    expect(recipeFromText("just some words about dinner")).toBeNull();
  });
});

describe("helpers", () => {
  it("matches site categories to yours", () => {
    const mine = [{ id: 1, name: "Dinner" }, { id: 2, name: "Dessert" }, { id: 3, name: "Soups" }];
    expect(matchCategories(["Main Course", "soups", "Brunch"], mine)).toEqual([1, 3]);
  });
  it("one address per page", () => {
    expect(normalizeUrl("https://www.site.com/chili/?utm_source=x&id=2#comments")).toBe("https://site.com/chili?id=2");
    expect(normalizeUrl("https://site.com/chili/")).toBe(normalizeUrl("https://site.com/chili"));
  });
  it("blocks the server itself and link-local addresses, allows the LAN", () => {
    expect(["127.0.0.1", "169.254.169.254", "0.0.0.0", "::1", "fe80::1", "::ffff:127.0.0.1"].map(blockedAddress)).toEqual([true, true, true, true, true, true]);
    expect(["192.168.1.20", "10.0.0.5", "93.184.216.34", "2606:4700::1"].map(blockedAddress)).toEqual([false, false, false, false]);
  });
});

describe("schema.org as real sites write it", () => {
  const base = { "@type": "Recipe", name: "Pie", recipeIngredient: ["1 crust"], recipeInstructions: ["Bake."] };
  it("Yoast: the picture is a reference to an ImageObject elsewhere in the @graph", () => {
    const html = page({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "ImageObject", "@id": "https://blog.test/pie/#primaryimage", url: "https://blog.test/wp-content/pie.jpg", width: 1200 },
        { ...base, image: { "@id": "https://blog.test/pie/#primaryimage" } },
      ],
    });
    expect(recipeFromJsonLd(html, "https://blog.test/pie/")!.imageUrl).toBe("https://blog.test/wp-content/pie.jpg");
  });
  it("the recipe is the mainEntity of a WebPage", () => {
    expect(recipeFromJsonLd(page({ "@type": "WebPage", mainEntity: base }), "https://x.test/")!.title).toBe("Pie");
  });
  it("the script is wrapped in CDATA comments", () => {
    const html = `<script type="application/ld+json">/*<![CDATA[*/ ${JSON.stringify(base)} /*]]>*/</script>`;
    expect(recipeFromJsonLd(html, "https://x.test/")!.title).toBe("Pie");
  });
  it("a raw line break inside a string (invalid JSON some sites send)", () => {
    const html = `<script type="application/ld+json">{"@type":"Recipe","name":"Pie","recipeIngredient":["1 crust"],"recipeInstructions":["Bake until
golden."]}</script>`;
    expect(recipeFromJsonLd(html, "https://x.test/")!.steps).toEqual(["Bake until golden."]);
  });
  it("HTML entities in ingredients and steps", () => {
    const r = recipeFromJsonLd(page({ ...base, recipeIngredient: ["&frac12; cup sugar", "1 cup flour &amp; more"], recipeInstructions: [{ "@type": "HowToStep", text: "<p>Heat to 350&deg;F &ndash; then bake.</p>" }] }), "https://x.test/")!;
    expect(r.ingredients).toEqual(["½ cup sugar", "1 cup flour & more"]);
    expect(r.steps).toEqual(["Heat to 350°F – then bake."]);
  });
  it("a brine that takes a day and a yield given as a range", () => {
    const r = recipeFromJsonLd(page({ ...base, totalTime: "P1DT2H", recipeYield: "6-8 servings" }), "https://x.test/")!;
    expect(r).toMatchObject({ totalMinutes: 1560, servings: 6, yieldText: "6-8 servings" });
  });
});
