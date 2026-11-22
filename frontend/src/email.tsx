import { useEffect, useState } from "react";
import { api } from "./api";

// Is RecipeHub able to send email (Settings › Email)? null while asking, or if the answer didn't come
// (then nothing is held back). Things that send email check this before they can be turned on.
export function useEmailReady(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    api<{ active: boolean }>("GET", "/api/settings/email")
      .then((d) => live && setReady(!!d.active))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return ready;
}

// "Email isn't set up yet …" with a link to Settings › Email
export function EmailNeeded({ what, className = "" }: { what: string; className?: string }) {
  return (
    <p role="note" className={`rounded-lg bg-warning/15 px-3 py-2 text-sm text-ink ${className}`}>
      Email isn't set up yet, so {what}. Set it up in{" "}
      <a href="#/settings/email" className="font-semibold text-link hover:underline">
        Settings › Email
      </a>
      .
    </p>
  );
}
