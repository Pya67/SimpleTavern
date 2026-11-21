ALTER TABLE "chats" ADD COLUMN "emotion_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "emotion_baseline" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "emotion" jsonb;