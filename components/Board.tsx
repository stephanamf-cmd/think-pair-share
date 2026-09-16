"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession, type Auth } from "@/lib/client";
import { Brand, HplBadge, PHASE_INFO, PhasePill, QR, Spinner, Timer, useOrigin } from "./ui";
import GraphPanel from "./GraphPanel";
import { groupColor } from "./Graph";

const BOARD_AUTH: Auth = { role: "board" };

/** Projector view: public, read-only, auto-fitting graph. */
export default function Board({ code }: { code: string }) {
  const { view, error, clockOffset } = useSession(code, BOARD_AUTH, 2000);
  const origin = useOrigin();
  const [isFull, setIsFull] = useState(false);

  useEffect(() => {
    const on = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  const nameOf = useMemo(() => new Map((view?.students ?? []).map((s) => [s.id, s.name])), [view?.students]);

  if (error?.code === "not_found")
    return (
      <div className="board">
        <Brand dark />
        <div className="center-screen">
          <h1 style={{ color: "#fff" }}>Session {code} has ended</h1>
        </div>
      </div>
    );
  if (!view) return <Spinner label={error?.message ?? "Connecting…"} />;

  const { session } = view;
  const phase = session.phase;
  const joinHost = origin.replace(/^https?:\/\//, "");
  const joinUrl = origin ? `${origin}/s/${code}` : "";

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="board">
      <Brand dark>
        <div className="board-tools">
          <PhasePill phase={phase} large />
          <button className="btn btn-ghost-dark btn-sm" onClick={toggleFull}>
            {isFull ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </Brand>

      <div className="board-prompt">
        <HplBadge phase={phase} size={72} />
        <div className="grow">
          <h1>{session.prompt || session.title}</h1>
          <p className="muted">
            {session.prompt ? `${session.title} · ` : ""}
            {PHASE_INFO[phase].board}
          </p>
        </div>
        <Timer endsAt={session.timerEndsAt} total={session.timerTotal} offset={clockOffset} size="lg" />
      </div>

      {phase === "lobby" ? (
        <div className="board-lobby">
          <div style={{ display: "grid", gap: 16, justifyItems: "center", textAlign: "center" }}>
            {joinUrl && <QR text={joinUrl} size={280} />}
            <div>
              <div className="muted">Go to</div>
              <div className="board-url">{joinHost}</div>
              <div className="muted" style={{ marginTop: 8 }}>
                and enter
              </div>
              <div className="board-code">{code}</div>
            </div>
          </div>
          <div>
            <div className="row" style={{ alignItems: "baseline", marginBottom: 16 }}>
              <span className="big-count">{view.studentCount}</span>
              <span className="muted" style={{ fontSize: "1.3rem" }}>
                joined
              </span>
            </div>
            <div className="name-cloud">
              {view.students.map((s, i) => (
                <span key={s.id} style={{ background: groupColor(i) }}>
                  {s.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="board-body">
          <GraphPanel view={view} mode="board" canLink={false} autoFit labelScale={1.35} />
          <aside className="board-side">
            <div style={{ display: "grid", gap: 10, justifyItems: "center", textAlign: "center" }}>
              {joinUrl && <QR text={joinUrl} size={150} />}
              <div className="muted small">{joinHost}</div>
              <div className="board-code" style={{ fontSize: "2.4rem" }}>
                {code}
              </div>
            </div>
            <div className="row" style={{ gap: 20 }}>
              <div>
                <div className="big-count">{view.ideaCount}</div>
                <span className="muted">ideas</span>
              </div>
              <div>
                <div className="big-count">{view.studentCount}</div>
                <span className="muted">students</span>
              </div>
            </div>
            {phase === "think" && (
              <p className="muted">Ideas stay hidden until the Share phase — each dot is someone&apos;s thinking.</p>
            )}
            {phase === "pair" && view.pairs.length > 0 && (
              <div>
                <h4 style={{ color: "rgba(255,255,255,.6)" }}>Find your partner</h4>
                <div className="board-pairs">
                  {view.pairs.map((p, i) => (
                    <div key={i}>
                      <span className="dot" style={{ background: groupColor(i) }} />
                      {p.map((id) => nameOf.get(id) ?? "?").join(" · ")}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {phase === "share" && (
              <p className="muted">
                Click an idea to see its connections. Solid lines are links students made; dashed lines join ideas that
                use the same key words.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
