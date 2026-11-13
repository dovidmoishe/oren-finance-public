CREATE TYPE "public"."agent_message_role" AS ENUM('user', 'assistant', 'tool', 'system');--> statement-breakpoint
CREATE TYPE "public"."execution_status" AS ENUM('preparing', 'awaiting_signature', 'submitted', 'confirming', 'confirmed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."execution_type" AS ENUM('stock_purchase', 'stock_sale', 'basket_purchase', 'lock', 'unlock');--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "agent_message_role" NOT NULL,
	"content" text NOT NULL,
	"tool_name" text,
	"tool_payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cached_news" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" text,
	"headline" text NOT NULL,
	"source" text,
	"summary" text,
	"url" text,
	"published_at" timestamp with time zone,
	"payload" jsonb,
	"cached_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"type" "execution_type" NOT NULL,
	"asset_id" text,
	"ticker" text,
	"token_mint" text,
	"input_asset" text,
	"output_asset" text,
	"amount" numeric(40, 18),
	"amount_usd" numeric(20, 8),
	"provider" text,
	"transaction_signature" text,
	"status" "execution_status" DEFAULT 'preparing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL,
	"total_value_usd" numeric(20, 8) NOT NULL,
	"available_value_usd" numeric(20, 8) NOT NULL,
	"locked_value_usd" numeric(20, 8) NOT NULL,
	"positions_json" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" text NOT NULL,
	"ticker" text NOT NULL,
	"momentum_7d" numeric(20, 8) NOT NULL,
	"momentum_30d" numeric(20, 8) NOT NULL,
	"volatility_30d" numeric(20, 8) NOT NULL,
	"volume_trend" numeric(20, 8) NOT NULL,
	"rsi_14" numeric(20, 8) NOT NULL,
	"sma_20" numeric(20, 8) NOT NULL,
	"sma_50" numeric(20, 8) NOT NULL,
	"liquidity_score" numeric(20, 8) NOT NULL,
	"activity_score" numeric(20, 8) NOT NULL,
	"opportunity_score" numeric(5, 2) NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vault_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lock_address" text NOT NULL,
	"owner" text NOT NULL,
	"mint" text NOT NULL,
	"asset_id" text,
	"ticker" text,
	"amount" numeric(40, 18) NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"unlock_at" timestamp with time zone NOT NULL,
	"transaction_signature" text NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_messages" ADD CONSTRAINT "agent_messages_thread_id_agent_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."agent_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_messages_thread_id_created_at_idx" ON "agent_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_threads_wallet_address_idx" ON "agent_threads" USING btree ("wallet_address");--> statement-breakpoint
CREATE INDEX "cached_news_asset_id_idx" ON "cached_news" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "cached_news_expires_at_idx" ON "cached_news" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "executions_wallet_created_at_idx" ON "executions" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE INDEX "executions_status_idx" ON "executions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "executions_asset_id_idx" ON "executions" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "executions_transaction_signature_idx" ON "executions" USING btree ("transaction_signature");--> statement-breakpoint
CREATE INDEX "portfolio_snapshots_wallet_timestamp_idx" ON "portfolio_snapshots" USING btree ("wallet_address","timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_signals_asset_id_idx" ON "stock_signals" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "stock_signals_ticker_idx" ON "stock_signals" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "stock_signals_opportunity_score_idx" ON "stock_signals" USING btree ("opportunity_score");--> statement-breakpoint
CREATE UNIQUE INDEX "vault_positions_lock_address_idx" ON "vault_positions" USING btree ("lock_address");--> statement-breakpoint
CREATE INDEX "vault_positions_owner_idx" ON "vault_positions" USING btree ("owner");--> statement-breakpoint
CREATE INDEX "vault_positions_asset_id_idx" ON "vault_positions" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "vault_positions_unlock_at_idx" ON "vault_positions" USING btree ("unlock_at");