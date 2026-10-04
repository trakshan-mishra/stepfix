# stepfix

stepfix is an AI tech-support helper for people who are not technical. It explains each diagnostic or repair step, and the person runs every command themselves.

## Safety model

The AI is never allowed to write commands. Every command comes from the reviewed, public script library in `library/*.yaml`, which is linted for dangerous patterns. This is the opposite of “paste this into your terminal” scams: the model selects a bounded step, while the application supplies the exact command and explains what it does.

## Models

Open-weight models only: gpt-oss-20b and gpt-oss-120b on Groq, with GLM-4.7-flash on Cloudflare Workers AI as the fallback, and a scripted playbook if every model is down. No closed models are used.

## Run locally

You need Node.js, npm, a Cloudflare account with Workers AI access, and a Groq API key.

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler login
npm run dev
```

Fill in the required values in `.dev.vars`, including `GROQ_API_KEY`, and set `LLM_MODE=live` for live model calls. Never commit that file. Open `http://localhost:5173` after the development server starts.

## Tests

The repository has 427 tests across 16 test files.

```bash
npm test
npm run check
```

`npm run check` verifies formatting, lint, and TypeScript.

## Status

Beta. The current support scope is Linux (Ubuntu) and Windows 11, with Wi-Fi and Bluetooth flows.

## License

MIT. See `LICENSE`.
