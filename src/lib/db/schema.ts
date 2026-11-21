import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type { EmotionState, EmotionVector } from "@/lib/emotion/engine";
import type { CompactionSettings, LoreSelectiveLogic, PresetParams, PromptBlock, UiPrefs, ModelPrefs } from "@/lib/types";

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  openrouterKeyEnc: text("openrouter_key_enc"),
  defaultPresetId: uuid("default_preset_id"),
  defaultPersonaId: uuid("default_persona_id"),
  defaultTemplateId: uuid("default_template_id"),
  compaction: jsonb("compaction").$type<CompactionSettings>(),
  ui: jsonb("ui").$type<UiPrefs>(),
  modelPrefs: jsonb("model_prefs").$type<ModelPrefs>().notNull().default({}),
  lastChatId: uuid("last_chat_id"),
  ...timestamps,
});

export const personas = pgTable("personas", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  pronouns: text("pronouns").notNull().default(""),
  avatar: text("avatar"),
  color: text("color"),
  sort: integer("sort").notNull().default(0),
  ...timestamps,
});

export const presets = pgTable("presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  modelId: text("model_id").notNull(),
  params: jsonb("params").$type<PresetParams>().notNull(),
  contextSize: integer("context_size"),
  ...timestamps,
});

export const promptTemplates = pgTable("prompt_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  blocks: jsonb("blocks").$type<PromptBlock[]>().notNull(),
  ...timestamps,
});

export const characters = pgTable("characters", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  avatar: text("avatar"),
  color: text("color"),
  tagline: text("tagline").notNull().default(""),
  description: text("description").notNull().default(""),
  personality: text("personality").notNull().default(""),
  scenario: text("scenario").notNull().default(""),
  firstMessage: text("first_message").notNull().default(""),
  alternateGreetings: text("alternate_greetings").array().notNull().default(sql`'{}'::text[]`),
  exampleDialogue: text("example_dialogue").notNull().default(""),
  systemPrompt: text("system_prompt").notNull().default(""),
  postHistoryInstructions: text("post_history_instructions").notNull().default(""),
  creatorNotes: text("creator_notes").notNull().default(""),
  creator: text("creator").notNull().default(""),
  characterVersion: text("character_version").notNull().default(""),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  favorite: boolean("favorite").notNull().default(false),
  defaultPresetId: uuid("default_preset_id").references(() => presets.id, { onDelete: "set null" }),
  defaultPersonaId: uuid("default_persona_id").references(() => personas.id, { onDelete: "set null" }),
  extensions: jsonb("extensions").$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const lorebooks = pgTable("lorebooks", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  scanDepth: integer("scan_depth").notNull().default(6),
  tokenBudget: integer("token_budget").notNull().default(1024),
  recursive: boolean("recursive").notNull().default(false),
  /** Where it was imported from (e.g. a JanitorAI script URL), so re-imports reuse it. Empty for local books. */
  source: text("source").notNull().default(""),
  ...timestamps,
});

export const lorebookEntries = pgTable(
  "lorebook_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    lorebookId: uuid("lorebook_id")
      .notNull()
      .references(() => lorebooks.id, { onDelete: "cascade" }),
    comment: text("comment").notNull().default(""),
    keys: text("keys").array().notNull().default(sql`'{}'::text[]`),
    secondaryKeys: text("secondary_keys").array().notNull().default(sql`'{}'::text[]`),
    selectiveLogic: text("selective_logic").$type<LoreSelectiveLogic>().notNull().default("and_any"),
    content: text("content").notNull().default(""),
    constant: boolean("constant").notNull().default(false),
    position: text("position").$type<"before_char" | "after_char" | "at_depth">().notNull().default("after_char"),
    depth: integer("depth").notNull().default(4),
    order: integer("order").notNull().default(100),
    probability: integer("probability").notNull().default(100),
    caseSensitive: boolean("case_sensitive").notNull().default(false),
    wholeWord: boolean("whole_word").notNull().default(true),
    enabled: boolean("enabled").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("lore_entries_book_idx").on(t.lorebookId)],
);

export const characterLorebooks = pgTable(
  "character_lorebooks",
  {
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    lorebookId: uuid("lorebook_id")
      .notNull()
      .references(() => lorebooks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.characterId, t.lorebookId] })],
);

/** User-made folders for organizing chats in the sidebar. */
export const directories = pgTable("directories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
});

export const chats = pgTable(
  "chats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    presetId: uuid("preset_id").references(() => presets.id, { onDelete: "set null" }),
    templateId: uuid("template_id").references(() => promptTemplates.id, { onDelete: "set null" }),
    personaId: uuid("persona_id").references(() => personas.id, { onDelete: "set null" }),
    activeRootId: uuid("active_root_id"),
    authorsNote: text("authors_note").notNull().default(""),
    authorsNoteDepth: integer("authors_note_depth").notNull().default(4),
    pinned: boolean("pinned").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    // Deleting a directory keeps its chats; they just fall back to the date groups.
    directoryId: uuid("directory_id").references(() => directories.id, { onDelete: "set null" }),
    forkedFromChatId: uuid("forked_from_chat_id"),
    /** Emotion engine: track {{char}}'s feelings per reply and feed them into the prompt. */
    emotionEnabled: boolean("emotion_enabled").notNull().default(true),
    /** Resting temperament the engine decays toward (estimated from the character on first use). */
    emotionBaseline: jsonb("emotion_baseline").$type<EmotionVector>(),
    totalCost: doublePrecision("total_cost").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [index("chats_last_msg_idx").on(t.lastMessageAt), index("chats_character_idx").on(t.characterId), index("chats_directory_idx").on(t.directoryId)],
);

export const chatLorebooks = pgTable(
  "chat_lorebooks",
  {
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    lorebookId: uuid("lorebook_id")
      .notNull()
      .references(() => lorebooks.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.chatId, t.lorebookId] })],
);

export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "streaming" | "complete" | "error" | "stopped";

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => messages.id, { onDelete: "cascade" }),
    activeChildId: uuid("active_child_id"),
    role: text("role").$type<MessageRole>().notNull(),
    personaId: uuid("persona_id").references(() => personas.id, { onDelete: "set null" }),
    characterId: uuid("character_id").references(() => characters.id, { onDelete: "set null" }),
    content: text("content").notNull().default(""),
    reasoning: text("reasoning"),
    status: text("status").$type<MessageStatus>().notNull().default("complete"),
    error: text("error"),
    modelId: text("model_id"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    cost: doublePrecision("cost"),
    genMs: integer("gen_ms"),
    ttftMs: integer("ttft_ms"),
    finishReason: text("finish_reason"),
    bookmarked: boolean("bookmarked").notNull().default(false),
    hidden: boolean("hidden").notNull().default(false),
    /** Emotion engine state of {{char}} after this assistant message. */
    emotion: jsonb("emotion").$type<EmotionState>(),
    search: tsvector("search").generatedAlwaysAs(sql`to_tsvector('simple', coalesce(content, ''))`),
    ...timestamps,
  },
  (t) => [
    index("messages_chat_parent_idx").on(t.chatId, t.parentId),
    index("messages_search_idx").using("gin", t.search),
  ],
);

export const memoryChunks = pgTable(
  "memory_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    level: integer("level").notNull().default(0),
    messageIds: uuid("message_ids").array().notNull(),
    sourceChunkIds: uuid("source_chunk_ids").array().notNull().default(sql`'{}'::uuid[]`),
    mergedIntoId: uuid("merged_into_id"),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    userEdited: boolean("user_edited").notNull().default(false),
    modelId: text("model_id"),
    ...timestamps,
  },
  (t) => [index("memory_chat_idx").on(t.chatId)],
);

export const pinnedFacts = pgTable(
  "pinned_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    sourceMessageId: uuid("source_message_id"),
    suggested: boolean("suggested").notNull().default(false),
    sort: real("sort").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("facts_chat_idx").on(t.chatId)],
);

export const promptSnapshots = pgTable("prompt_snapshots", {
  messageId: uuid("message_id")
    .primaryKey()
    .references(() => messages.id, { onDelete: "cascade" }),
  chatId: uuid("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  payload: jsonb("payload").notNull(),
  breakdown: jsonb("breakdown").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Persona = typeof personas.$inferSelect;
export type Character = typeof characters.$inferSelect;
export type Preset = typeof presets.$inferSelect;
export type PromptTemplate = typeof promptTemplates.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MemoryChunk = typeof memoryChunks.$inferSelect;
export type PinnedFact = typeof pinnedFacts.$inferSelect;
export type Lorebook = typeof lorebooks.$inferSelect;
export type LorebookEntry = typeof lorebookEntries.$inferSelect;
export type Settings = typeof settings.$inferSelect;
