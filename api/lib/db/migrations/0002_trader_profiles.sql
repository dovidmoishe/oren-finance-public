CREATE TABLE IF NOT EXISTS "trader_profiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "wallet_address" text NOT NULL,
  "slug" text NOT NULL,
  "display_name" text NOT NULL,
  "avatar_url" text,
  "bio" text,
  "is_public" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trader_profiles_wallet_address_idx" ON "trader_profiles" USING btree ("wallet_address");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trader_profiles_slug_idx" ON "trader_profiles" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trader_profiles_is_public_idx" ON "trader_profiles" USING btree ("is_public");
