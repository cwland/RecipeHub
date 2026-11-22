import { useState } from "react";
import { api } from "../api";
import { useSession, type User } from "../session";
import { Card, Notice, Toggle, UnitsPills } from "./settingsUi";

// Settings › Recipes › Cooking: how amounts show to start with, and whether Cook mode keeps the
// screen awake. Each person's own; saved as you change them.
export default function CookingPrefs() {
  const { user, setUser } = useSession();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async (change: Partial<Pick<User, "units" | "keepAwake" | "ingredientOrder">>) => {
    setMsg(null);
    try {
      setUser(await api<User>("PATCH", "/api/profile", change));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const units = user.units ?? "original";
  return (
    <>
    <Card title="Measurements" description="How amounts show when you open a recipe. Every recipe also has this switch.">
      <UnitsPills value={units} onChange={(v) => void save({ units: v })} />
    </Card>
    <Card title="Cooking" description="How recipes open for you.">
      <div className="flex items-start justify-between gap-6">
        <p className="text-sm">
          <span className="font-semibold">Keep the screen awake in Cook mode</span>
          <span className="block text-subtle">Your phone or tablet won't go to sleep while you cook step by step (on https:// addresses).</span>
        </p>
        <Toggle label="Keep the screen awake in Cook mode" checked={user.keepAwake ?? true} onChange={(v) => void save({ keepAwake: v })} />
      </div>
      <div className="mt-4 flex items-start justify-between gap-6">
        <p className="text-sm">
          <span className="font-semibold">Sort ingredients A to Z</span>
          <span className="block text-subtle">Off: ingredients show in the order they were entered. Sections stay where they are.</span>
        </p>
        <Toggle label="Sort ingredients A to Z" checked={user.ingredientOrder === "alpha"} onChange={(v) => void save({ ingredientOrder: v ? "alpha" : "entered" })} />
      </div>
      <p className="mt-2">
        <Notice msg={msg} />
      </p>
    </Card>
    </>
  );
}
