import { describe, expect, it } from "vitest";
import { bestModel } from "./aiModels";

// The model picked for you after Validate: the best one for RecipeHub that the service has
describe("bestModel", () => {
  it("Anthropic: Haiku, then Sonnet; the newest of a kind", () => {
    expect(bestModel("anthropic", ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5", "claude-haiku-5-5"])).toBe("claude-haiku-5-5");
    expect(bestModel("anthropic", ["claude-opus-5-5", "claude-sonnet-5-5"])).toBe("claude-sonnet-5-5");
  });
  it("OpenAI: a mini model, newest first", () => {
    expect(bestModel("openai", ["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini", "gpt-5-mini", "o3"])).toBe("gpt-5-mini");
    expect(bestModel("openai", ["gpt-4o", "gpt-4o-mini", "text-embedding-3-small"])).toBe("gpt-4o-mini");
  });
  it("Gemini: a Flash model, not the lite or the image ones", () => {
    expect(bestModel("gemini", ["gemini-2.5-pro", "gemini-2.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-image"])).toBe("gemini-2.5-flash");
    expect(bestModel("gemini", ["models/gemini-3-flash", "models/gemini-2.5-flash"])).toBe("models/gemini-3-flash");
  });
  it("OpenRouter: Claude Haiku, then a Gemini Flash, then a GPT mini", () => {
    expect(bestModel("openrouter", ["openai/gpt-4o-mini", "google/gemini-2.5-flash", "anthropic/claude-haiku-5.5"])).toBe("anthropic/claude-haiku-5.5");
    expect(bestModel("openrouter", ["openai/gpt-4o-mini", "google/gemini-2.5-flash"])).toBe("google/gemini-2.5-flash");
  });
  it("a home AI: one that reads photos first (qwen3-vl, gemma3), then llama or qwen", () => {
    expect(bestModel("local", ["llama3.1:8b", "qwen3-vl:8b"])).toBe("qwen3-vl:8b");
    expect(bestModel("local", ["llama3.1:8b", "gemma3:12b"])).toBe("gemma3:12b");
    expect(bestModel("local", ["nomic-embed-text", "mistral:7b", "llama3.1:8b"])).toBe("llama3.1:8b");
  });
  it("nothing it knows: the first one that isn't an embedding model", () => {
    expect(bestModel("local", ["nomic-embed-text", "phi4"])).toBe("phi4");
    expect(bestModel("openai", [])).toBe("");
  });
});
