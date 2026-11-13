ALTER TABLE "mcp_trade_intents" ADD COLUMN "side" text NOT NULL DEFAULT 'buy';
ALTER TABLE "mcp_trade_intents" ADD COLUMN "stock_mint" text;
ALTER TABLE "mcp_trade_intents" ADD COLUMN "amount_shares" numeric(30,12);
ALTER TABLE "mcp_trade_intents" ADD COLUMN "max_in_raw" text;
ALTER TABLE "mcp_trade_intents" ADD COLUMN "min_out_raw" text;
ALTER TABLE "mcp_trade_intents" ALTER COLUMN "amount_usd" DROP NOT NULL;
ALTER TABLE "mcp_trade_intents" DROP CONSTRAINT "mcp_trade_intents_amount_positive";
ALTER TABLE "mcp_trade_intents" ADD CONSTRAINT "mcp_trade_intents_side_valid" CHECK ("side" IN ('buy', 'sell'));
ALTER TABLE "mcp_trade_intents" ADD CONSTRAINT "mcp_trade_intents_amount_valid" CHECK (("side" = 'buy' AND "amount_usd" > 0 AND "amount_shares" IS NULL) OR ("side" = 'sell' AND "amount_shares" > 0));
