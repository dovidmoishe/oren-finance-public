CREATE TABLE IF NOT EXISTS "mcp_oauth_objects" (
  "key" text PRIMARY KEY NOT NULL,
  "model" text NOT NULL,
  "payload" jsonb NOT NULL,
  "uid_hash" text,
  "user_code_hash" text,
  "grant_id" text,
  "expires_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "mcp_oauth_uid_idx" ON "mcp_oauth_objects" ("model", "uid_hash");
CREATE INDEX IF NOT EXISTS "mcp_oauth_user_code_idx" ON "mcp_oauth_objects" ("model", "user_code_hash");
CREATE INDEX IF NOT EXISTS "mcp_oauth_grant_idx" ON "mcp_oauth_objects" ("model", "grant_id");
CREATE INDEX IF NOT EXISTS "mcp_oauth_expiry_idx" ON "mcp_oauth_objects" ("expires_at");
