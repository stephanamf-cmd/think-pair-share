import { createHash, randomBytes, timingSafeEqual } from "crypto";

// No 0/O, 1/I/L — easy to read off a projector.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function makeCode(length = 5): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

export function makeId(prefix = ""): string {
  return prefix + randomBytes(8).toString("base64url");
}

export function makeSecret(): string {
  return randomBytes(24).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function secretMatches(secret: string | null | undefined, hash: string | undefined): boolean {
  if (!secret || !hash) return false;
  const a = Buffer.from(hashSecret(secret), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function normaliseCode(code: string): string {
  return (code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
}

/** Trim, collapse runs of blank space, strip control characters, cap length. */
export function cleanText(s: unknown, max: number, singleLine = false): string {
  if (typeof s !== "string") return "";
  let out = Array.from(s)
    .filter((ch) => {
      const c = ch.codePointAt(0) ?? 0;
      return c === 10 || c >= 32; // keep newlines, drop other control chars
    })
    .join("");
  out = singleLine ? out.replace(/\s+/g, " ") : out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return Array.from(out.trim()).slice(0, max).join("");
}
