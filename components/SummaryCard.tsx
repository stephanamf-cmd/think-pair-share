"use client";

import { useEffect, useState } from "react";
import type { LiveView } from "@/lib/client";
import { copyText, useNow } from "@/lib/client";
import type { Summary } from "@/lib/types";
import { themeColor } from "./Graph";

const SOURCE_LABEL: Record<Summary["source"], string> = {
  gemini: "Gemini",
  groq: "Groq",
  anthropic: "Claude",
  basic: "built-in summary",
};

function ago(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

function Themes({ summary, ideaIds, size = "md" }: { summary: Summary; ideaIds: Set<string>; size?: "md" | "lg" }) {
  const themes = summary.themes
    .map((t, i) => ({ ...t, color: themeColor(t.title, i), count: t.ideaIds.filter((id) => ideaIds.has(id)).length }))
    .filter((t) => t.count > 0);
  if (!themes.length) return null;
  return (
    <div className={`summary-themes ${size}`}>
      {themes.map((t, i) => (
        <span key={t.title + i}>
          <i style={{ background: t.color }} />
          {t.title} <em>{t.count}</em>
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Teacher                                                             */
/* ------------------------------------------------------------------ */

export function TeacherSummary({
  view,
  onSummarise,
  onUpdate,
}: {
  view: LiveView;
  onSummarise: () => Promise<string | null>;
  onUpdate: (patch: { paragraph?: string; shown?: boolean; clear?: boolean }) => Promise<void>;
}) {
  const summary = view.summary;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary?.paragraph ?? "");
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(true);
  const now = useNow(30_000);

  useEffect(() => {
    if (!editing) setDraft(summary?.paragraph ?? "");
  }, [summary?.paragraph, editing]);

  const ideaIds = new Set(view.ideas.map((i) => i.id));
  const newIdeas = summary ? Math.max(0, view.ideaCount - summary.ideaCount) : 0;
  const ai = view.ai;

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      await onSummarise();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card summary-card">
      <div className="spread">
        <button type="button" className="summary-title" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className={`caret ${open ? "open" : ""}`}>›</span> ✨ Class summary
        </button>
        <span className="muted tiny">
          {ai ? `AI: ${SOURCE_LABEL[ai.provider]} · ${ai.model}` : "No AI key yet — using the built-in summary"}
        </span>
      </div>

      {open && (
        <div className="stack" style={{ marginTop: 10 }}>
          {!summary && (
            <div className="summary-empty">
              <p className="muted small" style={{ margin: 0 }}>
                Turn {view.ideaCount} idea{view.ideaCount === 1 ? "" : "s"} into a short paragraph you can teach from,
                with themes that colour and tidy the graph. Only the idea text is sent to the AI — never names.
              </p>
              <button className="btn btn-accent" disabled={busy || view.ideaCount < 2} onClick={run}>
                {busy ? `Summarising ${view.ideaCount} ideas…` : "✨ Summarise ideas"}
              </button>
            </div>
          )}

          {summary && (
            <>
              {summary.notice && <div className="banner banner-info small">{summary.notice}</div>}
              {editing ? (
                <div>
                  <textarea className="textarea" rows={6} value={draft} maxLength={1500} onChange={(e) => setDraft(e.target.value)} />
                  <div className="row" style={{ marginTop: 6 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={!draft.trim()}
                      onClick={async () => {
                        await onUpdate({ paragraph: draft });
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
                <p className={`summary-paragraph ${busy ? "is-busy" : ""}`}>{summary.paragraph}</p>
              )}

              <Themes summary={summary} ideaIds={ideaIds} />

              {(summary.misconception || summary.nextQuestion) && (
                <div className="summary-extras">
                  {summary.misconception && (
                    <p>
                      <b>Watch out for:</b> {summary.misconception}
                    </p>
                  )}
                  {summary.nextQuestion && (
                    <p>
                      <b>Next question:</b> {summary.nextQuestion}
                    </p>
                  )}
                </div>
              )}

              <div className="spread">
                <label className="row small" style={{ gap: 8, cursor: "pointer" }}>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={summary.shown}
                    aria-label="Show summary on the board and student screens"
                    className={`switch ${summary.shown ? "on" : ""}`}
                    onClick={() => onUpdate({ shown: !summary.shown })}
                  >
                    <i />
                  </button>
                  Show on board &amp; student screens
                </label>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)} disabled={editing}>
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      const text = [
                        summary.paragraph,
                        summary.misconception && `Watch out for: ${summary.misconception}`,
                        summary.nextQuestion && `Next question: ${summary.nextQuestion}`,
                      ]
                        .filter(Boolean)
                        .join("\n\n");
                      setCopied(await copyText(text));
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                  <button className="btn btn-accent btn-sm" disabled={busy || view.ideaCount < 2} onClick={run}>
                    {busy ? "Summarising…" : newIdeas > 0 ? `↻ Update (+${newIdeas} new)` : "↻ Regenerate"}
                  </button>
                  <button
                    className="icon-btn"
                    title="Delete this summary"
                    aria-label="Delete this summary"
                    onClick={() => {
                      if (confirm("Delete this summary?")) void onUpdate({ clear: true });
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
              <p className="muted tiny" style={{ margin: 0 }}>
                From {summary.ideaCount} ideas · {SOURCE_LABEL[summary.source]}
                {summary.source !== "basic" ? ` (${summary.model})` : ""} · {ago(now - summary.createdAt)}
                {summary.edited ? " · edited by you" : ""} · AI can make mistakes, so check it before sharing.
              </p>
            </>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Board & students (read-only, only when the teacher shows it)        */
/* ------------------------------------------------------------------ */

export function SummaryPanel({ view, variant }: { view: LiveView; variant: "board" | "student" }) {
  const summary = view.summary;
  if (!summary) return null;
  const ideaIds = new Set(view.ideas.map((i) => i.id));
  const body = (
    <>
      <p className="summary-paragraph">{summary.paragraph}</p>
      <Themes summary={summary} ideaIds={ideaIds} size={variant === "board" ? "lg" : "md"} />
      {summary.nextQuestion && (
        <p className="summary-next">
          <b>Next question:</b> {summary.nextQuestion}
        </p>
      )}
    </>
  );
  if (variant === "student") {
    return (
      <details className="summary-panel summary-for-student" open>
        <summary>
          <h4>✨ Class summary</h4>
        </summary>
        {body}
      </details>
    );
  }
  return (
    <section className="summary-panel summary-for-board">
      <h4>✨ Class summary</h4>
      {body}
    </section>
  );
}
