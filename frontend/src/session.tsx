import { createContext, useContext } from "react";

export interface User {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  seenVersion?: string | null; // the version whose "What's new" was dismissed
  theme?: string | null; // Settings › Profile › Appearance (null: the default)
  colorMode?: string | null; // light, dark or system (null: system)
  role?: "owner" | "member"; // the owner runs the server (settings, keys, backups, members)
  remindAt?: string | null; // daily meal plan email time ("17:30"), null: off
  units?: "original" | "metric" | "us"; // how amounts show to start with (the setup wizard)
  keepAwake?: boolean; // Cook mode keeps the screen on (default on)
  ingredientOrder?: "entered" | "alpha"; // recipes show ingredients as entered (default) or A to Z
  setupDone?: boolean; // been through the setup wizard (false: it shows on sign-in)
}

export interface Session {
  user: User;
  setUser: (u: User) => void;
  // Store a fresh login token (after a password change, the old one stops working)
  replaceToken: (token: string) => void;
  signOut: () => void;
  signOutEverywhere: () => Promise<void>;
}

export const SessionContext = createContext<Session | null>(null);

export function useSession() {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside SessionContext");
  return s;
}

// "Alex Cook" -> "AC"; a single word like "alex" -> "AL"
export const initialsOf = (u: User) => {
  const words = (u.displayName?.trim() || u.username).split(/\s+/).filter(Boolean);
  const text = words.length > 1 ? words[0][0] + words[1][0] : words[0].slice(0, 2);
  return text.toUpperCase();
};
