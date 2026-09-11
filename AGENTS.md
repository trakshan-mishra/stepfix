# AGENTS.md — rules for coding agents in this repo

You are building **stepfix** (codename): an AI support agent that guides users through fixing their own computer problems. A Support persona triages and hands a validated case file to a Technician persona. The Technician recommends one step at a time from a reviewed script library, shown as a card with a collapsible explanation. Users run every command themselves.

The full spec lives in `../spec/` (01–09). When a task names a section, read it before writing code.

**Scope:** Linux (Ubuntu/Debian) and Windows 10/11 only. Phones and macOS are out of scope unless the human asks.

## Stack (pinned — don't swap without being asked)

- Cloudflare Workers + Durable Objects (SQLite) + D1 (FTS5) + Vectorize + Workers AI. One Worker deploy.
- `agents` ^0.22, `@cloudflare/ai-chat` ^0.11 (`AIChatAgent`, `useAgentChat`, resumable streaming).
- Vercel AI SDK `ai` ^7, `@ai-sdk/react` ^4, `@ai-sdk/groq` ^4, `@ai-sdk/google` ^4, `@ai-sdk/openai-compatible` ^3, `workers-ai-provider` ^4.
- React 19 + Vite + Tailwind 4 (from `cloudflare/agents-starter`), zod ^4, vitest + `@cloudflare/vitest-pool-workers`, Playwright.

These SDKs change fast. **Check the installed `.d.ts` files and the Cloudflare docs before using an API.** Don't write from memory. Docs: https://developers.cloudflare.com/agents/ (chat agents, client SDK, trigger patterns, durable execution, retries, routing, cross-domain auth).

## Commands

- `npm run dev` — local dev (wrangler/vite)
- `npm run check` — typecheck + lint (must pass before you say you're done)
- `npm test` — vitest (unit + workers pool)
- `npm run test:e2e` — Playwright
- `npm run lint:library` / `npm run compile:library`
- `npm run eval -- [--scenario S01] [--sim scripted|ollama|groq] [--chaos "..."]`
- Never run `wrangler deploy`, `wrangler secret put`, `wrangler d1 migrations apply --remote`, or anything that touches production unless the human asks in this session.

## Invariants — never break these

1. **Commands come only from the library.** The UI renders a command only from a validated `recommend_step` tool output built from `src/generated/library.json`. Assistant Markdown never renders code blocks or inline code. Never add a code path that shows model-written commands.
2. **No paid or card-required services.** Don't add a dependency on a service that needs a credit card. Model IDs and limits live only in `src/server/llm/models.config.ts` or env vars.
3. **Every external call has** a timeout, a typed error, and a fallback. No unhandled rejection may reach the UI. Every user message gets an assistant reply: a model's or the playbook engine's.
4. **Untrusted content** (command output, screenshot descriptions, KB text, long pastes) is wrapped in `<untrusted>` after stripping look-alike tags. Never put it in a system prompt without wrapping.
5. **Secrets:** only via `wrangler secret` / `.dev.vars` (gitignored). Never log message text, outputs, or keys. Scrub with the shared `scrub.ts` on the client and again on the server.
6. **Library safety:** never set `reviewed_by` or `tested_on` (only the human does that). Never weaken `lint-library.ts`. New entries must pass it.
7. **Durable Objects:** never edit an existing migration. Add a new tag. Don't enable `experimentalDecorators`.
8. **Router:** `maxRetries: 0` on `streamText`; the router owns retries and failover. Don't add retry loops elsewhere.
9. **Writes budget:** don't add per-token or per-message D1 writes. The Coordinator batches its writes. D1 analytics are written once per session.
10. **Chaos flags** must be ignored when `APP_ENV=production`.

## How to work

1. Read the task and the spec sections it names. List the files you'll create or change and the tests you'll add, then implement.
2. Keep modules small and typed. No `any` without a comment explaining why. Use zod schemas at every boundary (tool inputs, HTTP bodies, model JSON, library YAML).
3. Write tests alongside the code: one focused test per stated behavior, plus the failure cases the spec lists.
4. Run `npm run check` and `npm test` (and `npm run test:e2e` if you touched UI). Paste the real output. If something fails, fix it or say plainly what's still failing. Never claim it works without running the checks.
5. Don't add features, dependencies or refactors the task didn't ask for. If you spot a problem outside the task, list it in your report instead of fixing it.
6. Git: small commits with plain messages. **Never add AI attribution or `Co-Authored-By` trailers** to commits or PR text.

## Report format (end of every task)

- What changed (files)
- Tests added
- Commands run and their real results
- Anything not done, and why
- Risks or follow-ups
