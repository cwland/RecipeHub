# RecipeHub API

Interactive docs at **`/api/docs`** (the OpenAPI spec at `/api/docs/json`). Every route except the health check and sign-in routes needs:

- `Authorization: Bearer <token>` (from signing in), or
- `X-API-Key: <key>` (create keys in **Settings → API keys**)

Try a key: `curl -H "X-API-Key: <key>" https://recipes.example.com/api/info`

Send a recipe in (a Recipe push key works). Ingredients and steps can be one block of text or lists:

```
curl -X POST -H "X-API-Key: <key>" -H "Content-Type: application/json" \
  -d '{"title":"Overnight Oats","ingredients":"1/2 cup oats\n1/2 cup milk","steps":"Stir.\n\nChill overnight.","tags":["breakfast"],"collections":["Make Ahead"]}' \
  https://recipes.example.com/api/recipes
```

Import a recipe from a link (or `"text"` for pasted text). `"wait"` holds the request up to that many seconds so you get the result in one go; without it you get a job to check at `GET /api/imports/:id`:

```
curl -X POST -H "X-API-Key: <key>" -H "Content-Type: application/json" \
  -d '{"url":"https://www.seriouseats.com/...","wait":30}' \
  https://recipes.example.com/api/recipes/import
```

For an **iOS Shortcut** that imports from the share sheet: *Receive URLs from Share Sheet* → *Get Contents of URL* (method POST, header `X-API-Key`, JSON body `url` = Shortcut Input, `wait` = 30) → *Show Result*. A Recipe push key is all it needs.

Main recipe routes: `GET /api/recipes?q=&tag=&category=&collection=&favorite=true&sort=recent|newest|title|rating`, `GET/PATCH/DELETE /api/recipes/:id`, `POST /api/recipes/:id/duplicate`, `PUT /api/recipes/:id/me` (your favorite, pin, rating, notes; signed in only), `POST /api/recipes/:id/substitutions`, `POST /api/recipes/:id/substitutions/apply` (`{"ids":[…]}`), and `/api/tags`, `/api/categories`, `/api/collections`.

## API key access

Each key has one access type, chosen when it's made and changeable later:

| Access | Can |
|---|---|
| Read only | Read recipes, meal plans, grocery lists and pantry |
| Write only | Add, change and delete them (no reading) |
| Recipe push | Only send recipes in (`POST /api/recipes`, `POST /api/recipes/import`) and check on imports |
| Grocery list write | Only add to, check off and change grocery lists |
| Inbox only | Only push to the inbox (`POST /api/inbox`), for the RecipeHub Companion extension |
| Full admin | Everything above, plus logs, backups and exports |

No key can ever see or change settings, other keys, sign-in details, or restore a backup, and no key can read, change or clear the inbox (Inbox only, Write only and Full admin keys can push to it).

## Discovery (RSS feeds)

**Discover** (in the navigation; on phones it takes Settings' place in the bottom bar, and Settings moves into the Account menu) shows posts from the household's feeds as cards: picture, title, feed, how long ago. Pick **All feeds** or one; add your tags in the box (Enter or a comma); each shows as a chip under it. Click a chip to highlight it and see only the posts that mention it (several highlighted: posts mentioning any of them, each card showing which), and click again to stop; the highlighted ones are remembered in your browser. **Feeds** adds (a feed or a site's address) and removes them; **Refresh** checks now. A card opens the post (`#/discover/<id>`): its picture, title and the feed's description, with **Open original site** (a post with no link shows the feed's text instead of a preview). Opening a post shows its **recipe preview** before anything is saved: ingredients and steps, servings and times, read with plain code (no AI) from the recipe page's recipe data, or from the feed post's own Ingredients / Instructions when the site keeps RecipeHub out or has none; it's kept with the post for a day. When neither has the recipe, **Read with AI** reads the page (or the feed's copy) when you press it. **Calculate nutrition** (AI, when pressed) works it out one ingredient at a time and shows the label per serving with each ingredient's calories. **Import Recipe** saves the recipe exactly as shown, nutrition included (no reading the page again, no AI), then offers the usual AI check, which doesn't work out nutrition again unless it changes the ingredients. Posts already in your recipes (imported from here, or saved from the same link) say **In your recipes** on their card and page. The household subscribes to recipe sites' RSS or Atom feeds; posts are read with plain code (no AI in fetching, reading, filtering or showing them). RecipeHub checks every feed every 3 hours (`DISCOVERY_HOURS`, `0` turns it off; or Settings › Recipes › **Discover checks feeds**, off: only Refresh) and keeps each post until 60 days after it last appeared in its feed. A post's own HTML is made safe when it's read: only text formatting, lists, headings, tables, links and pictures are kept. Each person has their own filter tags, matched (any case, part of a word) against a post's title, categories and summary. API: `GET`/`POST /api/discovery/feeds` (`{ url }`: a feed, or a website's address that names its feed), `DELETE /api/discovery/feeds/:id`, `POST /api/discovery/refresh` (`?feed=`), `GET /api/discovery/items` (`?feed=`, `?tags=a,b` posts matching any of those, `?match=tags` any of yours, `?limit=`, `?before=` the `next` of the last page; each with `matchedTags`), `GET /api/discovery/items/:id` (with `contentHtml`; items have `recipeId` when in your recipes), `GET /api/discovery/items/:id/recipe` (the preview: `{ recipe, how: schema.org | text | ai, from: site | feed, problem, canAi }`; `?fresh=1` reads the page again), `POST /api/discovery/items/:id/recipe/ai` (Read with AI), `POST /api/discovery/items/:id/recipe/nutrition` (Calculate nutrition), `POST /api/discovery/items/:id/import` (202, an import job: `GET /api/imports/:id`; the preview as shown when there is one, otherwise the post's link with the feed's copy as a fallback; `result.fromFeed` when read from the feed's copy), `GET`/`PUT /api/discovery/tags` (`{ tags }`, yours). Backups keep the feeds; their posts are fetched again.

## Inbox

A household inbox for things other apps send in to look at later. In the app: the inbox button at the bottom of the left bar shows how many are waiting (on phones, in the Account menu); it opens a drawer listing each item (its site's icon, Recipe link / Instagram / Note / Recipe data, where it's from and when) with **Import** (the usual import window, started for links; a note opens as pasted text; recipe data is read as the page it came from) and **Dismiss**. Imported items move to the **Imported** tab, with **Open the recipe**; **Dismissed** has **Bring back** and **Delete**. `#/inbox` opens it. `POST /api/inbox` takes `{ type, url?, title?, content?, sourceApp?, metadata?: { pageTitle?, favIconUrl?, capturedAt? } }`; `type` is `RECIPE_LINK`, `INSTAGRAM_LINK`, `TEXT_NOTE` (needs `content`) or `RAW_RECIPE_DATA` (copied HTML or JSON-LD in `content`). Links need an `http(s)` `url`. With no title, the page title, the note's first line or the link's site is used. The same link (or the same note text) sent while it's still waiting comes back as that item (200, `duplicate: true`) instead of a second one. Signed-in only: `GET /api/inbox` (waiting items, newest first; `?status=PROCESSED` or `DISMISSED` for the others), `GET /api/inbox/count` (`{ pending }`), `PATCH /api/inbox/:id` (`{ status, recipeId? }`: `recipeId` is the recipe it became), `DELETE /api/inbox/:id`. Open copies of the app hear about changes on the live events stream (topic `inbox`). Backups include the inbox. A note is named by its first line. `GET /api/key-check` (any key) answers with the key's own name and access, whether it can push to the inbox or import, and whether AI correction is available (`aiCorrection`), for the [RecipeHub Companion](https://github.com/cwland/RecipeHub-Companion) browser extension's connection test. The rules are in `backend/src/lib/keyAccess.ts`. **Settings → API keys** has an on/off switch that refuses every key at once.
