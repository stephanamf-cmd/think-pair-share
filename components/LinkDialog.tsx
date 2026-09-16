"use client";

import { useEffect, useState } from "react";
import { RELATIONS, LIMITS, type IdeaView, type Relation } from "@/lib/types";
import { RELATION_COLORS } from "./Graph";

export default function LinkDialog({
  source,
  target,
  onSave,
  onCancel,
}: {
  source: IdeaView;
  target: IdeaView;
  onSave: (source: string, target: string, relation: Relation, note: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(source);
  const [to, setTo] = useState(target);
  const [relation, setRelation] = useState<Relation>("builds");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const verb = RELATIONS.find((r) => r.id === relation)!.verb;

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Link two ideas" onClick={(e) => e.stopPropagation()}>
        <h3>Link two ideas</h3>
        <div className="link-preview">
          <div className="idea-chip">{from.text}</div>
          <div className="link-verb" style={{ color: RELATION_COLORS[relation] }}>
            <span>{verb}</span>
            <button
              type="button"
              className="icon-btn"
              title="Swap direction"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
            >
              ⇅
            </button>
          </div>
          <div className="idea-chip">{to.text}</div>
        </div>

        <div className="rel-grid">
          {RELATIONS.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`rel-btn ${relation === r.id ? "on" : ""}`}
              style={{ ["--rel" as string]: RELATION_COLORS[r.id] }}
              onClick={() => setRelation(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Why? (optional)</span>
          <input
            className="input"
            value={note}
            maxLength={LIMITS.noteChars}
            placeholder="because…"
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onSave(from.id, to.id, relation, note);
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save link"}
          </button>
        </div>
      </div>
    </div>
  );
}
