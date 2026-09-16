export type Phase = "lobby" | "think" | "pair" | "share";
export const PHASES: Phase[] = ["lobby", "think", "pair", "share"];

export type Relation = "builds" | "agrees" | "challenges" | "similar";
export const RELATIONS: { id: Relation; label: string; verb: string }[] = [
  { id: "builds", label: "Builds on", verb: "builds on" },
  { id: "agrees", label: "Agrees with", verb: "agrees with" },
  { id: "challenges", label: "Challenges", verb: "challenges" },
  { id: "similar", label: "Similar to", verb: "is similar to" },
];

export const LIMITS = {
  ideaChars: 280,
  ideasPerStudent: 8,
  linksPerStudent: 30,
  nameChars: 30,
  noteChars: 120,
  titleChars: 80,
  promptChars: 300,
  studentsPerSession: 80,
};

/* ---------- Stored records ---------- */

export interface Meta {
  code: string;
  title: string;
  prompt: string;
  phase: Phase;
  createdAt: number;
  timerEndsAt: number | null;
  timerTotal: number | null;
  anonymous: boolean;
  locked: boolean;
  pairs: string[][];
  teacherKeyHash: string;
  summary?: Summary | null;
}

export type AiProvider = "gemini" | "groq" | "anthropic";

export interface SummaryTheme {
  title: string;
  ideaIds: string[];
}

/** A teachable round-up of the class's ideas, made by an AI model (or the built-in fallback). */
export interface Summary {
  paragraph: string;
  themes: SummaryTheme[];
  misconception: string;
  nextQuestion: string;
  source: AiProvider | "basic";
  model: string;
  createdAt: number;
  ideaCount: number;
  edited: boolean;
  shown: boolean; // visible on the board and students' screens
  notice?: string; // e.g. why the built-in summary was used
}

export interface Student {
  id: string;
  name: string;
  tokenHash: string;
  joinedAt: number;
}

export interface Idea {
  id: string;
  text: string;
  authorIds: string[];
  createdAt: number;
  updatedAt: number;
  phase: Phase;
}

export interface Link {
  id: string;
  source: string;
  target: string;
  relation: Relation;
  note: string;
  byId: string; // student id or "teacher"
  createdAt: number;
}

export interface SessionState {
  meta: Meta;
  students: Record<string, Student>;
  ideas: Record<string, Idea>;
  links: Record<string, Link>;
  version: number;
}

/* ---------- What the browser receives ---------- */

export type Role = "teacher" | "student" | "board";

export interface IdeaView {
  id: string;
  text: string;
  authorNames: string[];
  authorIds?: string[]; // teacher only
  group: number; // colour group: pair index, or author index when there are no pairs
  mine: boolean;
  fromPartner: boolean;
  redacted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LinkView {
  id: string;
  source: string;
  target: string;
  relation: Relation;
  note: string;
  byName: string;
  mine: boolean;
}

export interface StudentView {
  id: string;
  name: string;
  ideaCount?: number; // teacher only
  linkCount?: number; // teacher only
  pairIndex: number;
}

export type PublicMeta = Omit<Meta, "teacherKeyHash" | "pairs" | "summary">;

export interface SessionView {
  role: Role;
  version: number;
  serverNow: number;
  me: { id: string; name: string } | null;
  session: PublicMeta;
  students: StudentView[];
  studentCount: number;
  ideaCount: number;
  pairs: string[][]; // teacher/board: all pairs; student: only their own
  myPartners: { id: string; name: string }[];
  ideas: IdeaView[];
  links: LinkView[];
  /** Teacher: always (if made). Board/students: only when the teacher has shown it. */
  summary: Summary | null;
  /** Teacher only: which AI service is configured on the server (null = built-in summary only). */
  ai?: { provider: AiProvider; model: string } | null;
}

export type Action =
  | { action: "join"; name: string }
  | { action: "addIdea"; text: string; asPair?: boolean }
  | { action: "editIdea"; id: string; text: string }
  | { action: "deleteIdea"; id: string }
  | { action: "addLink"; source: string; target: string; relation: Relation; note?: string }
  | { action: "deleteLink"; id: string }
  | {
      action: "updateSession";
      phase?: Phase;
      title?: string;
      prompt?: string;
      anonymous?: boolean;
      locked?: boolean;
      timerSeconds?: number | null; // null = stop the timer
      addSeconds?: number;
    }
  | { action: "makePairs"; mode: "shuffle" | "fill" | "clear" }
  | { action: "summarise" }
  | { action: "updateSummary"; paragraph?: string; shown?: boolean; clear?: boolean }
  | { action: "removeStudent"; id: string };
