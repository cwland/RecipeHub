import { useState, type ReactNode } from "react";
import { InfoIcon } from "./Icons";
import { Popup } from "./Popup";

// The (i) next to "AI services": what a model has to support, and models worth trying.
// Model names change often; "Load models" on a service shows what your key or server offers today.

const NEEDS: { title: string; text: ReactNode }[] = [
  { title: "Answers in JSON", text: "Every job asks for a reply in JSON (a fixed format RecipeHub can read). The model has to follow that reliably. Most current chat models do; very small ones often don't." },
  { title: "A chat API RecipeHub speaks", text: "OpenAI-style chat completions (OpenAI, OpenRouter, Ollama, LM Studio, LocalAI, vLLM), Anthropic's Messages API, or Google's Gemini API." },
  { title: "Enough context", text: "Recipe pages can be long: pick a model with a context window of at least 16,000 tokens (32,000 or more is comfortable). For home models, set Ollama's context size to match (num_ctx)." },
  { title: "Reads pictures (for photos)", text: "Only for Add recipe › From a photo: the model must accept images (a vision model). Tick “Can read photos” only on those." },
  { title: "No long thinking for quick jobs", text: "“Thinking” or reasoning models can use up the reply before they get to the answer, so nutrition and aisle sorting fail. Use a regular model for quick jobs, or turn reasoning off." },
];

const Model = ({ id }: { id: string }) => <code className="rounded bg-page px-1.5 py-0.5 text-[0.85em] text-ink">{id}</code>;

const PICKS: { group: string; note: string; rows: { model: ReactNode; does: string; notes: string }[] }[] = [
  {
    group: "At home (Ollama, LM Studio)",
    note: "Free and private. Choose Local / OpenAI-compatible and enter your server's address (for Ollama: http://<server>:11434/v1). Needs a graphics card for decent speed.",
    rows: [
      { model: <Model id="qwen3-vl:8b" />, does: "Everything, including photos", notes: "The best all-rounder for about 8 GB of graphics memory (uses about 6 GB). Strong at reading recipe cards." },
      { model: <Model id="qwen2.5vl:7b" />, does: "Everything, including photos", notes: "Older but proven document reader, same size." },
      { model: <Model id="gemma3:4b" />, does: "Everything, small", notes: "Fits about 4 GB. Weaker on photos and handwriting." },
      { model: <Model id="qwen3-vl:32b" />, does: "Everything, best at home", notes: "Needs about 24 GB of graphics memory." },
      { model: <Model id="llama3.1:8b" />, does: "Quick jobs only (no photos)", notes: "Fast, reliable JSON, no thinking. Untick “Can read photos”." },
    ],
  },
  {
    group: "Paid (hosted)",
    note: "Pay per use; household use is usually pennies a month. Paste an API key from the provider.",
    rows: [
      { model: <Model id="claude-haiku-5-5" />, does: "Everything, including photos", notes: "Anthropic (Claude). Cheap and fast; a good single choice. Through OpenRouter: anthropic/claude-haiku-5.5." },
      { model: <Model id="claude-sonnet-5-5" />, does: "Hard photos and handwriting", notes: "Anthropic. Costs more: put it second, with “Quick jobs” unticked, so it's only asked when needed." },
      { model: <>Gemini Flash or Flash-Lite</>, does: "Everything, including photos", notes: "Google. Very cheap. Click Load models and pick the newest Flash-Lite or Flash." },
      { model: <>OpenAI's small models</>, does: "Everything, including photos", notes: "OpenAI. Pick a current small model that accepts images (Load models lists them)." },
    ],
  },
];

export default function AiModelHelp() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Which AI models work with RecipeHub" title="Which AI models work with RecipeHub" className="flex size-6 items-center justify-center rounded-full text-subtle hover:bg-pressed hover:text-action">
        <InfoIcon />
      </button>
      {open && (
        <Popup title="Which AI models work" onClose={() => setOpen(false)} wide tall>
          <div className="flex flex-col gap-6 p-5 text-sm sm:p-6">
            <section>
              <h3 className="text-base font-bold">What a model needs</h3>
              <ul className="mt-2 flex flex-col gap-2">
                {NEEDS.map((n) => (
                  <li key={n.title}>
                    <strong>{n.title}.</strong> <span className="text-subtle">{n.text}</span>
                  </li>
                ))}
              </ul>
            </section>
            {PICKS.map((g) => (
              <section key={g.group}>
                <h3 className="text-base font-bold">{g.group}</h3>
                <p className="mt-1 text-subtle">{g.note}</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[34rem] text-left">
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr className="border-b border-line">
                        <th className="py-2 pr-3 font-semibold">Model</th>
                        <th className="py-2 pr-3 font-semibold">Good for</th>
                        <th className="py-2 font-semibold">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r, i) => (
                        <tr key={i} className="border-b border-line last:border-0 align-top">
                          <td className="whitespace-nowrap py-2 pr-3">{r.model}</td>
                          <td className="py-2 pr-3">{r.does}</td>
                          <td className="py-2 text-subtle">{r.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
            <section className="rounded-xl bg-page p-4">
              <h3 className="font-bold">A good setup</h3>
              <p className="mt-1 text-subtle">
                First a home model (or Claude Haiku) with Quick jobs and Can read photos ticked, then a paid model as the backup. If the first is down or too slow, the next one answers, and it shows in Settings › Logs.
              </p>
              <p className="mt-2 text-xs text-muted">Model names change often. Click Load models on a service to see exactly what your key or server offers.</p>
            </section>
          </div>
        </Popup>
      )}
    </>
  );
}
