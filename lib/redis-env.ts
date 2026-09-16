/**
 * Find Redis connection details in the environment, whatever the provider called them.
 *
 * Vercel's Marketplace integrations don't all use the same names:
 *   Upstash (REST):  KV_REST_API_URL + KV_REST_API_TOKEN, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   With a custom prefix when connecting: e.g. MYDB_KV_REST_API_URL + MYDB_KV_REST_API_TOKEN
 *   Redis Cloud / plain Redis: REDIS_URL (redis:// or rediss://), sometimes KV_URL
 *
 * We prefer a REST pair (works everywhere), then fall back to any redis:// URL.
 * Only variable NAMES are ever reported back to the browser — never values.
 */

export type RedisEnv =
  | { type: "rest"; url: string; token: string; urlVar: string; tokenVar: string }
  | { type: "tcp"; url: string; urlVar: string };

type Env = Record<string, string | undefined>;

const PREFERRED_REST = ["UPSTASH_REDIS_REST_URL", "KV_REST_API_URL"];
const PREFERRED_TCP = ["REDIS_URL", "KV_URL", "UPSTASH_REDIS_URL", "REDIS_TLS_URL"];

const looksRedisy = (name: string) => /REDIS|UPSTASH|(^|_)KV(_|$)|VALKEY/i.test(name);

function rank(name: string, preferred: string[]) {
  const i = preferred.indexOf(name);
  if (i >= 0) return i;
  return looksRedisy(name) ? 50 : 100;
}

export function findRedisEnv(env: Env = process.env): RedisEnv | null {
  const names = Object.keys(env).filter((k) => (env[k] ?? "").trim() !== "");

  // 1) REST URL + matching TOKEN (same name with URL -> TOKEN)
  const restUrls = names
    .filter((k) => /REST(_API)?_URL$/.test(k) && /^https?:\/\//i.test(env[k]!.trim()))
    .sort((a, b) => rank(a, PREFERRED_REST) - rank(b, PREFERRED_REST));
  for (const urlVar of restUrls) {
    const tokenVar = urlVar.replace(/URL$/, "TOKEN");
    const token = env[tokenVar]?.trim();
    if (token) return { type: "rest", url: env[urlVar]!.trim(), token, urlVar, tokenVar };
  }

  // 2) Any redis:// or rediss:// connection string
  const tcpUrls = names
    .filter((k) => /^rediss?:\/\//i.test(env[k]!.trim()))
    .sort((a, b) => rank(a, PREFERRED_TCP) - rank(b, PREFERRED_TCP));
  if (tcpUrls.length) return { type: "tcp", url: env[tcpUrls[0]]!.trim(), urlVar: tcpUrls[0] };

  return null;
}

/** Names (only) of variables that look database-related — shown when no connection could be made. */
export function redisEnvHints(env: Env = process.env): string[] {
  return Object.keys(env)
    .filter((k) => looksRedisy(k) || /^STORAGE_/.test(k))
    .filter((k) => !/^(VERCEL|NEXT|NODE|npm_)/i.test(k))
    .sort()
    .slice(0, 20);
}
