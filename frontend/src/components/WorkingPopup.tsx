import { createPortal } from "react-dom";
import { useLockBodyScroll } from "../scrollLock";

// While AI works on something: a spinning circle and one line of what it's doing now.
// It closes by itself when the work is done (the caller stops showing it).
export function WorkingPopup({ title, line }: { title: string; line: string }) {
  useLockBodyScroll();
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]">
      <div role="dialog" aria-modal="true" aria-label={title} className="flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl bg-container px-6 py-7 text-center shadow-[0_12px_40px_rgba(31,36,38,0.3)]">
        <span role="progressbar" aria-label={title} className="size-12 animate-spin rounded-full border-4 border-brand-subtle border-t-action" />
        <h2 className="text-lg font-bold">{title}</h2>
        <p role="status" aria-live="polite" className="min-h-[1.25rem] text-sm text-subtle">
          {line}
        </p>
      </div>
    </div>,
    document.body,
  );
}
