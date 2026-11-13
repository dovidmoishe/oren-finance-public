CREATE TABLE "saved_research" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "asset_id" text NOT NULL,
  "note" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "saved_research_user_asset_idx" ON "saved_research" ("user_id", "asset_id");
--> statement-breakpoint
CREATE TABLE "research_usage" (
  "bucket" text NOT NULL,
  "window_start" timestamptz NOT NULL,
  "count" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX "research_usage_bucket_window_idx" ON "research_usage" ("bucket", "window_start");
--> statement-breakpoint
CREATE TABLE "research_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "asset_id" text NOT NULL,
  "kind" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "research_events_kind_created_idx" ON "research_events" ("kind", "created_at");
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON saved_research TO oren_api_runtime;
    GRANT SELECT, INSERT, UPDATE ON research_usage TO oren_api_runtime;
    GRANT INSERT ON research_events TO oren_api_runtime;
  END IF;
END $$;
