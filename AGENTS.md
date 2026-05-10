# AGENTS.md

## Project

Personal SaaS OS is a local-first personal execution system for daily planning, task tracking, Codex delegation, review, and Obsidian knowledge capture.

## Current Phase

Build the simplest usable V0. The user will use it daily and iterate from real usage.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Local JSON file storage
- No database in V0
- No Docker in V0
- No authentication in V0

## Working Rules

- Keep changes small.
- Prefer simple working code over abstractions.
- Do not introduce a database unless explicitly requested.
- Do not introduce Docker unless explicitly requested.
- Do not build generic productivity features.
- Do not add RAG, vector search, crawler, or dashboard features in V0.
- All tasks must have a concrete nextAction and doneWhen.
- UI text should be Chinese.
- The app runs locally and is viewed in Chrome.

## Verification

Before finishing:

- Run npm install if needed.
- Run npm run build if feasible.
- Run TypeScript checks if configured.
- Confirm /today renders.
- Confirm tasks persist after refresh.
- Confirm Markdown export works or falls back to exports/.
- Summarize changed files.

## Scripts

Make sure package.json has:

- npm run dev
- npm run build
- npm run lint if available

## Acceptance Criteria

V0 is complete when:

1. npm run dev starts the app.
2. /today opens in Chrome.
3. The page shows Today P0, Active Task SSOT, Codex queue, Waiting/Review queue, Add Task form, Codex packet generator, Review form.
4. New tasks persist in data/store.json.
5. Task status can be updated.
6. A Codex task packet can be generated and copied.
7. Daily review can be saved.
8. Markdown export creates or updates a daily Markdown file.

## Implementation Rules

- Do not ask clarifying questions unless truly blocked.
- Make practical assumptions.
- Complete the smallest useful version.
- After implementation, give exact run instructions.
