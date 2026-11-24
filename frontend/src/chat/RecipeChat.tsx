import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Lightbulb, MessageCircle, Minus, Send, Trash2 } from "lucide-react";
import type { Recipe } from "../recipes";
import type { Units } from "../cooking";
import ChatText from "./ChatText";
import { buildRecipe, chatErrorText, clearChat, loadChat, sendChat, type ChatMsg } from "./chatApi";
import { useDraggable, type Size } from "./useDraggable";

// The chat bubble on a recipe (and in Cook mode). Tapping it opens a small chat about this recipe;
// on a phone it opens as a panel from the bottom. Each person has their own chat for each recipe.
// A reply that suggests changes offers to become a new recipe, which opens in the new-recipe editor.

export const CHAT_IDEAS = ["Substitute a missing ingredient", "Reduce calories", "Make this recipe healthier", "Adapt for dietary restrictions", "Scale or adjust serving size"];
export const DRAFT_KEY = "recipehub-chat-draft";

const WINDOW: Size = { w: 380, h: 520 };
// Narrower than 640px, or too short for the window (a phone on its side): a bottom panel instead
const small = () => window.innerWidth < 640 || window.innerHeight < WINDOW.h + 40;
// Cook mode: the closed bubble stays clear of the top bar and the step buttons at the bottom
const COOK_KEEP_OUT = { top: 64, bottom: 96 };

const useNarrow = () => {
  const [narrow, setNarrow] = useState(small);
  useEffect(() => {
    const again = () => setNarrow(small());
    window.addEventListener("resize", again);
    return () => window.removeEventListener("resize", again);
  }, []);
  return narrow;
};

export default function RecipeChat({ recipe, factor, units, cook = false }: { recipe: Recipe; factor: number; units: Units; cook?: boolean }) {
  const bubble: Size = cook ? { w: 44, h: 44 } : { w: 56, h: 56 };
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false); // once opened, the chat stays mounted (a wait isn't lost by minimizing)
  const narrow = useNarrow();
  // Cook mode: halfway down the right edge, clear of the step buttons (bottom) and the top bar
  const drag = useDraggable(cook ? "recipehub.chat.pos.cook" : "recipehub.chat.pos", open && !narrow ? WINDOW : bubble, () =>
    cook ? { x: window.innerWidth - bubble.w - 16, y: Math.round(window.innerHeight * 0.4) } : { x: window.innerWidth - bubble.w - 24, y: window.innerHeight - bubble.h - 24 },
    cook && !open ? COOK_KEEP_OUT : undefined
  );

  const bubbleButton = !open && (
      <button
        type="button"
        aria-label="Open recipe chat"
        title="Ask about this recipe"
        className="fixed z-[9999] flex touch-none items-center justify-center rounded-full bg-action text-white shadow-lg hover:opacity-90"
        style={{ left: drag.pos.x, top: drag.pos.y, width: bubble.w, height: bubble.h }}
        {...drag.handlers}
        onClick={() => {
          if (drag.wasDrag()) return;
          setOpen(true);
          setOpened(true);
        }}
      >
        <MessageCircle className={cook ? "size-5" : "size-6"} aria-hidden />
      </button>
    );

  const frame = narrow
    ? { className: "fixed inset-x-0 bottom-0 z-[9999] flex flex-col rounded-t-2xl border border-line bg-container shadow-2xl", style: { height: cook ? "60vh" : "85vh" } }
    : { className: "fixed z-[9999] flex flex-col rounded-2xl border border-line bg-container shadow-2xl", style: { left: drag.pos.x, top: drag.pos.y, width: WINDOW.w, height: WINDOW.h } };
  return (
    <>
      {bubbleButton}
      {opened && (
        <div role="dialog" aria-label="Recipe chat" hidden={!open} className={open ? frame.className : "hidden"} style={open ? frame.style : undefined}>
          <ChatPanel recipe={recipe} factor={factor} units={units} onMinimize={() => setOpen(false)} titleBar={narrow ? {} : { ...drag.handlers, className: "cursor-move touch-none" }} />
        </div>
      )}
    </>
  );
}

type Problem = { text: string; retryOf: number | null };

function ChatPanel({ recipe, factor, units, onMinimize, titleBar }: { recipe: Recipe; factor: number; units: Units; onMinimize: () => void; titleBar: { onPointerDown?: (e: React.PointerEvent) => void; className?: string } }) {
  const [messages, setMessages] = useState<ChatMsg[] | null>(null);
  const [text, setText] = useState("");
  const [waiting, setWaiting] = useState<string | null>(null); // what the dots say while the AI works
  const [problem, setProblem] = useState<Problem | null>(null);
  const [ideas, setIdeas] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [declined, setDeclined] = useState<Set<number>>(new Set());
  const end = useRef<HTMLDivElement>(null);

  const read = async () => {
    try {
      const list = await loadChat(recipe.id);
      setMessages(list);
      return list;
    } catch (e) {
      setMessages((m) => m ?? []);
      setProblem({ text: chatErrorText(e), retryOf: null });
      return null;
    }
  };
  useEffect(() => {
    void read().then((list) => {
      // left with a question that never got an answer (a failed request, then a reload)
      const last = list?.at(-1);
      if (last?.role === "user") setProblem({ text: "This question didn't get an answer. Try again?", retryOf: last.id });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe.id]);
  useEffect(() => end.current?.scrollIntoView?.({ block: "end" }), [messages, waiting, problem]);

  const ask = async (body: { message: string } | { retryOf: number }) => {
    if (waiting) return;
    setProblem(null);
    setIdeas(false);
    if ("message" in body) {
      // shown right away; replaced by the saved one when the answer comes
      setMessages((m) => [...(m ?? []), { id: -1, role: "user", content: body.message, canSave: false, timestamp: new Date().toISOString() }]);
      setText("");
    }
    setWaiting("The assistant is typing");
    try {
      const r = await sendChat(recipe.id, { ...body, view: { factor, units } });
      setMessages((m) => [...(m ?? []).filter((x) => x.id !== -1 && x.id !== r.userMessage.id), r.userMessage, r.reply]);
    } catch (e) {
      const list = await read();
      const last = list?.at(-1);
      setProblem({ text: chatErrorText(e), retryOf: last?.role === "user" ? last.id : null });
    } finally {
      setWaiting(null);
    }
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const m = text.trim();
    if (m) void ask({ message: m });
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const saveAsRecipe = async (m: ChatMsg) => {
    setProblem(null);
    setWaiting("Writing the new recipe");
    try {
      const draft = await buildRecipe(recipe.id, m.id);
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        /* storage blocked: the editor opens empty */
      }
      window.location.hash = "#/recipes/new?draft=chat";
    } catch (e) {
      setProblem({ text: chatErrorText(e), retryOf: null });
    } finally {
      setWaiting(null);
    }
  };

  const clear = async () => {
    setConfirmClear(false);
    try {
      await clearChat(recipe.id);
      setMessages([]);
      setProblem(null);
      setDeclined(new Set());
    } catch (e) {
      setProblem({ text: chatErrorText(e), retryOf: null });
    }
  };

  const empty = !!messages && messages.length === 0;
  return (
    <>
      <header className={`flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 ${titleBar.className ?? ""}`} onPointerDown={titleBar.onPointerDown}>
        <MessageCircle className="size-5 shrink-0 text-action" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate font-semibold">{recipe.title}</h2>
        <button type="button" aria-label="Clear chat" title="Clear chat" className="rounded-lg p-1.5 text-subtle hover:bg-pressed hover:text-ink" onPointerDown={(e) => e.stopPropagation()} onClick={() => setConfirmClear(true)}>
          <Trash2 className="size-4" aria-hidden />
        </button>
        <button type="button" aria-label="Minimize" title="Minimize" className="rounded-lg p-1.5 text-subtle hover:bg-pressed hover:text-ink" onPointerDown={(e) => e.stopPropagation()} onClick={onMinimize}>
          <Minus className="size-4" aria-hidden />
        </button>
      </header>

      {confirmClear && (
        <div className="flex shrink-0 items-center gap-2 border-b border-line bg-page px-4 py-2 text-sm">
          <span className="flex-1">Clear this chat? This can't be undone.</span>
          <button type="button" className="rounded-lg bg-action px-3 py-1 font-semibold text-white" onClick={() => void clear()}>
            Clear
          </button>
          <button type="button" className="rounded-lg px-3 py-1 font-semibold text-subtle hover:bg-pressed" onClick={() => setConfirmClear(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
        {empty && !waiting && <p className="text-subtle">Ask anything about making this recipe: swaps, healthier versions, timing, servings.</p>}
        {messages?.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : ""}>
            <div className={m.role === "user" ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-action px-3 py-2 text-white" : "max-w-[95%] rounded-2xl rounded-bl-sm bg-page px-3 py-2"}>
              {m.role === "user" ? m.content : <ChatText text={m.content} />}
            </div>
            {m.role === "assistant" && m.canSave && !declined.has(m.id) && (
              <div className="mt-2 rounded-xl border border-line px-3 py-2">
                <p className="font-semibold">Save as new recipe?</p>
                <p className="text-subtle">Makes a separate recipe with these changes. This one stays as it is.</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" disabled={!!waiting} className="rounded-lg bg-action px-3 py-1 font-semibold text-white disabled:opacity-50" onClick={() => void saveAsRecipe(m)}>
                    Yes, save it
                  </button>
                  <button type="button" className="rounded-lg px-3 py-1 font-semibold text-subtle hover:bg-pressed" onClick={() => setDeclined((d) => new Set(d).add(m.id))}>
                    No, keep chatting
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        {waiting && (
          <div role="status" aria-label={waiting} className="flex w-fit items-center gap-2 rounded-2xl rounded-bl-sm bg-page px-3 py-2 text-subtle">
            {waiting !== "The assistant is typing" && <span>{waiting}…</span>}
            <span className="flex gap-1" aria-hidden>
              {[0, 150, 300].map((d) => (
                <span key={d} className="size-2 animate-bounce rounded-full bg-subtle" style={{ animationDelay: `${d}ms` }} />
              ))}
            </span>
          </div>
        )}
        {problem && (
          <div role="alert" className="rounded-xl border border-line bg-page px-3 py-2">
            <p>{problem.text}</p>
            {problem.retryOf !== null && (
              <button type="button" className="mt-2 rounded-lg bg-action px-3 py-1 font-semibold text-white" onClick={() => void ask({ retryOf: problem.retryOf! })}>
                Try again
              </button>
            )}
          </div>
        )}
        <div ref={end} />
      </div>

      {(empty || ideas) && !waiting && (
        <div className="flex shrink-0 flex-wrap gap-2 px-4 pb-2">
          {CHAT_IDEAS.map((idea) => (
            <button key={idea} type="button" className="rounded-full border border-line px-3 py-1 text-sm hover:bg-pressed" onClick={() => void ask({ message: idea })}>
              {idea}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={submit} className="flex shrink-0 items-end gap-2 border-t border-line px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {!empty && (
          <button type="button" aria-label="Ideas" title="Ideas" aria-pressed={ideas} className="rounded-lg p-2 text-subtle hover:bg-pressed hover:text-ink" onClick={() => setIdeas((v) => !v)}>
            <Lightbulb className="size-5" aria-hidden />
          </button>
        )}
        <textarea
          aria-label="Message"
          rows={1}
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Ask about this recipe…"
          className="max-h-28 min-h-10 flex-1 resize-none rounded-lg border border-line bg-page px-3 py-2 text-sm outline-none focus:border-action focus:ring-2 focus:ring-action/15"
        />
        <button type="submit" aria-label="Send" disabled={!!waiting || !text.trim()} className="rounded-lg bg-action p-2.5 text-white disabled:opacity-50">
          <Send className="size-4" aria-hidden />
        </button>
      </form>
    </>
  );
}
