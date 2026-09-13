# stepfix — build progress

## Current milestone

v2 WO-1 through WO-12 complete (2026-09-13)

## What's done

### v2 Work Orders (2026-09-13)

- **WO-0** — Audit verified: report-after not reserve-before (coordinator-logic.ts:258), 24h day reset (line 262), Gemini/Z.ai enabled with guessed limits (models.config.ts:113,179), CF neurons per-model (line 135), router no max-3/no reservation (router.ts:50), mark_resolved no postcondition+original-task (tools.ts:255), handleStepResult uses truncateForUntrusted not scrub (tools.ts:298), /agents auth fall-through (server.ts:215), purge not clearing SDK messages (server.ts:175), eval/run-eval.ts fabricates fixed_by (line 84).
- **WO-1** — Model registry truth: Gemini/Z.ai disabled by default (enabled:false, capacity 0, effectiveLimits null). Removed guessed rpd/tpm. CF neurons account-shared (quotaGroup: "cf-account-neurons"). Added quotaGroup, accountVerified, runtimeEnabled, effectiveLimits, freeEligibilityVerified, privacyConfigVerified, neuronRate, paid fields. Added isActionable(), resolveEntry(), getActionableCandidates(). Tests: 10 new registry tests.
- **WO-2** — Atomic durable reservation ledger: reserve/dispatch fence/reconcile lifecycle in coordinator-logic.ts. Per-quotaKey-window entries (RPM/TPM/ITPM/OTPM/RPD/TPD, ASR sec, neurons, concurrency). Provider reset semantics (CF 00:00 UTC, Gemini midnight Pacific, Groq per-header). Idempotency keys. Dispatch fence (duplicate returns stored). Crash-after-dispatch charged conservatively. Coordinator unavailable => no live call. Tests: 23 reservation + 7 window tests.
- **WO-3** — Router: prior reservation before each dispatch, hard max-3 attempts, 20s deadline, maxRetries:0. Wired into server.ts via createUIMessageStream. Mock and live router contexts. Playbook fallback on coordinator_unavailable. Tool-loop continuations reserve. Tests: 5 router-reservation + 4 buildReservationEntries tests.
- **WO-4** — Auth: /agents rejects missing token (no fall-through), verifies subject matches route. Purge clears SDK messages via saveMessages(() => []). handleStepResult calls scrub() before truncate. Technician/support prompts loaded from .md files with placeholder replacement. Tests: 3 new (scrub, prompt placeholders).
- **WO-5** — Session envelope: SessionEnvelope type, admitWithEnvelope (70% normal ceiling, 10% protected), consumeEnvelope (no double count), HARD_LIMITS (10min, 12 clips, 180s ASR, 4 light, 2 heavy, 6 VLM). Voice admission = TTS AND (local ASR OR cloud ASR). Text never counted as voice. Tests: 10 envelope tests.
- **WO-6** — Case UI: ScriptCard rendered for recommend_step tool output, CasePanel mounted in session route, HandoffBanner for handoff. Assistant text sanitized (redactCommands + code fence removal). Case state tracked from tool outputs. Card cache for offline.
- **WO-7** — Voice + live view: voice.ts (preflight TTS, preflight local ASR, TTS controller with interrupt). ocr.ts (FrameManager: 5s min between cloud frames, 6 max, one in-flight, validateFrame, cropFrame). audio.ts (stateless ASR endpoint /api/audio/asr, mock mode, Groq Whisper integration). Tests: 10 FrameManager + validateFrame tests.
- **WO-8** — Playbook + degraded: degraded.ts (captureSnapshot, restoreFromSnapshot, isRestorable). Card cache (client localStorage). Playbook fallback already wired in WO-3. Restoration resumes prior role/state/caseVersion, not reset-to-Support. Tests: 7 degraded overlay tests.
- **WO-9** — Handoff + resolution: caseVersion added to CaseFile (monotonic, bumped on handoff/resolve/escalate/handback). mark_resolved requires postconditionMet AND originalTaskMet (rejects without, continues diagnosis). handoff_to_technician advances caseVersion. Tests: 4 new (caseVersion monotonic, evidence preserved, postcondition rejection, original-task rejection).
- **WO-10** — Eval integrity: machine.ts (createMachine, executeCommand, markFixed, isFullyFixed). simulator.ts (runSimulation with real step execution, no fabricated fixed_by). Scrub applied to outputs. Injection caught. Secret caught. 0 false-fixed. Tests: 4 machine + 6 simulator tests.
- **WO-11** — Auth delete + tombstone: revokeToken/isRevoked/purgeExpiredRevocations in token.ts. Delete flow returns "pending" (202) if backend down, "deleted" only after confirmed. Revoked token rejected until expiry. Tests: 7 revocation tests.
- **WO-12** — Load + latency: load-runner.ts (runLoadTest, runReservationLoadTest, formatReport). Progressive 5/10/20, burst 50, reservation load. p50/p95/max latency measurement. Mock quotas only. Tests: 6 load tests.

**Total tests: 421 passed (16 test files). tsc clean. lint clean.**

### M5 — Knowledge base (2026-09-11)

### M5 — Knowledge base (2026-09-11)

- `migrations/0001_init.sql` — D1 schema: kb_chunks table, kb_fts FTS5 virtual table with external-content pattern, sync triggers (insert/delete/update), sessions_index, violations, demand tables
- `kb/sources.yaml` — copied from seed (12 sources: 3 ArchWiki ingest, 1 MS Docs ingest, 8 link-only)
- `kb/ingest/ingest.ts` — ingestion script skeleton (reads sources.yaml, chunks by heading, computes stable IDs, placeholder for fetch+embed+upsert)
- `src/server/kb/search.ts` — hybrid search: `sanitizeFts()` (strips FTS special chars, keywords, splits on punctuation), `sanitizeFtsOr()` (OR fallback), `rrf()` (Reciprocal Rank Fusion k=60), `makeSnippet()` (truncates with [...]), `searchKb()` (lexical FTS5 first, semantic Vectorize when lexical <3 results, RRF fusion, 2.5s timeout, keyword-only fallback)
- Updated `search_kb` tool in `tools.ts` to reference KB search
- Tests: 21 tests — sanitizeFts (12: simple word, multiple words, can't, a-b, C:\Users, 0x80070005, org.bluez.Error.NotReady, empty, punctuation, FTS keywords, special chars), sanitizeFtsOr (2), RRF (5: fuse two lists, items in both rank higher, empty lists, one empty, k parameter), makeSnippet (3: short as-is, truncates with [...], preserves start+end)

### M4 — Support → Technician agent (2026-09-11)

- `src/server/agent/case-file.ts` — zod schemas (Os, Category, Fact, CaseFile, Step, Phase, Card), `missingForHandoff()` validation
- `src/server/agent/phases.ts` — state machine (support→technician→resolved/escalated→closed), `canTransition()`, `transition()`, `isTerminal()`
- `src/server/agent/prompts/support.md` and `technician.md` — system prompts from 04 §5
- `src/server/agent/tools.ts` — 7 tools with validation: `update_case`, `handoff_to_technician` (validates case file), `recommend_step` (library lookup, OS check, param validation, one-per-turn, idempotent), `search_kb` (stub), `request_screenshot` (cap check), `escalate_to_human` (builds report), `mark_resolved` (requires passing step), `handback_to_support`
- `src/server/agent/prepare-messages.ts` — `buildSystemPrompt()` (phase-aware with case JSON/steps table/catalog), `formatCatalogSubset()`, `prepareMessagesForModel()` (wraps long pastes in untrusted tags)
- `src/server/guardrails/command-scanner.ts` — scans for fenced code, inline code, shell prompts, known binaries; redacts commands; ignores plain mentions (bluetooth service, your terminal, Wi-Fi)
- `src/server/guardrails/untrusted.ts` — `stripLookalikeTags()`, `wrapUntrusted()`, `truncateForUntrusted()` (first 3K + last 3K)
- `src/server/report/escalation.ts` — `buildEscalationReport()` (Markdown with case, steps table, outputs, likely cause)
- `src/server.ts` — wired tools into `onChatMessage`, step_result metadata handling, command scanner on `onFinish`, phase-aware system prompt with catalog
- UI components: `ScriptCard` (command/manual, risk badges, needs-admin, copy button, disruptive gate, collapsible Why/What-you-should-see, undo, result buttons, paste output), `HandoffBanner`, `CasePanel` (phase, OS, steps list, delete button), `ReportCard` (copy/download/mailto)
- Tests: 42 tests — missingForHandoff (4), phases (9), command scanner (12), untrusted content (5), handoff tool (2), recommend_step tool (4), escalate tool (1), mark_resolved tool (2), handleStepResult (3), escalation report (1)

### M3 — Resilient model layer (2026-09-11)

- `src/server/llm/models.config.ts` — 12-entry registry (groq: gpt-oss-20b/120b, qwen3.8/3.6-27b; gemini: flash/flash-lite via env vars; workers-ai: glm-4.7-flash, gpt-oss-120b, llama-4-scout, bge-small; zai: glm-4.7-flash, glm-4.6v-flash). Role chains, limits, privacy mode filtering (removes gemini+zai).
- `src/server/llm/providers.ts` — builds AI SDK models per registry entry using createGroq, createGoogle, createOpenAICompatible (Z.ai), createWorkersAI.
- `src/server/llm/router.ts` — `streamTurn` with TTFT timers per model, maxRetries 0, failover before first token, continuation after mid-stream failure, 20s turn deadline, user-abort not failover, chaos injection.
- `src/server/llm/classify.ts` — error classification (429→rate_limit with retry-after, 401/403→auth_error/disable, 404→not_found/disable, 5xx→server_error 30s, timeout→20s, network→30s, circuit breaker after 3 consecutive→2min).
- `src/server/llm/chaos.ts` — CHAOS flag parsing (429, timeout, cut, all_down, vectorize_down, d1_down), ignored in production.
- `src/server/agents/coordinator-logic.ts` — added quota ledger: per-model cooldown/failure tracking, candidates(), report(), kill switches (disabledProviders, disabledModels, forceDegraded, admissionsPaused).
- `src/server/http/admin.ts` — admin API with ADMIN_TOKEN: GET /api/admin/health (provider status, cooldowns, kill switches), POST /api/admin/kill-switch (disable/enable provider/model, force degraded).
- Wired admin routes into `src/server.ts`.
- Tests: 39 tests — classify table (10: 429, retry-after, 401, 403, 404, 500, 503, timeout, network, unknown), chaos parsing (10: empty, 429, multiple, all_down, vectorize/d1, invalid, production ignore, dev pass, prob 0/1), privacy mode (4: support/technician/vision filtering, gemini kept off), model registry (5: 12 entries, unique keys, all enabled, env var model IDs, trains-on-inputs), coordinator quota ledger (10: report ok/fail, auth disable, rate limit cooldown, circuit breaker, candidates filter, forceDegraded, provider kill switch, model kill switch)

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
- `npm run check` passes, `npm test` passes (232 tests: 1 sanity + 104 library + 9 token + 16 coordinator + 39 router/chaos/classify + 42 agent/guardrails/report + 21 kb)
- `npm run lint:library` passes (0 errors, 4 info for unreachable entries — expected)
- `npm run compile:library` is deterministic (verified)
- Vectorize binding warns "does not support local development" — expected; the index doesn't exist yet
- `npm run dev` chat streaming not manually verified yet — human needs to run `npm run dev` and send a message
- Router streamTurn not yet wired into SupportSession.onChatMessage — tools are wired with direct streamText + mock model
- Admin API not manually tested
- `SESSION_SIGNING_KEY` defaults to "dev-key-change-me" in dev — human must set a real key in `.dev.vars`
- Gemini model IDs may carry `-preview` suffix — human should verify exact IDs via the Gemini API
- KB ingest script is a skeleton — full fetch+embed+upsert requires CF_ACCOUNT_ID + CF_API_TOKEN (human-only)
- KB search not wired to live D1/Vectorize in tests — needs `wrangler d1 migrations apply --local` first
- Server-driven continuation after handoff not yet implemented — needs `saveMessages` with synthetic system_event
- Playwright E2E not added

## Decisions made

- Using `--legacy-peer-deps` for npm install (MCP SDK peer conflict)
- Kept starter's `@cloudflare/kumo`, `streamdown`, `@streamdown/code`, `@phosphor-icons/react` for UI
- Kept Workers AI model `@cf/moonshotai/kimi-k2.7-code` as the M0 placeholder (will be replaced by the model router in M3)
- `APP_ENV` set to `"development"` and `LLM_MODE` set to `"mock"` in wrangler.jsonc vars for local dev
- Cycle detection uses graph reachability (can the entry reach RESOLVED/ESCALATE/FLOW_ENTRY through any path?) rather than simple default-chain following
- `renderCommand` lives in `src/server/library/render.ts` (separate from index.ts) so tests can import it without the compiled library JSON
- Coordinator admission logic extracted into `coordinator-logic.ts` (pure class, no Agent dependency) for unit testing; the DO wraps it
- Queue promotion is lazy: `release()` frees a slot but doesn't auto-promote; `checkQueue()` promotes when the client polls and a slot is available
- Router streamTurn uses `convertToModelMessages` inside the loop because `streamText` expects `ModelMessage[]`, not `UIMessage[]`
- Router not yet wired into SupportSession.onChatMessage — tools are wired with direct streamText + mock model
- `isCooling()` checks kill switches first, then per-model quota, so a disabled provider works even without a prior report
- Tools use a `ToolContext` interface (state + setState + sessionId) so they're testable without the DO
- `prepareMessagesForModel` wraps long pastes (>500 chars) in `<untrusted>` tags but leaves short messages plain
- Command scanner uses a plain-mention allowlist to avoid false positives on "the bluetooth service", "your terminal", etc.

## Next milestone

M6 — Screenshots, scrubbing, vision

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
