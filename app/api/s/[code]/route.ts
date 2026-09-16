import { getStore, storageInfo } from "@/lib/store";
import { normaliseCode } from "@/lib/ids";
import { errorResponse, json, resolveViewer } from "@/lib/server";
import { HttpError, performAction } from "@/lib/actions";
import { buildView } from "@/lib/view";
import { aiInfo } from "@/lib/ai";
import type { Action } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // AI summaries can take a few seconds

type Ctx = { params: Promise<{ code: string }> };

const notFound = () => new HttpError(404, "No session with that code. Check the code on the board.", "not_found");

/**
 * Poll for the latest state.
 * ?v=<version the browser already has>. If nothing changed we answer with one cheap Redis read.
 */
export async function GET(req: Request, { params }: Ctx) {
  try {
    const code = normaliseCode((await params).code);
    const store = getStore();
    const known = Number(new URL(req.url).searchParams.get("v") ?? -1);
    const v = await store.version(code);
    if (v === null) throw notFound();
    if (v === known) return json({ same: true, version: v, serverNow: Date.now() });
    const st = await store.load(code);
    if (!st) throw notFound();
    const viewer = resolveViewer(req, st);
    const info = viewer.role === "teacher" ? { ...storageInfo(), ai: aiInfo() } : { storage: store.kind };
    return json({ ...buildView(st, viewer), ...info });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Every change goes through here: { action: "addIdea", ... } — see lib/actions.ts. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const code = normaliseCode((await params).code);
    const store = getStore();
    const body = (await req.json().catch(() => null)) as Action | null;
    if (!body || typeof body !== "object" || typeof body.action !== "string") {
      throw new HttpError(400, "Bad request.");
    }
    const st = await store.load(code);
    if (!st) throw notFound();
    const viewer = body.action === "join" ? { role: "board" as const } : resolveViewer(req, st);
    const result = await performAction(store, st, viewer, body);
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

/** Teacher ends and deletes the session. */
export async function DELETE(req: Request, { params }: Ctx) {
  try {
    const code = normaliseCode((await params).code);
    const store = getStore();
    const st = await store.load(code);
    if (!st) throw notFound();
    if (resolveViewer(req, st).role !== "teacher") throw new HttpError(403, "Only the teacher can do that.");
    await store.destroy(code);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
