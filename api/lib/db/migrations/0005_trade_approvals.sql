CREATE TABLE "trade_approvals" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
 "user_id" text NOT NULL,
 "wallet" text NOT NULL,
 "wallet_id" text NOT NULL,
 "kind" text NOT NULL,
 "reference_id" text NOT NULL,
 "execution_id" uuid NOT NULL,
 "transaction" text NOT NULL,
 "signed_transaction" text,
 "signature" text,
 "status" text DEFAULT 'prepared' NOT NULL,
 "details" jsonb NOT NULL,
 "fee_lamports" text NOT NULL,
 "expires_at" timestamp with time zone NOT NULL,
 "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "trade_approval_reference" ON "trade_approvals" ("user_id", "wallet", "kind", "reference_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "trade_approval_wallet_inflight" ON "trade_approvals" ("wallet") WHERE "status" IN ('signing', 'signed');
