import { useEffect, useState } from "react";
import { api, ApiError, getToken } from "./api";

// Is AI set up (and can it read photos)? Asked once per page load; AI buttons only show when it is.
export interface AiStatus {
  ready: boolean;
  photos: boolean;
  enhance: boolean; // AI Enhance is on (and AI is ready)
}
let cached: Promise<AiStatus> | null = null;
export function useAiStatus(): AiStatus {
  const [s, setS] = useState<AiStatus>({ ready: false, photos: false, enhance: false });
  useEffect(() => {
    cached ??= api<AiStatus>("GET", "/api/ai/status").catch(() => {
      cached = null;
      return { ready: false, photos: false, enhance: false };
    });
    void cached.then(setS);
  }, []);
  return s;
}
// After AI settings change
export const forgetAiStatus = () => {
  cached = null;
};
// A switch on Settings › AI changed (AI, AI Enhance)
if (typeof window !== "undefined") window.addEventListener("features-changed", forgetAiStatus);

// Several photos in one request (field "photo")
export async function uploadFiles<T>(path: string, files: File[]): Promise<T> {
  const form = new FormData();
  for (const f of files) form.append("photo", f);
  const token = getToken();
  const res = await fetch(path, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Upload failed (${res.status})`);
  return data as T;
}

// One file in a request (field "file")
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  } catch {
    throw new ApiError(0, "Couldn't reach RecipeHub. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Upload failed (${res.status})`);
  return data as T;
}
