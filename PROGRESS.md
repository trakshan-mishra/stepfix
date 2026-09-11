# stepfix — build progress

## Current milestone

M1 — Script library pipeline and public pages (complete)

## What's done

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
- D1 and Vectorize resources don't exist yet — human must create them (see "What the human must do next")
- `npm install` requires `--legacy-peer-deps` due to `@modelcontextprotocol/sdk` peer conflict between `agents@0.22` and other deps
- `npm run check` passes, `npm test` passes (105 tests: 1 sanity + 104 library)
- `npm run lint:library` passes (0 errors, 4 info for unreachable entries — expected per spec)
- `npm run compile:library` is deterministic (verified)
- Vectorize binding warns "does not support local development" — expected; the index doesn't exist yet
- `npm run dev` chat streaming not manually verified yet — human needs to run `npm run dev` and send a message
- 4 seed entries had explanations under 80 chars; fixed in the split library files
- 4 entries are unreachable from flows/gotos (linux.sys.os_release, linux.sys.kernel, win.sys.os_info, win.net.restart_adapter) — expected per spec §1: "Some entries aren't reachable from any flow. Only the LLM uses them."

## Decisions made

- Using `--legacy-peer-deps` for npm install (MCP SDK peer conflict)
- Kept starter's `@cloudflare/kumo`, `streamdown`, `@streamdown/code`, `@phosphor-icons/react` for UI
- Kept Workers AI model `@cf/moonshotai/kimi-k2.7-code` as the M0 placeholder (will be replaced by the model router in M3)
- `APP_ENV` set to `"development"` and `LLM_MODE` set to `"mock"` in wrangler.jsonc vars for local dev
- Cycle detection uses graph reachability (can the entry reach RESOLVED/ESCALATE/FLOW_ENTRY through any path?) rather than simple default-chain following, because the seed library has intentional loops (e.g. journal → service_restart → controller_show → journal) that are broken by conditional gotos
- `renderCommand` lives in `src/server/library/render.ts` (separate from index.ts) so tests can import it without the compiled library JSON

## Next milestone

M2 — Sessions, admission, chat skeleton (mock model)

## What the human must do next

1. `npx wrangler login` (if not already logged in)
2. `npx wrangler d1 create stepfix` — copy the `database_id` into `wrangler.jsonc`
3. `npx wrangler vectorize create kb-bge-small-384 --dimensions=384 --metric=cosine`
4. `npx wrangler vectorize create-metadata-index kb-bge-small-384 --property-name=os --type=string`
5. `npx wrangler vectorize create-metadata-index kb-bge-small-384 --property-name=category --type=string`
6. Create a `.dev.vars` file from `.dev.vars.example` (no real keys needed until M2/M3)
7. Run `npm run dev` and send a message to verify the chat works
8. Browse `/library` to see all 63 entries
