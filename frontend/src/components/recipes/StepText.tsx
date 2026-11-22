import { Fragment } from "react";
import { convertTemperatures, findTimers, scaleStepText, type Units } from "../../cooking";
import { stepLabel, type Ingredient } from "../../recipes";
import { startTimer } from "../../timers";
import { ClockIcon } from "../Icons";

// A step's text, with temperatures in your units, the ingredients' amounts at the recipe's scale
// (scaling), and each time ("simmer for 15 minutes") as a button that starts a timer
export function StepText({ text: written, units, recipe, stepNumber, big, scaling }: { text: string; units: Units; recipe: { id: number; title: string }; stepNumber: number; big?: boolean; scaling?: { ingredients: Ingredient[]; factor: number } }) {
  const text = scaling ? scaleStepText(written, scaling.ingredients, scaling.factor, units) : written;
  // "Brown: Sear 3–5 minutes…": the short label in bold (AI Enhance writes steps this way)
  const label = stepLabel(text);
  if (label)
    return (
      <>
        <strong>{label[0]}</strong>
        <StepText text={label[1]} units={units} recipe={recipe} stepNumber={stepNumber} big={big} />
      </>
    );
  const shown = convertTemperatures(text, units);
  const found = findTimers(shown);
  if (!found.length) return <>{shown}</>;
  const parts: JSX.Element[] = [];
  let at = 0;
  found.forEach((t, i) => {
    parts.push(<Fragment key={`t${i}`}>{shown.slice(at, t.start)}</Fragment>);
    // punctuation right after stays with the button (no lone "." on the next line)
    const tail = shown.slice(t.end).match(/^[.,;:!?)]+/)?.[0] ?? "";
    parts.push(
      <span key={`w${i}`} className="whitespace-nowrap">
        <button
          type="button"
          onClick={() => startTimer(`Step ${stepNumber} · ${t.label}`, t.seconds, recipe)}
          title={`Start a ${t.label} timer`}
          className={`mx-0.5 inline-flex items-baseline gap-1 rounded-full bg-brand-subtle px-2 font-semibold text-action underline decoration-action/30 underline-offset-2 hover:bg-active ${big ? "py-0.5" : ""}`}
        >
          <ClockIcon className={`${big ? "size-5" : "size-3.5"} self-center`} />
          {shown.slice(t.start, t.end)}
        </button>
        {tail}
      </span>
    );
    at = t.end + tail.length;
  });
  parts.push(<Fragment key="end">{shown.slice(at)}</Fragment>);
  return <>{parts}</>;
}
