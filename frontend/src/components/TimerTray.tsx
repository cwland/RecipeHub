import { addTime, clock, dismissTimer, pauseTimer, resumeTimer, secondsLeft, useTimers } from "../timers";
import { CloseIcon } from "./Icons";

// Running timers, bottom right on every page (above the phone tab bar), until you dismiss them
export default function TimerTray() {
  const timers = useTimers();
  if (!timers.length) return null;
  // (in Cook Mode, above its Back / Next bar)
  const cooking = /^#\/recipes\/\d+\/cook/.test(window.location.hash);
  return (
    <section aria-label="Timers" className={`fixed right-3 z-[70] flex w-[min(23rem,calc(100vw-1.5rem))] flex-col gap-2 sm:right-4 ${cooking ? "bottom-28" : "bottom-16 sm:bottom-4"}`}>
      {timers.map((t) => {
        const left = secondsLeft(t);
        const running = !!t.endsAt && !t.rang;
        return (
          <div
            key={t.id}
            role={t.rang ? "alert" : "status"}
            className={`flex items-center gap-3 rounded-2xl px-4 py-3 shadow-[0_8px_28px_rgba(0,0,0,0.22)] ${t.rang ? "animate-pulse bg-error text-white" : "bg-primary text-white"}`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold opacity-90">{t.label}</p>
              {t.recipeTitle && (
                <a href={`#/recipes/${t.recipeId}/cook`} className="block truncate text-xs opacity-75 hover:underline">
                  {t.recipeTitle}
                </a>
              )}
            </div>
            <span className="tabular text-2xl font-bold" aria-label={t.rang ? "Done" : `${clock(left)} left`}>
              {t.rang ? "Done!" : clock(left)}
            </span>
            <div className="flex items-center gap-1">
              {!t.rang && (
                <button type="button" onClick={() => (running ? pauseTimer(t.id) : resumeTimer(t.id))} className="rounded-lg bg-white/15 px-2 py-1 text-xs font-semibold hover:bg-white/25">
                  {running ? "Pause" : "Go"}
                </button>
              )}
              <button type="button" onClick={() => addTime(t.id, 60)} className="rounded-lg bg-white/15 px-2 py-1 text-xs font-semibold hover:bg-white/25" aria-label={`Add a minute to ${t.label}`} title={`Add a minute to ${t.label}`}>
                +1
              </button>
              <button type="button" onClick={() => dismissTimer(t.id)} aria-label={`${t.rang ? "Dismiss" : "Cancel"} ${t.label}`} title={`${t.rang ? "Dismiss" : "Cancel"} ${t.label}`} className="rounded-lg p-1 hover:bg-white/20">
                <CloseIcon className="size-4" />
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
