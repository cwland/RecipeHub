import { afterEach, describe, expect, it, vi } from "vitest";
import { relay, takeSentPage } from "./receiveRelay";

// /receive.html: takes the page from the tab that opened it, keeps it for the app, then opens
// #/recipes/receive (the app can't be handed it directly: its security headers cut the link)
const URL_ = "https://kitchen.example.com/recipes/13647-pork";
const html = "<!DOCTYPE html><html><head><title>Pork</title></head><body>2 lb pork</body></html>";

function fakeWindow(opener: object | null) {
  const listeners: ((e: MessageEvent) => void)[] = [];
  const replace = vi.fn();
  const win = { opener, addEventListener: (_: string, f: (e: MessageEvent) => void) => listeners.push(f), location: { replace } } as unknown as Window;
  const send = (data: unknown, source: object | null = opener) => {
    const reply = vi.fn();
    listeners.forEach((f) => f({ data, source: source && Object.assign(source, { postMessage: reply }), origin: "https://kitchen.example.com" } as unknown as MessageEvent));
    return reply;
  };
  return { win, send, replace };
}

describe("the relay page", () => {
  afterEach(() => localStorage.clear());

  it("keeps the page from the tab that opened it, says it got it, and opens the app", () => {
    const { win, send, replace } = fakeWindow({});
    relay(win);
    const reply = send({ recipehub: "page", url: URL_, html });
    expect(reply).toHaveBeenCalledWith("recipehub:got", "*");
    expect(replace).toHaveBeenCalledWith("/#/recipes/receive");
    expect(takeSentPage()).toEqual({ url: URL_, html });
    expect(takeSentPage()).toBeNull(); // taken once
  });

  it("ignores anything else: another window, a different message, a link that isn't a web page", () => {
    const { win, send, replace } = fakeWindow({});
    relay(win);
    send({ recipehub: "page", url: URL_, html }, {});
    send("hello");
    send({ recipehub: "page", url: "javascript:alert(1)", html });
    send({ recipehub: "page", url: URL_, html: 42 });
    expect(replace).not.toHaveBeenCalled();
    expect(takeSentPage()).toBeNull();
  });

  it("a page too big to keep: the app says so", () => {
    const { win, send, replace } = fakeWindow({});
    relay(win);
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    send({ recipehub: "page", url: URL_, html });
    expect(replace).toHaveBeenCalledWith("/#/recipes/receive?too-big=1");
    set.mockRestore();
  });

  it("an old page left behind isn't offered (only one sent in the last 10 minutes)", () => {
    localStorage.setItem("recipehub-sent-page", JSON.stringify({ url: URL_, html, at: Date.now() - 11 * 60_000 }));
    expect(takeSentPage()).toBeNull();
  });
});
