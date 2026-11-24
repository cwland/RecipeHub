import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { clampPos, useDraggable } from "./useDraggable";
import ChatText from "./ChatText";
import { chatErrorText } from "./chatApi";
import { ApiError } from "../api";

describe("clampPos", () => {
  it("can keep clear of a top bar and a footer (Cook mode)", () => {
    const keepOut = { top: 64, bottom: 96 };
    expect(clampPos({ x: 10, y: 380 }, { w: 44, h: 44 }, { w: 400, h: 390 }, keepOut)).toEqual({ x: 10, y: 250 });
    expect(clampPos({ x: 10, y: 0 }, { w: 44, h: 44 }, { w: 400, h: 390 }, keepOut)).toEqual({ x: 10, y: 64 });
  });
  it("keeps the bubble inside the screen", () => {
    expect(clampPos({ x: -50, y: 900 }, { w: 56, h: 56 }, { w: 400, h: 800 })).toEqual({ x: 0, y: 744 });
    expect(clampPos({ x: 100, y: 100 }, { w: 56, h: 56 }, { w: 400, h: 800 })).toEqual({ x: 100, y: 100 });
  });
});

function Bubble({ onClick }: { onClick: () => void }) {
  const { pos, handlers, wasDrag } = useDraggable("test.pos", { w: 56, h: 56 }, () => ({ x: 10, y: 10 }));
  return (
    <button data-testid="b" style={{ left: pos.x, top: pos.y }} {...handlers} onClick={() => !wasDrag() && onClick()}>
      chat
    </button>
  );
}

describe("useDraggable", () => {
  beforeEach(() => localStorage.clear());
  const drag = (el: HTMLElement, dx: number) => {
    fireEvent.pointerDown(el, { clientX: 20, clientY: 20, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 20 + dx, clientY: 20, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 20 + dx, clientY: 20, pointerId: 1 });
    fireEvent.click(el);
  };
  it("a small wiggle is still a tap; a real move is a drag, not a tap", () => {
    let taps = 0;
    render(<Bubble onClick={() => taps++} />);
    drag(screen.getByTestId("b"), 3);
    expect(taps).toBe(1);
    drag(screen.getByTestId("b"), 40);
    expect(taps).toBe(1);
    expect(screen.getByTestId("b").style.left).toBe("50px");
  });
  it("remembers where it was put", () => {
    const { unmount } = render(<Bubble onClick={() => {}} />);
    drag(screen.getByTestId("b"), 40);
    unmount();
    render(<Bubble onClick={() => {}} />);
    expect(screen.getByTestId("b").style.left).toBe("50px");
  });
  it("a saved spot that's now off screen comes back on", () => {
    localStorage.setItem("test.pos", JSON.stringify({ x: 5000, y: 5000 }));
    render(<Bubble onClick={() => {}} />);
    expect(parseInt(screen.getByTestId("b").style.left)).toBe(window.innerWidth - 56);
  });
  it("moves back on screen when the window gets smaller", () => {
    render(<Bubble onClick={() => {}} />);
    drag(screen.getByTestId("b"), 500);
    act(() => {
      Object.defineProperty(window, "innerWidth", { value: 300, configurable: true });
      window.dispatchEvent(new Event("resize"));
    });
    expect(parseInt(screen.getByTestId("b").style.left)).toBe(244);
  });
});

describe("ChatText", () => {
  it("shows bullets, numbers and bold, and never runs HTML", () => {
    const { container } = render(<ChatText text={"Try this:\n- **Greek yogurt** for sour cream\n- olive oil\n\n1. Brown it\n2. Simmer\n<script>alert(1)</script>"} />);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("strong")?.textContent).toBe("Greek yogurt");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  });
});

describe("chatErrorText", () => {
  it("puts each problem plainly", () => {
    expect(chatErrorText(new ApiError(504, "x", undefined, "timeout"))).toBe("The assistant didn't answer in time. Try again?");
    expect(chatErrorText(new ApiError(502, "x", undefined, "garbled"))).toBe("The assistant's answer came back garbled. Try again?");
    expect(chatErrorText(new ApiError(409, "x", undefined, "notSetUp"))).toBe("Recipe chat needs AI set up in Settings › AI.");
    expect(chatErrorText(new ApiError(0, "x"))).toBe("Couldn't reach RecipeHub. Check your connection and try again.");
    expect(chatErrorText(new ApiError(504, "Gateway Timeout"))).toBe("The assistant didn't answer in time. Try again?"); // a proxy's own timeout
    expect(chatErrorText(new ApiError(502, "None of your AI services answered.", undefined, "failed"))).toBe("The assistant couldn't answer (None of your AI services answered.). Try again?");
  });
});
