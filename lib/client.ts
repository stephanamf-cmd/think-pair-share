"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Action, SessionView } from "./types";

/* ---------------- identity in this browser ---------------- */

export type StudentIdentity = { studentId: string; token: string; name: string };
export type TeacherEntry = { code: string; key: string; title: string; createdAt: number };

const safe = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode — fine, identity just won't survive a refresh */
    }
  },
  remove(key: string) {
    try {
      window.localStorage.removeItem(key);
    } catch {}
  },
};

export const identity = {
  student(code: string): StudentIdentity | null {
    const raw = safe.get(`tps:student:${code}`);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  setStudent(code: string, id: StudentIdentity) {
    safe.set(`tps:student:${code}`, JSON.stringify(id));
    safe.set("tps:lastName", id.name.replace(/ \(\d+\)$/, ""));
  },
  clearStudent(code: string) {
    safe.remove(`tps:student:${code}`);
  },
  lastName(): string {
    return safe.get("tps:lastName") ?? "";
  },
  teacherSessions(): TeacherEntry[] {
    try {
      return JSON.parse(safe.get("tps:teacher") ?? "[]");
    } catch {
      return [];
    }
  },
  teacherKey(code: string): string | null {
    return identity.teacherSessions().find((s) => s.code === code)?.key ?? null;
  },
  saveTeacher(entry: TeacherEntry) {
    const list = identity.teacherSessions().filter((s) => s.code !== entry.code);
    list.unshift(entry);
    safe.set("tps:teacher", JSON.stringify(list.slice(0, 30)));
  },
  forgetTeacher(code: string) {
    safe.set("tps:teacher", JSON.stringify(identity.teacherSessions().filter((s) => s.code !== code)));
  },
};

export type Auth =
  | { role: "teacher"; key: string }
  | { role: "student"; studentId: string; token: string }
  | { role: "board" };

function authHeaders(auth: Auth): Record<string, string> {
  if (auth.role === "teacher") return { "x-teacher-key": auth.key };
  if (auth.role === "student") return { "x-student-id": auth.studentId, "x-student-token": auth.token };
  return {};
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T = any>(code: string, auth: Auth, body: Action): Promise<T> {
  const res = await fetch(`/api/s/${code}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(auth) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || "Something went wrong.", res.status, data.code);
  return data as T;
}

export async function deleteSession(code: string, key: string) {
  const res = await fetch(`/api/s/${code}`, { method: "DELETE", headers: { "x-teacher-key": key } });
  if (!res.ok) throw new ApiError("Couldn't delete the session.", res.status);
}

/* ---------------- live polling ---------------- */

export type StorageInfo = {
  storage?: "upstash" | "redis" | "memory";
  storageVar?: string | null;
  envHints?: string[];
  vercelEnv?: string | null;
};
export type LiveView = SessionView & StorageInfo;

/**
 * Poll the session. Unchanged polls are tiny (the server compares version numbers).
 * Pauses while the tab is hidden and catches up the moment it's visible again.
 */
export function useSession(code: string, auth: Auth | null, intervalMs = 2500) {
  const [view, setView] = useState<LiveView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const version = useRef(-1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const again = useRef(false);
  const authKey = auth ? JSON.stringify(auth) : "";

  const tick = useCallback(async () => {
    if (!auth) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      const res = await fetch(`/api/s/${code}?v=${version.current}`, {
        headers: authHeaders(auth),
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(new ApiError(data.error || "Connection problem.", res.status, data.code));
      } else {
        setError(null);
        setClockOffset(data.serverNow - Date.now());
        if (!data.same) {
          version.current = data.version;
          setView(data);
        }
      }
    } catch {
      setError(new ApiError("Can't reach the server — retrying…", 0, "offline"));
    } finally {
      inFlight.current = false;
    }
    if (again.current) {
      again.current = false;
      void tick();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, authKey]);

  useEffect(() => {
    if (!auth) return;
    version.current = -1;
    let stopped = false;
    const loop = async () => {
      if (stopped) return;
      if (typeof document === "undefined" || !document.hidden) await tick();
      if (!stopped) timer.current = setTimeout(loop, intervalMs);
    };
    loop();
    const onVisible = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, intervalMs]);

  const refresh = useCallback(() => {
    version.current = -1;
    return tick();
  }, [tick]);

  return { view, error, refresh, clockOffset };
}

/** Current time, re-rendering every `ms`. */
export function useNow(ms = 250, offset = 0) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + offset), ms);
    return () => clearInterval(t);
  }, [ms, offset]);
  return now;
}

export function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => false,
    );
  }
  return Promise.resolve(false);
}

export function downloadFile(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
