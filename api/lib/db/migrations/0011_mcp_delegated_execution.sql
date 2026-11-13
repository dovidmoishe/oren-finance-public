CREATE TABLE "mcp_delegated_executions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "intent_id" uuid NOT NULL REFERENCES "mcp_trade_intents"("id"),
  "idempotency_key" text NOT NULL,
  "state" text NOT NULL DEFAULT 'challenged',
  "unsigned_transaction" text NOT NULL,
  "privy_request" jsonb NOT NULL,
  "request_expires_at" timestamptz NOT NULL,
  "signed_transaction" text,
  "chain_signature" text,
  "last_valid_block_height" integer,
  "error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "mcp_delegated_execution_state_valid" CHECK ("state" IN ('challenged', 'signing', 'signed', 'broadcast', 'confirmed', 'failed', 'pending')),
  CONSTRAINT "mcp_delegated_execution_signed_bytes_valid" CHECK ("state" NOT IN ('signed', 'broadcast', 'confirmed') OR "signed_transaction" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_delegated_execution_intent_idx" ON "mcp_delegated_executions" ("intent_id");
