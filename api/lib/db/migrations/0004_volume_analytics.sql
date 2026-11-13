DO $$ BEGIN
 CREATE TYPE "public"."execution_feature" AS ENUM('direct', 'agent', 'basket', 'copy_trade', 'limit_order');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."execution_job_kind" AS ENUM('swap_fill', 'limit_fill', 'dune_sync');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."execution_job_status" AS ENUM('pending', 'processing', 'retry', 'completed', 'dead');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "feature_source" "execution_feature" DEFAULT 'direct' NOT NULL;
--> statement-breakpoint
ALTER TABLE "executions" ADD COLUMN IF NOT EXISTS "submitted_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade_fills" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "execution_id" uuid,
  "order_key" text,
  "transaction_signature" text NOT NULL,
  "fill_index" integer DEFAULT 0 NOT NULL,
  "wallet_address" text NOT NULL,
  "asset_id" text NOT NULL,
  "ticker" text NOT NULL,
  "token_mint" text NOT NULL,
  "side" "trade_side" NOT NULL,
  "stock_amount" numeric(40, 18) NOT NULL,
  "usd_notional" numeric(28, 8) NOT NULL,
  "execution_price_usd" numeric(28, 8) NOT NULL,
  "feature_source" "execution_feature" NOT NULL,
  "provider" text NOT NULL,
  "slot" numeric(20, 0) NOT NULL,
  "block_time" timestamp with time zone NOT NULL,
  "verified_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "trade_fills_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "trade_fills_signature_asset_fill_idx" ON "trade_fills" USING btree ("transaction_signature", "asset_id", "fill_index");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_fills_asset_time_idx" ON "trade_fills" USING btree ("asset_id", "block_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_fills_side_time_idx" ON "trade_fills" USING btree ("side", "block_time");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trade_fills_feature_time_idx" ON "trade_fills" USING btree ("feature_source", "block_time");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "execution_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" "execution_job_kind" NOT NULL,
  "dedupe_key" text NOT NULL,
  "execution_id" uuid,
  "order_key" text,
  "transaction_signature" text,
  "status" "execution_job_status" DEFAULT 'pending' NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "available_at" timestamp with time zone DEFAULT now() NOT NULL,
  "locked_at" timestamp with time zone,
  "last_error" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "execution_jobs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "execution_jobs_dedupe_key_idx" ON "execution_jobs" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "execution_jobs_status_available_idx" ON "execution_jobs" USING btree ("status", "available_at");
