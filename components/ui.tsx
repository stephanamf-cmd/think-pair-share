"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Phase } from "@/lib/types";
import { useNow } from "@/lib/client";

export const PHASE_INFO: Record<
  Phase,
  {
    label: string;
    color: string;
    hpl: { src: string; name: string } | null;
    student: string;
    board: string;
    teacher: string;
  }
> = {
  lobby: {
    label: "Lobby",
    color: "#8a94a6",
    hpl: null,
    student: "Your teacher will start the Think phase soon.",
    board: "Join now",
    teacher: "Students join with the code. Nothing can be posted yet.",
  },
  think: {
    label: "Think",
    color: "#30B4B4",
    hpl: { src: "/hpl-meta-thinking.png", name: "Meta-thinking" },
    student: "Think on your own and write down your ideas. Only you can see them for now.",
    board: "Think on your own",
    teacher: "Students write ideas privately. The board shows dots, not text.",
  },
  pair: {
    label: "Pair",
    color: "#8DB51F",
    hpl: { src: "/hpl-empathetic.png", name: "Empathetic" },
    student: "Talk with your partner. Read each other's ideas, improve them and link them.",
    board: "Find your partner and talk",
    teacher: "Partners see each other's ideas and can link them. Pairs are made automatically.",
  },
  share: {
    label: "Share",
    color: "#F39A1E",
    hpl: { src: "/hpl-linking.png", name: "Linking" },
    student: "Explore the class graph. Link your ideas to other people's.",
    board: "Share and link ideas",
    teacher: "Everyone sees every idea on the graph and can link them.",
  },
};

export function Brand({ dark = false, href = "/", children }: { dark?: boolean; href?: string; children?: React.ReactNode }) {
  return (
    <header className={`topbar ${dark ? "topbar-dark" : ""}`}>
      <Link href={href} className="brand" aria-label="Network International School — Think Pair Share home">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dark ? "/nis-logo-white.png" : "/nis-logo.png"} alt="Network International School" className="brand-logo" />
        <span className="brand-divider" />
        <span className="brand-app">
          Think <b>·</b> Pair <b>·</b> Share
        </span>
      </Link>
      <div className="topbar-right">{children}</div>
    </header>
  );
}

export function PhasePill({ phase, large = false }: { phase: Phase; large?: boolean }) {
  const info = PHASE_INFO[phase];
  return (
    <span className={`phase-pill ${large ? "large" : ""}`} style={{ ["--phase" as string]: info.color }}>
      <i />
      {info.label}
    </span>
  );
}

export function HplBadge({ phase, size = 56 }: { phase: Phase; size?: number }) {
  const hpl = PHASE_INFO[phase].hpl;
  if (!hpl) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={hpl.src} alt={`HPL: ${hpl.name}`} title={`HPL: ${hpl.name}`} width={size} height={size} className="hpl-badge" />
  );
}

export function PhaseSteps({ phase, onPick, disabled }: { phase: Phase; onPick?: (p: Phase) => void; disabled?: boolean }) {
  const order: Phase[] = ["lobby", "think", "pair", "share"];
  const idx = order.indexOf(phase);
  return (
    <div className="phase-steps" role="tablist">
      {order.map((p, i) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={p === phase}
          disabled={disabled || !onPick}
          className={`step ${p === phase ? "current" : ""} ${i < idx ? "done" : ""}`}
          style={{ ["--phase" as string]: PHASE_INFO[p].color }}
          onClick={() => onPick?.(p)}
        >
          <span className="step-num">{i === 0 ? "0" : i}</span>
          <span className="step-label">{PHASE_INFO[p].label}</span>
        </button>
      ))}
    </div>
  );
}

export function Timer({
  endsAt,
  total,
  offset,
  size = "md",
}: {
  endsAt: number | null;
  total: number | null;
  offset: number;
  size?: "sm" | "md" | "lg";
}) {
  const now = useNow(250, offset);
  if (!endsAt) return null;
  const left = Math.max(0, Math.ceil((endsAt - now) / 1000));
  const frac = total ? Math.max(0, Math.min(1, (endsAt - now) / (total * 1000))) : 0;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  const state = left === 0 ? "done" : left <= 10 ? "warn" : "";
  return (
    <div className={`timer timer-${size} ${state}`} role="timer" aria-live="off">
      <svg viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r="15.5" className="track" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          className="bar"
          strokeDasharray={`${(frac * 97.4).toFixed(2)} 97.4`}
          transform="rotate(-90 18 18)"
        />
      </svg>
      <span>{left === 0 ? "Time!" : `${mm}:${ss}`}</span>
    </div>
  );
}

export function QR({ text, size = 180 }: { text: string; size?: number }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    if (!text) return;
    QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1F3864", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [text]);
  return <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} aria-label="QR code to join" />;
}

export function useOrigin() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

export function Banner({ kind = "info", children }: { kind?: "info" | "warn" | "error"; children: React.ReactNode }) {
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="center-screen">
      <div className="spinner" aria-hidden />
      <p className="muted">{label}</p>
    </div>
  );
}

/** Shown to teachers when the server has no database and is using temporary memory. */
export function StorageWarning({ info }: { info: { storage?: string; envHints?: string[]; vercelEnv?: string | null } | null }) {
  const [local, setLocal] = useState(true);
  useEffect(() => setLocal(/^(localhost|127\.|0\.0\.0\.0|192\.168\.)/.test(window.location.hostname)), []);
  if (!info || info.storage !== "memory" || local) return null;
  const hints = info.envHints ?? [];
  const env = info.vercelEnv;
  return (
    <Banner kind="warn">
      <b>No database connection — sessions may disappear.</b>{" "}
      {hints.length > 0 ? (
        <>
          This deployment can see <code>{hints.join(", ")}</code>, but none of them is a Redis connection the app can use
          (it needs a <code>…_REST_API_URL</code> + <code>…_REST_API_TOKEN</code> pair, or a <code>redis://</code> URL).
        </>
      ) : (
        <>
          This deployment{env ? ` (${env})` : ""} has no database variables at all. In Vercel, open the project →{" "}
          <b>Storage</b> → your Upstash database → <b>Connect Project</b>, and make sure{" "}
          <b>{env === "preview" ? "Preview" : "Production"}</b> is ticked. Then go to <b>Deployments</b> and redeploy the
          latest deployment.
          {env === "preview" && " You're on a preview link — your main site address may already work."}
        </>
      )}
    </Banner>
  );
}
