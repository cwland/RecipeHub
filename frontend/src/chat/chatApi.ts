import { api, ApiError } from "../api";
import type { Units } from "../cooking";

// Recipe chat on the server (each person's own messages for a recipe)
export interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  content: string;
  canSave: boolean;
  timestamp: string;
}
export interface ChatView {
  factor: number;
  units: Units;
}
// A new recipe written from the chat, for the new-recipe editor (not saved yet)
export interface ChatRecipe {
  title: string;
  description: string | null;
  ingredients: string[];
  steps: (string | { section: string })[];
  servings: number | null;
  yieldText: string | null;
  prepMinutes: number | null;
  cookMinutes: number | null;
  totalMinutes: number | null;
  tags: string[];
  imageUrl: string | null; // the original's photo (an uploaded one is a copy)
  notes: string;
}

export const loadChat = (id: number) => api<{ messages: ChatMsg[] }>("GET", `/api/recipes/${id}/chat`).then((r) => r.messages);
export const sendChat = (id: number, body: ({ message: string } | { retryOf: number }) & { view: ChatView }) => api<{ userMessage: ChatMsg; reply: ChatMsg }>("POST", `/api/recipes/${id}/chat`, body);
export const clearChat = (id: number) => api<void>("DELETE", `/api/recipes/${id}/chat`);
export const buildRecipe = (id: number, messageId: number) => api<ChatRecipe>("POST", `/api/recipes/${id}/chat/${messageId}/recipe`);

// What went wrong, said plainly
export function chatErrorText(e: unknown): string {
  if (!(e instanceof ApiError) || e.status === 0) return "Couldn't reach RecipeHub. Check your connection and try again.";
  if (e.kind === "timeout" || e.status === 504) return "The assistant didn't answer in time. Try again?";
  if (e.kind === "garbled") return "The assistant's answer came back garbled. Try again?";
  if (e.kind === "notSetUp") return "Recipe chat needs AI set up in Settings › AI.";
  return `The assistant couldn't answer (${e.message}). Try again?`;
}
