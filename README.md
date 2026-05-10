# Personal SaaS OS

Local-first V0 for daily P0 selection, active task tracking, Codex task packet generation, evening review, and Obsidian Markdown export.

## Run

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000/today
```

If Windows blocks port 3000, use another port:

```bash
npm run dev -- --port 3121
```

## Storage

The source of truth is:

```text
data/store.json
```

The app creates the file with seed tasks if it does not exist.

## Optional Environment

Copy `.env.local.example` to `.env.local` only if needed.

```bash
OBSIDIAN_VAULT_PATH=/mnt/c/Users/YOUR_NAME/Documents/ObsidianVault
APP_TIMEZONE=Asia/Shanghai
```

If `OBSIDIAN_VAULT_PATH` is unset, Markdown export writes to `exports/YYYY-MM-DD.md`.
