import { MinusIcon, PlusIcon } from "./Icons";
import { MAX_ACROSS, MIN_ACROSS } from "./recipes/recipeView";

// − 4 +: how many tiles across a grid of cards shows (the recipe list and Discover).
// Phones always show 2 across, so it only shows on wider screens.
export const tileButton = "flex size-8 items-center justify-center rounded-md text-subtle hover:bg-brand-subtle hover:text-action disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-subtle";

export function TilesAcross({ across, onChange }: { across: number; onChange: (n: number) => void }) {
  return (
    <span className="hidden items-center gap-1 sm:flex">
      <button type="button" aria-label="Fewer tiles across" title="Fewer tiles across" disabled={across <= MIN_ACROSS} onClick={() => onChange(across - 1)} className={tileButton}>
        <MinusIcon />
      </button>
      <span aria-hidden className="w-4 text-center text-sm font-semibold tabular-nums">{across}</span>
      <button type="button" aria-label="More tiles across" title="More tiles across" disabled={across >= MAX_ACROSS} onClick={() => onChange(across + 1)} className={tileButton}>
        <PlusIcon className="size-4" />
      </button>
    </span>
  );
}
