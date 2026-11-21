# Sussy Tavern

A private, single-user roleplay app for chatting with characters through any LLM on [OpenRouter](https://openrouter.ai). It's built for UX: smooth word-by-word streaming, spring animations, swipes and branches, mid-chat persona switching, and auto-compacting memory, so chats can go on indefinitely.

> OpenRouter is **mocked by default** (`OPENROUTER_MOCK=true`). A built-in simulator speaks OpenRouter's wire format, including streaming, reasoning, usage and cost, and errors. That lets you develop and test with no network access and no cost.

## Quick start

Requirements: Node 22+ (24 recommended), pnpm 11, Docker.

```powershell
pnpm install
docker compose up -d          # Postgres 17 + pgvector on :5432
copy .env.example .env.local  # then edit as needed
pnpm dev                      # http://localhost:3000
```

Migrations and default data (a demo character, two personas, presets and a prompt template) are applied automatically on first start.

### Login

There's one user: you. Pick one of these:

- **Bypass, for development and tests:** set `AUTH_BYPASS=true` in `.env.local`.
- **Password:** run `pnpm auth:hash "your password"`, paste the printed `AUTH_PASSWORD_HASH=b64:…` line into `.env.local`, set a long random `AUTH_SECRET`, and set `AUTH_BYPASS=false`.

The hash is base64-wrapped because Next.js expands `$` in env values, and raw argon2 hashes are full of `$`.

### Real models

Set `OPENROUTER_MOCK=false`, then add your key either in **Settings → OpenRouter** (validated, then stored AES-GCM encrypted with `ENCRYPTION_KEY`) or as `OPENROUTER_API_KEY`.

## Features

**Chat**
- **Streaming:** token streaming through an adaptive reveal buffer plus Streamdown word-level blur-in. Bursty networks still read as steady typing. Live tok/s while streaming; model, tokens, speed and cost on hover.
- **Versions on every message.** Swipe assistant replies (← →, or swiping past the last one generates a new reply), edit messages in place with undo, or save a user edit as a new branch and get a fresh reply. Alternate greetings are swipeable too.
- **Message actions:** continue a reply (also offered when a reply hits the token limit or was stopped), impersonate (the AI writes your next message), narrator messages, hide from context, bookmark, pin as fact, fork the chat from any message, and delete with undo.
- **Personas:** switch mid-chat with the composer chip, Alt+P or `/as Name`. Every message remembers its persona, and the prompt labels speakers once more than one persona has spoken.
- **Slash commands:** `/regen /continue /impersonate /as /sys /note /pin /compact /model /preset /inspect`, with an autocomplete menu.
- **Reasoning:** thinking models get a collapsible "Thinking…" block with a live timer.
- **Friendly errors:** rate limit, no credits, context overflow and so on, each with a hint and a Retry button.
- **Smooth long chats:** the conversation is virtualized (TanStack Virtual chat mode). It stays pinned to the bottom, shows a "jump to latest" pill with an unread count, and pages in history as you scroll up.

**Memory (effectively infinite chats)**
- **Auto-compaction:** once uncompacted history passes a share of the context budget, the oldest messages are summarized in the background (pg-boss job). Summaries are merged into higher-level "story so far" recaps as they pile up.
- **Branch-safe and edit-safe:** a memory covers specific message IDs. Branching away or editing a covered message invalidates it automatically; branch-only memories come back when you switch back.
- **Pinned facts** are always sent and never summarized away. The summarizer can suggest facts, which you accept or dismiss.
- **Memory panel:** context-usage meter, editable memories, "Compact now", and a divider in the chat showing where summarization starts.

**Control**
- **Presets:** model picker with live catalog, context and price, favorites and recents. Every sampler (temperature, top P/K, min P, top A, repetition/frequency/presence penalties, max tokens, seed, stop strings), reasoning effort, provider order and fallbacks, middle-out, and raw extra JSON. Controls a model doesn't support are greyed out.
- **Prompt templates:** drag-to-reorder blocks (main prompt, character, persona, examples, lore, memory, facts, history, post-history, custom), role per block, and macros (`{{char}} {{user}} {{time}} {{date}} {{random:a,b}} {{roll:1d20}} {{idle_duration}}`).
- **Prompt inspector:** exact payload, per-block token budget, which lore fired, and what was summarized or dropped.
- **Lorebooks:** keyword, regex and secondary-key logic, recursion, probability, position or depth, token budgets, and a live "test matcher". Attach a lorebook to a character or a single chat.
- **Author's note** with insert depth, per character and per chat preset, persona and template overrides, and cost tracking per message and chat.

**Navigation and data**
- **Command palette (Ctrl+K):** search chats, characters and message text (Postgres full-text), and run contextual commands. Press `?` for all shortcuts.
- **Character Card V1/V2/V3 import:** drag PNG or JSON anywhere on the Characters page; embedded lorebooks come along. Export is a V3 PNG with a V2 chunk for compatibility, or JSON.
- **Chat export** as Markdown, HTML or JSON (JSON keeps all branches); chat import from JSON.
- **Backups:** full backup download and restore, plus an automatic nightly backup to `data/backups` that keeps the last 7.
- **Responsive and installable:** drawers on mobile, installable PWA with an offline page, and messages that send automatically when you reconnect. Dark and light themes, bubbles or book layout, adjustable width and font size, and reduced-motion support.

## Mock model test hooks

Include these in a message:

| Text | Effect |
| --- | --- |
| `/mock-long` | A very long reply (scroll and virtualization testing) |
| `/mock-error 429` · `402` · `500` · `context` | The corresponding API error |

Mock models: **Storyteller** (natural pace), **Thinker** (reasoning), **Flash** (fast, 8k), **Tiny** (2k context, triggers compaction quickly) and **Basic** (limited params, shows greyed-out sliders).

## Scripts

| Command | |
| --- | --- |
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm test` | Unit tests (Vitest): prompt builder, lore, macros, compaction, cards, mock provider |
| `pnpm e2e` | Playwright end-to-end (uses your installed Chrome, mock model, auth bypass) |
| `pnpm typecheck` / `pnpm lint` | |
| `pnpm db:generate` | Generate a migration after editing `src/lib/db/schema.ts` |
| `pnpm db:migrate` / `pnpm db:studio` | Apply migrations manually / browse data |
| `pnpm auth:hash "pw"` | Create a password hash |

## Self-hosting with Docker

On your VPS, create a `.env` from `.env.example`. Set `AUTH_PASSWORD_HASH` using `pnpm auth:hash "your password"`, set `AUTH_SECRET` and `ENCRYPTION_KEY` to separate random values of at least 32 characters, and keep `AUTH_BYPASS=false`. Set `OPENROUTER_MOCK=false` to use OpenRouter.

### Serve HTTPS from the Nginx container

Point your domain at the VPS, allow inbound TCP port 443, and obtain a certificate for the domain. Keep the certificate and key outside the checkout and add their absolute paths on the VPS to `.env`.

```dotenv
TLS_CERT_FILE=/path/to/fullchain.pem
TLS_KEY_FILE=/path/to/privkey.pem
```

```sh
docker compose -f docker-compose.yml -f compose.tls.yml --profile app up -d --build
```

Open `https://your-domain`. When your certificate renews, recreate Nginx so it picks up the new files.

```sh
docker compose -f docker-compose.yml -f compose.tls.yml --profile app up -d --force-recreate --no-deps nginx
```

### Use an existing HTTPS reverse proxy on the VPS

```sh
docker compose --profile app up -d --build
```

Point the host proxy at `http://127.0.0.1:3000` (override the port with `NGINX_PORT` in `.env`). Preserve the original `Host`, set `X-Forwarded-Proto` to `https`, and disable response buffering at the host proxy so chat replies stream. Production login requires HTTPS.

Nginx proxies requests to Next.js over the Compose network. PostgreSQL's host port is bound to loopback for local development. Uploads and backups live in the `appdata` volume, and the database in `pgdata`.

## Architecture

```
src/
  app/(app)/…            pages: home, chats/[id], characters, personas, presets, lorebooks, settings
  app/api/rpc/[name]     typed RPC: zod-validated procedures in src/server/procedures.ts
  app/api/chats/[id]/generate   NDJSON streaming generation (stop = client abort; partial text kept)
  components/chat/       ChatView, Conversation (virtualized), MessageItem, Composer, Markdown, chat-store
  components/panels/     Character / Persona / Generation / Memory / Lore / Inspector panels
  lib/prompt/            builder.ts, lore.ts, macros.ts      (pure, unit-tested)
  lib/memory/            compaction.ts (pure planning), run.ts (jobs)
  lib/llm/               OpenRouter provider, mock, params mapping, errors, model catalog
  lib/chat/              message tree (swipes/branches = siblings), generation, export
  lib/cards/             PNG tEXt + Character Card V1–V3
  server/bootstrap.ts    migrations, defaults, crash recovery, pg-boss workers
```

Messages form a tree: swipes, edits saved as branches, and regenerations are all siblings, and every parent remembers its active child. The visible conversation is the active path, loaded through a recursive CTE.
