CREATE TABLE "mcp_trade_delegations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "wallet_id" text NOT NULL,
  "wallet" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending_signer',
  "signer_id" text NOT NULL,
  "policy_id" text NOT NULL,
  "policy_hash" text NOT NULL,
  "policy_tier" smallint NOT NULL,
  "per_trade_limit_usd" numeric(18,6) NOT NULL,
  "daily_limit_usd" numeric(18,6) NOT NULL,
  "max_slippage_bps" integer NOT NULL,
  "allow_sell" boolean NOT NULL DEFAULT false,
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "activated_at" timestamptz,
  "revoked_at" timestamptz,
  "revoke_reason" text,
  CONSTRAINT "mcp_delegation_status_valid" CHECK ("status" IN ('pending_signer', 'active', 'revoked', 'expired')),
  CONSTRAINT "mcp_delegation_limits_valid" CHECK ("per_trade_limit_usd" > 0 AND "daily_limit_usd" >= "per_trade_limit_usd"),
  CONSTRAINT "mcp_delegation_slippage_valid" CHECK ("max_slippage_bps" BETWEEN 1 AND 50),
  CONSTRAINT "mcp_delegation_expiry_valid" CHECK ("expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '7 days'),
  CONSTRAINT "mcp_delegation_policy_tier_valid" CHECK ("policy_tier" IN (1, 2))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_delegation_wallet_open_idx" ON "mcp_trade_delegations" ("wallet_id") WHERE "status" IN ('pending_signer', 'active');
--> statement-breakpoint
CREATE INDEX "mcp_delegation_owner_idx" ON "mcp_trade_delegations" ("user_id", "wallet_id");
--> statement-breakpoint
CREATE TABLE "mcp_budget_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delegation_id" uuid NOT NULL REFERENCES "mcp_trade_delegations"("id"),
  "intent_id" uuid NOT NULL REFERENCES "mcp_trade_intents"("id"),
  "amount_usd" numeric(18,6) NOT NULL,
  "status" text NOT NULL DEFAULT 'reserved',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "settled_at" timestamptz,
  CONSTRAINT "mcp_budget_amount_positive" CHECK ("amount_usd" > 0),
  CONSTRAINT "mcp_budget_status_valid" CHECK ("status" IN ('reserved', 'consumed', 'released')),
  CONSTRAINT "mcp_budget_settled_valid" CHECK (("status" = 'reserved' AND "settled_at" IS NULL) OR ("status" <> 'reserved' AND "settled_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_budget_intent_idx" ON "mcp_budget_reservations" ("intent_id");
--> statement-breakpoint
CREATE INDEX "mcp_budget_window_idx" ON "mcp_budget_reservations" ("delegation_id", "created_at") WHERE "status" IN ('reserved', 'consumed');
--> statement-breakpoint
CREATE TABLE "mcp_audit_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "wallet_id" text,
  "grant_id" text,
  "delegation_id" uuid REFERENCES "mcp_trade_delegations"("id"),
  "intent_id" uuid REFERENCES "mcp_trade_intents"("id"),
  "event_type" text NOT NULL,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "mcp_audit_user_idx" ON "mcp_audit_events" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "mcp_audit_grant_idx" ON "mcp_audit_events" ("grant_id", "created_at");
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD COLUMN "mode" text NOT NULL DEFAULT 'browser';
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD COLUMN "status" text NOT NULL DEFAULT 'prepared';
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD COLUMN "delegation_id" uuid REFERENCES "mcp_trade_delegations"("id");
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD COLUMN "reference_value_usd" numeric(18,6);
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD COLUMN "quoted_proceeds_usd" numeric(18,6);
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD COLUMN "reviewed_terms" jsonb;
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD COLUMN "execution_error" text;
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD CONSTRAINT "mcp_intent_mode_valid" CHECK ("mode" IN ('browser', 'delegated'));
--> statement-breakpoint
ALTER TABLE "mcp_trade_intents" ADD CONSTRAINT "mcp_intent_status_valid" CHECK ("status" IN ('prepared', 'executing', 'submitted', 'confirmed', 'failed'));
--> statement-breakpoint
CREATE UNIQUE INDEX "mcp_intent_idempotency_idx" ON "mcp_trade_intents" ("grant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
