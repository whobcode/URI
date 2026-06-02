# Unified Requirements Installer (URI)

Merge multiple Python `requirements.txt` files into one, detecting and surfacing version conflicts —
on Cloudflare Workers (TypeScript + Hono). Originally specced as a Python CLI; rebuilt as a Worker
with a web UI and a JSON API.

## Features
- Parses PEP 508-style requirements (extras, version specifiers, environment markers)
- Normalizes package names per PEP 503 and groups across files
- Detects conflicting pins (`==`), keeps the highest as a best-effort resolution
- Combines compatible specifiers (e.g. `>=1.0` + `<2.0`)
- Emits a unified `requirements.txt`, an install command, and notes for skipped/URL/VCS lines

## Run
```bash
npm install
npm run dev
```

## Deploy
```bash
npm run deploy
```

## API
- `POST /api/merge` `{ files: [{name, content}] }` → `{ packageCount, conflictCount, conflicts, notes, requirementsTxt, installCommand }`

## Stack
Cloudflare Workers · Hono
