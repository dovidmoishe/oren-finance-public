CREATE TABLE IF NOT EXISTS "mcp_connections" (
  "grant_id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL,
  "user_id" text NOT NULL,
  "wallet_id" text NOT NULL,
  "wallet" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "revoked_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "mcp_connections_user_idx" ON "mcp_connections" ("user_id");
