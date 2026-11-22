import { useState } from "react";
import { api } from "../api";
import { useSession } from "../session";
import { EmailNeeded, useEmailReady } from "../email";
import {
  Notice,
  SettingCard,
  Toggle,
  field,
  secondaryButton,
} from "./settingsUi";

// The daily meal plan email: today's and tomorrow's meals, and what to start ahead (soak, thaw,
// marinate). Each person's own; off hides the time.
export default function ReminderSettings() {
  const { user, setUser } = useSession();
  const [time, setTime] = useState(user.remindAt ?? "17:00");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const on = !!user.remindAt;
  const emailReady = useEmailReady();
  const blocked = emailReady === false;
  const save = async (remindAt: string | null) => {
    setMsg(null);
    try {
      await api("PUT", "/api/profile/reminder", { remindAt });
      setUser({ ...user, remindAt });
      if (remindAt)
        setMsg({
          ok: true,
          text: `Saved. It comes each day at ${remindAt}, when something is planned.`,
        });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <SettingCard
      title="Meal plan email"
      text={
        <>
          Each day: today's and tomorrow's meals, and anything to start ahead
          for tomorrow, like “soak the beans overnight”. Sent to{" "}
          {user.email || "your email"}; nothing comes on days with nothing
          planned.
        </>
      }
      toggle={
        <Toggle
          label="Meal plan email"
          checked={on}
          disabled={blocked && !on}
          onChange={(v) => void save(v ? time : null)}
        />
      }
    >
      {blocked && <EmailNeeded what={on ? "the meal plan email can't be sent. You can still turn it off" : "the meal plan email can't be turned on"} />}
      {(on || msg) && (
        <>
          {on && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm font-medium text-subtle">
                Send it at
                <input
                  type="time"
                  aria-label="Send it at"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  onBlur={() =>
                    time && time !== user.remindAt && void save(time)
                  }
                  className={field + " w-36"}
                />
              </label>
              <button
                type="button"
                className={secondaryButton}
                onClick={async () => {
                  setMsg(null);
                  try {
                    await api("POST", "/api/profile/reminder/test");
                    setMsg({ ok: true, text: `Sent to ${user.email}.` });
                  } catch (e) {
                    setMsg({ ok: false, text: (e as Error).message });
                  }
                }}
              >
                Send one now
              </button>
              <span className="basis-full text-xs text-muted">
                Uses the server's time zone (set TZ in your Docker setup, e.g.
                TZ=America/Chicago).
              </span>
            </div>
          )}
          <div className="mt-3 empty:hidden">
            <Notice msg={msg} />
          </div>
        </>
      )}
    </SettingCard>
  );
}
