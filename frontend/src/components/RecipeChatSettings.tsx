import { useEffect, useState } from "react";
import { api } from "../api";
import { FeatureSwitch } from "./FeatureSwitch";
import { Card, Notice } from "./settingsUi";

// Settings › Recipes › Recipe chat: the switch, and (while it's on) notes about the household that
// go into every chat, and which AI answers (only offered when more than one is set up)
interface ChatSettings {
  notes: string;
  serviceId: string | null;
  services: { id: string; name: string }[];
}

export function RecipeChatSwitch() {
  return (
    <FeatureSwitch
      feature="recipeChat"
      needsAi
      title="Recipe chat"
      text="A chat bubble on every recipe and in Cook mode. Ask it to swap a missing ingredient, make a recipe lighter or dairy-free, or change the servings. Each person has their own chats, and a good change can be saved as a new recipe."
      offText="Off: there's no chat bubble on recipes."
    >
      <RecipeChatOptions />
    </FeatureSwitch>
  );
}

const field = "mt-1 w-full rounded-lg border border-line bg-page px-3 py-2.5 outline-none focus:border-action focus:ring-2 focus:ring-action/15";

function RecipeChatOptions() {
  const [s, setS] = useState<ChatSettings | null>(null);
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api<ChatSettings>("GET", "/api/settings/ai/recipe-chat")
      .then((v) => {
        setS(v);
        setNotes(v.notes);
      })
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const save = async (change: Partial<Pick<ChatSettings, "notes" | "serviceId">>) => {
    setMsg(null);
    try {
      const v = await api<ChatSettings>("PUT", "/api/settings/ai/recipe-chat", change);
      setS(v);
      setMsg({ ok: true, text: "Saved" });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  if (!s) return msg ? <Notice msg={msg} /> : null;
  return (
    <Card title="Recipe chat settings" description="For everyone in the household.">
      <label className="block">
        <span className="text-sm font-semibold text-subtle">Household notes</span>
        <textarea
          className={`${field} min-h-24`}
          maxLength={1000}
          value={notes}
          placeholder="We're dairy-free. Kids don't like mushrooms."
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => notes.trim() !== s.notes && void save({ notes: notes.trim() })}
        />
        <span className="mt-1 block text-sm text-subtle">The chat keeps these in mind in every answer.</span>
      </label>
      {s.services.length > 1 && (
        <label className="mt-4 block">
          <span className="text-sm font-semibold text-subtle">AI for recipe chat</span>
          <select className={field} value={s.serviceId ?? ""} onChange={(e) => void save({ serviceId: e.target.value || null })}>
            <option value="">Same as other AI features</option>
            {s.services.map((sv) => (
              <option key={sv.id} value={sv.id}>
                {sv.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-sm text-subtle">Asked first. If it doesn't answer, the others are tried in their usual order.</span>
        </label>
      )}
      {msg && (
        <div className="mt-3">
          <Notice msg={msg} />
        </div>
      )}
    </Card>
  );
}
