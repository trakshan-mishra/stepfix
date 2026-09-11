# stepfix — build progress

## Current milestone

M2 — Sessions, admission, chat skeleton (complete)

## What's done

### M2 — Sessions, admission, chat skeleton (2026-09-11)

- `src/server/llm/mock.ts` — mock language model using `MockLanguageModelV4` from `ai/test`, streams canned text with 300–1500ms random delay, tool-call support
- `src/server/http/token.ts` — HMAC-SHA256 session token, 24h expiry, sign/verify, timing-safe comparison
- `src/server/http/turnstile.ts` — server-side Turnstile verification with 3s timeout, dev test keys
- `src/server/agents/coordinator-logic.ts` — pure admission logic: admit, queue (cap 50), per-IP limits (3/hour, 10/day), heartbeat, release, sweep idle, checkQueue with lazy promotion
- `src/server/agents/coordinator.ts` — Coordinator DO wrapping CoordinatorLogic with durable storage and alarm sweep
- `src/server/http/session.ts` — POST `/api/session` (Turnstile + admit), GET `/api/session/queue/:ticket`, DELETE `/api/session/:id` (purge DO + D1)
- `src/server.ts` — wired session routes, token validation on WebSocket connect, SupportSession state (phase, caseFile, steps, counters), 24h purge schedule, mock model streaming
- `src/server/env-extra.ts` — TypeScript env augmentation for secrets (TURNSTILE_SECRET_KEY, SESSION_SIGNING_KEY, etc.)
- `src/client/routes/home.tsx` — Turnstile widget + start button + waiting room with 20±5s polling
- `src/client/routes/privacy.tsx` — privacy notice page
- `src/client/lib/token.ts` — localStorage token storage (save/get/clear with try/catch)
- `src/client/app.tsx` — routing for home, session, library, privacy; Chat accepts sessionId+token props
- Tests: 26 tests — token sign/verify (9: valid, tampered, expired, wrong secret, malformed, no dot, exactly 24h, different sessions, same session), coordinator admission (8: admit under cap, queue at cap, queue full, promote on release, queue order, heartbeat, expired ticket), per-IP limits (3: hourly limit, over-limit, different IPs), release/sweep (5: release, unknown release, sweep idle, no sweep active, promote after sweep)

### M1 — Script library pipeline (2026-09-11)

- Split `seed/script-library.yaml` into `library/` by OS/category: 10 files + `flows.yaml` (63 entries, 6 flows)
- `src/server/library/schema.ts` — zod schemas for entries, flows, params, compiled library
- `src/server/library/lint.ts` — all lint rules from 05 §5: id pattern/uniqueness, goto targets, cycle detection (graph reachability), kind consistency, undo requirement, explanation length, expect regex compilation, flows, command hygiene (48 forbidden patterns), chaining (semicolon ban, compound &&), pipe allowlist (quote-aware tokenizer), package install rules, param safety (anchored regex, enum values), unreachable entries (info)
- `scripts/lint-library.ts` — CLI for `npm run lint:library`
- `scripts/compile-library.ts` — validates with zod, computes sha256, writes `src/generated/library.json`; production refuses unreviewed; dev includes with draft flag
- `scripts/split-library.ts` — one-off script that split the seed YAML
- `src/server/library/render.ts` — `renderCommand` with param validation (enum, regex, dangerous char rejection)
- `src/server/library/index.ts` — typed access: `getScript`, `getAllScripts`, `getFlows`, `catalogFor`, `renderCommand`
- `src/server/http/library.ts` — routes GET `/api/library` and `/api/library/:id`
- Wired library routes into `src/server.ts`
- `src/client/routes/library.tsx` — `/library` page (group by OS/category, search box, risk badges, draft badges)
- `src/client/routes/library-detail.tsx` — `/library/:id` page (card view with explanation open, version, hash, sources, params, undo, expect patterns)
- Added lazy routing for `/library` and `/library/:id` in `src/client/app.tsx`
- Tests: 104 tests covering forbidden patterns (one per rule), pipe allowlist, chaining, id pattern, kind consistency, undo, explanation length, expect regex, goto targets, cycle detection, param safety, renderCommand injection (10 injection vectors), renderCommand regex/enum/no-params/missing/unsubstituted, flow validation, unreachable info
- `npm run pretest` compiles the library before tests

### M0 — Scaffold and upgrade (2026-09-11)

- Created repo from `cloudflare/agents-starter` template
- Copied `AGENTS.md` to repo root, `seed/` files copied in
- Upgraded deps: `ai@^7`, `agents@^0.22`, `@cloudflare/ai-chat@^0.11`, `workers-ai-provider@^4`, `zod@^4`
- Added deps: `@ai-sdk/react@^4`, `@ai-sdk/groq@^4`, `@ai-sdk/google@^4`, `@ai-sdk/openai-compatible@^3`, `nanoid`, `yaml`
- Added dev deps: `vitest`, `@cloudflare/vitest-pool-workers`, `@playwright/test`, `tsx`
- Restructured into `src/server/` and `src/client/` layout per 03 §8 (TODO-header placeholders)
- Moved `src/app.tsx` → `src/client/app.tsx`, `src/client.tsx` → `src/client/main.tsx`
- Updated `wrangler.jsonc`: name "stepfix", DO bindings (SupportSession + Coordinator), D1 "DB" (id placeholder), Vectorize "VECTORS", vars block, `run_worker_first` includes `/api/*`
- Renamed `ChatAgent` → `SupportSession` (extends `AIChatAgent`), stripped demo tools to minimal Workers AI stream
- Added empty `Coordinator` (extends `Agent`)
- Added `.dev.vars.example` with all secrets from 03 §7.2 / 09
- Added `.env.example` for `VITE_TURNSTILE_SITE_KEY`
- Added npm scripts: `test`, `test:e2e`, `lint:library`, `compile:library`, `eval`
- Added `vitest.config.ts` (workers pool)
- Added trivial workers-pool test in `tests/sanity.test.ts`
- Added `.github/workflows/ci.yml` (npm ci, check, test)
- Regenerated `env.d.ts` with new bindings

## Open issues

- `database_id` in `wrangler.jsonc` is a placeholder — human must run `npx wrangler d1 create stepfix` and fill it in
- D1 and Vectorize resources don't exist yet — human must create them
- `npm install` requires `--legacy-peer-deps` due to `@modelcontextprotocol/sdk` peer conflict
- `npm run check` passes, `npm test` passes (130 tests: 1 sanity + 104 library + 9 token + 16 coordinator)
- `npm run lint:library` passes (0 errors, 4 info for unreachable entries — expected)
- `npm run compile:library` is deterministic (verified)
- Vectorize binding warns "does not support local development" — expected; the index doesn't exist yet
- `npm run dev` chat streaming not manually verified yet — human needs to run `npm run dev` and send a message
- Turnstile widget loads from Cloudflare CDN — needs internet in dev
- Coordinator promotion is lazy (only on checkQueue poll), not automatic on release — by design, so clients discover admission via polling
- `SESSION_SIGNING_KEY` defaults to "dev-key-change-me" in dev — human must set a real key in `.dev.vars`

## Decisions made

- Using `--legacy-peer-deps` for npm install (MCP SDK peer conflict)
- Kept starter's `@cloudflare/kumo`, `streamdown`, `@streamdown/code`, `@phosphor-icons/react` for UI
- Kept Workers AI model `@cf/moonshotai/kimi-k2.7-code` as the M0 placeholder (will be replaced by the model router in M3)
- `APP_ENV` set to `"development"` and `LLM_MODE` set to `"mock"` in wrangler.jsonc vars for local dev
- Cycle detection uses graph reachability (can the entry reach RESOLVED/ESCALATE/FLOW_ENTRY through any path?) rather than simple default-chain following
- `renderCommand` lives in `src/server/library/render.ts` (separate from index.ts) so tests can import it without the compiled library JSON
- Coordinator admission logic extracted into `coordinator-logic.ts` (pure class, no Agent dependency) for unit testing; the DO wraps it
- Queue promotion is lazy: `release()` frees a slot but doesn't auto-promote; `checkQueue()` promotes when the client polls and a slot is available
- `LanguageModelV4StreamPart` requires `id` fields on text parts; mock model generates per-message IDs

## Next milestone

M3 — Model registry, providers, router, quota ledger

## What the human must do next

1. `npx wrangler login` (if not already logged in)
2. `npx wrangler d1 create stepfix` — copy the `database_id` into `wrangler.jsonc`
3. `npx wrangler vectorize create kb-bge-small-384 --dimensions=384 --metric=cosine`
4. `npx wrangler vectorize create-metadata-index kb-bge-small-384 --property-name=os --type=string`
5. `npx wrangler vectorize create-metadata-index kb-bge-small-384 --property-name=category --type=string`
6. Create `.dev.vars` from `.dev.vars.example` — set `SESSION_SIGNING_KEY` (run `openssl rand -base64 32`) and `TURNSTILE_SECRET_KEY` (use test key `1x0000000000000000000000000000000AA` for dev)
7. Create `.env` from `.env.example` — set `VITE_TURNSTILE_SITE_KEY` (use test key `1x00000000000000000000AA`)
8. Run `npm run dev` and send a message to verify the chat works with the mock model
9. With `MAX_ACTIVE_SESSIONS=1` (set in `.dev.vars`), open a second browser — it should land in the waiting room
