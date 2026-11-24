import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

// Something you can drag around the screen (the recipe chat bubble and its window). It never goes
// off screen, a move of 5px or less still counts as a tap, and where it was left is remembered in
// this browser under `key`.
export interface Pos {
  x: number;
  y: number;
}
export interface Size {
  w: number;
  h: number;
}

const THRESHOLD = 5;

export function clampPos(p: Pos, size: Size, viewport: Size): Pos {
  return {
    x: Math.max(0, Math.min(p.x, viewport.w - size.w)),
    y: Math.max(0, Math.min(p.y, viewport.h - size.h)),
  };
}

const viewport = (): Size => ({ w: window.innerWidth, h: window.innerHeight });

function load(key: string): Pos | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v && typeof v.x === "number" && typeof v.y === "number" ? { x: v.x, y: v.y } : null;
  } catch {
    return null;
  }
}
function keep(key: string, p: Pos) {
  try {
    localStorage.setItem(key, JSON.stringify(p));
  } catch {
    /* private window: just this visit */
  }
}

export function useDraggable(key: string, size: Size, start: () => Pos) {
  const [raw, setRaw] = useState<Pos>(() => load(key) ?? start());
  const [view, setView] = useState<Size>(viewport);
  const dragged = useRef(false);
  const pos = clampPos(raw, size, view);
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    const again = () => setView(viewport());
    window.addEventListener("resize", again);
    window.addEventListener("orientationchange", again);
    return () => {
      window.removeEventListener("resize", again);
      window.removeEventListener("orientationchange", again);
    };
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (e.button !== undefined && e.button > 0) return;
      dragged.current = false;
      const from = { x: e.clientX, y: e.clientY };
      const origin = posRef.current;
      let last = origin;
      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - from.x;
        const dy = ev.clientY - from.y;
        if (!dragged.current && Math.abs(dx) <= THRESHOLD && Math.abs(dy) <= THRESHOLD) return;
        dragged.current = true;
        last = clampPos({ x: origin.x + dx, y: origin.y + dy }, size, viewport());
        setRaw(last);
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        if (dragged.current) keep(key, last);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    },
    [key, size]
  );

  // A click right after a drag is the end of the drag, not a tap
  const wasDrag = useCallback(() => {
    const d = dragged.current;
    dragged.current = false;
    return d;
  }, []);

  return { pos, handlers: { onPointerDown }, wasDrag };
}
