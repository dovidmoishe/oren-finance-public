ALTER TYPE "public"."execution_type" ADD VALUE IF NOT EXISTS 'limit_buy';--> statement-breakpoint
ALTER TYPE "public"."execution_type" ADD VALUE IF NOT EXISTS 'limit_sell';--> statement-breakpoint
ALTER TYPE "public"."execution_type" ADD VALUE IF NOT EXISTS 'limit_cancel';--> statement-breakpoint
CREATE TYPE "public"."limit_order_status" AS ENUM('open', 'filled', 'cancelled', 'expired', 'failed', 'awaiting_signature');--> statement-breakpoint
CREATE TYPE "public"."limit_order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "limit_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_address" text NOT NULL,
	"order_key" text NOT NULL,
	"side" "limit_order_side" NOT NULL,
	"asset_id" text,
	"ticker" text,
	"input_mint" text NOT NULL,
	"output_mint" text NOT NULL,
	"making_amount" numeric(40, 18) NOT NULL,
	"taking_amount" numeric(40, 18) NOT NULL,
	"limit_price_usd" numeric(20, 8) NOT NULL,
	"amount_usd" numeric(20, 8),
	"status" "limit_order_status" DEFAULT 'open' NOT NULL,
	"basis" text,
	"open_signature" text,
	"close_signature" text,
	"expired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX "limit_orders_order_key_idx" ON "limit_orders" USING btree ("order_key");--> statement-breakpoint
CREATE INDEX "limit_orders_wallet_created_at_idx" ON "limit_orders" USING btree ("wallet_address","created_at");--> statement-breakpoint
CREATE INDEX "limit_orders_status_idx" ON "limit_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "limit_orders_asset_id_idx" ON "limit_orders" USING btree ("asset_id");
