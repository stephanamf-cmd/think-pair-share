"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { identity, type TeacherEntry } from "@/lib/client";
import { LIMITS } from "@/lib/types";
import { Banner, Brand } from "./ui";

const EXAMPLES = [
  "Why does a metal spoon feel colder than a wooden one at the same temperature?",
  "What would change if there were no friction?",
  "How could we test whether heavier objects fall faster?",
];

export default function TeachHome() {
  const router = useRouter();
  const [info, setInfo] = useState<{ pinRequired: boolean; storage: string } | null>(null);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<TeacherEntry[]>([]);

  useEffect(() => {
    fetch("/api/s", { cache: "no-store" })
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo({ pinRequired: false, storage: "unknown" }));
    setSessions(identity.teacherSessions());
    try {
      setPin(window.sessionStorage.getItem("tps:pin") ?? "");
    } catch {}
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/s", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, prompt, pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't start the session.");
      try {
        window.sessionStorage.setItem("tps:pin", pin);
      } catch {}
      identity.saveTeacher({ code: data.code, key: data.teacherKey, title: title || "Think · Pair · Share", createdAt: Date.now() });
      router.push(`/teach/${data.code}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  const isLocal = typeof window !== "undefined" && /^(localhost|127\.|192\.168\.)/.test(window.location.hostname);

  return (
    <>
      <Brand>
        <Link href="/" className="btn btn-ghost btn-sm">
          Student join page
        </Link>
      </Brand>
      <main className="container teach">
        <div className="teach-top">
          <form className="card" onSubmit={create}>
            <h1>Start a Think · Pair · Share</h1>
            <p className="muted">
              Students join on their own devices with a code. You control the phases and the timer; the board shows the
              live idea graph.
            </p>
            {info?.storage === "memory" && !isLocal && (
              <Banner kind="warn">
                No database is connected, so sessions may disappear. In Vercel, open <b>Storage → Upstash for Redis</b>,
                connect it to this project, then redeploy.
              </Banner>
            )}
            <label className="field" style={{ marginTop: 12 }}>
              <span>Title</span>
              <input
                className="input"
                value={title}
                maxLength={LIMITS.titleChars}
                placeholder="e.g. 10B Physics — Thermal energy"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Question for the class</span>
              <textarea
                className="textarea"
                value={prompt}
                maxLength={LIMITS.promptChars}
                placeholder={EXAMPLES[0]}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
            <div className="row" style={{ marginBottom: 12 }}>
              {EXAMPLES.map((ex) => (
                <button key={ex} type="button" className="tag" style={{ border: "none", cursor: "pointer" }} onClick={() => setPrompt(ex)}>
                  {ex.length > 44 ? ex.slice(0, 42) + "…" : ex}
                </button>
              ))}
            </div>
            {info?.pinRequired && (
              <label className="field">
                <span>Teacher PIN</span>
                <input className="input" type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="off" />
              </label>
            )}
            {error && <p className="error">{error}</p>}
            <button className="btn btn-primary btn-lg" disabled={busy || !info}>
              {busy ? "Starting…" : "Start session"}
            </button>
          </form>

          <div className="card">
            <h2>How a session runs</h2>
            <ol className="small" style={{ paddingLeft: 18, margin: 0, display: "grid", gap: 8 }}>
              <li>
                <b>Lobby</b> — put the <b>board</b> on the projector. Students scan the QR code or type the code.
              </li>
              <li>
                <b>Think</b> — students write ideas privately. The board shows dots appearing, not text.
              </li>
              <li>
                <b>Pair</b> — students are paired automatically (a trio if numbers are odd). Partners see each
                other&apos;s ideas, can post joint ideas and link them.
              </li>
              <li>
                <b>Share</b> — every idea appears on the graph. Students link ideas (builds on, agrees, challenges,
                similar) and ideas that use the same key words join up with dashed lines.
              </li>
              <li>Export the ideas as CSV or as an Obsidian-ready Markdown note.</li>
            </ol>
          </div>
        </div>

        <section className="card" style={{ marginTop: 16 }}>
          <h2>Your sessions on this device</h2>
          {sessions.length === 0 ? (
            <p className="muted small">Sessions you start will be listed here. Sessions expire after 30 days.</p>
          ) : (
            <ul className="session-list">
              {sessions.map((s) => (
                <li key={s.code}>
                  <span className="session-code">{s.code}</span>
                  <span className="grow">
                    {s.title}
                    <br />
                    <span className="muted tiny">{new Date(s.createdAt).toLocaleString("en-GB")}</span>
                  </span>
                  <Link className="btn btn-primary btn-sm" href={`/teach/${s.code}`}>
                    Open
                  </Link>
                  <a className="btn btn-ghost btn-sm" href={`/board/${s.code}`} target="_blank" rel="noreferrer">
                    Board ↗
                  </a>
                  <button
                    className="icon-btn"
                    title="Forget on this device"
                    onClick={() => {
                      identity.forgetTeacher(s.code);
                      setSessions(identity.teacherSessions());
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
