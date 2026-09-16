import { RELATIONS } from "./types";
import type { LiveView } from "./client";

const verb = (r: string) => RELATIONS.find((x) => x.id === r)?.verb ?? r;
const stamp = () => new Date().toISOString().slice(0, 10);

function csvCell(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportFilename(view: LiveView, ext: string) {
  const slug = view.session.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "session";
  return `${slug}-${view.session.code}-${stamp()}.${ext}`;
}

export function toCsv(view: LiveView): string {
  const num = new Map(view.ideas.map((i, n) => [i.id, n + 1]));
  const pairOf = new Map<string, number>();
  view.pairs.forEach((p, i) => p.forEach((id) => pairOf.set(id, i + 1)));
  const rows: unknown[][] = [["Idea #", "Idea", "Author(s)", "Pair", "Posted", "Links out", "Links in"]];
  for (const i of view.ideas) {
    const out = view.links.filter((l) => l.source === i.id).map((l) => `${verb(l.relation)} #${num.get(l.target)}${l.note ? ` (${l.note})` : ""}`);
    const inn = view.links.filter((l) => l.target === i.id).map((l) => `#${num.get(l.source)} ${verb(l.relation)} this`);
    const pair = i.authorIds?.map((a) => pairOf.get(a)).find(Boolean) ?? "";
    rows.push([num.get(i.id), i.text, i.authorNames.join(" & "), pair, new Date(i.createdAt).toLocaleString("en-GB"), out.join("; "), inn.join("; ")]);
  }
  return "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

/** One Markdown note with [[wikilinks]] — drops straight into Obsidian. */
export function toMarkdown(view: LiveView): string {
  const num = new Map(view.ideas.map((i, n) => [i.id, n + 1]));
  const lines: string[] = [];
  lines.push(`# ${view.session.title}`, "");
  if (view.session.prompt) lines.push(`> ${view.session.prompt.replace(/\n/g, "\n> ")}`, "");
  lines.push(`Code ${view.session.code} · ${new Date(view.session.createdAt).toLocaleDateString("en-GB")} · ${view.studentCount} students · ${view.ideas.length} ideas · ${view.links.length} links`, "");
  for (const i of view.ideas) {
    const n = num.get(i.id);
    lines.push(`## Idea ${n}`, "", i.text, "");
    if (i.authorNames.length) lines.push(`- **By:** ${i.authorNames.join(" & ")}`);
    for (const l of view.links.filter((l) => l.source === i.id)) {
      lines.push(`- ${verb(l.relation)} [[#Idea ${num.get(l.target)}]]${l.note ? ` — ${l.note}` : ""}${l.byName ? ` _(${l.byName})_` : ""}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function toJson(view: LiveView): string {
  const { storage: _s, storageVar: _v, envHints: _h, vercelEnv: _e, ...rest } = view;
  return JSON.stringify(rest, null, 2);
}
