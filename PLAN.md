# Sussy Tavern — Implementation Plan

A single-user, self-hosted roleplay chat app with any LLM via OpenRouter. The goal is UX first: streaming that feels instant and smooth, motion on every state change, and chats that never hit a length limit.

> Versions were checked on npm on 2026-11-20. Pin exact versions in `package.json` and bump them on purpose.

## Implementation status (2026-11-20)

Phases 0–7 are implemented (see README). Where the build differs from the plan:
- **Client streaming:** we use our own small NDJSON transport (`src/components/chat/chat-store.ts`) instead of `useChat`, because the message tree (swipes, branches, persona per message) maps poorly onto `useChat`'s flat list. The server still uses AI SDK 7 `streamText` with the real OpenRouter provider.
- **Smooth streaming:** Streamdown 2.8's built-in `animated` option (word `blurIn` with a backlog scheduler) won the Phase 2 spike. It's combined with our adaptive `useSmoothText` reveal buffer.
- **Versions:** swipes and branches are the same thing: siblings on any message, with a `‹ n/m ›` control. Editing works in place with undo; user messages can also be saved as a new branch with a fresh reply.
- **AI SDK 7 note:** system messages inside `messages` need `allowSystemInMessages: true`. We set it for chat because our prompt places system messages deliberately (author's note at depth, narrator lines). Summaries use `instructions`.
- **Password hash:** `pnpm auth:hash` prints `b64:<base64>` because Next.js `$`-expands env values (in .env files *and* the process env).
- **OpenRouter mock:** an in-process `fetch` (`src/lib/llm/mock.ts`) passed to the real provider. It's on by default (`OPENROUTER_MOCK=true`).

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 16.4** (App Router, Turbopack, React 19.3) | Server Components for fast first paint; Route Handlers for streaming; `after()` for background work. In Next 16, `middleware.ts` is called `proxy.ts`. |
| Language | TypeScript (strict), **Zod 4** | One set of schemas shared by forms, API and DB. |
| Package manager | **pnpm** | |
| Styling | **Tailwind CSS 4.3** (CSS-first config, OKLCH tokens) | |
| Components | **shadcn/ui** (CLI 4.x, **Base UI** primitives, now its default) | We own the code, it's accessible, and we can restyle it fully. |
| Animation | **Motion 14** (`motion/react`) + CSS transitions + React `<ViewTransition>` for route changes | Layout animations, shared-element avatar transitions, gestures (swipe), spring physics. |
| LLM | **AI SDK 7** (`ai`, `@ai-sdk/react`) + **`@openrouter/ai-sdk-provider` 3.1** | First-class streaming, `useChat`, reasoning parts, usage/cost metadata, `smoothStream`. Provider 3.x needs Node ≥ 22 (we have 24). |
| Markdown | **Streamdown 2.8** | Built for streaming: incomplete markdown doesn't flicker, and it supports Shiki, KaTeX and memoised blocks. We add a custom remark plugin for RP styling (`*actions*`, `"dialogue"`). |
| Chat virtualization | **TanStack Virtual 3.14** (chat mode: `anchorTo: 'end'`, `followOnAppend`, `scrollToEnd`, `isAtEnd`) | Supports reverse infinite scroll, streaming growth and "jump to latest". Fallback: `virtua` (5 kB, `reverse` + `shift`). |
| Server state | **TanStack Query 5** | Optimistic mutations with rollback, which also gives us undo. |
| Client state | **Zustand 5** (composer drafts, UI prefs); **nuqs** (URL state for panels/tabs) | |
| DB | **PostgreSQL 17 + pgvector** (Docker image `pgvector/pgvector:pg17`) | pgvector is ready for embedding recall later. Full-text search uses `tsvector`. |
| ORM | **Drizzle ORM 0.45** + drizzle-kit, `postgres` (postgres.js) driver | Type-safe, SQL-like, fast migrations. |
| Background jobs | **pg-boss 12** (Postgres-backed queue) | Compaction, title generation and backups, with no extra infra. |
| Auth | Password from env (argon2 hash) → **jose** signed JWT in an httpOnly cookie, checked in `proxy.ts` | `AUTH_BYPASS=true` skips it. |
| UI extras | **cmdk** (palette), **sonner** (toasts with undo), **vaul** (mobile drawers), **next-themes**, **lucide-react**, **@dnd-kit/react** (reordering prompt blocks / lore entries) | |
| Tokens | **gpt-tokenizer** for client-side estimates; OpenRouter `usage` for the real counts | |
| Images | **sharp** (avatar resize/crop → webp), stored in `./data/uploads` (Docker volume) | |
| Testing | **Vitest** (prompt builder, compaction, card parser), **Playwright** (critical flows), **MSW** mock OpenRouter stream | |

### Reference, not dependencies
- **AI Elements** (shadcn registry, `@ai-elements/*`) and **assistant-ui**: read their sources for patterns (conversation scroll, prompt input, reasoning collapsible). We copy specific pieces into `components/` via the shadcn CLI rather than adopting a whole framework, because RP needs custom message trees, swipes and personas.

---

## 2. Infra & dev setup

`docker-compose.yml`
- `postgres` — `pgvector/pgvector:pg17`, volume `pgdata`, port 5432
- (app runs on the host with `pnpm dev`; a `Dockerfile` and `app` service come later for self-hosting)

`.env.example`
```
DATABASE_URL=postgres://tavern:tavern@localhost:5432/tavern
AUTH_PASSWORD_HASH=          # argon2 hash; `pnpm auth:hash` generates it
AUTH_SECRET=                 # 32+ random bytes for JWT signing
AUTH_BYPASS=false            # true = skip login (dev/testing only)
OPENROUTER_API_KEY=          # optional; can also be set in Settings (encrypted at rest)
ENCRYPTION_KEY=              # for secrets stored in the DB
APP_URL=http://localhost:3000
```

Scripts: `dev`, `db:up` (compose), `db:generate`, `db:migrate`, `db:studio`, `db:seed` (demo character + persona), `auth:hash`, `test`, `e2e`.

---

## 3. Data model (Drizzle)

```
settings            singleton: openrouter key (encrypted), default preset, default persona,
                    ui prefs (theme, font, chat width, layout: bubbles|book), compaction model

personas            id, name, description, avatar, pronouns, is_default, sort, timestamps
characters          id, name, avatar, description, personality, scenario, first_message,
                    example_dialogue, system_prompt_override, post_history_instructions,
                    creator_notes, tags[], default_preset_id?, default_persona_id?,
                    favorite, extensions jsonb (unknown card fields round-trip), timestamps
character_greetings id, character_id, content, sort           (alternate greetings)

presets             id, name, model_id, params jsonb (temperature, top_p, top_k, min_p, top_a,
                    frequency/presence/repetition penalty, max_tokens, seed, stop[],
                    reasoning {effort|max_tokens, exclude}, provider routing prefs,
                    transforms, logit_bias), context_size_override, is_default
prompt_templates    id, name, blocks jsonb  (ordered list: system, char_desc, personality,
                    scenario, persona, examples, lore(before/after), memory, pinned_facts,
                    history, authors_note@depth, post_history, custom text blocks)

lorebooks           id, name, description, scan_depth, token_budget, recursive
lorebook_entries    id, lorebook_id, keys[], secondary_keys[], selective_logic, content,
                    constant, position, depth, order, probability, case_sensitive,
                    whole_word, enabled, comment
character_lorebooks / chat_lorebooks   (m:n links)

chats               id, character_id, title, preset_id?, prompt_template_id?, active_leaf_id,
                    authors_note, authors_note_depth, pinned, archived, forked_from_message_id?,
                    total_cost, total_tokens, last_message_at, timestamps
messages            id, chat_id, parent_id (tree), role (user|assistant|system|narrator),
                    persona_id? (user msgs), character_id? (assistant),
                    content, reasoning, status (streaming|complete|error|stopped),
                    model_id, prompt_tokens, completion_tokens, cost, gen_ms, ttft_ms,
                    finish_reason, bookmarked, hidden_from_context, depth (index on path),
                    search tsvector (generated), timestamps
                    -- swipes = siblings sharing parent_id; each parent stores active_child_id
memory_chunks       id, chat_id, level (0 = raw summary, 1+ = merged), from_message_id,
                    to_message_id, content, token_count, stale, user_edited, model_id, timestamps
pinned_facts        id, chat_id, content, source_message_id?, sort
prompt_snapshots    message_id, payload jsonb, token_breakdown jsonb   (prompt inspector; keep last N per chat)
```

Indexes: `messages(chat_id, parent_id)`, GIN on `messages.search`, `chats(last_message_at desc)`.

**Why a message tree:** swipes, edits-as-new-version, regenerate and branching all become the same operation: add a sibling and move the active pointer. The visible conversation is the path from root to `active_leaf_id`. "Fork to new chat" copies that path and its memory chunks into a new chat.

---

## 4. Core systems

### 4.1 Generation pipeline (server)
`POST /api/chats/[id]/generate` with `{ mode: 'reply'|'regenerate'|'continue'|'impersonate', parentId, personaId }`

1. Create the placeholder assistant message (`status: streaming`) and send its id as the first stream event (optimistic UI already shows it).
2. `buildPrompt(chat, path, persona)` → messages[] plus a token breakdown (see 4.3).
3. `streamText({ model: openrouter(preset.model), ...params, experimental_transform: smoothStream({ chunking: 'word', delayInMs: null }) })`.
4. Stream straight back as the response (`toUIMessageStreamResponse`). The generation is tied to the request: `abortSignal: req.signal`.
5. On finish, write final content, reasoning, usage, cost (OpenRouter `usage.cost`), TTFT and tokens/sec. Then enqueue `compaction.check` and, for the first exchange, `chat.title`.
6. **Stop** = the client aborts the fetch (`useChat().stop()`). This also covers closing the tab or navigating away. On abort, save the partial text with `status: stopped`, so it can be continued. If the server dies mid-stream, a startup sweep marks any leftover `streaming` messages as `stopped`.
7. Errors (rate limit, no credits, content filter, context overflow) map to typed errors, so the UI can show a specific message and fix (retry, switch model, open settings).


### 4.2 Streaming UX (client), the part that has to feel great
- **Adaptive reveal buffer:** network chunks arrive in bursts, so the client never renders them raw. A `useSmoothText` hook reveals characters on `requestAnimationFrame` at a rate proportional to the backlog (it drains the buffer in about 120–250 ms). Fast models still feel fluid and slow models don't stutter. When the stream ends, the rest flushes quickly instead of in one jump.
- **Fresh-text fade:** newly revealed text fades in. Either use Streamdown's built-in animation if it's good enough (spike, see Phase 2) or wrap the last ~40 chars in a span with a short opacity/blur keyframe. A soft gradient mask on the trailing edge covers the rest.
- **Stable markdown:** Streamdown parses incomplete markdown safely and memoises finished blocks, so only the last block re-renders per frame.
- **Typing indicator → content:** before the first token, show a breathing "typing" shimmer in the character's accent colour. It morphs (Motion `layout`) into the bubble when TTFT hits.
- **Scroll physics:** TanStack Virtual chat mode keeps the view pinned to the bottom only if you were already there. A floating "↓ New message" pill (with an unread count) appears when you've scrolled up. No scroll jumps when history loads above you.
- **Reasoning:** for thinking models, a collapsible "Thinking…" pill streams live with a timer and collapses on its own when the answer starts.
- **Live stats:** a subtle footer while streaming (tok/s, elapsed). After it finishes, it changes to cost and tokens, shown on hover.

### 4.3 Prompt builder
Pure, unit-tested function: `(template, character, persona, chat, path, memory, lore, preset) → { messages, breakdown, droppedCount }`.
- Applies macros (`{{char}}`, `{{user}}`, `{{persona}}`, `{{time}}`, `{{date}}`, `{{random:a,b}}`, `{{roll:1d20}}`, `{{idle_duration}}`).
- Uses the persona **on each message** for the `{{user}}` name in history, so mid-chat switches render correctly. The current persona's description goes in the persona block.
- Token budget = model context (from the OpenRouter catalog, or the preset override) − max_tokens − a safety margin. Fixed blocks are allocated first, then lore up to its budget, then memory, then as much recent history as fits (newest first).
- The output is saved as a `prompt_snapshot` for the inspector.

### 4.4 Auto-compaction (effectively infinite chats)
- **Trigger:** after each finished generation, if (estimated history tokens on the active path not covered by memory) > `compactAt` (default 60% of budget), enqueue `compaction.run(chatId)`.
- **Level 0:** take the oldest uncovered messages, beyond a protected recent window (default: last 30 messages or 40% of budget), in batches of about 4k tokens. Summarise with the compaction model (cheap/fast, configurable) using a structured prompt: events, character state, relationships, open threads and important facts. The result is saved as a `memory_chunk`.
- **Level 1+:** when level-0 chunks exceed their own budget, merge the oldest N into one "story so far" chunk. The hierarchy keeps total memory size bounded.
- **Pinned facts** are always included and never summarised away. Messages have a "Pin as fact" action, and the summariser can propose facts that you accept or dismiss.
- **Correctness under edits:** a chunk stores `from/to` message ids on the path. Editing, deleting or swiping a covered message, or switching to a branch that diverges inside a chunk's range, marks the chunk `stale`. A stale chunk is excluded and re-run in the background. User-edited chunks are never overwritten without asking.
- **UI:** a hairline divider in the timeline reads "Messages above are summarized · View memory". The Memory side panel lists chunks with edit, regenerate, delete, a token count and coverage range, and has a manual "Compact now" button. The originals stay in the scrollback forever.
- **Later:** embed messages (pgvector) and pull relevant old messages back in verbatim when the chat references them.

### 4.5 Lorebooks
Keyword scan over the last `scan_depth` messages, with whole-word or case options, secondary-key AND/NOT logic, optional recursion, probability, constant entries and insertion position/depth. Each lorebook has its own token budget. The inspector shows which entries fired and why.

### 4.6 OpenRouter integration
- `GET /api/models` proxies and caches `openrouter.ai/api/v1/models` (24 h). The model picker shows name, provider, context length, prices, supported params (sampler controls a model doesn't support are greyed out) and reasoning support, with search, favourites and recently used.
- The key is validated on save (shows credits remaining). Generations log `usage.cost`.
- App attribution headers (`HTTP-Referer`, `X-Title`) use generic values.

---

## 5. UX specification

**Layout (desktop):** three panes with resizable splitters.
- *Left:* chat list grouped Pinned / Today / This week / Older, with character avatars, search, and a "New chat" split button.
- *Centre:* the conversation.
- *Right:* a collapsible context panel with tabs: Character · Persona · Generation (preset + model) · Memory · Lore · Inspector.

**Mobile:** the panes become vaul drawers (swipe from the edges). The composer stays fixed above the keyboard using `interactive-widget=resizes-content` and `visualViewport`. The app installs as a PWA.

**Composer**
- Auto-growing textarea. Enter sends, Shift+Enter adds a newline (configurable). The draft is saved per chat.
- **Persona chip** on the left: click opens a popover with avatars, ⌥P cycles personas, or type `/as Name`. Switching animates the chip avatar, and the next message bubble carries the new persona.
- Slash commands with an inline autocomplete menu: `/regen`, `/continue`, `/impersonate`, `/as`, `/note`, `/pin`, `/compact`, `/model`, `/preset`, `/sys` (narrator message).
- Send turns into Stop while streaming (morph animation). ↑ in an empty composer edits your last message.

**Messages**
- Hover/long-press toolbar: edit, copy, regenerate, continue, branch, bookmark, pin fact, hide from context, delete, inspect prompt.
- **Swipes:** `‹ 2/5 ›` under the latest assistant message. Arrow keys, horizontal trackpad swipe and touch drag all work, and the message slides with Motion spring physics. Swiping past the last one generates a new reply.
- **Inline edit** in place, with the same size and no modal. Esc cancels and Ctrl+Enter saves. Saving an assistant message creates a new version (sibling), so nothing is lost.
- RP formatting: `*actions*` in muted italics, `"dialogue"` highlighted in the speaker's accent colour, OOC `((…))` dimmed. Layout is bubbles or book (full-width prose); you pick.
- The avatar uses a shared-element transition into the character panel when clicked.

**Branching:** a "Branch here" action on any message creates a sibling path. A branch indicator (⑂ 3) on a message opens a mini tree popover to jump between branches. "Fork to new chat" is also available.

**Undo everywhere:** deletes and destructive edits are optimistic, with a sonner toast "Deleted · Undo" (8 s). There are no confirmation dialogs except for deleting a whole character or chat.

**Command palette (Ctrl/⌘K):** search chats (full-text inside messages), characters and personas. It also runs actions: new chat with…, switch model, switch preset, toggle theme, open settings, export chat.

**Keyboard map (shown with `?`):** ⌘K palette, ⌘N new chat, ⌘/ focus composer, ⌘. stop, ⌘R regenerate, ←/→ swipe, ⌥P persona, ⌘B toggle sidebar, ⌘I inspector, Esc closes the topmost thing.

**Motion principles**
- Springs, not easings, for anything spatial: messages entering, panels, swipes, popovers. Durations stay under 250 ms for UI and only streaming text is slower. Enter = fade + 4 px rise. Lists use `layout` for reordering.
- Route changes (chat → chat, list → character editor) use `<ViewTransition>` cross-fades, with the avatar as a shared element.
- Respect `prefers-reduced-motion`: springs become instant and streaming fade becomes plain reveal.
- Skeletons match the final layout exactly, so there is no layout shift.

**Character editor:** a two-column live editor (fields on the left; a live preview card plus the "first message" rendered as it will appear on the right). Each field has a token counter, a total budget meter and autosave. Alternate greetings can be reordered by drag. Avatar upload has a crop UI. Importing PNG/JSON works by drag-and-drop anywhere in the app.

**Settings:** API key (masked, test button, credits), defaults, compaction model and thresholds, UI (theme, accent, font, size, chat width, layout), shortcuts, data (export/import/backup).

**Error & empty states:** every empty list has a friendly illustration and one primary action. Network loss shows a top banner, and pending sends queue up and retry.

---

## 6. Routes

```
/login
/                         → last opened chat, or onboarding (set key → create/import character → start)
/chats/[chatId]
/characters               grid with search/tags/favourites
/characters/new | /characters/[id]
/personas | /personas/[id]
/presets  | /presets/[id] (sampler + prompt template editor)
/lorebooks| /lorebooks/[id]
/settings
/api/...  route handlers: auth, models, chats, messages, generate,
          characters (+ import/export), personas, presets, lorebooks, uploads, backup
```

Server Components fetch initial data. Mutations go through Route Handlers or Server Actions, wrapped by TanStack Query for optimistic updates.

---

## 7. Phased implementation

Each phase ends in a working app. Every phase includes tests for its pure logic and one Playwright flow.

### Phase 0 — Foundation
- `create-next-app` (TS, Tailwind 4, App Router, Turbopack), pnpm, ESLint/Prettier, path aliases.
- `docker-compose.yml` (Postgres + pgvector), `.env.example`, Drizzle config, initial schema and migration, seed script.
- shadcn init (Base UI), design tokens (OKLCH palette, dark-first, accent colour variable), fonts (Inter + a serif for book mode), next-themes.
- Auth: `/login` page, argon2 verify, jose cookie, `proxy.ts` guard, `AUTH_BYPASS`, `pnpm auth:hash`.
- App shell: resizable three-pane layout, mobile drawers, sonner, Motion provider, reduced-motion handling.

### Phase 1 — Entities
- Personas CRUD (avatar upload + crop via sharp).
- Characters CRUD with the live editor, alternate greetings and tags.
- Settings: OpenRouter key (encrypted, validated, credits).
- Model catalog proxy and the model picker component.
- Presets CRUD with a full sampler panel (sliders + numeric inputs, greyed out when the model doesn't support a param, reset-to-default per field).

### Phase 2 — Chat core (the most important phase)
- **Spike first:** compare streaming render quality: Streamdown's built-in animation vs. a custom `useSmoothText` + tail fade. Pick the smoothest at 20 and at 200 tok/s.
- Message tree storage, the active path query and chat creation (first message / pick greeting).
- Generation pipeline: reply, stop (client abort, partial text kept), error mapping, startup sweep for interrupted messages.
- Conversation view: TanStack Virtual chat mode, jump-to-latest pill, history paging.
- Composer: persona chip and switching, drafts, Enter behaviour.
- Message actions: edit (with versioning), delete + undo, regenerate/swipes, continue, impersonate, hide from context.
- Macros and the basic prompt builder (default template).
- Auto chat titles (pg-boss job).

### Phase 3 — Control & transparency
- Prompt template editor (drag-reorder blocks, custom blocks, author's note depth).
- Per-character and per-chat preset/template overrides. The header shows a model/preset badge with quick switching.
- Prompt inspector: exact payload, per-block token breakdown, which lore fired, dropped messages.
- Cost/token tracking per message and chat. Reasoning display.

### Phase 4 — Memory
- Token budgeter tied to model context.
- Compaction jobs (levels 0/1+), stale detection on edits and branches, re-runs.
- Memory panel, compacted divider, "Compact now", pinned facts plus suggested facts.
- Lorebooks: CRUD, entry editor, scanning engine, linking to character and chat.

### Phase 5 — Navigation & power UX
- Command palette with full-text search (Postgres `tsvector`).
- Slash commands, keyboard map and `?` help sheet.
- Branching UI (branch indicator, tree popover, fork to new chat).
- Bookmarks, chat pin/archive, chat list grouping.
- Touch swipe gestures, PWA manifest and icons, offline banner and send queue.

### Phase 6 — Interop & data
- Character Card V2/V3 import (PNG `chara`/`ccv3` tEXt chunks, JSON, embedded lorebook), export to V3 PNG (plus a V2 chunk for compatibility) and JSON. Unknown fields round-trip via `extensions`.
- Chat export (Markdown / JSON / standalone HTML) and import (JSON).
- Full backup (DB dump + uploads zip) and restore. A nightly automatic backup job with retention.

### Phase 7 — Polish & hardening
- Performance: profile 10k-message chats, memoisation audit, bundle analysis.
- Accessibility pass (focus rings, ARIA live region for streaming, contrast).
- Visual polish pass on every empty, loading and error state.
- Production Dockerfile and `app` service in compose.

### v2 backlog
Group chats (multi-character, turn order) · embedding recall · AI-assisted character creator · TTS · image generation · per-message translation.

---

## 8. Folder structure

```
src/
  app/                    routes (see §6), layout, globals.css
  components/ui/          shadcn primitives
  components/chat/        Conversation, MessageItem, SwipeControls, Composer, PersonaChip,
                          StreamingText, ReasoningBlock, JumpToLatest, CompactedDivider
  components/panels/      CharacterPanel, GenerationPanel, MemoryPanel, LorePanel, InspectorPanel
  components/palette/     CommandPalette
  lib/db/                 schema.ts, client.ts, queries/*
  lib/llm/                openrouter.ts, generate.ts, errors.ts, models.ts
  lib/prompt/             builder.ts, macros.ts, budget.ts, lore.ts   (pure + tested)
  lib/memory/             compaction.ts, staleness.ts                (pure + tested)
  lib/cards/              png.ts, v2.ts, v3.ts
  lib/jobs/               boss.ts, handlers/*
  lib/auth/               session.ts
  hooks/                  useSmoothText, useChatStream, useHotkeys, ...
  stores/                 composer.ts, ui.ts
proxy.ts
drizzle/                  migrations
docker-compose.yml
```

---

## 9. Risks & open questions
- **Streamdown animation quality:** settled by the Phase 2 spike; the custom fallback is ready.
- **Closing the tab mid-reply stops the reply.** That's by design now. The partial text is saved, and **Continue** picks up from there.
- **Compaction quality:** the summary prompt needs tuning on real long chats. Keep the prompt editable in Settings.
- **Token estimates for non-OpenAI models:** gpt-tokenizer is approximate. Keep a 10% safety margin and recalibrate per model from real `usage` numbers.
