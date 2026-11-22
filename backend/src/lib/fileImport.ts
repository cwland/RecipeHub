import { gunzipSync, strFromU8, unzipSync, type Unzipped } from "fflate";
import { minutesOf, plain, yieldOf, type ImportedRecipe } from "./importRecipe.js";

// Recipe collections exported from other apps. Each reader turns a file into recipes (and a list
// of entries it couldn't use, with why); saving them is importJobs' work.

export type FileRecipe = ImportedRecipe & { notes?: string | null; rating?: number | null; photo?: Buffer | null };
export interface ReadResult {
  format: string;
  recipes: FileRecipe[];
  problems: { name: string; reason: string }[];
}

export class FileImportError extends Error {}

const MAX_TOTAL = 1024 * 1024 * 1024; // what a zip may unpack to (a zip bomb stops here)
const lines = (s: unknown) => (typeof s === "string" ? s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);
const text = (s: unknown) => (typeof s === "string" && s.trim() ? s.trim() : null);

function unzip(data: Buffer, what: string): Unzipped {
  let total = 0;
  try {
    return unzipSync(new Uint8Array(data), {
      filter: (f) => {
        total += f.originalSize;
        if (total > MAX_TOTAL) throw new FileImportError(`${what} is too big to import in one go`);
        return !f.name.endsWith("/") && !/(^|\/)(__MACOSX|\.DS_Store)/.test(f.name);
      },
    });
  } catch (e) {
    if (e instanceof FileImportError) throw e;
    throw new FileImportError(`${what} couldn't be opened. Is it the whole file, exactly as the app exported it?`);
  }
}

// ---------- Paprika 3 ----------
// .paprikarecipes: a zip of .paprikarecipe files; each is gzip-compressed JSON

function paprikaRecipe(p: Record<string, unknown>): FileRecipe {
  const servings = text(p.servings);
  const y = servings ? yieldOf(servings) : { servings: null, yieldText: null };
  const photo = typeof p.photo_data === "string" && p.photo_data ? Buffer.from(p.photo_data, "base64") : null;
  const nutrition = text(p.nutritional_info);
  const rating = typeof p.rating === "number" && p.rating >= 1 && p.rating <= 5 ? Math.round(p.rating) : null;
  return {
    title: plain(p.name),
    description: text(p.description),
    ingredients: lines(p.ingredients),
    steps: lines(p.directions),
    servings: y.servings,
    yieldText: y.yieldText && y.yieldText !== String(y.servings) ? y.yieldText : null,
    prepMinutes: minutesOf(p.prep_time),
    cookMinutes: minutesOf(p.cook_time),
    totalMinutes: minutesOf(p.total_time),
    sourceUrl: text(p.source_url),
    sourceName: text(p.source),
    imageUrl: photo ? null : text(p.image_url),
    categories: Array.isArray(p.categories) ? p.categories.filter((c): c is string => typeof c === "string" && !!c.trim()) : [],
    rating,
    notes: [text(p.notes), nutrition && `Nutrition: ${nutrition}`].filter(Boolean).join("\n\n") || null,
    photo,
  };
}

function readPaprika(entries: [string, Uint8Array][]): ReadResult {
  const out: ReadResult = { format: "Paprika", recipes: [], problems: [] };
  for (const [name, bytes] of entries) {
    let p: Record<string, unknown>;
    try {
      p = JSON.parse(strFromU8(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes));
    } catch {
      out.problems.push({ name, reason: "It couldn't be read" });
      continue;
    }
    const r = paprikaRecipe(p);
    if (!r.title) out.problems.push({ name, reason: "It has no name" });
    else out.recipes.push(r);
  }
  return out;
}

// ---------- which kind of file ----------

export function readRecipeFile(name: string, data: Buffer): ReadResult {
  const lower = name.toLowerCase();
  if (lower.endsWith(".paprikarecipes")) {
    const files = unzip(data, "That Paprika file");
    return readPaprika(Object.entries(files).filter(([n]) => n.toLowerCase().endsWith(".paprikarecipe")));
  }
  if (lower.endsWith(".paprikarecipe")) return readPaprika([[name, new Uint8Array(data)]]);
  throw new FileImportError(`${name} isn't a recipe file RecipeHub can read. It takes Paprika exports (.paprikarecipes) and PDFs.`);
}
