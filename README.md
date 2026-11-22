# RecipeHub

**Your recipes, meal plans and groceries, self-hosted.** A recipe manager for the homelab: import from any site, a photo or a handwritten card, cook step by step, plan the week, and shop from one shared list. AI is optional and can run on your own hardware.

## What it does

- **Recipes**: import from a link, a photo or a handwritten card, a PDF cookbook, or Paprika files; tags, categories, collections, favorites, ratings, notes, versions and full-text search.
- **Cook Mode**: one step at a time, ingredient checklist, tap-to-start timers, scaling, metric/US units, the screen kept awake.
- **Meal plan and groceries**: plan the week by drag and drop, then shop from shared weekly grocery lists sorted by aisle, with a pantry. Changes show live on every device in the household.
- **Discover**: recipes from your favorite sites' RSS feeds, previewed before you save them.
- **Sharing**: public read-only links, PDF and other downloads, email.
- **AI is optional**: OpenAI, Claude, Gemini, OpenRouter or a home server like Ollama, with failover, for reading recipes, nutrition, aisle sorting and meal ideas.
- **Self-hosted**: one Docker image plus PostgreSQL, daily backups, passkeys and OAuth sign-in, API keys for Home Assistant, Shortcuts and the [RecipeHub Companion](https://github.com/cwland/RecipeHub-Companion) browser extension.

What changed in each version is under **What's new** in the app (`frontend/src/changelog.ts`). The version is in `backend/package.json` and `frontend/package.json` (keep them the same).

## Run it with Docker

Every push to `main` builds a `linux/amd64` image and publishes it as `ghcr.io/cwland/recipehub:latest`. It runs on any 64-bit Intel or AMD CPU with SSE4.2 (most from 2009 on, including Celeron and Pentium homelab boxes); it doesn't need AVX or AVX2. The image is Debian-based: the Alpine builds of the image and PDF libraries crashed with "illegal instruction" on CPUs without AVX2.

```
mkdir recipehub && cd recipehub
# copy docker-compose.yml and .env.example from this repo
cp .env.example .env          # change POSTGRES_PASSWORD and JWT_SECRET (openssl rand -base64 48)
docker compose pull
docker compose up -d
```

Open `http://<server>:4000` and create your account. The image won't start while `JWT_SECRET` is still the example value: it signs every sign-in, and the example is public.

- Everything is kept in `./data`: `./data/app` is the app's `/app/data` (backups, and later photos), `./data/postgres` is the database.
- Build it yourself instead: `docker buildx build --platform linux/amd64 -t recipehub .` (or `docker compose build`).
- Database migrations run when the container starts.

### Behind a reverse proxy

Traefik, Nginx Proxy Manager or Caddy: point the proxy at port 4000. The app reads `X-Forwarded-For` and `X-Forwarded-Proto` from proxies on private networks (Docker, your LAN). If your proxy is elsewhere, set `TRUST_PROXY` to its address. Serve it over HTTPS: passkeys, the camera (photo import) and keep-awake in Cook Mode need it.

## Develop locally

```
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL (with recipehub and recipehub_test databases)
cp backend/.env.example backend/.env
npm run setup
npm run dev
```

- Web: http://localhost:5173 (Vite, hot reload)
- API: http://localhost:4000/api/health, docs at http://localhost:4000/api/docs

No Docker? On a Mac: `brew install postgresql@16 && brew services start postgresql@16`, then `createdb recipehub && createdb recipehub_test` and use your username in `DATABASE_URL`.

**Tests:** `npm test` runs the API tests (they use `TEST_DATABASE_URL` and wipe it each run) and the web app tests.

**Changing the database:** edit `backend/src/db/schema.ts`, then `cd backend && npm run db:generate`. The migration in `backend/drizzle/` runs the next time the API starts.

### Project layout

```
backend/            Fastify + TypeScript + Drizzle (PostgreSQL)
  src/app.ts          routes, auth check, API key scopes, security headers, rate limits, OpenAPI
  src/lib/            auth, sessions, passkeys, OAuth, AI (with failover), mail, backups, logs
  src/routes/         one file per area
  drizzle/            database migrations
  tests/              Vitest (against a real PostgreSQL)
frontend/           React + Vite + Tailwind (Figtree), light and dark themes
Dockerfile          one image: the API serves the built web app
.github/workflows/  tests + linux/amd64 image on every push
```

## API

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

### API key access

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

### Discovery (RSS feeds)

**Discover** (in the navigation; on phones it takes Settings' place in the bottom bar, and Settings moves into the Account menu) shows posts from the household's feeds as cards: picture, title, feed, how long ago. Pick **All feeds** or one; add your tags in the box (Enter or a comma); each shows as a chip under it. Click a chip to highlight it and see only the posts that mention it (several highlighted: posts mentioning any of them, each card showing which), and click again to stop; the highlighted ones are remembered in your browser. **Feeds** adds (a feed or a site's address) and removes them; **Refresh** checks now. A card opens the post (`#/discover/<id>`): its picture, title and the feed's description, with **Open original site** (a post with no link shows the feed's text instead of a preview). Opening a post shows its **recipe preview** before anything is saved: ingredients and steps, servings and times, read with plain code (no AI) from the recipe page's recipe data, or from the feed post's own Ingredients / Instructions when the site keeps RecipeHub out or has none; it's kept with the post for a day. When neither has the recipe, **Read with AI** reads the page (or the feed's copy) when you press it. **Calculate nutrition** (AI, when pressed) works it out one ingredient at a time and shows the label per serving with each ingredient's calories. **Import Recipe** saves the recipe exactly as shown, nutrition included (no reading the page again, no AI), then offers the usual AI check, which doesn't work out nutrition again unless it changes the ingredients. Posts already in your recipes (imported from here, or saved from the same link) say **In your recipes** on their card and page. The household subscribes to recipe sites' RSS or Atom feeds; posts are read with plain code (no AI in fetching, reading, filtering or showing them). RecipeHub checks every feed every 3 hours (`DISCOVERY_HOURS`, `0` turns it off; or Settings › Recipes › **Discover checks feeds**, off: only Refresh) and keeps each post until 60 days after it last appeared in its feed. A post's own HTML is made safe when it's read: only text formatting, lists, headings, tables, links and pictures are kept. Each person has their own filter tags, matched (any case, part of a word) against a post's title, categories and summary. API: `GET`/`POST /api/discovery/feeds` (`{ url }`: a feed, or a website's address that names its feed), `DELETE /api/discovery/feeds/:id`, `POST /api/discovery/refresh` (`?feed=`), `GET /api/discovery/items` (`?feed=`, `?tags=a,b` posts matching any of those, `?match=tags` any of yours, `?limit=`, `?before=` the `next` of the last page; each with `matchedTags`), `GET /api/discovery/items/:id` (with `contentHtml`; items have `recipeId` when in your recipes), `GET /api/discovery/items/:id/recipe` (the preview: `{ recipe, how: schema.org | text | ai, from: site | feed, problem, canAi }`; `?fresh=1` reads the page again), `POST /api/discovery/items/:id/recipe/ai` (Read with AI), `POST /api/discovery/items/:id/recipe/nutrition` (Calculate nutrition), `POST /api/discovery/items/:id/import` (202, an import job: `GET /api/imports/:id`; the preview as shown when there is one, otherwise the post's link with the feed's copy as a fallback; `result.fromFeed` when read from the feed's copy), `GET`/`PUT /api/discovery/tags` (`{ tags }`, yours). Backups keep the feeds; their posts are fetched again.

### Inbox

A household inbox for things other apps send in to look at later. In the app: the inbox button at the bottom of the left bar shows how many are waiting (on phones, in the Account menu); it opens a drawer listing each item (its site's icon, Recipe link / Instagram / Note / Recipe data, where it's from and when) with **Import** (the usual import window, started for links; a note opens as pasted text; recipe data is read as the page it came from) and **Dismiss**. Imported items move to the **Imported** tab, with **Open the recipe**; **Dismissed** has **Bring back** and **Delete**. `#/inbox` opens it. `POST /api/inbox` takes `{ type, url?, title?, content?, sourceApp?, metadata?: { pageTitle?, favIconUrl?, capturedAt? } }`; `type` is `RECIPE_LINK`, `INSTAGRAM_LINK`, `TEXT_NOTE` (needs `content`) or `RAW_RECIPE_DATA` (copied HTML or JSON-LD in `content`). Links need an `http(s)` `url`. With no title, the page title, the note's first line or the link's site is used. The same link (or the same note text) sent while it's still waiting comes back as that item (200, `duplicate: true`) instead of a second one. Signed-in only: `GET /api/inbox` (waiting items, newest first; `?status=PROCESSED` or `DISMISSED` for the others), `GET /api/inbox/count` (`{ pending }`), `PATCH /api/inbox/:id` (`{ status, recipeId? }`: `recipeId` is the recipe it became), `DELETE /api/inbox/:id`. Open copies of the app hear about changes on the live events stream (topic `inbox`). Backups include the inbox. A note is named by its first line. `GET /api/key-check` (any key) answers with the key's own name and access, whether it can push to the inbox or import, and whether AI correction is available (`aiCorrection`), for the [RecipeHub Companion](https://github.com/cwland/RecipeHub-Companion) browser extension's connection test. The rules are in `backend/src/lib/keyAccess.ts`. **Settings → API keys** has an on/off switch that refuses every key at once.

## Security

- Security headers on every response (CSP, no framing, nosniff, HSTS over HTTPS).
- Rate limits per address on sign-in, setup, password reset and passkey/OAuth sign-in (10 a minute), plus a lockout after 5 failed passwords. Guessing API keys blocks the address for a while.
- Logins are bearer tokens (not cookies), so cross-site request forgery doesn't apply; the API is same-origin only (no CORS).
- Saved secrets (AI keys, email password, OAuth client secret) are encrypted with a key derived from `JWT_SECRET`.
- The Docker image refuses to start with the example `JWT_SECRET` from `.env.example` (development only warns). Make your own with `openssl rand -base64 48`.

Found a security problem? Please report it privately through GitHub's **Security → Report a vulnerability** on this repository rather than in a public issue.

## Household

- The first account is the household **owner**. Add the people you live with in **Settings › Household**: give them a password, or email an invite (needs email set up) so they choose their own.
- Everyone shares recipes, the meal plan, grocery lists and the pantry. Favorites, pins, ratings, private notes, theme and sign-in are each person's own.
- Owners (there can be several) manage server settings: Email, AI, API keys, Data (backups), Logs, OAuth sign-in, and the household. Members don't see those tabs, and the API refuses them.
- Locked out? `docker compose exec recipehub npm run reset-password -- <username>` (without a username it resets the owner).

## Grocery list and pantry

- **Grocery** (#/grocery): type or paste items (“eggs, 2 lb chicken thighs, milk”). They're sorted by store aisle; tap one to put it in the cart, tap ⋯ to change the amount, aisle, note or list. Each tab shows how many are left to get, like (6).
- **Lists are weekly**: whenever no list is named, items go to “Week of <Monday>” (the Monday of this week, in the server's time zone), made if it isn't there. Two current lists can't share a name. **Rename**, **Archive this list** and **Delete** are at the bottom of a list.
- **Edit** (top of the list) picks several items to delete at once, for example after adding the wrong recipe.
- **Archived** (top of the page) shows archived lists, read-only, as they were (checked and unchecked). Tick what you still need and add it to a current list or a new one.
- **Add to grocery list** on a recipe (at the servings you chose) or **Week ▾ › Add this week to the grocery list** on the meal plan. The same ingredient from several recipes is added up into one line. Items in the pantry start unticked, and staples are never added.
- When you're done shopping, **Done: put them in the pantry** moves what's in the cart to the pantry.
- **Pantry** (#/pantry): what you have, with use-by dates and staples (salt, oil, spices). **Cook with what you have** lists recipes you can mostly make from it.
- Changes show up live on every signed-in device in the household (grocery list, pantry and meal plan).
- Home Assistant: make an API key with **Grocery list write** access and `POST /api/grocery/items` with `{"text": "milk"}` (header `x-api-key`). It goes on this week's list.
- API: `GET /api/grocery/lists` (current lists; `?archived=1` archived ones, newest first), `GET /api/grocery/this-week` (`{ name, listId }`), `POST /api/grocery/items/delete` (`{ ids }`, all or nothing), `POST /api/grocery/lists/:id/archive`, `POST /api/grocery/lists/:id/bring-forward` (`{ itemIds, listId }` or `{ itemIds, name }` for a new list). Archived lists can be read but not changed (409).

## AI

Turn it on in **Settings › AI** and add one or more services (OpenAI, Claude, Gemini, OpenRouter, or a home server like Ollama). They're tried in order: if one is down, the next answers.

- **Use it for**: tick **Quick jobs** on a cheap, fast model and untick it on an expensive one, and the quick jobs (aisle sorting, nutrition, meal ideas) go to the cheap one. Tick **Can read photos** on services whose model takes pictures. Reading recipes from pages and text uses every service, in order.
- **Recipes from photos**: Add recipe › From a photo. `POST /api/recipes/import/photos` (multipart, field `photo`, up to 4) works with a Recipe push API key too.
- **Nutrition**: per serving, with the serving size and added sugars, from the recipe's site, estimated by AI (**Calculate nutrition**, or **Re-calculate nutrition** once it has been; a window with a spinner says what it's doing and closes when it's done; `POST /api/recipes/:id/nutrition`, with `Accept: application/x-ndjson` for progress lines), or typed in (`PUT`). AI buttons only show while AI is set up and on. When the ingredients change and the numbers weren't worked out again (AI off, Auto nutrition off, or the AI couldn't), the Nutrition tab says the recipe has been updated and the nutrition may be out of date. The points figure is an approximation from calories, saturated fat, sugar (only added sugar when it's known) and protein, not any diet program's official number.
- **Auto nutrition** (Settings › Recipes; comes on the first time AI is set up, and can't be changed while AI is off): nutrition is worked out in the background for a new recipe (after its AI check is applied or skipped with `POST /api/recipes/:id/enhance/skip`, or straight away when the AI check is off or the recipe came in with an API key) and again whenever its ingredients change. Numbers typed in by hand are never replaced; they get `nutrition.outdated: true` instead. Whole-file imports aren't estimated. `nutritionUpdating` on a recipe says a job is waiting or running.
- **Meal ideas**: Meal plan › Week ▾ › Meal ideas, or on the Pantry page (`POST /api/ai/ideas`).
- **Aisles**: items the word list can't place are sorted by AI once and remembered.
- **AI Enhance**: a newly added recipe offers "Check this recipe with AI?", and every recipe has an **Improve with AI** button. The AI fills gaps in the steps, corrects and tidies the ingredients (it never adds one), works out nutrition (a second, short request: each ingredient looked up and added up by RecipeHub, the same as Estimate, so it matches what Re-analyze gives) and suggests categories (from your own list) and tags. A window walks through each changed part, original beside the suggestion: **Accept change** or **Reject change** (both move on), **Prior** goes back, and the pencil edits the suggestion first. The last choice saves. Applying new steps or ingredients saves a new version (see Recipe versioning), so the recipe from before is a click away. Checking saves nothing. Brief steps (a few short lines) are rewritten in full: grouped under headings, each step with a short bold label and the how and why; detailed steps only get gaps filled. While it works, the window shows live progress (which service it's asking, "thinking…", "writing… N words", a fallback to the next, what it found), and a **Skip** button moves on to your next service if one is too slow. The answer is read as it's written: RecipeHub waits up to 3 minutes (or your "Seconds to wait") for the AI to start, then only stops if it goes quiet for a minute. Add `?skip=<service id>,…` to leave services out. Switch it off in Settings › Recipes (it comes on the first time AI is set up, and can't be changed while AI is off). API: `POST /api/recipes/:id/enhance` (suggestions), `…/enhance/apply` (`{ steps?, ingredients?, nutrition?, categories?, tags? }`), `…/enhance/skip` (offer turned down). Send `Accept: application/x-ndjson` to `/enhance` for progress lines (`{"type":"step","text":…}` then `{"type":"result",…}` or `{"type":"error",…}`).
- **Recipe versioning** (Settings › Recipes, on by default): every recipe keeps its versions. An import or a new recipe is v1; an AI check that changes steps or ingredients makes a new version; a hand edit asks whether to save to the current version or as a new one. Nutrition changes go into the active version. A recipe page has three tabs: **Active recipe**, **Nutrition** and **Version history** (each version's number, date, source, who and what changed, with **Set active** and **Delete**; the active version can't be deleted). Versions cover the title, description, ingredients, steps, servings, times, notes and nutrition; tags, categories, collections, the photo and per-person things stay outside them. API: `PATCH /api/recipes/:id` takes `version: "new" | "current"` (default current); `GET /api/recipes/:id/versions`, `GET …/versions/:number`, `POST …/versions/:number/activate`, `DELETE …/versions/:number`. Backups include versions; restoring an older backup gives each recipe its versions.
- **The Improve with AI wizard**: one screen per part that changed (ingredients, instructions, nutrition, categories and tags), the original beside the suggestion, with **Accept change** and **Reject change** (both move on) and **Prior** to go back. The pencil edits the suggestion (Done finishes; the choice buttons wait until then). The last choice saves and shows "Recipe added" (or "updated"). The AI never adds ingredients: lines it invents are dropped. The recipe's name stays at the top. It opens by itself after a single import (`#/recipes/:id?imported=1`).
- **Many recipes at once**: a file with more than one recipe (Paprika, a cookbook PDF) first lists them A–Z with checkboxes (ones already in RecipeHub unticked); unticked recipes aren't imported. Then choose **Review each with AI** (`#/recipes/review/<import job>`: the wizard for each recipe in turn, with Stop reviewing; where you are is remembered in the browser) **Just import them**, or **Improve all automatically** (one AI request per recipe, in the background, with a pill at the top of every screen: "Improving 3 of 40…"; `#/recipes/improving/<job>` shows progress, what failed and a **Stop** button). Every recipe's original stays as v1 in Version history. API: `POST /api/recipes/import/file?choose=1` (the job's result lists `choices`), `POST /api/imports/:id/choose` (`{ keep: [n…] }`), `GET /api/imports/active` (for the pill), `POST /api/imports/:id/improve` (202, an `import-improve` job whose result has `total`, `done`, `improved`, `unchanged`, `failed`, `stopped`), `POST /api/imports/:id/stop` (ends after the recipe being worked on). A single import can ask for the same: `POST /api/recipes/import` with `"improve": true` (409 when AI or Improve with AI is off) improves the new recipe in the background once it's in; the import's result names that job in `improving`. `"inbox": true` leaves a note of the import in the inbox's Imported list (the same link waiting there is the one marked imported), for the Companion's Import.
- **Recipe page**: Start cooking, **Share** and **Delete** sit on the category line; a pencil, favorite and pin are icons by the name (every icon has hover text); **Add to grocery list**, **Organize** (categories, collections and tags in one panel, saved together) and **Improve with AI** are the buttons, with the tag and collection pills under them. Each part is **edited in place**: the pencil by the name edits the details (name, description, servings, times, source), and Ingredients, Steps and Notes each have their own pencil; saving asks about the version when versioning is on. `#/recipes/:id/edit` opens the recipe with its details ready to edit. **Add to grocery list** sends the size you scaled to (`POST /api/grocery/preview` takes `servings`, or `scale` for recipes without a serving count). Scaling is a − 4 servings + (or − 1× +) stepper with a small reset icon.
- **Ingredient lines**: amounts in words are read ("One pound of ground sausage" is 1 lb), words in brackets and "to taste", "for garnish", "optional" are notes, and imports and AI write amounts as numbers so they scale.

## Sharing and backups

- **Organize** (Settings › Recipes): categories, collections, tags and meal plan rows as tabs of chips with recipe counts (tags have a search box). Click a chip to rename, describe (collections), see its recipes, move or delete it. Categories and collections sort **A–Z**, **Z–A** or **Manual**; in Manual, drag the chips into order. The sort applies everywhere they're listed. API: `GET`/`PUT /api/organize/sort` (`{categories, collections}`: `az`, `za` or `manual`).
- **Public share links** (Settings › Recipes › Public share links, on by default): every recipe has an unguessable read-only link, `/share/rcp_<32 hex>` (migration 0012 gave existing recipes one; restoring an older backup makes them). The page needs no sign-in and shows the recipe, scaling, units, steps and nutrition; it leaves out the recipe's notes, ratings, who added it and collections. **New link** replaces a link (the old one stops). Links use the app address from Settings › Email, else the address RecipeHub was opened on; they only work for others when RecipeHub is reachable from the internet. `/share/` pages carry Open Graph tags (title, summary, photo) for link previews. API: `GET` or `POST /api/recipes/:id/share-link` (`{path, url, on}`), `POST …/share-link/new`, `GET /api/public/share/:token` (no sign-in; 404 when unknown or links are off).
- **Downloads**: PDF (made on the server with pdf-lib: photo, times, ingredients, steps, nutrition; ⅓ ⅛ and the like print as 1/3, 1/8), schema.org JSON-LD, Paprika (`.paprikarecipe`, imports back into RecipeHub), Meal-Master (`.mmf`, plain ASCII) and CookML (`.cml`). `GET /api/recipes/:id/export?format=pdf|jsonld|paprika|mealmaster|cookml` includes the recipe's notes; `GET /api/public/share/:token/export?format=…` (no sign-in) leaves them out. `GET /api/recipes/:id/jsonld` still works.
- **Share** on a recipe has two tabs. **Link & downloads**: Copy link, Share… (the Web Share API; sends the chosen file too where the share sheet takes files), Mail app (`mailto:` with the subject and link; a chosen file is downloaded first), Attach a file (for those two), Download, Print it. **Email**: To, Note, Attach a file, then Send; when email isn't set up the tab says so, links to Settings › Email and won't send. **Send from RecipeHub** (`POST /api/recipes/:id/email` with `to`, `note`, `attach`: `none` or a format): the photo inline, title, summary, times, an **Open the recipe** button to the public link (when links are on and the app address is set), then the recipe, and at the bottom **View the recipe** and a link for each download format (`<public link>?download=pdf` opens the public page with a Download window, that format picked); the recipe's notes stay out of the email and its attachment. The meal plan email (Settings › Recipes) and Household's **Email an invite** also wait until email is set up.
- **Email** on the grocery list sends what's left, by aisle. Emails need **Settings › Email** set up, and are sent by signed-in people only (not API keys).
- **Substitutions** (on each recipe): **Swap an ingredient** (type in *Instead of* and pick the line from the recipe that shows below, or keep your own words) or **Add an item**, then what you used: an optional amount and unit from the lists, and the item. Your substitutions are listed under the form with a tick box each, all ticked; **Make a new version with these changes** puts the ticked ones into the ingredients as a new version (swaps replace their line, added items go at the end) and marks them *in vN*. The recipe as it was stays in Version history. A swap typed in your own words is kept as a note and isn't applied. API: `POST /api/recipes/:id/substitutions` with `{"kind":"swap","line":"1 cup sour cream","amount":"3/4","unit":"cup","item":"Greek yogurt"}` or `{"kind":"add","item":"smoked paprika"}`.
- **Metric and US**: Settings › Recipes › **Measurements** (As is, Metric or US; As is to start with), and the same switch on every recipe. In Metric, a dry ingredient in cups or spoons shows about how many grams (`≈240 g all-purpose flour (2 cups)`): from a built-in table of about 40 common ingredients (flours, sugars, butter, cheese, oats, rice…), or else the AI's weight for that line (worked out with the nutrition). Liquids stay in millilitres, things you count (eggs, cloves) are never weighed, and under 5 g stays in spoons. In US, grams of an ingredient the table knows show as cups or spoons (`≈2 cups`). The original measure shows beside each estimate.
- **Ingredient order**: Settings › Recipes › Cooking › **Sort ingredients A to Z** (off: as entered). Each person's own; applies to the recipe page and Cook mode, and sections keep their place. API: `PATCH /api/profile` `{"ingredientOrder":"alpha"|"entered"}`.
- **Meal plan email**: Settings › Recipes (with **Cooking**: measurements and keeping the screen awake in Cook mode). Uses the server's time zone, so set `TZ` in `.env` (e.g. `TZ=America/Chicago`).
- **Backups** are `.tar.gz` files with the data (`recipehub.json`) and every recipe photo (`photos/`), saved daily in `./data/app/backups`; the newest `BACKUP_KEEP` are kept. **Settings › Data › Restore** takes a `.tar.gz` backup or a `.json` export. A safety backup is saved before every restore.

## Accounts and passwords

- **Setup wizard**: the first time an account signs in, a wizard opens over the app (blurred behind it): one short page per step that fits without scrolling on a laptop or a phone, with step dots, Back and Next pinned at the bottom, and **Skip Setup** on every step. The owner gets nine steps: **Welcome** (your name, shown as initials as you type, username and email); **Sign in with a passkey** (**Add Passkey** and its status, an ⓘ explaining it; **Not now** skips); **Choose an AI** (optional but recommended: a short with/without table and the five providers); **Connect** (the address or key with **Validate** at the end of the box: it lists the service's models in the Model drop-down and picks the best one for RecipeHub, which you can change: Claude Haiku, a GPT mini, a Gemini Flash, or on a home AI qwen3-vl, then gemma3, llama3 or qwen; a line below says which models work well and why; *How to get a key* is one link away; Next asks the chosen model once before saving); **Backup AI** (optional, asked when the first one fails or runs out; the same Validate and pick; **Skip Backup**); **Fine-Tune AI** (Improve with AI, Auto nutrition, Saved copies for blocked sites; the AI ones say they need AI when it was skipped); **Email** (provider, From address, username, password and **Send a test email**, which must work before it's saved; another server, RecipeHub's address and the port notes are under **More options**); **Recipe & Meal Planning** (measurements, keeping the screen awake in Cook mode, Discover checking feeds by itself); and **You're all set! 🎉** (the RecipeHub Companion and where Add recipe is). **Skip AI Setup** on Choose or Connect goes straight to Fine-Tune. Members get Welcome, Passkey, Recipe & Meal Planning and Done. Finishing (or skipping) fades the wizard out and opens your recipes with **Add recipe** glowing and a tip next to it until you click it or **Got it**. What's new waits until setup is done. The **Getting started** tour is in the account menu. Accounts from before 0.16 count as set up. API: `PATCH /api/profile` (`units`, `keepAwake`), `POST /api/profile/setup-done`.
- **Account menu** (your initials, bottom left; "Account" on phones): Profile & security, Getting started, Sign out, Sign out everywhere.
- **Settings → Security**: change password (signs out every other device), passkeys, OAuth sign-in, signed-in devices (sign out any one), sign-in history.
- **Email** in **Settings → Email**: pick a provider (Gmail, Outlook, iCloud, Fastmail, or custom) and **Send test email**. `SMTP_*` / `MAIL_FROM` / `APP_URL` in `.env` are a fallback.
- **Forgot password?** shows on the sign-in page when email is set up. Reset links work once, for 1 hour.
- **Locked out without email?** On the server: `docker compose exec recipehub npm run reset-password -- <username>` (running it locally: `cd backend && npm run reset-password -- <username>`).

### Passkeys

Sign in with Touch ID, Face ID, Windows Hello or a phone. Add one in **Settings → Security → Passkeys**.
A passkey belongs to the address it was added on, and browsers only offer them on `https://` and `localhost`. Optional: `PASSKEY_ORIGINS=https://recipes.example.com` limits them to those addresses.

### OAuth sign-in (Authentik, Authelia, Keycloak, Google, GitHub…)

1. At your provider, create an OAuth2/OpenID Connect app with the redirect URI shown in **Settings → Security** (`https://<your address>/api/auth/oauth/callback`).
2. Turn OAuth on, name the button, enter the issuer / discovery URL, client ID and secret, then **Test connection**.
   Authentik: `https://auth.example.com/application/o/<app-slug>/` · Keycloak: `https://kc.example.com/realms/<realm>` · Google: `https://accounts.google.com`
3. **Link my account** (or sign in once with a verified email that matches your profile).
4. Optional: **OAuth only** hides the password form.

**Locked out?** `docker compose exec recipehub npm run auth:reset`, or set `EMERGENCY_DISABLE_OAUTH=true` in `.env` and restart.

## Cooking

- **Start cooking** on a recipe opens Cook Mode: one step at a time (Next / Back, swipe, or the arrow keys), with the ingredients as a checklist and the ones the step uses lit up.
- The screen is kept awake with the Wake Lock API, which browsers only allow on `https://` addresses (and localhost). Over plain `http://` on your LAN it shows "Screen may sleep".
- Times in steps become timer buttons. Timers live in your browser, keep running across pages and reloads, and ring with a chime, a buzz on phones, and a notification if you allow them.
- Servings and units (As is, Metric, US; on the same line as the servings) are remembered per recipe in your browser. Teaspoons and tablespoons stay as they are; cups, ounces and pounds convert (rounded the way a jug or kitchen scale reads), and oven temperatures in steps switch between °F and °C.
- **Fresh herbs** show the dried amount beside them, like "2 tbsp fresh basil (2 tsp dried)": a third of the fresh amount, scaled with the servings and in the chosen units. Sprigs (¼ tsp each, ½ for rosemary) and bunches (about a cup fresh) get an estimate marked "about".
- **Editing a recipe**: the pencils edit each part in place. While editing, the AI, Organize and grocery buttons and the tags and categories are hidden; clicking anywhere outside the part closes it (asking "Discard changes?" if you changed something).

## Importing recipes

- **From a link:** recipe sites that include schema.org recipe data (most do) import without AI. Other pages, and TikTok, Instagram or YouTube videos (their description), are read by your AI service.
- **From a file:** Add a recipe › From a file takes a Paprika export (`.paprikarecipes`, or one `.paprikarecipe`), with photos, categories, ratings and notes. Recipes you already have (same link, or same name and ingredients) are skipped. `POST /api/recipes/import/file` (multipart, field `file`).
- **From a PDF:** From a file or From a photo takes a `.pdf`, one recipe or a whole cookbook. Text pages are read by AI in parts of about 12,000 characters (overlapping by a page, so a recipe split across parts isn't lost; one found twice is kept once); scanned pages are sent as pictures, three at a time, to a service that can read photos. Needs AI. Each recipe's source is the file name.
- **Pasted text:** read straight away when it has "Ingredients" and "Instructions" headings, otherwise by AI.
- Imports run in the background (a job queue in PostgreSQL), so they survive a restart. Results and problems show in Settings › Logs › Imports.
- **Blocked links:** a security check (Cloudflare, reCAPTCHA, hCaptcha, AWS WAF), a paywall, or a refusal (403, 429, 503) is named in the error, and a failed import's `result.blocked` has `{reason, by, url}`. A page marked paywalled (`isAccessibleForFree: false`) that still has the recipe in its schema.org data imports normally.
- **Saved copies** (Settings › Recipes, on by default): a blocked link is looked up on the Wayback Machine (its newest copy, fetched raw so the recipe data is kept), then archive.ph, archive.today, archive.is and archive.li (their copies have no recipe data, so AI reads the text). A security check on archive.ph stops there (the others share it) and the import keeps the link so you can open it. Archives are asked as `RecipeHub/<version> (self-hosted recipe manager; +https://github.com/cwland/RecipeHub)`: the Wayback Machine turns away a browser user agent from a server. A recipe read from a copy keeps its own link; `result.savedCopy` says `{from, url, date}`, and a failure lists `result.savedCopies`.
- **Send to RecipeHub** (Settings › Recipes): a bookmark for pages RecipeHub can't fetch itself. It opens `/receive.html` (the one page served without `Cross-Origin-Opener-Policy`, so the recipe's tab can hand it the page), which keeps the page in the browser for up to 10 minutes and opens `#/recipes/receive`; that asks before importing. API: `POST /api/recipes/import` takes `html` (up to 8 MB) with `url`; the page is read instead of fetched, saved copies aren't tried, and the copy is dropped from the job once imported.
- The server fetches links for you, so it refuses addresses that point at itself (localhost, link-local). Pages on your LAN import fine.
- Photos are saved in `/app/data/photos` (resized to 1600 px, WebP) and served at `/api/photos/...` without signing in (the names are random). Unused ones are cleared daily.

## AI

**Settings → AI**: add one or more services: OpenAI, Claude, Gemini, OpenRouter, or a home AI with an OpenAI-style API (Ollama, LocalAI, vLLM, LM Studio). They're tried in order; if one is down or too slow, the next is asked (and it shows in Settings → Logs). The on/off switch at the top stops all AI use and keeps your services.

## Backups and restore

- A backup is saved every day in `/app/data/backups` (the newest 30 are kept; `BACKUP_KEEP`). **Settings → Data** has Back up now, downloads, and Restore.
- **Delete data** (Settings › Data, owner only, never an API key) has two choices. **Delete all recipes**: deletes every recipe with its versions, photos, substitutions, ratings and notes, plus all tags and collections, meal plan entries for recipes, and import jobs. Categories, the grocery list, pantry, settings and people stay. Type `DELETE` to confirm; a `-before-wipe` backup is saved first, so Restore brings it all back. API: `POST /api/wipe/recipes` with `{"confirm":"DELETE"}`. **Reset the entire app**: back to a fresh install. Every table is emptied (people, passkeys, sessions, settings, recipes, lists, meal plan, Discover, logs) and the photos removed; the default categories and the Groceries list are put back. Everyone is signed out and the next visit shows the first-run screen and the setup wizard. Type `RESET` to confirm; a `-before-reset` backup is made first and the backups folder is kept. Restoring it brings back the recipes, lists and settings, but not people's accounts or passkeys (backups don't hold sign-ins). API: `POST /api/wipe/all` with `{"confirm":"RESET"}`.
- Restore replaces all recipe data with the file's; your login is kept and a `-before-restore` backup is saved first.
- Backups include your settings. Saved keys and passwords are included only when `BACKUP_KEY` is set, encrypted with it. **Keep a copy of `BACKUP_KEY` away from the server** (a password manager): it can't be recovered. Restoring on another server needs the same `BACKUP_KEY`.

## New version bar

When a newer release is published on GitHub (`UPDATE_REPO`, default `cwland/RecipeHub`), a bar at the top offers its notes. Choose how often to look in **Settings → Data → Updates**: every hour, 6 hours, day (the default), week or month, or never. The server looks each hour whether a check is due; the app asks after you sign in. API: `PUT /api/updates/settings` `{"every":"hour"|"6h"|"day"|"week"|"month"|"never"}`.

## Credits

Icons: [Lucide](https://lucide.dev) (ISC).

## License

[MIT](LICENSE): anyone may use, change and share RecipeHub, including commercially, as long as the license notice stays with it. It comes with no warranty.
