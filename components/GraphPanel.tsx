"use client";

import { useEffect, useMemo, useState } from "react";
import Graph, {
  DEFAULT_SETTINGS,
  GRAPH_THEME,
  RELATION_COLORS,
  groupColor,
  themeColor,
  type GraphEdge,
  type GraphNode,
  type GraphSettings,
} from "./Graph";
import LinkDialog from "./LinkDialog";
import { keywordEdges } from "@/lib/keywords";
import { RELATIONS, type IdeaView, type Relation } from "@/lib/types";
import type { LiveView } from "@/lib/client";

interface Props {
  view: LiveView;
  mode: "teacher" | "student" | "board";
  canLink: boolean;
  onAddLink?: (source: string, target: string, relation: Relation, note: string) => Promise<void>;
  onDeleteLink?: (id: string) => Promise<void>;
  onDeleteIdea?: (id: string) => Promise<void>;
  autoFit?: boolean;
  className?: string;
  startWithControls?: boolean;
  labelScale?: number;
}

const verb = (r: Relation) => RELATIONS.find((x) => x.id === r)?.verb ?? r;

function loadSettings(mode: string): GraphSettings {
  try {
    const raw = window.localStorage.getItem(`tps:graph:${mode}`);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), search: "" };
  } catch {}
  return DEFAULT_SETTINGS;
}

export default function GraphPanel({
  view,
  mode,
  canLink,
  onAddLink,
  onDeleteLink,
  onDeleteIdea,
  autoFit = true,
  className,
  startWithControls = false,
  labelScale = 1,
}: Props) {
  const [settings, setSettings] = useState<GraphSettings>(DEFAULT_SETTINGS);
  const [controlsOpen, setControlsOpen] = useState(startWithControls);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [linkFromId, setLinkFromId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ source: string; target: string } | null>(null);
  const [activeTheme, setActiveTheme] = useState<number | null>(null);

  useEffect(() => setSettings(loadSettings(mode)), [mode]);
  const update = (patch: Partial<GraphSettings>) => {
    if (patch.search !== undefined) setActiveTheme(null);
    setSettingsSaved(patch);
  };
  const setSettingsSaved = (patch: Partial<GraphSettings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        const { search: _s, ...keep } = next;
        window.localStorage.setItem(`tps:graph:${mode}`, JSON.stringify(keep));
      } catch {}
      return next;
    });

  const ideaById = useMemo(() => new Map(view.ideas.map((i) => [i.id, i])), [view.ideas]);

  // Drop selection if the idea disappears.
  useEffect(() => {
    if (selectedId && !ideaById.has(selectedId)) setSelectedId(null);
    if (linkFromId && !ideaById.has(linkFromId)) setLinkFromId(null);
  }, [ideaById, selectedId, linkFromId]);

  const readable = useMemo(() => view.ideas.filter((i) => !i.redacted), [view.ideas]);

  const kw = useMemo(
    () =>
      keywordEdges(readable, {
        minShared: settings.minShared,
        ignoreText: settings.ignorePrompt ? view.session.prompt : undefined,
        maxPerIdea: settings.maxWordLinks >= 6 ? 0 : settings.maxWordLinks,
      }),
    [readable, settings.minShared, settings.ignorePrompt, settings.maxWordLinks, view.session.prompt],
  );

  // Themes from the class summary (if there is one), limited to ideas that still exist.
  const themes = useMemo(
    () =>
      (view.summary?.themes ?? [])
        .map((t, i) => ({ ...t, ideaIds: t.ideaIds.filter((id) => ideaById.has(id)), color: themeColor(t.title, i) }))
        .filter((t) => t.ideaIds.length > 0),
    [view.summary, ideaById],
  );
  const themeOf = useMemo(() => {
    const m = new Map<string, number>();
    themes.forEach((t, i) => t.ideaIds.forEach((id) => m.set(id, i)));
    return m;
  }, [themes]);
  useEffect(() => {
    if (activeTheme !== null && activeTheme >= themes.length) setActiveTheme(null);
  }, [themes.length, activeTheme]);
  const byTheme = settings.colorBy === "theme" && themes.length > 0;

  // A fresh summary switches the graph to theme colours (you can switch back under Graph settings → Groups).
  const summaryStamp = view.summary?.createdAt ?? 0;
  const [seenStamp, setSeenStamp] = useState(mode === "board" ? 0 : summaryStamp);
  useEffect(() => {
    if (summaryStamp && summaryStamp !== seenStamp) {
      setSeenStamp(summaryStamp);
      if (settings.colorBy !== "theme") setSettingsSaved({ colorBy: "theme" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryStamp]);

  const q = settings.search.trim().toLowerCase();
  const focusSet = activeTheme !== null && themes[activeTheme] ? new Set(themes[activeTheme].ideaIds) : null;
  const nodes: GraphNode[] = useMemo(
    () =>
      view.ideas.map((i) => {
        const t = themeOf.get(i.id);
        return {
          id: i.id,
          label: i.redacted ? "" : i.text,
          group: i.group,
          redacted: i.redacted,
          mine: i.mine,
          color: byTheme ? (t !== undefined ? themes[t].color : "#9aa7bf") : undefined,
          cluster: byTheme && settings.clusterThemes && t !== undefined ? t : undefined,
          match: focusSet
            ? focusSet.has(i.id)
            : q
              ? i.text.toLowerCase().includes(q) || i.authorNames.some((n) => n.toLowerCase().includes(q))
              : false,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.ideas, q, byTheme, themes, themeOf, activeTheme, settings.clusterThemes],
  );

  const edges: GraphEdge[] = useMemo(() => {
    const out: GraphEdge[] = [];
    const linked = new Set<string>();
    if (settings.showStudent) {
      for (const l of view.links) {
        out.push({ id: l.id, source: l.source, target: l.target, kind: "student", relation: l.relation });
        linked.add([l.source, l.target].sort().join("|"));
      }
    }
    if (settings.showKeyword) {
      for (const e of kw.edges) {
        const key = [e.source, e.target].sort().join("|");
        if (linked.has(key)) continue;
        out.push({ id: `kw:${key}`, source: e.source, target: e.target, kind: "keyword" });
      }
    }
    return out;
  }, [view.links, kw.edges, settings.showStudent, settings.showKeyword]);

  const handleSelect = (id: string | null) => {
    if (linkFromId && id && id !== linkFromId) {
      setPending({ source: linkFromId, target: id });
      setLinkFromId(null);
      setSelectedId(id);
      return;
    }
    if (!id) setLinkFromId(null);
    setSelectedId(id);
  };

  const selected = selectedId ? ideaById.get(selectedId) ?? null : null;
  const kwCount = edges.filter((e) => e.kind === "keyword").length;
  const showNames = mode !== "board" || !view.session.anonymous;

  const pairsInUse = view.pairs.length > 0;

  return (
    <div className={`graph-panel ${className ?? ""}`}>
      <Graph
        nodes={nodes}
        edges={edges}
        settings={settings}
        selectedId={selectedId}
        linkFromId={linkFromId}
        onSelect={handleSelect}
        autoFit={autoFit}
        labelScale={labelScale}
        highlighting={!!focusSet}
      />

      {/* top-left: counts and common words */}
      <div className="graph-hud">
        <div className="graph-stats">
          <b>{view.ideas.length}</b> ideas · <b>{view.links.length}</b> links · <b>{kwCount}</b> word links
        </div>
        {themes.length > 0 ? (
          <div className="chip-row">
            {themes.map((t, i) => (
              <button
                key={t.title + i}
                type="button"
                className={`chip chip-theme ${activeTheme === i ? "chip-on" : ""}`}
                onClick={() => setActiveTheme(activeTheme === i ? null : i)}
                title={`${t.ideaIds.length} ideas — click to spotlight them`}
              >
                <i style={{ background: t.color }} />
                {t.title} <span>{t.ideaIds.length}</span>
              </button>
            ))}
          </div>
        ) : kw.top.length > 0 && (
          <div className="chip-row">
            {kw.top.slice(0, 8).map((t) => (
              <button
                key={t.word}
                type="button"
                className={`chip ${q === t.word ? "chip-on" : ""}`}
                onClick={() => update({ search: q === t.word ? "" : t.word })}
                title={`${t.count} ideas use this word`}
              >
                {t.word} <span>{t.count}</span>
              </button>
            ))}
          </div>
        )}
        {linkFromId && (
          <div className="link-hint">
            Now tap the idea you want to connect to.{" "}
            <button type="button" onClick={() => setLinkFromId(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* top-right: Obsidian-style settings */}
      <div className={`graph-controls ${controlsOpen ? "open" : ""}`}>
        <button type="button" className="controls-toggle" onClick={() => setControlsOpen((o) => !o)} aria-expanded={controlsOpen}>
          {controlsOpen ? "✕" : "⚙"} <span>Graph settings</span>
        </button>
        {controlsOpen && (
          <div className="controls-body">
            <Section title="Filters">
              <input
                className="input input-dark"
                placeholder="Search ideas…"
                value={settings.search}
                onChange={(e) => update({ search: e.target.value })}
              />
              <Toggle label="Student links" value={settings.showStudent} onChange={(v) => update({ showStudent: v })} />
              <Toggle label="Shared-word links" value={settings.showKeyword} onChange={(v) => update({ showKeyword: v })} />
              <Slider
                label="Words in common"
                min={1}
                max={3}
                step={1}
                value={settings.minShared}
                onChange={(v) => update({ minShared: v })}
                format={(v) => `${v}+`}
              />
              <Slider
                label="Word links per idea"
                min={1}
                max={6}
                step={1}
                value={settings.maxWordLinks}
                onChange={(v) => update({ maxWordLinks: v })}
                format={(v) => (v >= 6 ? "All" : `${v}`)}
              />
              <Toggle
                label="Ignore words from the question"
                value={settings.ignorePrompt}
                onChange={(v) => update({ ignorePrompt: v })}
              />
            </Section>
            <Section title="Groups">
              <div className="seg">
                <button
                  type="button"
                  className={byTheme ? "on" : ""}
                  disabled={!themes.length}
                  title={themes.length ? "Colour ideas by summary theme" : "Make a class summary first"}
                  onClick={() => update({ colorBy: "theme" })}
                >
                  Theme
                </button>
                <button
                  type="button"
                  className={settings.colorBy === "pair" || (settings.colorBy === "theme" && !byTheme) ? "on" : ""}
                  onClick={() => update({ colorBy: "pair" })}
                >
                  Pair
                </button>
                <button type="button" className={settings.colorBy === "none" ? "on" : ""} onClick={() => update({ colorBy: "none" })}>
                  Plain
                </button>
              </div>
              {themes.length > 0 && (
                <Toggle label="Cluster themes together" value={settings.clusterThemes} onChange={(v) => update({ clusterThemes: v })} />
              )}
            </Section>
            <Section title="Display">
              <Toggle label="Arrows" value={settings.arrows} onChange={(v) => update({ arrows: v })} />
              <Slider label="Text fade threshold" min={0} max={1} step={0.05} value={settings.textFade} onChange={(v) => update({ textFade: v })} />
              <Slider label="Node size" min={0.5} max={2} step={0.05} value={settings.nodeSize} onChange={(v) => update({ nodeSize: v })} />
              <Slider label="Link thickness" min={0.5} max={3} step={0.1} value={settings.linkWidth} onChange={(v) => update({ linkWidth: v })} />
            </Section>
            <Section title="Forces">
              <Slider label="Centre force" min={0} max={1} step={0.05} value={settings.centerForce} onChange={(v) => update({ centerForce: v })} />
              <Slider label="Repel force" min={0} max={20} step={0.5} value={settings.repelForce} onChange={(v) => update({ repelForce: v })} />
              <Slider label="Link force" min={0} max={1} step={0.05} value={settings.linkForce} onChange={(v) => update({ linkForce: v })} />
              <Slider label="Link distance" min={30} max={300} step={5} value={settings.linkDistance} onChange={(v) => update({ linkDistance: v })} />
            </Section>
            <button type="button" className="btn btn-ghost-dark btn-sm" onClick={() => update({ ...DEFAULT_SETTINGS })}>
              Reset to defaults
            </button>
          </div>
        )}
      </div>

      {/* bottom-right: legend */}
      <div className="graph-legend">
        {RELATIONS.map((r) => (
          <span key={r.id}>
            <i style={{ background: RELATION_COLORS[r.id] }} />
            {r.label}
          </span>
        ))}
        <span>
          <i className="dash" style={{ borderColor: GRAPH_THEME.keyword }} />
          Shared words
        </span>
        {mode === "student" && (
          <span>
            <i className="ring" />
            Your idea
          </span>
        )}
      </div>

      {/* selection */}
      {selected && (
        <IdeaDetails
          idea={selected}
          view={view}
          ideaById={ideaById}
          kwEdges={kw.edges}
          showNames={showNames}
          pairsInUse={pairsInUse}
          canLink={canLink && !!onAddLink && !selected.redacted}
          onClose={() => handleSelect(null)}
          onStartLink={() => setLinkFromId(selected.id)}
          onFocus={(id) => setSelectedId(id)}
          onDeleteLink={onDeleteLink}
          onDeleteIdea={onDeleteIdea}
          mode={mode}
        />
      )}

      {pending && onAddLink && ideaById.get(pending.source) && ideaById.get(pending.target) && (
        <LinkDialog
          source={ideaById.get(pending.source)!}
          target={ideaById.get(pending.target)!}
          onCancel={() => setPending(null)}
          onSave={async (source, target, relation, note) => {
            await onAddLink(source, target, relation, note);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function IdeaDetails({
  idea,
  view,
  ideaById,
  kwEdges,
  showNames,
  pairsInUse,
  canLink,
  onClose,
  onStartLink,
  onFocus,
  onDeleteLink,
  onDeleteIdea,
  mode,
}: {
  idea: IdeaView;
  view: LiveView;
  ideaById: Map<string, IdeaView>;
  kwEdges: { source: string; target: string; words: string[] }[];
  showNames: boolean;
  pairsInUse: boolean;
  canLink: boolean;
  onClose: () => void;
  onStartLink: () => void;
  onFocus: (id: string) => void;
  onDeleteLink?: (id: string) => Promise<void>;
  onDeleteIdea?: (id: string) => Promise<void>;
  mode: Props["mode"];
}) {
  const links = view.links.filter((l) => l.source === idea.id || l.target === idea.id);
  const words = kwEdges
    .filter((e) => e.source === idea.id || e.target === idea.id)
    .map((e) => ({ other: e.source === idea.id ? e.target : e.source, words: e.words }));
  const snippet = (id: string) => {
    const t = ideaById.get(id)?.text ?? "";
    return t.length > 70 ? t.slice(0, 68) + "…" : t;
  };

  return (
    <aside className="idea-details" aria-label="Selected idea">
      <div className="idea-details-head">
        <span className="dot" style={{ background: groupColor(idea.group) }} />
        <span className="muted small">
          {idea.mine
            ? "Your idea"
            : idea.fromPartner
              ? "Your partner's idea"
              : showNames && idea.authorNames.length
                ? idea.authorNames.join(" & ")
                : pairsInUse
                  ? "A classmate"
                  : "Idea"}
          {idea.mine && idea.authorNames.length > 1 ? ` · with ${idea.authorNames.slice(1).join(" & ")}` : ""}
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {idea.redacted ? (
        <p className="idea-details-text muted">Hidden until the Share phase.</p>
      ) : (
        <p className="idea-details-text">{idea.text}</p>
      )}

      {links.length > 0 && (
        <div className="detail-block">
          <h4>Connections</h4>
          <ul>
            {links.map((l) => {
              const outgoing = l.source === idea.id;
              const other = outgoing ? l.target : l.source;
              return (
                <li key={l.id}>
                  <i className="rel" style={{ background: RELATION_COLORS[l.relation] }} />
                  <div>
                    <span className="muted small">{outgoing ? `This ${verb(l.relation)}` : `${cap(verb(l.relation))} this`}</span>
                    <button type="button" className="link-btn" onClick={() => onFocus(other)}>
                      {snippet(other)}
                    </button>
                    {l.note && <span className="note">“{l.note}”</span>}
                    {l.byName && <span className="muted tiny">linked by {l.byName}</span>}
                  </div>
                  {(l.mine || mode === "teacher") && onDeleteLink && (
                    <button type="button" className="icon-btn" title="Remove link" onClick={() => onDeleteLink(l.id)}>
                      ✕
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {words.length > 0 && (
        <div className="detail-block">
          <h4>Shares words with</h4>
          <ul>
            {words.slice(0, 8).map((w) => (
              <li key={w.other}>
                <i className="rel dash" />
                <div>
                  <button type="button" className="link-btn" onClick={() => onFocus(w.other)}>
                    {snippet(w.other)}
                  </button>
                  <span className="muted tiny">{w.words.join(", ")}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="detail-actions">
        {canLink && (
          <button type="button" className="btn btn-accent btn-sm" onClick={onStartLink}>
            ⟶ Link this to another idea
          </button>
        )}
        {mode === "teacher" && onDeleteIdea && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (confirm("Delete this idea for everyone?")) void onDeleteIdea(idea.id);
            }}
          >
            Delete idea
          </button>
        )}
      </div>
    </aside>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="ctl-section">
      <button type="button" className="ctl-title" onClick={() => setOpen((o) => !o)}>
        <span className={`caret ${open ? "open" : ""}`}>›</span> {title}
      </button>
      {open && <div className="ctl-items">{children}</div>}
    </div>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ctl-row">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={value} className={`switch ${value ? "on" : ""}`} onClick={() => onChange(!value)}>
        <i />
      </button>
    </label>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
  format,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  return (
    <label className="ctl-slider">
      <span>
        {label}
        {format && <em>{format(value)}</em>}
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
