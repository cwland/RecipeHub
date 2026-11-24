<p align="center">
  <img src="frontend/public/favicon.svg" width="72" alt="RecipeHub leaf icon">
</p>

<h1 align="center">RecipeHub</h1>

<p align="center">
  <b>Your recipes, meal plans and groceries, self-hosted.</b><br>
  A modern recipe manager for the homelab, with optional AI that helps make your recipes better.
</p>

<p align="center">
  <a href="#run-it-with-docker">Run it with Docker</a> ·
  <a href="#ai-that-improves-your-recipes">AI features</a> ·
  <a href="docs/GUIDE.md">Guide</a> ·
  <a href="docs/API.md">API</a> ·
  <a href="LICENSE">MIT license</a>
</p>

![RecipeHub's recipe library](docs/screenshots/library.webp)

## Why RecipeHub

RecipeHub started as a replacement for a native Mac recipe app. I wanted a modern web app that works on any device (desktop, tablet or phone), runs on my own server, and keeps my recipes in my own database. Along the way it picked up AI features that do more than store recipes: they **improve** them. That means filling gaps in the instructions, tidying ingredients, working out nutrition, reading recipes from photos, PDFs and videos, and helping find new things to cook.

- **Import from anywhere**: a link, a photo of a handwritten card, a PDF cookbook, pasted text, exports from other recipe apps, or the [RecipeHub Companion](https://github.com/cwland/RecipeHub-Companion) browser extension.
- **Cook Mode**: one step at a time, an ingredient checklist with each step's ingredients lit up, tap-to-start timers, scaling, metric/US units, and the screen kept awake.
- **Meal plan and groceries**: plan the week by drag and drop, then shop from a shared list sorted by aisle, with a pantry. Changes show live on every device in the household.
- **Discover**: new recipes from your favorite sites' RSS feeds, previewed before you save them.
- **Versions**: every change to a recipe is kept, so an AI edit (or your own) is always one click from undone.
- **Sharing**: public read-only links, PDF and other downloads, email.
- **AI is optional**: OpenAI, Claude, Gemini, OpenRouter or a home server like Ollama, with automatic failover. Everything else works without it.
- **Self-hosted**: one Docker image plus PostgreSQL, daily backups, passkeys and OAuth sign-in, and API keys for Home Assistant, iOS Shortcuts and the browser extension.

## A tour

### Your recipes

Everything in one library: photos, categories, tags, collections, favorites, ratings, private notes and full-text search. A recipe page shows the times, servings and source, with scaling and unit conversion right beside the ingredients. There's a light and a dark theme.

| | |
|---|---|
| ![A recipe page](docs/screenshots/recipe.webp) | ![The recipe library in dark mode](docs/screenshots/library-dark.webp) |

### Add a recipe any way you have it

Paste a link and most sites import instantly from their built-in recipe data, with no AI needed. Pages without it, plus TikTok, Instagram and YouTube videos, are read by your AI service. Snap a photo of a cookbook page or a handwritten card, drop in a whole PDF cookbook, or paste text. Sites that block bots fall back to a saved copy on the Wayback Machine or archive.ph.

![The Add a recipe window: from a link, pasted text, a file or a photo](docs/screenshots/add-recipe.webp)

### Cook Mode

One step at a time, big enough to read from across the counter. Ingredients used in the current step are highlighted, times in the steps become timers (with a chime, a buzz on phones and a notification), and the screen stays awake.

![Cook Mode: a step with a timer, and the ingredients it uses highlighted](docs/screenshots/cook-mode.webp)

### Meal plan, grocery list and pantry

Drag recipes onto the week, then add the whole week to the grocery list in one go. The same ingredient from several recipes is added up into one line, and anything already in the pantry starts unticked. The list is sorted by store aisle and shared by everyone in the household, live. When you're done shopping, what's in the cart moves to the pantry, and **Cook with what you have** shows which recipes you can mostly make from it.

![The weekly meal plan](docs/screenshots/meal-plan.webp)

| | |
|---|---|
| ![The grocery list, sorted by aisle](docs/screenshots/grocery.webp) | ![The pantry, with recipes you can make from it](docs/screenshots/pantry.webp) |

### Discover new recipes

Subscribe to your favorite recipe sites' RSS feeds. New posts show up as cards, and your own tags (chicken, soup, holiday…) highlight the ones you care about. Opening a post shows the recipe's ingredients and steps **before** anything is saved, so you only import the ones you want.

![Discover: posts from your recipe feeds](docs/screenshots/discover.webp)

| | |
|---|---|
| ![A Discover post with its recipe preview](docs/screenshots/discover-preview.webp) | ![A post without recipe data, with Read with AI](docs/screenshots/discover-read-ai.webp) |

### On your phone

RecipeHub is built to be used one-handed in the kitchen and the store.

<p align="center">
  <img src="docs/screenshots/phone-recipe.webp" width="250" alt="A recipe on a phone">
  &nbsp;
  <img src="docs/screenshots/phone-cook.webp" width="250" alt="Cook Mode on a phone">
  &nbsp;
  <img src="docs/screenshots/phone-grocery.webp" width="250" alt="The grocery list on a phone">
</p>

## AI that improves your recipes

AI in RecipeHub is optional, and it's there to make your recipes better, not just to store them. Use a hosted service (OpenAI, Claude, Gemini, OpenRouter) or keep everything on your own network with a home AI server like Ollama. Add several and they're tried in order: if one is down or too slow, the next one answers.

### Improve with AI

Every recipe has an **Improve with AI** button, and a newly imported recipe offers it straight away. The AI fills gaps in the steps (missing times, temperatures and how to tell when something is done), corrects and tidies the ingredients, works out nutrition, and suggests categories and tags. It never adds an ingredient. Short, vague steps are rewritten in full: grouped under headings, each with a bold label and the how and why.

You watch it work, live: which service it's asking, when it's thinking and how much it has written. If one service is slow, **Skip** moves on to the next.

![Improve with AI, working: live progress from the AI service](docs/screenshots/ai-working.webp)

Nothing changes until you say so. A wizard walks through each part that changed, with your original beside the AI's suggestion: **Accept change**, **Reject change**, or edit the suggestion first.

![Improve with AI: the original steps beside the AI's rewritten steps](docs/screenshots/ai-steps.webp)

| | |
|---|---|
| ![Improve with AI: ingredient fixes](docs/screenshots/ai-ingredients.webp) | ![Improve with AI: suggested categories and tags](docs/screenshots/ai-organize.webp) |

Accepted changes are saved as a **new version**, so the recipe as it was is always a click away in **Version history**.

![Version history, with versions made by the AI check](docs/screenshots/versions.webp)

### Nutrition, worked out per ingredient

**Calculate nutrition** looks up each ingredient, adds them up, and shows a nutrition label per serving with what each ingredient contributes. It can run automatically for every new recipe, and again whenever the ingredients change. Numbers you type in yourself are never replaced.

| | |
|---|---|
| ![A recipe's nutrition label with calories by ingredient](docs/screenshots/nutrition.webp) | ![Improve with AI: the nutrition step](docs/screenshots/ai-nutrition.webp) |

### And more

- **Read recipes from anything**: photos of cookbook pages and handwritten cards, scanned or text PDFs (a whole cookbook at once), video descriptions, and pages with no recipe data.
- **Bulk improve**: import a whole cookbook, then review each recipe with AI, or let it improve them all in the background.
- **Discover**: **Read with AI** for posts whose page has no recipe data, and nutrition before you import.
- **Meal ideas** for the week's plan, or from what's in the pantry.
- **Aisle sorting**: grocery items the built-in word list doesn't know are placed by AI once and remembered.
- **Grams for cups**: in Metric, dry ingredients in cups and spoons show an estimated weight.

Set it up in **Settings › AI**. Mark a cheap, fast model for quick jobs (aisle sorting, nutrition, meal ideas) and keep a stronger one for reading recipes.

![Settings › AI with several services, tried in order](docs/screenshots/settings-ai.webp)

## Built mostly with AI

Almost all of RecipeHub's code (the Node/TypeScript API, the React web app, the tests and the GitHub Actions pipelines, plus the [RecipeHub Companion](https://github.com/cwland/RecipeHub-Companion) browser extension) was written by an AI coding assistant (Claude), working from plain-language design notes and feedback. The human side was deciding what to build, reviewing designs, testing every round on real devices and saying what to change. Read the code with that in mind, and treat it as an example of what AI-assisted development can produce.

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

## Documentation

- **[Guide](docs/GUIDE.md)**: how every part works in detail: households, importing, AI, versions, grocery lists, sharing, backups, sign-in (passkeys, OAuth) and security.
- **[API](docs/API.md)**: API keys and their access levels, sending recipes in, Discover, the inbox, and Home Assistant / iOS Shortcuts examples. Interactive docs are built in at `/api/docs`.
- **[Developing](docs/DEVELOPMENT.md)**: running it locally, tests, database changes and the project layout.

Found a security problem? Please report it privately through GitHub's **Security → Report a vulnerability** on this repository rather than in a public issue.

## Credits

Icons: [Lucide](https://lucide.dev) (ISC).

## License

[MIT](LICENSE): anyone may use, change and share RecipeHub, including commercially, as long as the license notice stays with it. It comes with no warranty.
