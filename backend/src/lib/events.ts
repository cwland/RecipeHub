import type { FastifyInstance } from "fastify";

// Live updates for the household: when someone changes a grocery list, the pantry or the meal plan,
// every open copy of the app hears about it and reloads that part. Server-sent events over one
// long request (GET /api/events); the app sends its login header with fetch, so no token is ever
// in a URL. Works through reverse proxies (buffering is turned off for this response).

export type Topic = "grocery" | "pantry" | "plan" | "recipes" | "inbox";
export interface LiveEvent {
  topic: Topic;
  id?: number; // which list, if it's about one
  by?: number | null; // who did it (the app skips its own changes)
}

type Listener = (e: LiveEvent) => void;

export class EventBus {
  private listeners = new Set<Listener>();
  emit(e: LiveEvent) {
    for (const l of this.listeners) l(e);
  }
  on(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }
  get size() {
    return this.listeners.size;
  }
}

export default async function eventRoutes(app: FastifyInstance) {
  app.get("/api/events", async (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no", // nginx: send each event right away
    });
    res.write(`retry: 3000\n\n`);
    const send = (e: LiveEvent) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    const off = app.events.on(send);
    // a comment every 25 s keeps proxies from closing a quiet connection
    const ping = setInterval(() => res.write(`: ping\n\n`), 25000);
    const close = () => {
      clearInterval(ping);
      off();
    };
    req.raw.on("close", close);
    res.on("error", close);
  });
}
