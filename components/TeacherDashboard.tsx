"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, copyText, deleteSession, downloadFile, identity, useSession, type Auth, type LiveView } from "@/lib/client";
import { exportFilename, toCsv, toJson, toMarkdown } from "@/lib/export";
import { LIMITS, type Action, type Phase, type Relation } from "@/lib/types";
import { Banner, Brand, HplBadge, PHASE_INFO, PhaseSteps, QR, Spinner, Timer, useOrigin } from "./ui";
import GraphPanel from "./GraphPanel";
import { groupColor } from "./Graph";

export default function TeacherDashboard({ code }: { code: string }) {
  const [key, setKey] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    // A teacher link looks like /teach/CODE#k=SECRET — save it, then tidy the URL.
    const m = window.location.hash.match(/k=([A-Za-z0-9_-]+)/);
    if (m) {
      const existing = identity.teacherSessions().find((s) => s.code === code);
      identity.saveTeacher({ code, key: m[1], title: existing?.title ?? "Session", createdAt: existing?.createdAt ?? Date.now() });
      history.replaceState(null, "", window.location.pathname);
    }
    setKey(identity.teacherKey(code));
  }, [code]);

  const auth: Auth | null = useMemo(() => (key ? { role: "teacher", key } : null), [key]);
  const { view, error, refresh, clockOffset } = useSession(code, auth, 2000);

  if (key === undefined) return <Spinner />;
  if (key === null || error?.code === "bad_key") {
    return (
      <>
        <Brand href="/teach" />
        <div className="center-screen">
          <h2>This browser isn&apos;t signed in as the teacher for {code}</h2>
          <p className="muted" style={{ maxWidth: 520 }}>
            Open the <b>teacher link</b> you copied when you started the session (it ends in <code>#k=…</code>), or start a
            new session.
          </p>
          <div className="row" style={{ justifyContent: "center" }}>
            <Link className="btn btn-primary" href="/teach">
              Start a new session
            </Link>
            <a className="btn btn-ghost" href={`/board/${code}`}>
              Open the board
            </a>
          </div>
        </div>
      </>
    );
  }
  if (error?.code === "not_found") {
    return (
      <>
        <Brand href="/teach" />
        <div className="center-screen">
          <h2>Session {code} has ended or expired</h2>
          <Link
            className="btn btn-primary"
            href="/teach"
            onClick={() => identity.forgetTeacher(code)}
          >
            Back to my sessions
          </Link>
        </div>
      </>
    );
  }
  if (!view) return <Spinner label={error?.message ?? "Loading session…"} />;

  return <Dashboard code={code} view={view} auth={auth!} teacherKey={key} refresh={refresh} clockOffset={clockOffset} offline={error?.code === "offline" ? error.message : ""} />;
}

function Dashboard({
  code,
  view,
  auth,
  teacherKey,
  refresh,
  clockOffset,
  offline,
}: {
  code: string;
  view: LiveView;
  auth: Auth;
  teacherKey: string;
  refresh: () => Promise<void>;
  clockOffset: number;
  offline: string;
}) {
  const router = useRouter();
  const origin = useOrigin();
  const { session } = view;
  const [flash, setFlash] = useState("");
  const [side, setSide] = useState<"students" | "ideas">("students");
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(session.title);
  const [prompt, setPrompt] = useState(session.prompt);
  const [customMins, setCustomMins] = useState("4");

  useEffect(() => {
    if (!editing) {
      setTitle(session.title);
      setPrompt(session.prompt);
    }
  }, [session.title, session.prompt, editing]);

  useEffect(() => {
    // keep the saved title in sync for the sessions list
    const e = identity.teacherSessions().find((s) => s.code === code);
    if (e && e.title !== session.title) identity.saveTeacher({ ...e, title: session.title });
  }, [code, session.title]);

  const say = (msg: string) => {
    setFlash(msg);
    setTimeout(() => setFlash(""), 2500);
  };

  const act = useCallback(
    async (body: Action, okMsg?: string) => {
      try {
        await api(code, auth, body);
        await refresh();
        if (okMsg) say(okMsg);
      } catch (e) {
        say((e as Error).message);
      }
    },
    [code, auth, refresh],
  );

  const joinUrl = origin ? `${origin}/s/${code}` : "";
  const teacherLink = origin ? `${origin}/teach/${code}#k=${teacherKey}` : "";
  const nameOf = useMemo(() => new Map(view.students.map((s) => [s.id, s.name])), [view.students]);
  const unpaired = view.students.filter((s) => s.pairIndex < 0).length;
  const ideasNewest = [...view.ideas].reverse();

  const setPhase = (p: Phase) => act({ action: "updateSession", phase: p }, `${PHASE_INFO[p].label} phase`);

  return (
    <>
      <Brand href="/teach">
        <a className="btn btn-accent btn-sm" href={`/board/${code}`} target="_blank" rel="noreferrer">
          Open board ↗
        </a>
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => say((await copyText(teacherLink)) ? "Teacher link copied — keep it private" : teacherLink)}
          title="Use this link to control the session from another device"
        >
          Copy teacher link
        </button>
      </Brand>

      <main className="container teach" style={{ maxWidth: 1400 }}>
        {offline && <Banner kind="warn">{offline}</Banner>}
        {view.storage === "memory" && origin && !/localhost|127\.0\.0\.1/.test(origin) && (
          <Banner kind="warn">
            Temporary storage in use — connect <b>Upstash for Redis</b> in Vercel (Storage tab) and redeploy, or
            students may not see the same session.
          </Banner>
        )}

        <div className="teach-top">
          {/* ---- session & controls ---- */}
          <div className="card stack">
            {editing ? (
              <div>
                <label className="field">
                  <span>Title</span>
                  <input className="input" value={title} maxLength={LIMITS.titleChars} onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label className="field">
                  <span>Question</span>
                  <textarea className="textarea" value={prompt} maxLength={LIMITS.promptChars} onChange={(e) => setPrompt(e.target.value)} />
                </label>
                <div className="row">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={async () => {
                      await act({ action: "updateSession", title, prompt }, "Saved");
                      setEditing(false);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="spread" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <span className="muted small">{session.title}</span>
                  <h2 style={{ margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{session.prompt || "No question set yet"}</h2>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                  Edit
                </button>
              </div>
            )}

            <PhaseSteps phase={session.phase} onPick={setPhase} />
            <div className="row">
              <HplBadge phase={session.phase} size={44} />
              <p className="muted small grow" style={{ margin: 0 }}>
                {PHASE_INFO[session.phase].teacher}
              </p>
              {session.phase !== "share" && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => setPhase((["think", "pair", "share"] as Phase[])[["lobby", "think", "pair"].indexOf(session.phase)])}
                >
                  Next: {PHASE_INFO[(["think", "pair", "share"] as Phase[])[["lobby", "think", "pair"].indexOf(session.phase)]].label} →
                </button>
              )}
            </div>

            <div className="spread">
              <div className="timer-controls">
                <span className="small" style={{ fontWeight: 650 }}>
                  Timer
                </span>
                {[1, 2, 3, 5].map((m) => (
                  <button key={m} className="btn btn-ghost btn-sm" onClick={() => act({ action: "updateSession", timerSeconds: m * 60 })}>
                    {m} min
                  </button>
                ))}
                <span className="row" style={{ gap: 4 }}>
                  <input
                    className="input"
                    style={{ width: 56, padding: "5px 8px" }}
                    value={customMins}
                    inputMode="decimal"
                    aria-label="Custom minutes"
                    onChange={(e) => setCustomMins(e.target.value.replace(/[^0-9.]/g, ""))}
                  />
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      const m = Number(customMins);
                      if (m > 0) void act({ action: "updateSession", timerSeconds: Math.round(m * 60) });
                    }}
                  >
                    Go
                  </button>
                </span>
                {session.timerEndsAt && (
                  <>
                    <button className="btn btn-ghost btn-sm" onClick={() => act({ action: "updateSession", addSeconds: 30 })}>
                      +30 s
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => act({ action: "updateSession", timerSeconds: null })}>
                      Stop
                    </button>
                  </>
                )}
              </div>
              <Timer endsAt={session.timerEndsAt} total={session.timerTotal} offset={clockOffset} size="md" />
            </div>

            <div className="settings-row">
              <label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={session.anonymous}
                  className={`switch ${session.anonymous ? "on" : ""}`}
                  onClick={() => act({ action: "updateSession", anonymous: !session.anonymous })}
                >
                  <i />
                </button>
                Hide names from students &amp; board
              </label>
              <label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={session.locked}
                  className={`switch ${session.locked ? "on" : ""}`}
                  onClick={() => act({ action: "updateSession", locked: !session.locked })}
                >
                  <i />
                </button>
                Lock (no new ideas or links)
              </label>
              {flash && <span className="tag tag-teal">{flash}</span>}
            </div>
          </div>

          {/* ---- join info ---- */}
          <div className="card">
            <div className="join-box">
              {joinUrl && <QR text={joinUrl} size={150} />}
              <div className="grow">
                <span className="muted small">Join code</span>
                <div className="code-big">{code}</div>
                <p className="join-url muted" style={{ margin: "8px 0" }}>
                  {joinUrl}
                </p>
                <div className="row">
                  <button className="btn btn-ghost btn-sm" onClick={async () => say((await copyText(joinUrl)) ? "Join link copied" : joinUrl)}>
                    Copy join link
                  </button>
                </div>
              </div>
            </div>
            <div className="row" style={{ marginTop: 14, gap: 18 }}>
              <div>
                <div className="big-count" style={{ fontSize: "2rem", color: "var(--navy)" }}>
                  {view.studentCount}
                </div>
                <span className="muted small">students</span>
              </div>
              <div>
                <div className="big-count" style={{ fontSize: "2rem", color: "var(--teal-d)" }}>
                  {view.ideaCount}
                </div>
                <span className="muted small">ideas</span>
              </div>
              <div>
                <div className="big-count" style={{ fontSize: "2rem", color: "#c27812" }}>
                  {view.links.length}
                </div>
                <span className="muted small">links</span>
              </div>
            </div>
          </div>
        </div>

        <div className="teach-main">
          {/* ---- side panel ---- */}
          <div className="card side-scroll">
            <div className="tabs">
              <button className={side === "students" ? "on" : ""} onClick={() => setSide("students")}>
                Students <span className="count">{view.studentCount}</span>
              </button>
              <button className={side === "ideas" ? "on" : ""} onClick={() => setSide("ideas")}>
                Ideas <span className="count">{view.ideaCount}</span>
              </button>
            </div>

            {side === "students" && (
              <div className="stack">
                <div>
                  <h4>Pairs</h4>
                  <div className="row" style={{ marginBottom: 10 }}>
                    <button className="btn btn-primary btn-sm" disabled={view.studentCount < 2} onClick={() => act({ action: "makePairs", mode: "shuffle" }, "Pairs shuffled")}>
                      {view.pairs.length ? "Reshuffle" : "Make pairs"}
                    </button>
                    {view.pairs.length > 0 && unpaired > 0 && (
                      <button className="btn btn-accent btn-sm" onClick={() => act({ action: "makePairs", mode: "fill" }, "Newcomers paired")}>
                        Pair {unpaired} newcomer{unpaired === 1 ? "" : "s"}
                      </button>
                    )}
                    {view.pairs.length > 0 && (
                      <button className="btn btn-ghost btn-sm" onClick={() => act({ action: "makePairs", mode: "clear" }, "Pairs cleared")}>
                        Clear
                      </button>
                    )}
                  </div>
                  {view.pairs.length === 0 ? (
                    <p className="muted small">Pairs are made automatically when you move to the Pair phase.</p>
                  ) : (
                    <div className="pair-grid">
                      {view.pairs.map((p, i) => (
                        <div key={i} className="pair-row">
                          <span className="dot" style={{ background: groupColor(i) }} />
                          {p.map((id) => nameOf.get(id) ?? "?").join(" · ")}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <h4>Students</h4>
                  {view.students.length === 0 && <p className="muted small">Waiting for students to join…</p>}
                  {view.students.map((s) => (
                    <div key={s.id} className="student-row">
                      <span className="dot" style={{ background: s.pairIndex >= 0 ? groupColor(s.pairIndex) : "#cfd8de" }} />
                      <span className="name" title={s.name}>
                        {s.name}
                      </span>
                      <span className="stat">
                        {s.ideaCount} idea{s.ideaCount === 1 ? "" : "s"} · {s.linkCount} link{s.linkCount === 1 ? "" : "s"}
                      </span>
                      <button
                        className="icon-btn"
                        title={`Remove ${s.name}`}
                        aria-label={`Remove ${s.name}`}
                        onClick={() => {
                          if (confirm(`Remove ${s.name}? Their ideas and links will be deleted.`))
                            void act({ action: "removeStudent", id: s.id }, `${s.name} removed`);
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {side === "ideas" && (
              <ul className="idea-list">
                {ideasNewest.length === 0 && <p className="muted small">No ideas yet.</p>}
                {ideasNewest.map((i) => (
                  <li key={i.id} className="idea" style={{ ["--accent" as string]: groupColor(i.group) }}>
                    <p className="idea-text">{i.text}</p>
                    <div className="spread">
                      <span className="idea-meta">
                        {i.authorNames.join(" & ")} · {new Date(i.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          if (confirm("Delete this idea for everyone?")) void act({ action: "deleteIdea", id: i.id }, "Idea deleted");
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ---- graph ---- */}
          <div className="stack">
            <GraphPanel
              view={view}
              mode="teacher"
              canLink
              className="teach-graph"
              onAddLink={(source: string, target: string, relation: Relation, note: string) =>
                act({ action: "addLink", source, target, relation, note }, "Link added")
              }
              onDeleteLink={(id) => act({ action: "deleteLink", id }, "Link removed")}
              onDeleteIdea={(id) => act({ action: "deleteIdea", id }, "Idea deleted")}
            />
            <div className="spread">
              <p className="muted small" style={{ margin: 0 }}>
                You always see everything here. Students only see the full graph in the Share phase.
              </p>
              <div className="row">
                <span className="small" style={{ fontWeight: 650 }}>
                  Export
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => downloadFile(exportFilename(view, "csv"), toCsv(view), "text/csv")}>
                  CSV
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => downloadFile(exportFilename(view, "md"), toMarkdown(view), "text/markdown")}>
                  Obsidian .md
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => downloadFile(exportFilename(view, "json"), toJson(view), "application/json")}>
                  JSON
                </button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={async () => {
                    if (!confirm("End and delete this session for everyone? Export first if you want to keep the ideas.")) return;
                    try {
                      await deleteSession(code, teacherKey);
                      identity.forgetTeacher(code);
                      router.push("/teach");
                    } catch (e) {
                      say((e as Error).message);
                    }
                  }}
                >
                  End session
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
