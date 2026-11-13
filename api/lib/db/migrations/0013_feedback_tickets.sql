CREATE TABLE "feedback_tickets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "wallet_address" text NOT NULL,
  "email" text,
  "kind" text NOT NULL,
  "subject" text NOT NULL,
  "message" text NOT NULL,
  "page" text,
  "status" text NOT NULL DEFAULT 'open',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "feedback_tickets_user_created_idx" ON "feedback_tickets" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "feedback_tickets_status_created_idx" ON "feedback_tickets" ("status", "created_at");
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') THEN
    GRANT SELECT, INSERT ON feedback_tickets TO oren_api_runtime;
  END IF;
END $$;
