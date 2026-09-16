# Think · Pair · Share — Network International School

A live Think-Pair-Share tool for the classroom. Students join on their own devices with a code, write ideas, talk them through with a partner, then link ideas together on an Obsidian-style class graph shown on the projector.

Built with Next.js 16 and Upstash Redis, and deploys to Vercel.

## How a lesson runs

| Phase | Students | Board (projector) |
|---|---|---|
| **Lobby** | Join with the code or QR code and their name | QR code, join code and the names of everyone who has joined |
| **Think** (HPL: Meta-thinking) | Write up to 8 ideas. Only they can see them. | A blank dot appears for each new idea. |
| **Pair** (HPL: Empathetic) | Pairs are made automatically, with a trio if numbers are odd. Partners see each other's ideas, can post a joint "pair idea", and can link ideas. | The dots, plus a "Find your partner" list |
| **Share** (HPL: Linking) | Everyone's ideas appear on the graph. Students link ideas as *builds on*, *agrees with*, *challenges* or *similar to*, and can add a reason. | The full live graph |

The teacher dashboard (`/teach`) lets you:

- switch phases
- run a timer (1/2/3/5 minutes, a custom time, or +30 s)
- reshuffle pairs, or pair students who join late
- hide names from students and the board
- lock the session
- remove a student or an idea
- export the ideas as CSV, as an Obsidian-ready Markdown note with `[[#Idea n]]` links, or as JSON

### The graph

- **Solid, coloured lines** are links that students made. The colour shows the link type.
- **Dashed lines** join ideas that use the same key words. Words are lightly stemmed, so *heat*, *heating* and *heated* match. Common words, words from the question itself, and words used by more than half the class are ignored.
- Node colour shows the pair. Bigger nodes have more connections.
- Hover over or tap an idea to highlight its neighbours. You can drag nodes, and scroll or pinch to zoom. Double-click the background to fit everything on screen.
- Labels fade in as you zoom, as in Obsidian.
- **Graph settings** (the ⚙ button) has Obsidian-style controls:
  - Filters: search, link types, how many words ideas must share
  - Groups
  - Display: arrows, text fade, node size, link thickness
  - Forces: centre, repel, link force, link distance
- The word chips at the top show the most-used words. Click one to highlight the ideas that use it.

## Deploy to Vercel

1. **Import the repo.** In Vercel, choose **Add New → Project** and import `stephanamf-cmd/think-pair-share`. Keep the default settings (Next.js), then click **Deploy**.
2. **Add the database.** In the project, open **Storage → Create / Connect → Upstash for Redis (Marketplace)**. Create a free database and connect it to this project, with **Production** (and Preview, if you use preview links) ticked. Vercel adds the connection environment variables for you.
   The app finds them whatever they're called:
   - any `…_REST_API_URL` + `…_REST_API_TOKEN` pair (e.g. `KV_REST_API_URL`, or with a custom prefix)
   - `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
   - any `redis://` or `rediss://` URL, such as `REDIS_URL` from Redis Cloud
3. **Set a teacher PIN (recommended).** Go to **Settings → Environment Variables** and add `TEACHER_PIN`, for example `4827`. Only people who know the PIN can start sessions. Students never need it.
4. **Redeploy.** Go to **Deployments → ⋯ → Redeploy** so the new variables take effect.
5. Open `https://<your-app>.vercel.app/teach`, start a session, and click **Open board ↗** on the projector.

If no database is connected, the app falls back to temporary memory storage and the teacher page shows a warning. Don't run a lesson in this state: on Vercel, students may not all see the same session. The warning lists any database-looking variable *names* it found (never their values) to help you spot a naming or environment mix-up. Remember to redeploy after connecting.

### Optional settings

| Variable | Default | Purpose |
|---|---|---|
| `TEACHER_PIN` | *(none)* | PIN needed to start a session |
| `SESSION_TTL_DAYS` | `30` | How long a session's data is kept after its last change |

## Links

- Students: `/`, or `/s/CODE` (the QR code points here)
- Board / projector: `/board/CODE`. The board is public and read-only. Ideas stay hidden until the Share phase.
- Teacher: `/teach/CODE`. The device that started the session is signed in automatically. To control the session from another device, use **Copy teacher link** (it ends in `#k=…`). Keep that link private.

## Run it locally

```bash
npm install
npm run dev        # http://localhost:3000, with in-memory storage and no setup needed
```

To use a real database locally, copy `.env.example` to `.env.local` and fill in the Upstash values.

## Privacy and data

- There are no accounts. Students give only a display name. Each browser keeps a random token so it can post as that student.
- Data lives in your Upstash database and expires after `SESSION_TTL_DAYS`. **End session** on the dashboard deletes it immediately.
- Teacher keys and student tokens are stored only as SHA-256 hashes.

## How it works

- `lib/store.ts` stores sessions in Upstash Redis, with an in-memory fallback for development. Each session uses a few keys, and a version counter goes up on every change.
- `app/api/s/[code]/route.ts`:
  - `GET` polls the session. If nothing has changed, it costs a single Redis read.
  - `POST` handles every change through one action dispatcher (`lib/actions.ts`).
- `lib/view.ts` decides what the teacher, each student and the board are allowed to see.
- `components/Graph.tsx` draws the force-directed graph on a canvas with `d3-force`.
- `lib/keywords.ts` works out the shared-word links in the browser.

Screens check for changes every 2–2.5 seconds and pause while the tab is hidden.

## Branding

The logos in `public/` are Network International School's, taken from the school's shared resources. The app uses the NIS palette: navy `#1F3864`, green `#A8CC30`, teal `#30B4B4`, yellow `#FCD80C` and orange `#FCA83C`. It also uses the school's HPL ACP/VAA symbols for each phase.
