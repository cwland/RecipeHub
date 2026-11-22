import { and, asc, eq, inArray, isNotNull, gte, lte } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { mealPlan, recipes, users, appSettings } from "../db/schema.js";
import type { MailService } from "./mail.js";
import { logEvent } from "./appLog.js";

// The daily meal plan email: today's and tomorrow's meals, and anything in tomorrow's recipes that
// has to start ahead (soak the beans, thaw the chicken, marinate overnight). Each person turns it on
// and picks the time in Settings › Recipes.

const AHEAD = /\b(overnight|the night before|a day ahead|day before|marinat\w*|thaw\w*|defrost\w*|soak\w*|brine|brining|let (?:it )?rise|proof\w*|refrigerate (?:for )?(?:at least )?\d+\s*(?:hours?|hrs?)|chill (?:for )?(?:at least )?\d+\s*(?:hours?|hrs?)|(?:at least|up to) \d+\s*(?:hours?|hrs?))\b/i;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayAfter = (day: string) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return isoDay(d);
};
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

export async function planEmail(db: Db, today: string, appUrl: string | null) {
  const tomorrow = dayAfter(today);
  const [planner] = await db.select().from(appSettings).where(eq(appSettings.key, "planner"));
  const slotNames = new Map(((planner?.value as { slots?: { id: string; name: string }[] } | undefined)?.slots ?? [
    { id: "breakfast", name: "Breakfast" },
    { id: "lunch", name: "Lunch" },
    { id: "dinner", name: "Dinner" },
    { id: "snack", name: "Snack" },
  ]).map((s, i) => [s.id, { name: s.name, order: i }]));
  const rows = await db
    .select({ date: mealPlan.date, slot: mealPlan.slot, position: mealPlan.position, title: mealPlan.title, note: mealPlan.note, recipeId: mealPlan.recipeId, recipe: recipes.title, steps: recipes.steps })
    .from(mealPlan)
    .leftJoin(recipes, eq(recipes.id, mealPlan.recipeId))
    .where(and(gte(mealPlan.date, today), lte(mealPlan.date, tomorrow)))
    .orderBy(asc(mealPlan.date), asc(mealPlan.position));
  if (!rows.length) return null;
  const order = (s: string) => slotNames.get(s)?.order ?? 99;
  const day = (d: string) => rows.filter((r) => r.date === d).sort((a, b) => order(a.slot) - order(b.slot) || a.position - b.position);
  const name = (r: (typeof rows)[number]) => r.recipe ?? r.title ?? "Something";
  const ahead = day(tomorrow).flatMap((r) => (r.steps ?? []).filter((s) => !s.section && AHEAD.test(s.text)).map((s) => ({ dish: name(r), step: s.text })));
  const link = (r: (typeof rows)[number]) => (r.recipeId && appUrl ? `<a href="${esc(appUrl.replace(/\/+$/, ""))}/#/recipes/${r.recipeId}" style="color:#1a7f4b;text-decoration:none">${esc(name(r))}</a>` : esc(name(r)));
  const section = (title: string, d: string) => {
    const list = day(d);
    return `<h2 style="font-size:18px;margin:18px 0 6px">${title} <span style="font-weight:normal;color:#777;font-size:14px">${longDay(d)}</span></h2>${
      list.length ? list.map((r) => `<p style="margin:0;padding:6px 0;border-bottom:1px solid #eee"><span style="color:#777;display:inline-block;min-width:90px">${esc(slotNames.get(r.slot)?.name ?? r.slot)}</span> ${link(r)}${r.note ? ` <span style="color:#777">(${esc(r.note)})</span>` : ""}</p>`).join("") : `<p style="margin:0;color:#777">Nothing planned.</p>`
    }`;
  };
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1d2b24">
<div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:16px;padding:8px 24px 22px">
${section("Today", today)}
${section("Tomorrow", tomorrow)}
${ahead.length ? `<h2 style="font-size:18px;margin:18px 0 6px">Start ahead for tomorrow</h2>${ahead.map((a) => `<p style="margin:0 0 8px;padding:10px 12px;background:#fff7e6;border-radius:8px"><strong>${esc(a.dish)}:</strong> ${esc(a.step)}</p>`).join("")}` : ""}
</div><p style="font-size:12px;color:#888;margin:14px 0 0">From RecipeHub. Turn this email off in Settings › Recipes.</p></div></body></html>`;
  const lines = (d: string) => day(d).map((r) => `- ${slotNames.get(r.slot)?.name ?? r.slot}: ${name(r)}${r.note ? ` (${r.note})` : ""}`).join("\n") || "- Nothing planned.";
  const text = `Today, ${longDay(today)}\n${lines(today)}\n\nTomorrow, ${longDay(tomorrow)}\n${lines(tomorrow)}\n${ahead.length ? `\nStart ahead for tomorrow\n${ahead.map((a) => `- ${a.dish}: ${a.step}`).join("\n")}\n` : ""}`;
  const first = day(today)[0] ?? day(tomorrow)[0];
  return { subject: ahead.length ? `Meal plan: ${name(first)}… (start something tonight)` : `Meal plan: ${day(today).length ? `today, ${day(today).map(name).join(", ")}` : `tomorrow, ${day(tomorrow).map(name).join(", ")}`}`.slice(0, 150), html, text };
}

// Sends what's due. Runs every few minutes; each person gets at most one a day, at or after their time.
export async function sendDueReminders(db: Db, mail: MailService, now: Date) {
  const active = await mail.active();
  if (!active) return 0;
  const today = isoDay(now);
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const due = (await db.select().from(users).where(and(isNotNull(users.remindAt), isNotNull(users.email)))).filter((u) => u.remindAt! <= hhmm && u.remindedOn !== today);
  if (!due.length) return 0;
  // marked first, so a slow mail server can't cause a second email
  await db.update(users).set({ remindedOn: today }).where(inArray(users.id, due.map((u) => u.id)));
  const msg = await planEmail(db, today, active.config.appUrl ?? null);
  if (!msg) return 0; // nothing planned: no email
  let sent = 0;
  for (const u of due) {
    try {
      await mail.send({ to: u.email!, ...msg }, undefined, "reminder");
      sent++;
    } catch (e) {
      await logEvent(db, { category: "schedule", level: "warning", source: "Meal plan email", event: `Couldn't send ${u.username}'s meal plan email`, detail: (e as Error).message });
    }
  }
  return sent;
}

export function startReminderSchedule(db: Db, mail: MailService, now: () => Date, onError: (e: unknown) => void) {
  const run = () => sendDueReminders(db, mail, now()).catch(onError);
  const timer = setInterval(run, 5 * 60 * 1000);
  timer.unref();
  setTimeout(run, 20 * 1000).unref();
  return () => clearInterval(timer);
}
