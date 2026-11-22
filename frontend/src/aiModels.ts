// Which AI model to pick for RecipeHub after Validate lists what a service has, and what to say about
// the good choices. Matched by family (not exact names) so newer versions are picked too: among the
// models of the best family, the highest version wins.

export type AiProvider = "local" | "openai" | "anthropic" | "gemini" | "openrouter";

// Best first: quick, cheap, and able to read photos and PDFs where possible
const FAMILIES: Record<AiProvider, RegExp[]> = {
  anthropic: [/claude-haiku|claude-[\d-]+-haiku/, /claude-sonnet|claude-[\d-]+-sonnet/],
  openai: [/^gpt-[\d.]+o?-mini$/, /^gpt-[\d.]+o?$/],
  gemini: [/(^|\/)gemini-[\d.]+-flash$/, /(^|\/)gemini-[\d.]+-pro$/],
  openrouter: [/^anthropic\/claude-.*haiku/, /^google\/gemini-[\d.]+-flash$/, /^openai\/gpt-[\d.]+o?-mini$/, /^anthropic\/claude-.*sonnet/],
  local: [/qwen[\d.]*-?vl/, /gemma3/, /llama3/, /qwen/],
};

// [5, 5] for "claude-haiku-5-5"; dates (20241022) and sizes after ":" don't count
const version = (m: string) =>
  (m.replace(/:.*$/, "").replace(/\d{8}/g, "").match(/\d+/g) ?? []).map(Number);
const newer = (a: string, b: string) => {
  const x = version(a);
  const y = version(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

export function bestModel(provider: AiProvider, models: string[]): string {
  for (const family of FAMILIES[provider]) {
    const found = models.filter((m) => family.test(m));
    if (found.length) return [...found].sort((a, b) => newer(b, a))[0];
  }
  return models.find((m) => !/embed/i.test(m)) ?? "";
}

// The few lines under the Model box: what works well with RecipeHub, and why
export const SUGGESTIONS: Record<AiProvider, string> = {
  anthropic: "Haiku is quick and cheap and reads recipe photos and PDFs: the best fit. Sonnet is more careful but slower and costs more.",
  openai: "A “mini” model (like GPT-5 mini or 4o mini) is quick and cheap and reads photos. The full-size ones work too but cost more.",
  gemini: "A Flash model is quick, cheap and reads photos and PDFs. Pro is more careful but slower.",
  openrouter: "Claude Haiku, Gemini Flash or a GPT mini: quick, cheap and they read photos. Free models work, but are often slow or busy.",
  local: "qwen3-vl:8b reads photos and PDFs too (ollama pull qwen3-vl:8b). gemma3:12b also reads photos; llama3.1:8b and qwen2.5 are text only. 8B models need about 8 GB of memory.",
};
