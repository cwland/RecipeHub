import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { recipeChatMessages, recipes } from "../db/schema.js";
import { AiError, parseJsonReply } from "../lib/ai.js";
import { aiRecipe, RECIPE_JSON_SYSTEM } from "../lib/importRecipe.js";
import { isOn } from "../lib/features.js";
import { HttpError, notFound } from "../lib/errors.js";
import { idParam } from "../lib/validation.js";
import { buildSystemPrompt, conversationText, historyForAi, splitMarker, type ChatMsg } from "../lib/recipeChat.js";
import { getRecipeChatSettings } from "../lib/recipeChatSettings.js";

// Recipe chat (Settings › Recipes › Recipe chat). Each person's own conversation about a recipe.
// Errors say what went wrong in a word ("kind") so the app can put it plainly.
type Kind = "timeout" | "garbled" | "notSetUp" | "failed";
class ChatError extends Error {
  constructor(public kind: Kind, message: string) {
    super(message);
  }
}
const STATUS: Record<Kind, number> = { timeout: 504, garbled: 502, notSetUp: 409, failed: 502 };

const view = z.object({ factor: z.number().min(0.1).max(100), units: z.enum(["original", "metric", "us"]) });
const sendBody = z.union([
  z.object({ message: z.string().trim().min(1, "Type a message").max(2000, "Messages can be 2000 characters at most"), view }).strict(),
  z.object({ retryOf: z.number().int().positive(), view }).strict(),
]);

type Row = typeof recipeChatMessages.$inferSelect;
export const msgOf = (r: Row): ChatMsg => ({ id: r.id, role: r.role, content: r.content, canSave: r.canSave, timestamp: r.createdAt.toISOString() });

export default async function recipeChatRoutes(app: FastifyInstance) {
  const { db, ai } = app;

  // Signed in (not an API key), recipe chat on, and the recipe there: who's asking and the recipe
  const prepare = async (req: FastifyRequest) => {
    if (req.auth?.method !== "token") throw new HttpError(403, "Sign in to use recipe chat");
    const userId = req.auth.userId;
    const { id } = idParam.parse(req.params);
    if (!(await isOn(db, "ai")) || !(await isOn(db, "recipeChat"))) throw notFound("Recipe chat");
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!recipe) throw notFound("Recipe");
    return { userId, recipe };
  };
  const messagesOf = async (recipeId: number, userId: number) =>
    (await db.select().from(recipeChatMessages).where(and(eq(recipeChatMessages.recipeId, recipeId), eq(recipeChatMessages.userId, userId))).orderBy(asc(recipeChatMessages.createdAt), asc(recipeChatMessages.id))).map(msgOf);

  // The services to ask: the usual ones, with the one picked for recipe chat first
  const services = async () => {
    const active = await ai.active("recipe");
    if (!active) return null;
    const { serviceId } = await getRecipeChatSettings(db);
    const chosen = active.services.find((s) => s.id === serviceId);
    return { timeoutSec: active.timeoutSec, services: chosen ? [chosen, ...active.services.filter((s) => s !== chosen)] : active.services };
  };

  const fail = (reply: FastifyReply, e: unknown) => {
    const err = e instanceof ChatError ? e : e instanceof AiError ? new ChatError(/didn't answer within/.test(e.message) ? "timeout" : /couldn't be read|empty/i.test(e.message) ? "garbled" : "failed", e.message) : null;
    if (!err) throw e;
    return reply.status(STATUS[err.kind]).send({ error: err.message, kind: err.kind });
  };

  // Ask the AI about the conversation so far; the answer, as text
  const answer = async (system: string, history: ReturnType<typeof historyForAi>, maxTokens: number) => {
    const s = await services();
    if (!s?.services.length) throw new ChatError("notSetUp", "Recipe chat needs AI set up in Settings › AI.");
    const { text } = await ai.chatText(s.services, system, conversationText(history), { maxTokens, minWaitSec: 30, timeoutSec: s.timeoutSec });
    if (!text.trim()) throw new ChatError("garbled", "The AI sent back an empty answer.");
    return text;
  };

  app.get("/api/recipes/:id/chat", async (req) => {
    const { userId, recipe } = await prepare(req);
    return { messages: await messagesOf(recipe.id, userId) };
  });

  app.post("/api/recipes/:id/chat", async (req, reply) => {
    const { userId, recipe } = await prepare(req);
    const body = sendBody.parse(req.body);
    let userMessage: ChatMsg;
    if ("retryOf" in body) {
      const all = await messagesOf(recipe.id, userId);
      const found = all.find((m) => m.id === body.retryOf && m.role === "user");
      if (!found) throw notFound("Message");
      userMessage = found;
    } else {
      const [row] = await db.insert(recipeChatMessages).values({ recipeId: recipe.id, userId, role: "user", content: body.message }).returning();
      userMessage = msgOf(row);
    }
    const all = await messagesOf(recipe.id, userId);
    const upTo = all.slice(0, all.findIndex((m) => m.id === userMessage.id) + 1);
    const { notes } = await getRecipeChatSettings(db);
    try {
      const text = await answer(buildSystemPrompt(recipe, body.view, notes), historyForAi(upTo, userMessage.id), 800);
      const { content, canSave } = splitMarker(text);
      const [row] = await db.insert(recipeChatMessages).values({ recipeId: recipe.id, userId, role: "assistant", content, canSave }).returning();
      return { userMessage, reply: msgOf(row) };
    } catch (e) {
      return fail(reply, e);
    }
  });

  // A reply that suggested changes -> the whole recipe with them, for the new-recipe editor (nothing is saved)
  app.post("/api/recipes/:id/chat/:messageId/recipe", async (req, reply) => {
    const { userId, recipe } = await prepare(req);
    const messageId = z.coerce.number().int().positive().parse((req.params as { messageId: string }).messageId);
    const all = await messagesOf(recipe.id, userId);
    const at = all.findIndex((m) => m.id === messageId && m.role === "assistant" && m.canSave);
    if (at < 0) throw notFound("Message");
    const original = buildSystemPrompt(recipe, { factor: 1, units: "original" }, "").split("<<<RECIPE")[1].split("RECIPE>>>")[0].trim();
    const chat = all.slice(Math.max(0, at - 11), at + 1).map((m) => `${m.role === "user" ? "Cook" : "Assistant"}: ${m.content}`).join("\n\n");
    const user = `The original recipe:\n${original}\n\nThe conversation about changing it:\n${chat}\n\nWrite the full recipe with the changes from the assistant's last reply applied. Give it a title that says what changed (for example "${recipe.title} (dairy-free)").`;
    try {
      const s = await services();
      if (!s?.services.length) throw new ChatError("notSetUp", "Recipe chat needs AI set up in Settings › AI.");
      const { text } = await ai.chatText(s.services, RECIPE_JSON_SYSTEM, user, { maxTokens: 4000, minWaitSec: 60, timeoutSec: s.timeoutSec });
      const json = parseJsonReply(text);
      if (!json || typeof json !== "object") throw new ChatError("garbled", "The AI's recipe couldn't be read.");
      let made;
      try {
        made = aiRecipe(json as Record<string, unknown>);
      } catch (e) {
        throw new ChatError("garbled", (e as Error).message);
      }
      return { ...made, notes: `Made from ${recipe.title} with recipe chat.` };
    } catch (e) {
      return fail(reply, e);
    }
  });

  app.delete("/api/recipes/:id/chat", async (req, reply) => {
    const { userId, recipe } = await prepare(req);
    await db.delete(recipeChatMessages).where(and(eq(recipeChatMessages.recipeId, recipe.id), eq(recipeChatMessages.userId, userId)));
    return reply.status(204).send();
  });
}
