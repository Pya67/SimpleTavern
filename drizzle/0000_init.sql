CREATE TABLE "character_lorebooks" (
	"character_id" uuid NOT NULL,
	"lorebook_id" uuid NOT NULL,
	CONSTRAINT "character_lorebooks_character_id_lorebook_id_pk" PRIMARY KEY("character_id","lorebook_id")
);
--> statement-breakpoint
CREATE TABLE "characters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"color" text,
	"tagline" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"personality" text DEFAULT '' NOT NULL,
	"scenario" text DEFAULT '' NOT NULL,
	"first_message" text DEFAULT '' NOT NULL,
	"alternate_greetings" text[] DEFAULT '{}'::text[] NOT NULL,
	"example_dialogue" text DEFAULT '' NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"post_history_instructions" text DEFAULT '' NOT NULL,
	"creator_notes" text DEFAULT '' NOT NULL,
	"creator" text DEFAULT '' NOT NULL,
	"character_version" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"default_preset_id" uuid,
	"default_persona_id" uuid,
	"extensions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_lorebooks" (
	"chat_id" uuid NOT NULL,
	"lorebook_id" uuid NOT NULL,
	CONSTRAINT "chat_lorebooks_chat_id_lorebook_id_pk" PRIMARY KEY("chat_id","lorebook_id")
);
--> statement-breakpoint
CREATE TABLE "chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"character_id" uuid NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"preset_id" uuid,
	"template_id" uuid,
	"persona_id" uuid,
	"active_root_id" uuid,
	"authors_note" text DEFAULT '' NOT NULL,
	"authors_note_depth" integer DEFAULT 4 NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"forked_from_chat_id" uuid,
	"total_cost" double precision DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lorebook_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lorebook_id" uuid NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"secondary_keys" text[] DEFAULT '{}'::text[] NOT NULL,
	"selective_logic" text DEFAULT 'and_any' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"constant" boolean DEFAULT false NOT NULL,
	"position" text DEFAULT 'after_char' NOT NULL,
	"depth" integer DEFAULT 4 NOT NULL,
	"order" integer DEFAULT 100 NOT NULL,
	"probability" integer DEFAULT 100 NOT NULL,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"whole_word" boolean DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lorebooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"scan_depth" integer DEFAULT 6 NOT NULL,
	"token_budget" integer DEFAULT 1024 NOT NULL,
	"recursive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"message_ids" uuid[] NOT NULL,
	"source_chunk_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"merged_into_id" uuid,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"user_edited" boolean DEFAULT false NOT NULL,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"parent_id" uuid,
	"active_child_id" uuid,
	"role" text NOT NULL,
	"persona_id" uuid,
	"character_id" uuid,
	"content" text DEFAULT '' NOT NULL,
	"reasoning" text,
	"status" text DEFAULT 'complete' NOT NULL,
	"error" text,
	"model_id" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost" double precision,
	"gen_ms" integer,
	"ttft_ms" integer,
	"finish_reason" text,
	"bookmarked" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"pronouns" text DEFAULT '' NOT NULL,
	"avatar" text,
	"color" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pinned_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chat_id" uuid NOT NULL,
	"content" text NOT NULL,
	"source_message_id" uuid,
	"suggested" boolean DEFAULT false NOT NULL,
	"sort" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"model_id" text NOT NULL,
	"params" jsonb NOT NULL,
	"context_size" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_snapshots" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"breakdown" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"blocks" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"openrouter_key_enc" text,
	"default_preset_id" uuid,
	"default_persona_id" uuid,
	"default_template_id" uuid,
	"compaction" jsonb,
	"ui" jsonb,
	"last_chat_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "character_lorebooks" ADD CONSTRAINT "character_lorebooks_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_lorebooks" ADD CONSTRAINT "character_lorebooks_lorebook_id_lorebooks_id_fk" FOREIGN KEY ("lorebook_id") REFERENCES "public"."lorebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_default_preset_id_presets_id_fk" FOREIGN KEY ("default_preset_id") REFERENCES "public"."presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "characters" ADD CONSTRAINT "characters_default_persona_id_personas_id_fk" FOREIGN KEY ("default_persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_lorebooks" ADD CONSTRAINT "chat_lorebooks_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_lorebooks" ADD CONSTRAINT "chat_lorebooks_lorebook_id_lorebooks_id_fk" FOREIGN KEY ("lorebook_id") REFERENCES "public"."lorebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_preset_id_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_template_id_prompt_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."prompt_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chats" ADD CONSTRAINT "chats_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lorebook_entries" ADD CONSTRAINT "lorebook_entries_lorebook_id_lorebooks_id_fk" FOREIGN KEY ("lorebook_id") REFERENCES "public"."lorebooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_chunks" ADD CONSTRAINT "memory_chunks_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_parent_id_messages_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_character_id_characters_id_fk" FOREIGN KEY ("character_id") REFERENCES "public"."characters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pinned_facts" ADD CONSTRAINT "pinned_facts_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_snapshots" ADD CONSTRAINT "prompt_snapshots_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_snapshots" ADD CONSTRAINT "prompt_snapshots_chat_id_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chats_last_msg_idx" ON "chats" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "chats_character_idx" ON "chats" USING btree ("character_id");--> statement-breakpoint
CREATE INDEX "lore_entries_book_idx" ON "lorebook_entries" USING btree ("lorebook_id");--> statement-breakpoint
CREATE INDEX "memory_chat_idx" ON "memory_chunks" USING btree ("chat_id");--> statement-breakpoint
CREATE INDEX "messages_chat_parent_idx" ON "messages" USING btree ("chat_id","parent_id");--> statement-breakpoint
CREATE INDEX "messages_search_idx" ON "messages" USING gin ("search");--> statement-breakpoint
CREATE INDEX "facts_chat_idx" ON "pinned_facts" USING btree ("chat_id");