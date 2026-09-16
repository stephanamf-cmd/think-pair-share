import { cleanText, makeId, makeSecret, hashSecret } from "./ids";
import type { BatchOp, Store } from "./store";
import {
  LIMITS,
  PHASES,
  RELATIONS,
  type Action,
  type Idea,
  type Link,
  type Meta,
  type SessionState,
  type Student,
  type Summary,
} from "./types";
import { buildView, type Viewer } from "./view";
import { summariseIdeas } from "./ai";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

const fail = (status: number, message: string, code?: string): never => {
  throw new HttpError(status, message, code);
};

function requireTeacher(v: Viewer) {
  if (v.role !== "teacher") fail(403, "Only the teacher can do that.");
}
function requireStudent(v: Viewer): string {
  if (v.role !== "student") fail(401, "Please join the session first.", "not_joined");
  return (v as { id: string }).id;
}

/** Pair students up; an odd one out makes a trio. */
export function pairUp(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) out.push([ids[i], ids[i + 1]]);
  if (ids.length % 2 === 1) {
    const last = ids[ids.length - 1];
    if (out.length) out[out.length - 1].push(last);
    else out.push([last]);
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fillPairs(meta: Meta, studentIds: string[]): string[][] {
  const present = new Set(studentIds);
  const pairs = meta.pairs.map((p) => p.filter((id) => present.has(id))).filter((p) => p.length);
  const paired = new Set(pairs.flat());
  const unpaired = shuffle(studentIds.filter((id) => !paired.has(id)));
  // A pair left with one person (someone was removed) takes a newcomer first.
  for (const p of pairs) if (p.length === 1 && unpaired.length) p.push(unpaired.shift()!);
  const fresh: string[][] = [];
  for (let i = 0; i + 1 < unpaired.length; i += 2) fresh.push([unpaired[i], unpaired[i + 1]]);
  if (unpaired.length % 2 === 1) {
    const last = unpaired[unpaired.length - 1];
    const all = [...pairs, ...fresh];
    if (all.length) all.reduce((a, b) => (b.length < a.length ? b : a)).push(last);
    else fresh.push([last]);
  }
  return [...pairs, ...fresh];
}

function visibleToStudent(st: SessionState, studentId: string, idea: Idea): boolean {
  if (st.meta.phase === "share") return true;
  if (idea.authorIds.includes(studentId)) return true;
  if (st.meta.phase === "pair") {
    const pair = st.meta.pairs.find((p) => p.includes(studentId)) ?? [];
    return idea.authorIds.some((a) => pair.includes(a));
  }
  return false;
}

export interface ActionResult {
  ok: true;
  [k: string]: unknown;
}

export async function performAction(
  store: Store,
  st: SessionState,
  viewer: Viewer,
  body: Action,
): Promise<ActionResult> {
  const code = st.meta.code;
  const meta = st.meta;
  const now = Date.now();

  switch (body.action) {
    /* ---------------- students ---------------- */
    case "join": {
      let name = cleanText(body.name, LIMITS.nameChars, true);
      if (!name) fail(400, "Please type your name.");
      const all = Object.values(st.students);
      if (all.length >= LIMITS.studentsPerSession) fail(403, "This session is full.");
      const taken = new Set(all.map((s) => s.name.toLowerCase()));
      if (taken.has(name.toLowerCase())) {
        let n = 2;
        while (taken.has(`${name} (${n})`.toLowerCase())) n++;
        name = `${name} (${n})`;
      }
      const token = makeSecret();
      const student: Student = { id: makeId("s_"), name, tokenHash: hashSecret(token), joinedAt: now };
      const ops: BatchOp[] = [{ type: "put", kind: "students", records: [student] }];
      // Joining mid-way through the Pair phase? Find them a partner straight away.
      let newMeta: Meta | undefined;
      if (meta.phase === "pair") {
        newMeta = { ...meta, pairs: fillPairs(meta, [...all.map((s) => s.id), student.id]) };
      }
      await store.batch(code, ops, newMeta);
      return { ok: true, studentId: student.id, token, name };
    }

    case "addIdea": {
      const me = requireStudent(viewer);
      if (meta.locked) fail(403, "The session is locked.");
      if (meta.phase === "lobby") fail(403, "Wait for your teacher to start the Think phase.");
      const text = cleanText(body.text, LIMITS.ideaChars);
      if (!text) fail(400, "Your idea is empty.");
      const mineCount = Object.values(st.ideas).filter((i) => i.authorIds[0] === me).length;
      if (mineCount >= LIMITS.ideasPerStudent) fail(403, `You can add up to ${LIMITS.ideasPerStudent} ideas.`);
      let authorIds = [me];
      if (body.asPair && meta.phase !== "think") {
        const pair = meta.pairs.find((p) => p.includes(me));
        if (pair) authorIds = [me, ...pair.filter((id) => id !== me)];
      }
      const idea: Idea = { id: makeId("i_"), text, authorIds, createdAt: now, updatedAt: now, phase: meta.phase };
      await store.put(code, "ideas", [idea]);
      return { ok: true, id: idea.id };
    }

    case "editIdea": {
      const idea = st.ideas[body.id] ?? fail(404, "That idea no longer exists.");
      if (viewer.role !== "teacher") {
        const me = requireStudent(viewer);
        if (!idea.authorIds.includes(me)) fail(403, "You can only edit your own ideas.");
        if (meta.locked) fail(403, "The session is locked.");
      }
      const text = cleanText(body.text, LIMITS.ideaChars);
      if (!text) fail(400, "Your idea is empty.");
      await store.put(code, "ideas", [{ ...idea, text, updatedAt: now }]);
      return { ok: true };
    }

    case "deleteIdea": {
      const idea = st.ideas[body.id] ?? fail(404, "That idea no longer exists.");
      if (viewer.role !== "teacher") {
        const me = requireStudent(viewer);
        if (!idea.authorIds.includes(me)) fail(403, "You can only delete your own ideas.");
        if (meta.locked) fail(403, "The session is locked.");
      }
      const linkIds = Object.values(st.links)
        .filter((l) => l.source === idea.id || l.target === idea.id)
        .map((l) => l.id);
      await store.batch(code, [
        { type: "remove", kind: "ideas", ids: [idea.id] },
        { type: "remove", kind: "links", ids: linkIds },
      ]);
      return { ok: true };
    }

    /* ---------------- links ---------------- */
    case "addLink": {
      const by = viewer.role === "teacher" ? "teacher" : requireStudent(viewer);
      if (by !== "teacher") {
        if (meta.locked) fail(403, "The session is locked.");
        if (meta.phase !== "pair" && meta.phase !== "share") fail(403, "Linking opens in the Pair and Share phases.");
      }
      if (body.source === body.target) fail(400, "Pick two different ideas.");
      const a = st.ideas[body.source] ?? fail(404, "That idea no longer exists.");
      const b = st.ideas[body.target] ?? fail(404, "That idea no longer exists.");
      if (by !== "teacher" && (!visibleToStudent(st, by, a) || !visibleToStudent(st, by, b)))
        fail(403, "You can't see one of those ideas yet.");
      if (!RELATIONS.some((r) => r.id === body.relation)) fail(400, "Unknown link type.");
      const note = cleanText(body.note ?? "", LIMITS.noteChars, true);
      const existing = Object.values(st.links).find(
        (l) =>
          l.byId === by &&
          ((l.source === a.id && l.target === b.id) || (l.source === b.id && l.target === a.id)),
      );
      if (!existing && by !== "teacher") {
        const count = Object.values(st.links).filter((l) => l.byId === by).length;
        if (count >= LIMITS.linksPerStudent) fail(403, `You can make up to ${LIMITS.linksPerStudent} links.`);
      }
      const link: Link = existing
        ? { ...existing, source: a.id, target: b.id, relation: body.relation, note }
        : { id: makeId("l_"), source: a.id, target: b.id, relation: body.relation, note, byId: by, createdAt: now };
      await store.put(code, "links", [link]);
      return { ok: true, id: link.id, updated: !!existing };
    }

    case "deleteLink": {
      const link = st.links[body.id] ?? fail(404, "That link no longer exists.");
      if (viewer.role !== "teacher") {
        const me = requireStudent(viewer);
        if (link.byId !== me) fail(403, "You can only remove links you made.");
      }
      await store.remove(code, "links", [link.id]);
      return { ok: true };
    }

    /* ---------------- teacher ---------------- */
    case "updateSession": {
      requireTeacher(viewer);
      const next: Meta = { ...meta };
      if (body.phase !== undefined) {
        if (!PHASES.includes(body.phase)) fail(400, "Unknown phase.");
        if (body.phase !== meta.phase) {
          next.phase = body.phase;
          next.timerEndsAt = null;
          next.timerTotal = null;
          if (body.phase === "pair") next.pairs = fillPairs(meta, Object.keys(st.students));
        }
      }
      if (body.title !== undefined) next.title = cleanText(body.title, LIMITS.titleChars, true) || meta.title;
      if (body.prompt !== undefined) next.prompt = cleanText(body.prompt, LIMITS.promptChars);
      if (typeof body.anonymous === "boolean") next.anonymous = body.anonymous;
      if (typeof body.locked === "boolean") next.locked = body.locked;
      if (body.timerSeconds === null) {
        next.timerEndsAt = null;
        next.timerTotal = null;
      } else if (typeof body.timerSeconds === "number") {
        const s = Math.min(3600, Math.max(5, Math.round(body.timerSeconds)));
        next.timerEndsAt = now + s * 1000;
        next.timerTotal = s;
      }
      if (typeof body.addSeconds === "number") {
        const add = Math.min(3600, Math.max(-3600, Math.round(body.addSeconds)));
        if (next.timerEndsAt && next.timerEndsAt > now) {
          next.timerEndsAt = Math.max(now, next.timerEndsAt + add * 1000);
          next.timerTotal = Math.max(1, (next.timerTotal ?? 0) + add);
        } else if (add > 0) {
          next.timerEndsAt = now + add * 1000;
          next.timerTotal = add;
        }
      }
      await store.putMeta(next);
      return { ok: true };
    }

    case "makePairs": {
      requireTeacher(viewer);
      const ids = Object.values(st.students)
        .sort((a, b) => a.joinedAt - b.joinedAt)
        .map((s) => s.id);
      let pairs: string[][];
      if (body.mode === "clear") pairs = [];
      else if (body.mode === "fill") pairs = fillPairs(meta, ids);
      else pairs = pairUp(shuffle(ids));
      await store.putMeta({ ...meta, pairs });
      return { ok: true, pairs: pairs.length };
    }

    case "summarise": {
      requireTeacher(viewer);
      const ideas = Object.values(st.ideas).sort((a, b) => a.createdAt - b.createdAt);
      if (ideas.length < 2) fail(400, "Wait until there are at least two ideas.");
      if (meta.summary && now - meta.summary.createdAt < 8000) fail(429, "A summary was just made. Try again in a few seconds.");
      const draft = await summariseIdeas({
        title: meta.title,
        prompt: meta.prompt,
        ideas: ideas.map((i) => ({ id: i.id, text: i.text })),
        links: Object.values(st.links).map((l) => ({ source: l.source, target: l.target, relation: l.relation, note: l.note })),
      });
      // The AI call takes a few seconds; save onto the latest session settings, not the ones we started with.
      const fresh = (await store.load(code)) ?? fail(404, "The session has ended.");
      const summary: Summary = {
        ...draft,
        createdAt: Date.now(),
        ideaCount: ideas.length,
        edited: false,
        shown: fresh.meta.summary?.shown ?? false,
      };
      await store.putMeta({ ...fresh.meta, summary });
      return { ok: true, source: summary.source, notice: summary.notice ?? null };
    }

    case "updateSummary": {
      requireTeacher(viewer);
      if (body.clear) {
        await store.putMeta({ ...meta, summary: null });
        return { ok: true };
      }
      const current = meta.summary ?? fail(404, "There is no summary yet.");
      const next: Summary = { ...current };
      if (typeof body.paragraph === "string") {
        const text = cleanText(body.paragraph, 1500);
        if (!text) fail(400, "The summary can't be empty.");
        next.paragraph = text;
        next.edited = true;
      }
      if (typeof body.shown === "boolean") next.shown = body.shown;
      await store.putMeta({ ...meta, summary: next });
      return { ok: true };
    }

    case "removeStudent": {
      requireTeacher(viewer);
      const s = st.students[body.id] ?? fail(404, "Student not found.");
      const removeIdeas: string[] = [];
      const updateIdeas: Idea[] = [];
      for (const i of Object.values(st.ideas)) {
        if (!i.authorIds.includes(s.id)) continue;
        const rest = i.authorIds.filter((a) => a !== s.id);
        if (rest.length) updateIdeas.push({ ...i, authorIds: rest });
        else removeIdeas.push(i.id);
      }
      const gone = new Set(removeIdeas);
      const removeLinks = Object.values(st.links)
        .filter((l) => l.byId === s.id || gone.has(l.source) || gone.has(l.target))
        .map((l) => l.id);
      const pairs = meta.pairs.map((p) => p.filter((id) => id !== s.id)).filter((p) => p.length);
      await store.batch(
        code,
        [
          { type: "remove", kind: "students", ids: [s.id] },
          { type: "remove", kind: "ideas", ids: removeIdeas },
          { type: "put", kind: "ideas", records: updateIdeas },
          { type: "remove", kind: "links", ids: removeLinks },
        ],
        { ...meta, pairs },
      );
      return { ok: true };
    }

    default:
      return fail(400, "Unknown action.");
  }
}

export { buildView };
