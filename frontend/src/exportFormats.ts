// The download formats (the server's /export?format=…), in the order they're offered
export const EXPORT_FORMATS = [
  { id: "pdf", name: "PDF", hint: "To print or keep: photo, ingredients, steps, nutrition" },
  { id: "jsonld", name: "JSON-LD", hint: "schema.org recipe data, which most recipe apps import" },
  { id: "paprika", name: "Paprika", hint: "Opens in Paprika (and imports back into RecipeHub)" },
  { id: "mealmaster", name: "Meal-Master", hint: "Plain text that older recipe programs read" },
  { id: "cookml", name: "CookML", hint: "XML for CookML programs" },
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number]["id"];
