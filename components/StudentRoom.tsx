"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, identity, useSession, ApiError, type Auth, type LiveView, type StudentIdentity } from "@/lib/client";
import { LIMITS, type IdeaView, type Relation } from "@/lib/types";
import { Banner, Brand, HplBadge, PHASE_INFO, PhasePill, Spinner, Timer } from "./ui";
import JoinForm from "./JoinForm";
import GraphPanel from "./GraphPanel";
import { SummaryPanel } from "./SummaryCard";
import LinkDialog from "./LinkDialog";
import { groupColor } from "./Graph";

export default function StudentRoom({ code }: { code: string }) {
  const [ident, setIdent] = useState<StudentIdentity | null | undefined>(undefined);
  useEffect(() => setIdent(identity.student(code)), [code]);

  const auth: Auth | null = useMemo(
    () =>
      ident === undefined
        ? null
        : ident
          ? { role: "student", studentId: ident.studentId, token: ident.token }
          : { role: "board" },
    [ident],
  );
  const { view, error, refresh, clockOffset } = useSession(code, auth, 2500);

  useEffect(() => {
    if (error?.code === "student_gone") {
      identity.clearStudent(code);
      setIdent(null);
    }
  }, [error, code]);

  if (error?.code === "not_found") {
    return (
      <>
        <Brand />
        <div className="center-screen">
          <h2>No session called {code}</h2>
          <p className="muted">Check the code on the board — it may have ended.</p>
          <Link className="btn btn-primary" href="/">
            Try another code
          </Link>
        </div>
      </>
    );
  }

  if (ident === undefined || !view) return <Spinner label={error ? error.message : "Connecting…"} />;

  if (!ident || view.role !== "student") {
    return (
      <>
        <Brand />
        <main className="container narrow room stack">
          <div className="card card-navy prompt-card">
            <div className="prompt-head">
              <div className="row">
                <PhasePill phase={view.session.phase} />
                <span className="muted small">{view.session.title}</span>
              </div>
              <span className="muted small">Code {code}</span>
            </div>
            {view.session.prompt && <p className="prompt-text">{view.session.prompt}</p>}
          </div>
          <div className="card">
            <h2>Join this session</h2>
            <JoinForm fixedCode={code} onJoined={() => setIdent(identity.student(code))} />
          </div>
        </main>
      </>
    );
  }

  return <Room code={code} view={view} ident={ident} auth={auth!} refresh={refresh} clockOffset={clockOffset} error={error} onLeave={() => {
    identity.clearStudent(code);
    setIdent(null);
  }} />;
}

/* ------------------------------------------------------------------ */

function Room({
  code,
  view,
  ident,
  auth,
  refresh,
  clockOffset,
  error,
  onLeave,
}: {
  code: string;
  view: LiveView;
  ident: StudentIdentity;
  auth: Auth;
  refresh: () => Promise<void>;
  clockOffset: number;
  error: ApiError | null;
  onLeave: () => void;
}) {
  const { session } = view;
  const phase = session.phase;
  const info = PHASE_INFO[phase];
  const [toast, setToast] = useState("");
  const [linkStart, setLinkStart] = useState<IdeaView | null>(null);
  const [pendingLink, setPendingLink] = useState<{ source: IdeaView; target: IdeaView } | null>(null);
  const [tab, setTab] = useState<"graph" | "all" | "mine">("graph");
  const [pairTab, setPairTab] = useState<"list" | "graph">("list");

  const run = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await refresh();
      } catch (e) {
        setToast((e as Error).message);
        setTimeout(() => setToast(""), 4000);
        throw e;
      }
    },
    [refresh],
  );

  const addIdea = (text: string, asPair: boolean) => run(() => api(code, auth, { action: "addIdea", text, asPair }));
  const editIdea = (id: string, text: string) => run(() => api(code, auth, { action: "editIdea", id, text }));
  const deleteIdea = (id: string) => run(() => api(code, auth, { action: "deleteIdea", id }));
  const addLink = (source: string, target: string, relation: Relation, note: string) =>
    run(() => api(code, auth, { action: "addLink", source, target, relation, note }));
  const deleteLink = (id: string) => run(() => api(code, auth, { action: "deleteLink", id }));

  const mine = view.ideas.filter((i) => i.mine);
  const partnerIdeas = view.ideas.filter((i) => i.fromPartner);
  const others = view.ideas.filter((i) => !i.mine);
  const canPost = !session.locked && phase !== "lobby";
  const canLink = !session.locked && (phase === "pair" || phase === "share");
  const myName = view.me?.name ?? ident.name;
  const myStarted = mine.filter((i) => i.authorNames[0] === myName).length;

  const linkCandidates = (from: IdeaView) => view.ideas.filter((i) => i.id !== from.id && !i.redacted);

  return (
    <>
      <Brand>
        <span className="me-chip" title={ident.name}>
          <span>{view.me?.name ?? ident.name}</span>
          <button
            className="leave"
            title="Leave this session on this device"
            onClick={() => {
              if (confirm("Leave this session? Your ideas stay, but you'll need to join again.")) onLeave();
            }}
          >
            Leave
          </button>
        </span>
      </Brand>

      <main className="container room stack">
        {error && error.code === "offline" && <Banner kind="warn">{error.message}</Banner>}
        {session.locked && <Banner kind="info">Your teacher has locked the session. You can still look around.</Banner>}

        <div className="card card-navy prompt-card">
          <div className="prompt-head">
            <div className="row">
              <PhasePill phase={phase} />
              <span className="muted small">{session.title}</span>
            </div>
            <Timer endsAt={session.timerEndsAt} total={session.timerTotal} offset={clockOffset} size="sm" />
          </div>
          {session.prompt && <p className="prompt-text">{session.prompt}</p>}
          <div className="instruction">
            <HplBadge phase={phase} size={40} />
            <span>{info.student}</span>
          </div>
        </div>

        {phase === "lobby" && (
          <div className="card waiting">
            <div className="orbit" aria-hidden>
              <i />
              <i />
              <i />
            </div>
            <h3>You&apos;re in, {ident.name.split(" ")[0]}!</h3>
            <p className="muted">{view.studentCount} in the session. Keep this page open.</p>
          </div>
        )}

        {view.summary && <SummaryPanel view={view} variant="student" />}

        {phase === "pair" && <PartnerCard view={view} />}

        {canPost && (phase !== "share" || myStarted < LIMITS.ideasPerStudent) && (
          <Composer
            key={phase}
            phase={phase}
            hasPartner={view.myPartners.length > 0}
            remaining={LIMITS.ideasPerStudent - myStarted}
            onSubmit={addIdea}
            compact={phase === "share"}
          />
        )}

        {phase === "think" && (
          <section className="stack">
            <h4>Your ideas · only you can see these</h4>
            <IdeaList ideas={mine} empty="No ideas yet — what do you think?" onEdit={editIdea} onDelete={deleteIdea} editable={!session.locked} />
          </section>
        )}

        {phase === "pair" && (
          <section className="stack">
            <div className="tabs">
              <button className={pairTab === "list" ? "on" : ""} onClick={() => setPairTab("list")}>
                Our ideas <span className="count">{mine.length + partnerIdeas.length}</span>
              </button>
              <button className={pairTab === "graph" ? "on" : ""} onClick={() => setPairTab("graph")}>
                Graph
              </button>
            </div>
            {pairTab === "list" ? (
              <>
                <h4>Your partner&apos;s ideas</h4>
                <IdeaList
                  ideas={partnerIdeas}
                  empty={view.myPartners.length ? "Your partner hasn't posted yet." : "You'll see your partner's ideas here."}
                  onLink={canLink ? (i) => setLinkStart(i) : undefined}
                  links={view.links}
                />
                <h4>Your ideas</h4>
                <IdeaList
                  ideas={mine}
                  empty="You haven't posted an idea yet."
                  onEdit={editIdea}
                  onDelete={deleteIdea}
                  editable={!session.locked}
                  onLink={canLink ? (i) => setLinkStart(i) : undefined}
                  links={view.links}
                />
              </>
            ) : (
              <GraphPanel
                view={view}
                mode="student"
                canLink={canLink}
                onAddLink={addLink}
                onDeleteLink={deleteLink}
                className="student-graph"
              />
            )}
          </section>
        )}

        {phase === "share" && (
          <section>
            <div className="tabs">
              <button className={tab === "graph" ? "on" : ""} onClick={() => setTab("graph")}>
                Class graph
              </button>
              <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>
                Everyone <span className="count">{others.length}</span>
              </button>
              <button className={tab === "mine" ? "on" : ""} onClick={() => setTab("mine")}>
                Mine <span className="count">{mine.length}</span>
              </button>
            </div>
            {tab === "graph" && (
              <>
                <GraphPanel
                  view={view}
                  mode="student"
                  canLink={canLink}
                  onAddLink={addLink}
                  onDeleteLink={deleteLink}
                  className="student-graph"
                />
                <p className="muted small" style={{ marginTop: 8 }}>
                  Tap an idea to read it. Tap <b>Link this to another idea</b>, then tap the idea it connects to. Drag to
                  move, pinch or scroll to zoom.
                </p>
              </>
            )}
            {tab === "all" && (
              <IdeaList
                ideas={others}
                empty="No one else has posted yet."
                onLink={canLink ? (i) => setLinkStart(i) : undefined}
                links={view.links}
              />
            )}
            {tab === "mine" && (
              <IdeaList
                ideas={mine}
                empty="You haven't posted an idea."
                onEdit={editIdea}
                onDelete={deleteIdea}
                editable={!session.locked}
                onLink={canLink ? (i) => setLinkStart(i) : undefined}
                links={view.links}
              />
            )}
          </section>
        )}

        <MyLinks view={view} onDelete={deleteLink} />
      </main>

      {linkStart && (
        <PickIdea
          from={linkStart}
          candidates={linkCandidates(linkStart)}
          preferMine={!linkStart.mine}
          onCancel={() => setLinkStart(null)}
          onPick={(other) => {
            // Your own idea goes first so the sentence reads "my idea builds on theirs".
            const [source, target] = linkStart.mine || !other.mine ? [linkStart, other] : [other, linkStart];
            setPendingLink({ source, target });
            setLinkStart(null);
          }}
        />
      )}
      {pendingLink && (
        <LinkDialog
          source={pendingLink.source}
          target={pendingLink.target}
          onCancel={() => setPendingLink(null)}
          onSave={async (s, t, r, n) => {
            await addLink(s, t, r, n);
            setPendingLink(null);
          }}
        />
      )}
      {toast && (
        <div className="modal-backdrop" style={{ background: "transparent", pointerEvents: "none", placeItems: "end center" }}>
          <div className="banner banner-error" style={{ pointerEvents: "auto", background: "#fff" }}>
            {toast}
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

function PartnerCard({ view }: { view: LiveView }) {
  const partners = view.myPartners;
  const group = view.ideas.find((i) => i.mine || i.fromPartner)?.group ?? 0;
  if (!partners.length) {
    return (
      <div className="card partner-card">
        <div className="orbit" style={{ transform: "scale(0.6)", margin: -16 }} aria-hidden>
          <i />
          <i />
          <i />
        </div>
        <div>
          <h3 style={{ margin: 0 }}>Finding you a partner…</h3>
          <p className="muted small" style={{ margin: 0 }}>
            Your teacher will pair you up in a moment.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="card partner-card">
      <div className="partner-avatars">
        {partners.map((p, i) => (
          <span key={p.id} className="avatar" style={{ background: i === 0 ? groupColor(group) : "#30B4B4" }}>
            {p.name.charAt(0).toUpperCase()}
          </span>
        ))}
      </div>
      <div>
        <span className="muted small">Your {partners.length > 1 ? "group" : "partner"}</span>
        <h3 style={{ margin: 0 }}>{partners.map((p) => p.name).join(" & ")}</h3>
      </div>
    </div>
  );
}

function Composer({
  phase,
  hasPartner,
  remaining,
  onSubmit,
  compact,
}: {
  phase: string;
  hasPartner: boolean;
  remaining: number;
  onSubmit: (text: string, asPair: boolean) => Promise<void>;
  compact?: boolean;
}) {
  const [text, setText] = useState("");
  const [asPair, setAsPair] = useState(false);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(!compact);
  const left = LIMITS.ideaChars - Array.from(text).length;

  if (!open) {
    return (
      <button className="btn btn-ghost btn-block" onClick={() => setOpen(true)}>
        + Add another idea
      </button>
    );
  }
  if (remaining <= 0) return <Banner kind="info">You&apos;ve posted the maximum of {LIMITS.ideasPerStudent} ideas. Edit or delete one to add more.</Banner>;

  const submit = async () => {
    if (!text.trim() || busy) return;
    const posted = text;
    setBusy(true);
    setText(""); // clear straight away so a quick next idea isn't wiped when the save finishes
    try {
      await onSubmit(posted, asPair);
    } catch {
      setText((cur) => cur || posted); // put it back if the save failed (toast explains why)
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card composer">
      <label className="sr-only" htmlFor="idea-input">
        Your idea
      </label>
      <textarea
        id="idea-input"
        className="textarea"
        placeholder={phase === "pair" ? "Write an idea — or one you've improved together…" : "I think… because…"}
        value={text}
        maxLength={LIMITS.ideaChars}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-foot">
        <div className="row">
          {phase !== "think" && hasPartner && (
            <label className="check">
              <input type="checkbox" checked={asPair} onChange={(e) => setAsPair(e.target.checked)} />
              Post as a pair idea
            </label>
          )}
          <span className={`counter ${left < 30 ? "warn" : ""}`}>{left}</span>
        </div>
        <button className="btn btn-accent" disabled={busy || !text.trim()} onClick={submit}>
          {busy ? "Posting…" : "Post idea"}
        </button>
      </div>
    </div>
  );
}

function IdeaList({
  ideas,
  empty,
  onEdit,
  onDelete,
  onLink,
  editable,
  links,
}: {
  ideas: IdeaView[];
  empty: string;
  onEdit?: (id: string, text: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onLink?: (idea: IdeaView) => void;
  editable?: boolean;
  links?: LiveView["links"];
}) {
  if (!ideas.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="idea-list">
      {[...ideas].reverse().map((i) => (
        <IdeaItem
          key={i.id}
          idea={i}
          onEdit={editable ? onEdit : undefined}
          onDelete={editable ? onDelete : undefined}
          onLink={onLink}
          linkCount={links?.filter((l) => l.source === i.id || l.target === i.id).length ?? 0}
        />
      ))}
    </ul>
  );
}

function IdeaItem({
  idea,
  onEdit,
  onDelete,
  onLink,
  linkCount,
}: {
  idea: IdeaView;
  onEdit?: (id: string, text: string) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
  onLink?: (idea: IdeaView) => void;
  linkCount: number;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(idea.text);
  useEffect(() => {
    if (!editing) setText(idea.text);
  }, [idea.text, editing]);

  return (
    <li className="idea" style={{ ["--accent" as string]: groupColor(idea.group) }}>
      {editing ? (
        <>
          <textarea className="textarea" value={text} maxLength={LIMITS.ideaChars} onChange={(e) => setText(e.target.value)} />
          <div className="idea-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-sm"
              disabled={!text.trim()}
              onClick={async () => {
                await onEdit?.(idea.id, text).catch(() => {});
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="idea-text">{idea.text}</p>
          <div className="spread">
            <div className="idea-meta">
              {idea.mine && idea.authorNames.length > 1 && <span className="tag tag-green">Pair idea</span>}
              {!idea.mine && idea.authorNames.length > 0 && <span>{idea.authorNames.join(" & ")}</span>}
              {linkCount > 0 && <span className="tag tag-teal">{linkCount} link{linkCount === 1 ? "" : "s"}</span>}
            </div>
            <div className="idea-actions">
              {onLink && (
                <button className="btn btn-ghost btn-sm" onClick={() => onLink(idea)}>
                  ⟶ Link
                </button>
              )}
              {onEdit && (
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
              {onDelete && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    if (confirm("Delete this idea?")) void onDelete(idea.id).catch(() => {});
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </li>
  );
}

function PickIdea({
  from,
  candidates,
  preferMine,
  onPick,
  onCancel,
}: {
  from: IdeaView;
  candidates: IdeaView[];
  preferMine: boolean;
  onPick: (i: IdeaView) => void;
  onCancel: () => void;
}) {
  const sorted = [...candidates].sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.fromPartner) - Number(a.fromPartner));
  const list = preferMine ? sorted : sorted.filter((i) => !i.mine).concat(sorted.filter((i) => i.mine));
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>Link to which idea?</h3>
        <div className="idea-chip" style={{ marginBottom: 12 }}>
          {from.text}
        </div>
        {list.length === 0 ? (
          <p className="muted">There are no other ideas to link to yet.</p>
        ) : (
          <ul className="pick-list">
            {list.map((i) => (
              <li key={i.id}>
                <button style={{ ["--accent" as string]: groupColor(i.group) }} onClick={() => onPick(i)}>
                  <span className="muted tiny">{i.mine ? "Your idea" : i.fromPartner ? "Partner's idea" : i.authorNames.join(" & ") || "Classmate"}</span>
                  <br />
                  {i.text}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function MyLinks({ view, onDelete }: { view: LiveView; onDelete: (id: string) => Promise<void> }) {
  const mine = view.links.filter((l) => l.mine);
  const byId = new Map(view.ideas.map((i) => [i.id, i]));
  if (!mine.length) return null;
  const short = (id: string) => {
    const t = byId.get(id)?.text ?? "";
    return t.length > 60 ? t.slice(0, 58) + "…" : t;
  };
  return (
    <details className="card card-tight">
      <summary style={{ cursor: "pointer", fontWeight: 650 }}>Links you&apos;ve made ({mine.length})</summary>
      <ul className="idea-list" style={{ marginTop: 10 }}>
        {mine.map((l) => (
          <li key={l.id} className="spread" style={{ gap: 6 }}>
            <span className="small grow">
              “{short(l.source)}” <b>{l.relation === "builds" ? "builds on" : l.relation === "agrees" ? "agrees with" : l.relation === "challenges" ? "challenges" : "is similar to"}</b> “{short(l.target)}”
              {l.note && <span className="muted"> — {l.note}</span>}
            </span>
            <button className="icon-btn" title="Remove" onClick={() => void onDelete(l.id).catch(() => {})}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
