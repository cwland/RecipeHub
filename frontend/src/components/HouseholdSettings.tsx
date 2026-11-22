import { useEffect, useState, type FormEvent } from "react";
import { EmailNeeded, useEmailReady } from "../email";
import { ApiError, api } from "../api";
import { initialsOf, useSession } from "../session";
import { Card, field, primaryButton } from "./settingsUi";

interface Member {
  id: number;
  username: string;
  displayName: string | null;
  email: string | null;
  role: "owner" | "member";
  createdAt: string;
  lastSeenAt: string | null;
  invited: boolean;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "never");

// Settings › Household: everyone who signs in here. They share recipes, the meal plan, grocery lists
// and the pantry; favorites, ratings, notes and sign-in are each person's own.
export default function HouseholdSettings() {
  const { user } = useSession();
  const owner = user.role !== "member";
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = () => void api<Member[]>("GET", "/api/household/members").then(setMembers).catch((e) => setError((e as Error).message));
  useEffect(load, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setError("");
    setNotice("");
    try {
      await fn();
      if (ok) setNotice(ok);
    } catch (e) {
      setError((e as Error).message);
    }
    load();
  };

  return (
    <>
      <Card title="Household" description="Everyone here shares the recipes, meal plan, grocery lists and pantry. Favorites, ratings, private notes and sign-in are each person's own.">
        {notice && <p role="status" className="mb-3 rounded-lg bg-success-subtle px-3 py-2 text-success">{notice}</p>}
        {error && <p role="alert" className="mb-3 rounded-lg bg-error-subtle px-3 py-2 text-error">{error}</p>}
        <ul className="divide-y divide-line">
          {members?.map((m) => (
            <MemberRow key={m.id} m={m} me={m.id === user.id} canManage={owner} run={run} />
          ))}
        </ul>
        {!owner && <p className="mt-3 text-sm text-subtle">Only the household owner can add or remove people.</p>}
      </Card>
      {owner && <AddMember onAdded={(m, invited) => run(async () => {}, invited ? `Invite sent to ${m.email}. The link works for 7 days.` : `${m.displayName || m.username} can sign in now.`)} />}
    </>
  );
}

function MemberRow({ m, me, canManage, run }: { m: Member; me: boolean; canManage: boolean; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const name = m.displayName || m.username;
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-sm font-bold text-action">{initialsOf({ id: m.id, username: m.username, displayName: m.displayName, email: m.email })}</span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 font-semibold">
            {name}
            {me && <span className="text-sm font-normal text-muted">(you)</span>}
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${m.role === "owner" ? "bg-action text-white" : "bg-page text-subtle"}`}>{m.role === "owner" ? "Owner" : "Member"}</span>
            {m.invited && <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-semibold text-ink">Invited</span>}
          </span>
          <span className="block truncate text-sm text-subtle">
            {m.username}
            {m.email && ` · ${m.email}`} · last signed in {when(m.lastSeenAt)}
          </span>
        </span>
        {canManage && !me && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-pressed">
            {open ? "Done" : "Manage"}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 flex flex-col gap-3 rounded-xl bg-page p-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => run(() => api("PATCH", `/api/household/members/${m.id}`, { role: m.role === "owner" ? "member" : "owner" }))} className="rounded-lg border border-line bg-container px-3 py-1.5 text-sm font-semibold">
              {m.role === "owner" ? "Make a member" : "Make an owner"}
            </button>
            {m.email && (
              <button type="button" onClick={() => run(() => api("POST", `/api/household/members/${m.id}/invite`), `Sent ${name} a link to choose a password.`)} className="rounded-lg border border-line bg-container px-3 py-1.5 text-sm font-semibold">
                {m.invited ? "Send the invite again" : "Email a link to choose a new password"}
              </button>
            )}
            <button
              type="button"
              onClick={() => (confirmRemove ? run(() => api("DELETE", `/api/household/members/${m.id}`)) : setConfirmRemove(true))}
              className={`ml-auto rounded-lg px-3 py-1.5 text-sm font-semibold ${confirmRemove ? "bg-error text-white" : "text-error hover:bg-error-subtle"}`}
            >
              {confirmRemove ? `Remove ${name}?` : "Remove"}
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => api("PATCH", `/api/household/members/${m.id}`, { password }), `${name}'s password was changed, and they were signed out everywhere.`).then(() => setPassword(""));
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <label className="min-w-48 flex-1 text-sm font-medium text-subtle">
              Set a new password for {name}
              <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} placeholder="At least 8 characters" />
            </label>
            <button type="submit" disabled={password.length < 8} className="rounded-lg bg-primary px-4 py-2 font-semibold text-white disabled:opacity-50">
              Set password
            </button>
          </form>
          <p className="text-xs text-muted">Removing someone deletes their favorites, ratings and private notes. Recipes they added stay.</p>
        </div>
      )}
    </li>
  );
}

function AddMember({ onAdded }: { onAdded: (m: Member, invited: boolean) => void }) {
  const [how, setHow] = useState<"password" | "invite">("password");
  const [form, setForm] = useState({ username: "", displayName: "", email: "", password: "", owner: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string | boolean) => setForm({ ...form, [k]: v });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setError("");
    try {
      const m = await api<Member>("POST", "/api/household/members", {
        username: form.username,
        displayName: form.displayName || null,
        email: form.email || null,
        ...(how === "password" ? { password: form.password } : { invite: true }),
        role: form.owner ? "owner" : "member",
      });
      setForm({ username: "", displayName: "", email: "", password: "", owner: false });
      onAdded(m, how === "invite");
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(Object.fromEntries(err.details.map((d) => [d.path || "form", d.message])));
      else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const emailReady = useEmailReady();
  const noEmail = how === "invite" && emailReady === false;
  const tab = (on: boolean) => `rounded-md px-3 py-1.5 text-sm font-semibold ${on ? "bg-container shadow-sm" : "text-subtle"}`;
  return (
    <Card title="Add someone" description="Give them a password to sign in with (they can change it in Settings › Security), or email them an invite to choose their own.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div role="radiogroup" aria-label="How they get in" className="inline-flex self-start rounded-lg bg-page p-1">
          <button type="button" role="radio" aria-checked={how === "password"} onClick={() => setHow("password")} className={tab(how === "password")}>
            Set a password
          </button>
          <button type="button" role="radio" aria-checked={how === "invite"} onClick={() => setHow("invite")} className={tab(how === "invite")}>
            Email an invite
          </button>
        </div>
        {noEmail && <EmailNeeded what="invites can't be sent (you can still set a password for them)" />}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium text-subtle">
            Username (for signing in)
            <input aria-label="Username" value={form.username} onChange={(e) => set("username", e.target.value)} className={field} autoCapitalize="none" />
            {errors.username && <span className="mt-1 block text-error">{errors.username}</span>}
          </label>
          <label className="text-sm font-medium text-subtle">
            Name (optional)
            <input aria-label="Name" value={form.displayName} onChange={(e) => set("displayName", e.target.value)} className={field} />
          </label>
          <label className="text-sm font-medium text-subtle">
            Email {how === "invite" ? "" : "(optional, for password resets)"}
            <input aria-label="Email" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className={field} />
            {errors.email && <span className="mt-1 block text-error">{errors.email}</span>}
          </label>
          {how === "password" && (
            <label className="text-sm font-medium text-subtle">
              Password
              <input aria-label="Password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => set("password", e.target.value)} className={field} placeholder="At least 8 characters" />
              {errors.password && <span className="mt-1 block text-error">{errors.password}</span>}
            </label>
          )}
        </div>
        <label className="flex items-start gap-3">
          <input type="checkbox" checked={form.owner} onChange={(e) => set("owner", e.target.checked)} className="mt-1 size-4 accent-action" />
          <span>
            <span className="font-semibold">Also an owner</span>
            <span className="block text-sm text-subtle">Owners can change server settings (email, AI, API keys, backups) and add or remove people.</span>
          </span>
        </label>
        {(error || errors.form || errors[""]) && <p role="alert" className="text-error">{error || errors.form || errors[""]}</p>}
        <button type="submit" disabled={busy || noEmail || !form.username.trim()} className={`${primaryButton} self-start`}>
          {busy ? "Adding…" : how === "invite" ? "Send invite" : "Add to household"}
        </button>
      </form>
    </Card>
  );
}
