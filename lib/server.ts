import { NextResponse } from "next/server";
import { HttpError } from "./actions";
import { secretMatches } from "./ids";
import type { SessionState } from "./types";
import type { Viewer } from "./view";

export const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function errorResponse(err: unknown) {
  if (err instanceof HttpError) return json({ error: err.message, code: err.code }, err.status);
  console.error(err);
  return json({ error: "Something went wrong. Please try again." }, 500);
}

/**
 * Work out who is asking.
 * Teacher: x-teacher-key. Student: x-student-id + x-student-token. Anyone else: the projector board.
 * A student whose credentials no longer match (e.g. removed by the teacher) gets a 401 so their
 * browser can forget the old identity and show the join screen again.
 */
export function resolveViewer(req: Request, st: SessionState): Viewer {
  const key = req.headers.get("x-teacher-key");
  if (key && secretMatches(key, st.meta.teacherKeyHash)) return { role: "teacher" };
  const sid = req.headers.get("x-student-id");
  const token = req.headers.get("x-student-token");
  if (sid && token) {
    const s = st.students[sid];
    if (s && secretMatches(token, s.tokenHash)) return { role: "student", id: sid };
    throw new HttpError(401, "You're no longer in this session. Please join again.", "student_gone");
  }
  if (key) throw new HttpError(403, "That teacher link isn't valid for this session.", "bad_key");
  return { role: "board" };
}
