// Small fetch wrapper. The login token lives in localStorage on this device.

const TOKEN_KEY = "recipehub.token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: stays logged in only for this page load */
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: { path: string; message: string }[]) {
    super(message);
  }
}

// This browser's own random id, kept in localStorage: signing in again here reuses the same row in
// Settings › Security › Signed-in devices instead of adding one per sign-in
let memoryDeviceId: string | null = null;
function deviceId() {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
  try {
    let id = localStorage.getItem("recipehub-device-id");
    if (!id) {
      id = make();
      localStorage.setItem("recipehub-device-id", id);
    }
    return id;
  } catch {
    return (memoryDeviceId ??= make());
  }
}

export async function api<T = unknown>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const headers: Record<string, string> = { "x-device-id": deviceId(), ...extraHeaders };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    // offline, server restarting, Wi-Fi dropped: the browser only says "Failed to fetch"
    throw new ApiError(0, "Couldn't reach RecipeHub. Check your connection and try again.");
  }

  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    setToken(null);
    window.dispatchEvent(new Event("recipehub:logout"));
  }
  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.details);
  return data as T;
}

// POST and follow along: the server sends one JSON object per line as it works
// ({"type":"step","text":…} …, then {"type":"result", [key]: …} or {"type":"error",…}). A plain JSON reply works too.
// body: sent as JSON when given
export async function postWithProgress<T>(path: string, key: string, onStep: (text: string) => void, signal?: AbortSignal, body?: unknown): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", signal, ...(body !== undefined && { body: JSON.stringify(body) }), headers: { accept: "application/x-ndjson, application/json", "x-device-id": deviceId(), ...(body !== undefined && { "content-type": "application/json" }), ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  } catch {
    throw new ApiError(0, "Couldn't reach RecipeHub. Check your connection and try again.");
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  }
  if (!(res.headers.get("content-type") ?? "").includes("ndjson")) return (await res.json()) as T;
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.type === "step") onStep(o.text);
      else if (o.type === "result") return o[key] as T;
      else if (o.type === "error") throw new ApiError(o.status ?? 500, o.error ?? "Something went wrong. Try again.");
    }
    if (done) throw new ApiError(0, "The connection closed before it finished. Try again.");
  }
}

// ---------- shapes returned by the API ----------

// A file from the API, with the login header: its name, type and contents
export async function fetchFile(path: string) {
  const token = getToken();
  const res = await fetch(path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data.error ?? `Download failed (${res.status})`);
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "download";
  const type = (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0];
  return { name, type, blob: await res.blob() };
}

// Download a file from the API (needs the login header, so a plain link won't do)
export async function downloadFile(path: string) {
  const { name, blob } = await fetchFile(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: string;
}

// Upload one photo (multipart). Returns the new picture's address.
export async function uploadPhoto(path: string, file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const token = getToken();
  const res = await fetch(path, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Upload failed (${res.status})`);
  return data.imageUrl as string;
}
