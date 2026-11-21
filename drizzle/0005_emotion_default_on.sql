ALTER TABLE "chats" ALTER COLUMN "emotion_enabled" SET DEFAULT true;--> statement-breakpoint
-- New feature: switch it on for chats that existed before it shipped too.
UPDATE "chats" SET "emotion_enabled" = true;
