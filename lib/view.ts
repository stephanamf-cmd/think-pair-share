import type { Idea, IdeaView, LinkView, SessionState, SessionView, StudentView } from "./types";

export type Viewer = { role: "teacher" } | { role: "board" } | { role: "student"; id: string };

/**
 * Decide what each person is allowed to see.
 *
 *  Teacher  — everything, always.
 *  Student  — Think: only their own ideas. Pair: their own + their partner's.
 *             Share: everyone's ideas and links.
 *  Board    — (projector) Before Share: blank dots, so the class sees ideas arriving
 *             without seeing them. Share: everything.
 *  Anonymous mode hides who wrote what from everyone but the teacher
 *  (you still see your own and your partner's names).
 */
export function buildView(st: SessionState, viewer: Viewer): SessionView {
  const { meta } = st;
  const phase = meta.phase;
  const students = Object.values(st.students).sort((a, b) => a.joinedAt - b.joinedAt);

  const pairIndexOf = new Map<string, number>();
  meta.pairs.forEach((p, i) => p.forEach((id) => pairIndexOf.set(id, i)));
  const authorIndex = new Map(students.map((s, i) => [s.id, i]));
  const nameOf = (id: string) => (id === "teacher" ? "Teacher" : st.students[id]?.name ?? "Former student");

  const me = viewer.role === "student" ? st.students[viewer.id] ?? null : null;
  const myPairIdx = me ? pairIndexOf.get(me.id) ?? -1 : -1;
  const partnerIds = me && myPairIdx >= 0 ? meta.pairs[myPairIdx].filter((id) => id !== me.id) : [];
  const partnerSet = new Set(partnerIds);

  const isMine = (i: Idea) => !!me && i.authorIds.includes(me.id);
  const isPartner = (i: Idea) => !isMine(i) && i.authorIds.some((id) => partnerSet.has(id));

  const visibility = (i: Idea): "full" | "redacted" | null => {
    if (viewer.role === "teacher" || phase === "share") return "full";
    if (viewer.role === "board") return "redacted";
    if (isMine(i)) return "full";
    if (phase === "pair" && isPartner(i)) return "full";
    return null;
  };

  const hideNames = meta.anonymous && viewer.role !== "teacher";
  const groupOf = (i: Idea) => {
    for (const id of i.authorIds) {
      const p = pairIndexOf.get(id);
      if (p !== undefined) return p;
    }
    return 1000 + (authorIndex.get(i.authorIds[0]) ?? 0);
  };

  const fullIds = new Set<string>();
  const ideas: IdeaView[] = [];
  for (const i of Object.values(st.ideas).sort((a, b) => a.createdAt - b.createdAt)) {
    const vis = visibility(i);
    if (!vis) continue;
    const mine = isMine(i);
    const partner = isPartner(i);
    const showNames = vis === "full" && (!hideNames || mine || partner);
    if (vis === "full") fullIds.add(i.id);
    ideas.push({
      id: i.id,
      text: vis === "full" ? i.text : "",
      authorNames: showNames ? i.authorIds.map(nameOf) : [],
      authorIds: viewer.role === "teacher" ? i.authorIds : undefined,
      group: groupOf(i),
      mine,
      fromPartner: partner,
      redacted: vis === "redacted",
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    });
  }

  const links: LinkView[] = Object.values(st.links)
    .filter((l) => fullIds.has(l.source) && fullIds.has(l.target))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((l) => {
      const mine = !!me && l.byId === me.id;
      const known = !hideNames || mine || partnerSet.has(l.byId) || l.byId === "teacher";
      return {
        id: l.id,
        source: l.source,
        target: l.target,
        relation: l.relation,
        note: l.note,
        byName: known ? nameOf(l.byId) : "",
        mine,
      };
    });

  let studentViews: StudentView[];
  if (viewer.role === "teacher") {
    const ideaCount = new Map<string, number>();
    for (const i of Object.values(st.ideas)) for (const a of i.authorIds) ideaCount.set(a, (ideaCount.get(a) ?? 0) + 1);
    const linkCount = new Map<string, number>();
    for (const l of Object.values(st.links)) linkCount.set(l.byId, (linkCount.get(l.byId) ?? 0) + 1);
    studentViews = students.map((s) => ({
      id: s.id,
      name: s.name,
      pairIndex: pairIndexOf.get(s.id) ?? -1,
      ideaCount: ideaCount.get(s.id) ?? 0,
      linkCount: linkCount.get(s.id) ?? 0,
    }));
  } else if (viewer.role === "board") {
    studentViews = students.map((s) => ({ id: s.id, name: s.name, pairIndex: pairIndexOf.get(s.id) ?? -1 }));
  } else {
    studentViews = students
      .filter((s) => s.id === me?.id || partnerSet.has(s.id))
      .map((s) => ({ id: s.id, name: s.name, pairIndex: myPairIdx }));
  }

  const { teacherKeyHash: _k, pairs: _p, summary: rawSummary, ...session } = meta;
  const summary = rawSummary && (viewer.role === "teacher" || rawSummary.shown) ? rawSummary : null;

  return {
    role: viewer.role,
    version: st.version,
    serverNow: Date.now(),
    me: me ? { id: me.id, name: me.name } : null,
    session,
    students: studentViews,
    studentCount: students.length,
    ideaCount: Object.keys(st.ideas).length,
    pairs: viewer.role === "student" ? (myPairIdx >= 0 ? [meta.pairs[myPairIdx]] : []) : meta.pairs,
    myPartners: partnerIds.map((id) => ({ id, name: nameOf(id) })),
    ideas,
    links,
    summary,
  };
}
