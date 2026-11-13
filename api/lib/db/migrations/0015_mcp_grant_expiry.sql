DO $$
DECLARE old_constraint name;
BEGIN
  SELECT c.conname INTO STRICT old_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'mcp_api_trade_grants'::regclass
    AND c.contype = 'c'
    AND cardinality(c.conkey) = 2
    AND c.conkey @> ARRAY(
      SELECT attnum FROM pg_attribute
      WHERE attrelid = c.conrelid AND attname IN ('created_at', 'expires_at')
    );
  EXECUTE format('ALTER TABLE mcp_api_trade_grants DROP CONSTRAINT %I', old_constraint);
END $$;
--> statement-breakpoint
ALTER TABLE mcp_api_trade_grants
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD CONSTRAINT mcp_api_grant_expiry_valid CHECK (
    expires_at IS NULL OR
    (expires_at > created_at AND expires_at <= created_at + interval '72 hours')
  );
--> statement-breakpoint
ALTER TABLE mcp_trade_delegations ALTER COLUMN expires_at DROP NOT NULL;
