ALTER TABLE "mcp_connections" ADD COLUMN IF NOT EXISTS "scopes" text NOT NULL DEFAULT 'oren.read';

CREATE TABLE IF NOT EXISTS "mcp_trade_intents" (
  "id" uuid PRIMARY KEY NOT NULL DEFAULT gen_random_uuid(),
  "grant_id" text NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text NOT NULL,
  "wallet" text NOT NULL,
  "asset_id" text NOT NULL,
  "ticker" text NOT NULL,
  "approval_id" uuid,
  "amount_usd" numeric(18,6) NOT NULL,
  "slippage_bps" integer NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_trade_intents_amount_positive" CHECK (amount_usd > 0),
  CONSTRAINT "mcp_trade_intents_slippage_bound" CHECK (slippage_bps BETWEEN 1 AND 50)
);
CREATE INDEX IF NOT EXISTS "mcp_trade_intents_owner_idx" ON "mcp_trade_intents" ("user_id", "id");
