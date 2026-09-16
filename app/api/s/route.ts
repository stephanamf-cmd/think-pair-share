import { getStore, storageInfo } from "@/lib/store";
import { makeCode, makeSecret, hashSecret, cleanText } from "@/lib/ids";
import { errorResponse, json } from "@/lib/server";
import { HttpError } from "@/lib/actions";
import { LIMITS, type Meta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pinRequired = () => !!process.env.TEACHER_PIN;

/** Setup info for the teacher page. */
export async function GET() {
  return json({ pinRequired: pinRequired(), ...storageInfo() });
}

/** Start a new session. */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { title?: string; prompt?: string; pin?: string };
    if (pinRequired() && String(body.pin ?? "").trim() !== process.env.TEACHER_PIN) {
      throw new HttpError(401, "That teacher PIN isn't right.", "bad_pin");
    }
    const store = getStore();
    const teacherKey = makeSecret();
    const base = {
      title: cleanText(body.title, LIMITS.titleChars, true) || "Think · Pair · Share",
      prompt: cleanText(body.prompt, LIMITS.promptChars),
      phase: "lobby" as const,
      createdAt: Date.now(),
      timerEndsAt: null,
      timerTotal: null,
      anonymous: false,
      locked: false,
      pairs: [],
      teacherKeyHash: hashSecret(teacherKey),
    };
    for (let attempt = 0; attempt < 8; attempt++) {
      const meta: Meta = { ...base, code: makeCode(attempt < 5 ? 5 : 6) };
      if (await store.create(meta)) {
        return json({ code: meta.code, teacherKey, storage: store.kind });
      }
    }
    throw new HttpError(503, "Couldn't find a free session code. Please try again.");
  } catch (err) {
    return errorResponse(err);
  }
}
