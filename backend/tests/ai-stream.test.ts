import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";

// AI waits are shrunk 100x here: waiting for the first word (3 minutes) is 1.8 s, and going quiet
// (60 s) is 0.6 s.
let t: TestApp;
beforeAll(async () => (t = await setupTestApp({ aiTimeScale: 0.01 })));
afterAll(async () => t.close());
beforeEach(async () => {
  await t.reset();
  await t.login();
  t.ai.calls.length = 0;
});

const answer = {
  steps: ["Cook the chicken until it reaches 165°F."],
  stepChanges: ["Added the safe temperature."],
  categories: ["Dinner"],
  tags: ["spicy"],
};
// An OpenAI-style streamed reply: some thinking, then the answer in pieces
const sse = (text: string, opts: { thinking?: string[]; pieces?: number } = {}) => {
  const n = opts.pieces ?? 4;
  const size = Math.ceil(text.length / n);
  return [
    ...(opts.thinking ?? []).map((r) => `data: ${JSON.stringify({ choices: [{ delta: { reasoning: r } }] })}`),
    ...Array.from({ length: n }, (_, i) => `data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i * size, (i + 1) * size) } }] })}`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}`,
    "data: [DONE]",
  ];
};
const twoServices = () =>
  t.api("PUT", "/api/settings/ai", {
    maxPerRun: 50,
    services: [
      { name: "Home AI", provider: "local", baseUrl: "http://10.0.0.5:11434/v1", model: "qwen3-vl:32b" },
      { name: "Claude", provider: "openai", model: "big", apiKey: "k" },
    ],
  });
const chili = async () => (await t.api("POST", "/api/recipes", { title: "Chili", ingredients: "1 lb chicken", steps: ["Cook the chicken."], categories: ["Dinner"], tags: ["spicy"] })).body;
const stream = async (id: number, query = "") => {
  const res = await t.app.inject({ method: "POST", url: `/api/recipes/${id}/enhance${query}`, headers: { authorization: `Bearer ${t.getToken()}`, accept: "application/x-ndjson" } });
  return res.body.trim().split("\n").map((l) => JSON.parse(l));
};
const said = (lines: any[]) => lines.filter((l) => l.type === "step" || l.type === "status").map((l) => l.text as string);

describe("getting the AI's answer as it's written", () => {
  it("asks for a streamed answer and shows thinking, then writing with a word count", async () => {
    await twoServices();
    const r = await chili();
    t.ai.respond = () => ({ status: 200, sse: sse(JSON.stringify(answer), { thinking: ["The user wants", " a check..."] }) });
    const lines = await stream(r.id);
    expect(t.ai.calls[0].body.stream).toBe(true);
    const texts = said(lines);
    expect(texts).toContain("Home AI is thinking…");
    expect(texts.some((s) => /^Home AI is writing… \d+ words?$/.test(s))).toBe(true);
    expect(lines.filter((l) => l.type === "status").every((l) => l.text.startsWith("Home AI"))).toBe(true);
    expect(lines.at(-1)).toMatchObject({ type: "result", enhancement: { steps: { suggested: answer.steps, changed: true } } });
  });

  it("a slow model that keeps sending is not cut off, even past the first wait", async () => {
    await twoServices();
    const r = await chili();
    // 10 pieces, 300 ms apart: 3 s in all (longer than the 1.8 s first wait), never quiet for 0.6 s
    t.ai.respond = () => ({ status: 200, sse: sse(JSON.stringify(answer), { pieces: 10 }), gapMs: 300 });
    const lines = await stream(r.id);
    expect(lines.at(-1).type).toBe("result");
    expect(t.ai.calls.filter((c) => String(c.body.messages[0].content).startsWith("You check home recipes"))).toHaveLength(1); // one check (and its nutrition request)
  });

  it("a model that goes quiet is caught, said plainly, and the next service is asked", async () => {
    await twoServices();
    const r = await chili();
    t.ai.respond = (url) =>
      url.includes("10.0.0.5") ? { status: 200, sse: sse(JSON.stringify(answer), { pieces: 4 }).slice(0, 2), hang: true } : { status: 200, json: { choices: [{ message: { content: JSON.stringify(answer) } }] } };
    const lines = await stream(r.id);
    const texts = said(lines);
    expect(texts.some((s) => /^Home AI didn't answer \(it stopped sending for 1 seconds?/.test(s) || /^Home AI didn't answer \(it stopped sending/.test(s))).toBe(true);
    expect(texts).toContain("Answer received from Claude");
    expect(lines.at(-1).type).toBe("result");
  });

  it("a model that never starts is caught after the first wait", async () => {
    await twoServices();
    const r = await chili();
    t.ai.respond = (url) => (url.includes("10.0.0.5") ? { status: 200, sse: [], hang: true } : { status: 200, json: { choices: [{ message: { content: JSON.stringify(answer) } }] } });
    const texts = said(await stream(r.id));
    expect(texts.some((s) => /^Home AI didn't answer \(it didn't start answering within 2 seconds/.test(s))).toBe(true);
    expect(texts).toContain("Answer received from Claude");
  });
});

describe("servers that don't send pieces", () => {
  it("a server that ignores streaming and sends the whole answer at once still works", async () => {
    await twoServices();
    const r = await chili();
    t.ai.respond = () => ({ status: 200, sse: [JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer) }, finish_reason: "stop" }] })] });
    const lines = await stream(r.id);
    expect(lines.at(-1)).toMatchObject({ type: "result", enhancement: { steps: { suggested: answer.steps } } });
  });
});

describe("skipping a slow AI service", () => {
  it("offers to skip a service when there's another to ask, and ?skip= leaves it out", async () => {
    await twoServices();
    const r = await chili();
    t.ai.respond = () => ({ status: 200, json: { choices: [{ message: { content: JSON.stringify(answer) } }] } });
    const first = await stream(r.id);
    const asking = first.find((l) => l.type === "step" && l.text === "Asking Home AI (qwen3-vl:32b)…");
    expect(asking.skip).toEqual({ id: expect.any(String), name: "Home AI" });
    expect(first.find((l) => l.type === "step" && /^Asking Claude/.test(l.text ?? ""))).toBeUndefined(); // Home AI answered
    const claudeAsking = await (async () => {
      t.ai.calls.length = 0;
      const lines = await stream(r.id, `?skip=${asking.skip.id}`);
      expect(lines.at(-1).type).toBe("result");
      return lines.find((l) => l.type === "step" && /^Asking /.test(l.text));
    })();
    expect(claudeAsking.text).toBe("Asking Claude (big)…");
    expect(claudeAsking.skip).toBeUndefined(); // nothing after Claude to skip to
    expect(t.ai.calls.every((c) => !c.url.includes("10.0.0.5"))).toBe(true);
  });

  it("skipping every service says there's no other to ask", async () => {
    await twoServices();
    const r = await chili();
    const id = (await stream(r.id)).find((l) => l.skip)?.skip.id;
    const services = (await t.api("GET", "/api/settings/ai")).body.settings.services.map((s: any) => s.id);
    const last = (await stream(r.id, `?skip=${services.join(",")}`)).at(-1);
    expect(id).toBeTruthy();
    expect(last).toMatchObject({ type: "error", status: 409 });
    expect(last.error).toMatch(/no other AI service/i);
  });

  it("stopping a request (the person skipped or closed the window) stops asking, without trying the next service", async () => {
    await twoServices();
    t.ai.respond = () => ({ status: 200, sse: [], hang: true });
    const stop = new AbortController();
    const asked = t.app.ai.ask("recipe", "You reply with JSON only.", "hi", { stream: true, signal: stop.signal });
    setTimeout(() => stop.abort(), 100);
    await expect(asked).rejects.toThrow(/stopped/i);
    expect(t.ai.calls).toHaveLength(1);
  });
});
