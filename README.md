# Draftline

Turn a rough brief into a reviewable first draft, without losing editorial control.

Draftline is a human-in-the-loop editorial workflow. A rough B2B brief moves through research, outline, draft, editorial check, and repurposing. Specialised stages do the mechanical work. The run pauses at real checkpoints until a person approves, edits, or rejects. The database is the source of truth: refreshing the browser does not lose the run.

## Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), choose a demo brief, and start the workflow.

Demo mode is the default. It uses the same state machine, checkpoints, persistence, retries, and event stream as live mode. Only the model provider and web search are substituted, with a labeled demo corpus. Sources in demo mode were not fetched from the public web.

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## Live model

Copy `.env.example` values into `.env.local`.

- `AI_API_KEY` and `AI_BASE_URL` point at any OpenAI-compatible chat completions API.
- `TAVILY_API_KEY` is optional. Without it, live research fails visibly instead of inventing sources.
- Create a run with `mode: "live"` only after the key is set. The home screen starts demo runs.

Failure simulation (search timeout, model timeout, malformed output, database write failure) is available outside production, or when `DRAFTLINE_FAULTS=1`.

## How the run is put together

```
Brief
  → Workflow run
  → Explicit state machine
  → Orchestrator
  → Stage executor
  → Researcher | Outliner | Writer | Editorial checker | Repurposer
  → Web search and brand profile, only where that stage is allowed to use them
  → Schema validation and a provenance guard
  → SQLite via Prisma
  → Human checkpoint
  → Next stage
```

Illegal transitions throw. A research run cannot jump to repurposing. Approval, rejection, edit, regenerate, and retry are conditional updates: a second approval does not advance the workflow twice. Regenerating an upstream stage marks later stages stale and leaves their text inspectable, but export will not present stale text as the current package.

The editorial checker does not rewrite the article. It records findings. Demo briefs include one statistic that the corpus itself says is not ready to publish, so the checker has something real to flag.

Events are stored and replayed over server-sent events. If the stream drops, the run is rebuilt from `GET /api/runs/:id`.

Sessions are an httpOnly owner cookie. A run is visible only to the browser that created it. Model keys stay on the server.

The repository started empty, so this app was built as a Next.js project. SQLite keeps the portfolio runnable with no database server. Point `DATABASE_URL` at Postgres and change the Prisma provider when you want that instead.
