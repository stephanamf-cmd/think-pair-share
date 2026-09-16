/**
 * Shared-keyword links: two ideas are joined when they use the same meaningful word(s).
 *
 * - Common English words are ignored.
 * - Words are lightly stemmed so "heat", "heats", "heating" and "heated" match.
 * - Words from the question itself are ignored (otherwise everything links to everything).
 * - Words used by more than half the class are ignored once there are enough ideas.
 */

const STOP = new Set(
  `a about above after again against all almost also although always am among an and another any anybody anyone
  anything are around as at away back be became because become becomes been before being below between both but by
  came can cannot could did do does doing done down during each either else enough etc even ever every everyone
  everything few for from further get gets getting give given go goes going gone got had has have having he her here
  hers herself him himself his how however i if in into is it its itself just keep know like likely made make makes
  making many may maybe me might mine more most much must my myself need needs never no nor not nothing now of off
  often on once one only or other others our ours ourselves out over own part people per perhaps put quite rather
  really said same say says see seem seems several shall she should show since so some something sometimes still
  such take than that the their theirs them themselves then there these they thing things think this those though
  through thus to together too took toward towards under until up upon us use used uses using very via want was way
  ways we well were what whatever when where whether which while who whom whose why will with within without would
  yes yet you your yours yourself yourselves idea ideas because becuase dont cant wont isnt doesnt didnt im ive
  also lot lots kind sort really actually basically`
    .split(/\s+/)
    .filter(Boolean),
);

const hasVowel = (s: string) => /[aeiouy]/.test(s);

export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 5 && w.endsWith("ing") && hasVowel(w.slice(0, -3))) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed") && !w.endsWith("eed") && hasVowel(w.slice(0, -2))) w = w.slice(0, -2);
  else if (w.length > 4 && w.endsWith("es") && /(ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  // "running" -> "runn" -> "run"
  if (w.length > 3 && /([bdfgmnprt])\1$/.test(w)) w = w.slice(0, -1);
  return w;
}

export function keywordsOf(text: string): Map<string, string> {
  const out = new Map<string, string>(); // stem -> first surface form
  const words = text
    .toLowerCase()
    .replace(/[’']/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  for (const raw of words) {
    if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue;
    const s = stem(raw);
    if (s.length < 3 || STOP.has(s)) continue;
    if (!out.has(s)) out.set(s, raw);
  }
  return out;
}

export interface KeywordEdge {
  source: string;
  target: string;
  words: string[];
  weight: number;
}

/**
 * @param minShared   how many meaningful words two ideas must share
 * @param maxPerIdea  keep only each idea's strongest N word links (0 = keep all). Rarer shared words count
 *                    for more, so "photosynthesis" beats "plants". This is what stops big classes turning into a hairball.
 */
export function keywordEdges(
  ideas: { id: string; text: string }[],
  opts: { minShared: number; ignoreText?: string; maxShare?: number; maxPerIdea?: number },
): { edges: KeywordEdge[]; top: { word: string; count: number }[] } {
  const ignore = new Set(opts.ignoreText ? keywordsOf(opts.ignoreText).keys() : []);
  const kw = ideas.map((i) => ({ id: i.id, words: keywordsOf(i.text) }));

  // How many ideas use each word?
  const df = new Map<string, number>();
  const surface = new Map<string, string>();
  for (const k of kw)
    for (const [s, raw] of k.words) {
      df.set(s, (df.get(s) ?? 0) + 1);
      if (!surface.has(s)) surface.set(s, raw);
    }
  const maxShare = opts.maxShare ?? 0.5;
  const tooCommon = (s: string) => ideas.length >= 6 && (df.get(s) ?? 0) / ideas.length > maxShare;
  const usable = (s: string) => !ignore.has(s) && !tooCommon(s) && (df.get(s) ?? 0) >= 2;
  const idf = (s: string) => Math.log(1 + ideas.length / (df.get(s) ?? 1));

  // Index ideas by word, then only compare ideas that share something.
  const byWord = new Map<string, number[]>();
  kw.forEach((k, idx) => {
    for (const s of k.words.keys()) if (usable(s)) (byWord.get(s) ?? byWord.set(s, []).get(s)!).push(idx);
  });
  const shared = new Map<string, { words: string[]; weight: number }>();
  for (const [s, list] of byWord) {
    for (let a = 0; a < list.length; a++)
      for (let b = a + 1; b < list.length; b++) {
        const key = `${list[a]}|${list[b]}`;
        const entry = shared.get(key) ?? shared.set(key, { words: [], weight: 0 }).get(key)!;
        entry.words.push(surface.get(s) ?? s);
        entry.weight += idf(s);
      }
  }
  let edges: KeywordEdge[] = [];
  for (const [key, { words, weight }] of shared) {
    if (words.length < opts.minShared) continue;
    const [a, b] = key.split("|").map(Number);
    edges.push({ source: kw[a].id, target: kw[b].id, words, weight });
  }

  const cap = opts.maxPerIdea ?? 0;
  if (cap > 0) {
    const ranked = new Map<string, KeywordEdge[]>();
    for (const e of edges) {
      (ranked.get(e.source) ?? ranked.set(e.source, []).get(e.source)!).push(e);
      (ranked.get(e.target) ?? ranked.set(e.target, []).get(e.target)!).push(e);
    }
    const keep = new Set<KeywordEdge>();
    for (const list of ranked.values()) {
      list.sort((x, y) => y.weight - x.weight).slice(0, cap).forEach((e) => keep.add(e));
    }
    edges = edges.filter((e) => keep.has(e));
  }

  const top = [...df.entries()]
    .filter(([s, n]) => n >= 2 && !ignore.has(s))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([s, count]) => ({ word: surface.get(s) ?? s, count }));
  return { edges, top };
}
