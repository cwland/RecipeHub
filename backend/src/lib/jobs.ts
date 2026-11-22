import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { jobs, type JobResult } from "../db/schema.js";
import { logEvent } from "./appLog.js";

// Background jobs, kept in PostgreSQL (no Redis needed). One worker inside the app takes queued
// jobs one at a time (FOR UPDATE SKIP LOCKED, so a second copy of the app wouldn't take the same
// job). Jobs that were running when the server stopped are queued again when it starts.

export type JobRow = typeof jobs.$inferSelect;
export type JobHandler = (job: JobRow) => Promise<JobResult>;

export class JobQueue {
  private handlers = new Map<string, JobHandler>();
  private loop: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private db: Db) {}

  handle(kind: string, fn: JobHandler) {
    this.handlers.set(kind, fn);
  }

  async enqueue(kind: string, payload: Record<string, unknown>, createdBy: number | null) {
    const [row] = await this.db.insert(jobs).values({ kind, payload, createdBy }).returning();
    this.kick();
    return row;
  }

  // Is a job of this kind waiting to run?
  async pending(kind: string) {
    const [row] = await this.db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.kind, kind), eq(jobs.status, "queued"))).limit(1);
    return !!row;
  }

  async get(id: number) {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.id, id));
    return row ?? null;
  }

  // Start working now (if not already)
  kick() {
    if (this.loop) {
      this.again = true;
      return;
    }
    this.loop = this.work().finally(() => {
      this.loop = null;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    });
  }

  // Tests: wait until nothing is left to do
  async drain() {
    while (this.loop) await this.loop;
  }

  // Wait up to ms for a job to finish (for scripts that want the answer in one request)
  async wait(id: number, ms: number) {
    const until = Date.now() + ms;
    for (;;) {
      const row = await this.get(id);
      if (!row || row.status === "done" || row.status === "failed" || Date.now() >= until) return row;
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private async claim(): Promise<JobRow | null> {
    const rows = await this.db.execute(sql`
      update jobs set status = 'running', started_at = now(), attempts = attempts + 1
      where id = (select id from jobs where status = 'queued' order by id for update skip locked limit 1)
      returning id`);
    const id = (rows.rows[0] as { id: number } | undefined)?.id;
    return id ? this.get(id) : null;
  }

  private async work() {
    for (;;) {
      const job = await this.claim();
      if (!job) return;
      const handler = this.handlers.get(job.kind);
      try {
        if (!handler) throw new Error(`No worker for "${job.kind}" jobs`);
        const result = await handler(job);
        await this.db.update(jobs).set({ status: "done", result, error: null, finishedAt: new Date() }).where(eq(jobs.id, job.id));
      } catch (e) {
        const message = (e as Error).message || "Something went wrong";
        await this.db.update(jobs).set({ status: "failed", error: message.slice(0, 1000), finishedAt: new Date() }).where(eq(jobs.id, job.id));
      }
    }
  }

  // Server start: pick up where it left off, look for work every few seconds, tidy up daily
  async start(maintenance?: () => Promise<void>) {
    const stuck = await this.db.update(jobs).set({ status: "queued" }).where(and(eq(jobs.status, "running"), lt(jobs.attempts, 3))).returning({ id: jobs.id });
    await this.db.update(jobs).set({ status: "failed", error: "Stopped when the server restarted (3 times)", finishedAt: new Date() }).where(eq(jobs.status, "running"));
    if (stuck.length) await logEvent(this.db, { category: "import", level: "info", source: "Background jobs", event: `Picked up ${stuck.length} job${stuck.length === 1 ? "" : "s"} after a restart` });
    this.kick();
    let last = 0;
    this.timer = setInterval(() => {
      this.kick();
      if (Date.now() - last > 24 * 3600 * 1000) {
        last = Date.now();
        void this.prune().then(() => maintenance?.()).catch(() => {});
      }
    }, 5000);
    this.timer.unref();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  // Finished jobs are kept 30 days
  async prune(days = 30) {
    await this.db.delete(jobs).where(and(inArray(jobs.status, ["done", "failed"]), lt(jobs.finishedAt, new Date(Date.now() - days * 24 * 3600 * 1000))));
  }
}
