import { Redis } from "@upstash/redis";
import { createClient } from "redis";
import { findRedisEnv, redisEnvHints } from "./redis-env";
import type { Idea, Link, Meta, SessionState, Student } from "./types";

/**
 * Storage for sessions.
 *
 * Production: Redis from the Vercel Marketplace. Upstash's REST API is used when its URL + token are
 * present (any prefix); otherwise any redis:// / rediss:// connection string (e.g. REDIS_URL) is used.
 * See lib/redis-env.ts for how the variables are found.
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
export type StorageKind = "upstash" | "redis" | "memory";
type RecordOf<K extends Kind> = K extends "students" ? Student : K extends "ideas" ? Idea : Link;

export interface Store {
  kind: StorageKind;
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
/* Redis over TCP (REDIS_URL) — Redis Cloud, or Upstash's redis:// URL  */
/* ------------------------------------------------------------------ */

type TcpClient = ReturnType<typeof createClient>;
const gc = globalThis as unknown as { __tpsRedis?: Promise<TcpClient> };

function tcpStore(url: string): Store {
  // One connection per server instance, reused across requests.
  const client = (): Promise<TcpClient> => {
    if (!gc.__tpsRedis) {
      const c = createClient({
        url,
        socket: { connectTimeout: 10_000, reconnectStrategy: (retries: number) => Math.min(100 + retries * 200, 3000) },
      });
      c.on("error", (e: Error) => console.error("[think-pair-share] redis:", e.message));
      gc.__tpsRedis = c.connect().then(
        () => c,
        (err: unknown) => {
          gc.__tpsRedis = undefined; // try again on the next request
          throw err;
        },
      ) as Promise<TcpClient>;
    }
    return gc.__tpsRedis;
  };
  const run = async (...cmds: string[][]): Promise<unknown[]> => {
    const c = await client();
    // Commands sent in the same tick are pipelined automatically by node-redis.
    return Promise.all(cmds.map((args) => c.sendCommand(args) as Promise<unknown>));
  };
  const parse = (v: unknown) => (typeof v === "string" ? safeParse(v) : v);
  const toMap = (raw: unknown): Record<string, any> => {
    const out: Record<string, any> = {};
    if (Array.isArray(raw)) {
      for (let i = 0; i + 1 < raw.length; i += 2) out[String(raw[i])] = parse(String(raw[i + 1]));
    } else if (raw instanceof Map) {
      for (const [k, v] of raw) out[String(k)] = parse(String(v));
    } else if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = parse(String(v));
    }
    return out;
  };
  const ttl = String(TTL_SECONDS);

  const store: Store = {
    kind: "redis",
    async version(code) {
      const [v] = await run(["GET", key(code, "v")]);
      return v === null || v === undefined ? null : Number(v);
    },
    async load(code) {
      const [meta, students, ideas, links, v] = await run(
        ["GET", key(code, "meta")],
        ["HGETALL", key(code, "students")],
        ["HGETALL", key(code, "ideas")],
        ["HGETALL", key(code, "links")],
        ["GET", key(code, "v")],
      );
      if (!meta) return null;
      return {
        meta: parse(String(meta)) as Meta,
        students: toMap(students),
        ideas: toMap(ideas),
        links: toMap(links),
        version: Number(v ?? 0),
      };
    },
    async create(meta) {
      const [ok] = await run(["SET", key(meta.code, "meta"), JSON.stringify(meta), "NX", "EX", ttl]);
      if (ok === null || ok === undefined) return false;
      await run(["SET", key(meta.code, "v"), "1", "EX", ttl]);
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
      const cmds: string[][] = [];
      const touched = new Set<string>([key(code, "v")]);
      if (meta) cmds.push(["SET", key(code, "meta"), JSON.stringify(meta), "EX", ttl]);
      else touched.add(key(code, "meta"));
      for (const op of ops) {
        const k = key(code, op.kind);
        if (op.type === "put" && op.records.length) {
          cmds.push(["HSET", k, ...op.records.flatMap((r) => [r.id, JSON.stringify(r)])]);
          touched.add(k);
        } else if (op.type === "remove" && op.ids.length) {
          cmds.push(["HDEL", k, ...op.ids]);
        }
      }
      cmds.push(["INCR", key(code, "v")]);
      for (const k of touched) cmds.push(["EXPIRE", k, ttl]);
      await run(...cmds);
    },
    async destroy(code) {
      await run(["DEL", ...["meta", "v", "students", "ideas", "links"].map((p) => key(code, p))]);
    },
  };
  return store;
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
let cachedVar = "";

export function getStore(): Store {
  if (cached) return cached;
  const found = findRedisEnv();
  if (found?.type === "rest") {
    cached = upstashStore(new Redis({ url: found.url, token: found.token }));
    cachedVar = found.urlVar;
  } else if (found?.type === "tcp") {
    cached = tcpStore(found.url);
    cachedVar = found.urlVar;
  } else {
    cached = memoryStore();
    if (process.env.VERCEL) {
      console.warn(
        "[think-pair-share] No Redis connection variables found — using temporary in-memory storage. " +
          `Database-looking variables present: ${redisEnvHints().join(", ") || "none"}.`,
      );
    }
  }
  return cached;
}

/** Safe to show to teachers: which variable is in use, or which names we saw. Never values. */
export function storageInfo() {
  const store = getStore();
  return {
    storage: store.kind,
    storageVar: cachedVar || null,
    envHints: store.kind === "memory" ? redisEnvHints() : [],
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };
}
