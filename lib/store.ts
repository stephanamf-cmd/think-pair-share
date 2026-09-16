import { Redis } from "@upstash/redis";
import type { Idea, Link, Meta, SessionState, Student } from "./types";

/**
 * Storage for sessions.
 *
 * Production: Upstash Redis (connect it from the Vercel Marketplace — the env vars are added for you).
 * Local dev without env vars: an in-memory store, so `npm run dev` works out of the box.
 *
 * Keys per session (all expire after SESSION_TTL_DAYS):
 *   tps:{code}:meta      JSON  — title, prompt, phase, timer, pairs, teacher key hash
 *   tps:{code}:v         int   — bumped on every change; clients poll this cheaply
 *   tps:{code}:students  hash  — id -> Student
 *   tps:{code}:ideas     hash  — id -> Idea
 *   tps:{code}:links     hash  — id -> Link
 */

export type Kind = "students" | "ideas" | "links";
type RecordOf<K extends Kind> = K extends "students" ? Student : K extends "ideas" ? Idea : Link;

export interface Store {
  kind: "upstash" | "memory";
  /** Current version, or null if the session doesn't exist. One Redis command. */
  version(code: string): Promise<number | null>;
  load(code: string): Promise<SessionState | null>;
  /** Returns false if the code is already taken. */
  create(meta: Meta): Promise<boolean>;
  putMeta(meta: Meta): Promise<void>;
  put<K extends Kind>(code: string, kind: K, records: RecordOf<K>[]): Promise<void>;
  remove(code: string, kind: Kind, ids: string[]): Promise<void>;
  /** Several puts/removes and an optional meta write, applied together with a single version bump. */
  batch(code: string, ops: BatchOp[], meta?: Meta): Promise<void>;
  destroy(code: string): Promise<void>;
}

export type BatchOp =
  | { type: "put"; kind: Kind; records: (Student | Idea | Link)[] }
  | { type: "remove"; kind: Kind; ids: string[] };

const TTL_SECONDS = Math.max(1, Number(process.env.SESSION_TTL_DAYS || 30)) * 24 * 60 * 60;
const key = (code: string, part: string) => `tps:${code}:${part}`;

/* ------------------------------------------------------------------ */
/* Upstash                                                             */
/* ------------------------------------------------------------------ */

function upstashFromEnv(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function upstashStore(redis: Redis): Store {
  const toMap = (raw: unknown): Record<string, any> => {
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? safeParse(v) : v;
    }
    return out;
  };

  const store: Store = {
    kind: "upstash",

    async version(code) {
      const v = await redis.get<number | string>(key(code, "v"));
      return v === null || v === undefined ? null : Number(v);
    },

    async load(code) {
      const p = redis.pipeline();
      p.get(key(code, "meta"));
      p.hgetall(key(code, "students"));
      p.hgetall(key(code, "ideas"));
      p.hgetall(key(code, "links"));
      p.get(key(code, "v"));
      const [meta, students, ideas, links, v] = (await p.exec()) as unknown[];
      if (!meta) return null;
      return {
        meta: (typeof meta === "string" ? safeParse(meta) : meta) as Meta,
        students: toMap(students),
        ideas: toMap(ideas),
        links: toMap(links),
        version: Number(v ?? 0),
      };
    },

    async create(meta) {
      const ok = await redis.set(key(meta.code, "meta"), meta, { nx: true, ex: TTL_SECONDS });
      if (!ok) return false;
      await redis.set(key(meta.code, "v"), 1, { ex: TTL_SECONDS });
      return true;
    },

    async putMeta(meta) {
      await store.batch(meta.code, [], meta);
    },

    async put(code, kind, records) {
      await store.batch(code, [{ type: "put", kind, records }]);
    },

    async remove(code, kind, ids) {
      await store.batch(code, [{ type: "remove", kind, ids }]);
    },

    async batch(code, ops, meta) {
      const p = redis.pipeline();
      const touched = new Set<string>([key(code, "meta"), key(code, "v")]);
      if (meta) p.set(key(code, "meta"), meta, { ex: TTL_SECONDS });
      for (const op of ops) {
        const k = key(code, op.kind);
        if (op.type === "put" && op.records.length) {
          const obj: Record<string, string> = {};
          for (const r of op.records) obj[r.id] = JSON.stringify(r);
          p.hset(k, obj);
          touched.add(k);
        } else if (op.type === "remove" && op.ids.length) {
          p.hdel(k, ...op.ids);
        }
      }
      p.incr(key(code, "v"));
      for (const k of touched) if (k !== key(code, "meta") || !meta) p.expire(k, TTL_SECONDS);
      await p.exec();
    },

    async destroy(code) {
      await redis.del(
        key(code, "meta"),
        key(code, "v"),
        key(code, "students"),
        key(code, "ideas"),
        key(code, "links"),
      );
    },
  };
  return store;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/* ------------------------------------------------------------------ */
/* In-memory (local development only)                                  */
/* ------------------------------------------------------------------ */

type MemSession = { state: SessionState; expires: number };
const g = globalThis as unknown as { __tpsMem?: Map<string, MemSession> };

function memoryStore(): Store {
  const db = (g.__tpsMem ??= new Map());
  const get = (code: string) => {
    const s = db.get(code);
    if (!s) return null;
    if (s.expires < Date.now()) {
      db.delete(code);
      return null;
    }
    return s;
  };
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

  const store: Store = {
    kind: "memory",
    async version(code) {
      return get(code)?.state.version ?? null;
    },
    async load(code) {
      const s = get(code);
      return s ? clone(s.state) : null;
    },
    async create(meta) {
      if (get(meta.code)) return false;
      db.set(meta.code, {
        state: { meta: clone(meta), students: {}, ideas: {}, links: {}, version: 1 },
        expires: Date.now() + TTL_SECONDS * 1000,
      });
      return true;
    },
    async putMeta(meta) {
      await store.batch(meta.code, [], meta);
    },
    async put(code, kind, records) {
      await store.batch(code, [{ type: "put", kind, records }]);
    },
    async remove(code, kind, ids) {
      await store.batch(code, [{ type: "remove", kind, ids }]);
    },
    async batch(code, ops, meta) {
      const s = get(code);
      if (!s) return;
      if (meta) s.state.meta = clone(meta);
      for (const op of ops) {
        const table = s.state[op.kind] as Record<string, unknown>;
        if (op.type === "put") for (const r of op.records) table[r.id] = clone(r);
        else for (const id of op.ids) delete table[id];
      }
      s.state.version += 1;
      s.expires = Date.now() + TTL_SECONDS * 1000;
    },
    async destroy(code) {
      db.delete(code);
    },
  };
  return store;
}

/* ------------------------------------------------------------------ */

let cached: Store | null = null;
export function getStore(): Store {
  if (cached) return cached;
  const redis = upstashFromEnv();
  cached = redis ? upstashStore(redis) : memoryStore();
  if (!redis && process.env.VERCEL) {
    console.warn(
      "[think-pair-share] No Upstash Redis env vars found — using in-memory storage. " +
        "Connect Upstash from the Vercel Marketplace, then redeploy.",
    );
  }
  return cached;
}
