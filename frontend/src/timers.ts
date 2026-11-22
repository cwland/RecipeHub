import { useEffect, useState } from "react";

// Kitchen timers. They live in this browser (localStorage, so a reload or leaving Cook Mode
// doesn't lose them) and ring here when they're done: a chime, a buzz on phones, and a
// notification when you've allowed them.

export interface Timer {
  id: string;
  label: string; // "Simmer · 15 min"
  recipeId: number | null;
  recipeTitle: string | null;
  seconds: number; // as set
  endsAt: number | null; // running: when it ends (ms)
  left: number | null; // paused: seconds left
  rang: boolean; // finished and rang (until dismissed)
}

const KEY = "recipehub-timers";
let timers: Timer[] = load();
const listeners = new Set<() => void>();

function load(): Timer[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(timers));
  } catch {
    /* private window: timers last for this visit */
  }
  listeners.forEach((l) => l());
}

export const secondsLeft = (t: Timer, now = Date.now()) => (t.endsAt ? Math.max(0, Math.ceil((t.endsAt - now) / 1000)) : t.left ?? 0);

// ---------- sound ----------

let audio: AudioContext | null = null;
// Browsers only allow sound after a tap: starting a timer is one, so the sound is unlocked then
function unlockSound() {
  try {
    audio ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    audio = null;
  }
}
function chime() {
  if (!audio) return;
  const t0 = audio.currentTime;
  [0, 0.25, 0.5, 1.2, 1.45, 1.7].forEach((offset, i) => {
    const osc = audio!.createOscillator();
    const gain = audio!.createGain();
    osc.type = "sine";
    osc.frequency.value = i % 3 === 2 ? 1318 : 880;
    gain.gain.setValueAtTime(0.0001, t0 + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, t0 + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.22);
    osc.connect(gain).connect(audio!.destination);
    osc.start(t0 + offset);
    osc.stop(t0 + offset + 0.25);
  });
}

// ---------- the clock ----------

let lastRing = 0;
const baseTitle = () => document.title.replace(/^⏰ .*? · /, "");
setInterval(() => {
  if (typeof document === "undefined") return; // the page is gone (tests tearing down)
  const now = Date.now();
  let changed = false;
  for (const t of timers) {
    if (t.endsAt && t.endsAt <= now && !t.rang) {
      t.rang = true;
      changed = true;
      navigator.vibrate?.([500, 200, 500, 200, 500]);
      try {
        if ("Notification" in window && Notification.permission === "granted") new Notification(`${t.label} is done`, { body: t.recipeTitle ?? "RecipeHub timer", tag: `recipehub-timer-${t.id}`, icon: "/favicon.svg" });
      } catch {
        /* some phones only allow notifications from an installed app */
      }
    }
  }
  const ringing = timers.filter((t) => t.rang);
  // Keep chiming every few seconds until it's dismissed
  if (ringing.length && now - lastRing > 4000) {
    lastRing = now;
    chime();
  }
  document.title = ringing.length ? `⏰ ${ringing[0].label} · ${baseTitle()}` : baseTitle();
  if (changed) save();
  else if (timers.some((t) => t.endsAt)) listeners.forEach((l) => l()); // tick
}, 500);

// Timers changed in another tab
window.addEventListener("storage", (e) => {
  if (e.key === KEY) {
    timers = load();
    listeners.forEach((l) => l());
  }
});

// ---------- actions ----------

export function startTimer(label: string, seconds: number, recipe?: { id: number; title: string }) {
  unlockSound();
  // Ask once for notifications, so a timer can tell you when the app is in the background
  if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission().catch(() => {});
  const t: Timer = { id: Math.random().toString(36).slice(2, 10), label, recipeId: recipe?.id ?? null, recipeTitle: recipe?.title ?? null, seconds, endsAt: Date.now() + seconds * 1000, left: null, rang: false };
  timers = [...timers, t];
  save();
  return t;
}

export function pauseTimer(id: string) {
  timers = timers.map((t) => (t.id === id && t.endsAt ? { ...t, left: secondsLeft(t), endsAt: null } : t));
  save();
}
export function resumeTimer(id: string) {
  unlockSound();
  timers = timers.map((t) => (t.id === id && t.left !== null && !t.endsAt ? { ...t, endsAt: Date.now() + t.left * 1000, left: null } : t));
  save();
}
export function addTime(id: string, seconds: number) {
  unlockSound();
  timers = timers.map((t) => {
    if (t.id !== id) return t;
    if (t.rang) return { ...t, rang: false, endsAt: Date.now() + seconds * 1000, left: null };
    return t.endsAt ? { ...t, endsAt: t.endsAt + seconds * 1000 } : { ...t, left: (t.left ?? 0) + seconds };
  });
  save();
}
export function dismissTimer(id: string) {
  timers = timers.filter((t) => t.id !== id);
  save();
}

export function useTimers() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return timers;
}

// 754 -> "12:34", 3725 -> "1:02:05"
export function clock(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
