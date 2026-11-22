import { useEffect, useRef } from "react";
import { getToken } from "./api";

// Live updates from the server (GET /api/events, server-sent events). One connection for the whole
// app, opened with fetch so it can send the login header; it reconnects by itself.

export type Topic = "grocery" | "pantry" | "plan" | "recipes" | "inbox";
export interface LiveEvent {
  topic: Topic;
  id?: number;
  by?: number | null;
}

const listeners = new Set<(e: LiveEvent) => void>();
let running = false;

async function connect() {
  if (running) return;
  running = true;
  let wait = 1000;
  while (listeners.size) {
    const token = getToken();
    if (!token) break;
    const controller = new AbortController();
    try {
      const res = await fetch("/api/events", { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
      if (!res.ok || !res.body) throw new Error(String(res.status));
      wait = 1000;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done || !listeners.size) break;
        buf += decoder.decode(value, { stream: true });
        let at: number;
        while ((at = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, at);
          buf = buf.slice(at + 2);
          const data = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!data) continue;
          try {
            const e = JSON.parse(data.slice(6)) as LiveEvent;
            listeners.forEach((l) => l(e));
          } catch {
            /* not ours */
          }
        }
      }
      controller.abort();
    } catch {
      // server restarting, phone asleep, network gone: try again in a bit (up to 30 s apart)
    }
    if (!listeners.size) break;
    await new Promise((r) => setTimeout(r, wait));
    wait = Math.min(wait * 2, 30000);
  }
  running = false;
}

// Run `fn` when someone (in the household, on any device) changes this part
export function useLive(topics: Topic[], fn: (e: LiveEvent) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  const key = topics.join(",");
  useEffect(() => {
    const l = (e: LiveEvent) => key.split(",").includes(e.topic) && ref.current(e);
    listeners.add(l);
    void connect();
    // back from the background: whatever happened meanwhile
    const onVisible = () => document.visibilityState === "visible" && ref.current({ topic: key.split(",")[0] as Topic });
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      listeners.delete(l);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);
}
