import { useState, type ReactNode } from "react";
import { Popup } from "./Popup";
import { ChefIcon, GroceryIcon, PlannerIcon, RecipesIcon, ShareIcon, WandIcon } from "./Icons";

// Getting started: a short tour of the main things, after setup (and any time from the account menu)
const PAGES: { icon: ReactNode; title: string; text: string; tips: string[] }[] = [
  {
    icon: <RecipesIcon className="size-8" />,
    title: "Add your recipes",
    text: "Add a recipe (the + on the Recipes page) from a link, pasted text, a photo of a card, a PDF, or a whole Paprika export.",
    tips: ["Most recipe sites import as they are", "Several recipes in a file? Pick which ones to bring in", "Send to RecipeHub (Settings › Recipes) grabs a page you have open"],
  },
  {
    icon: <ChefIcon className="size-8" />,
    title: "Cook from a recipe",
    text: "Scale it with − and +, switch between As is, Metric and US, and press Start cooking for one step at a time with timers.",
    tips: ["Fresh herbs show the dried amount too", "The pencils edit each part in place", "Every change can be saved as a new version"],
  },
  {
    icon: <WandIcon className="size-8" />,
    title: "Improve with AI",
    text: "The AI tidies ingredients, fills gaps in the steps, works out nutrition and suggests categories and tags. You accept or reject each change.",
    tips: ["It never adds ingredients", "Edit its suggestion with the pencil before accepting", "Whole imports can be improved in the background"],
  },
  {
    icon: <PlannerIcon className="size-8" />,
    title: "Plan the week, shop once",
    text: "Drag recipes onto the meal plan, then add the week to the grocery list. It's shared with your household and sorted by aisle.",
    tips: ["The pantry keeps track of what you have", "Meal ideas suggest dinners from what's in it"],
  },
  {
    icon: <ShareIcon className="size-8" />,
    title: "Share a recipe",
    text: "Share gives every recipe a read-only link anyone can open, a PDF or file to download, and an email you can send from RecipeHub.",
    tips: ["Links can be replaced or all turned off", "Your notes and ratings stay private"],
  },
];

export default function GettingStarted({ onClose }: { onClose: () => void }) {
  const [at, setAt] = useState(0);
  const p = PAGES[at];
  const last = at === PAGES.length - 1;
  return (
    <Popup title="Getting started" onClose={onClose}>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-subtle text-action">{p.icon}</div>
        <h3 className="text-xl font-bold">{p.title}</h3>
        <p>{p.text}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-subtle">
          {p.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        <div className="flex justify-center gap-1.5" aria-hidden>
          {PAGES.map((_, i) => (
            <span key={i} className={`size-2 rounded-full ${i === at ? "bg-action" : "bg-line"}`} />
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-line pt-4">
          {at > 0 ? (
            <button type="button" onClick={() => setAt(at - 1)} className="px-2 py-2 font-semibold text-subtle hover:underline">
              Back
            </button>
          ) : (
            <button type="button" onClick={onClose} className="px-2 py-2 font-semibold text-subtle hover:underline">
              Skip the tour
            </button>
          )}
          <span className="ml-auto" />
          <button type="button" onClick={() => (last ? onClose() : setAt(at + 1))} className="rounded-lg bg-primary px-5 py-2.5 font-semibold text-white hover:bg-primary-pressed">
            {last ? "Done" : "Next"}
          </button>
        </div>
        <p className="text-center text-xs text-muted">See this again any time from your account menu.</p>
      </div>
    </Popup>
  );
}
