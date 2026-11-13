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
      WHERE attrelid = c.conrelid
        AND attname IN ('per_trade_limit_usd', 'daily_limit_usd')
    );
  EXECUTE format('ALTER TABLE mcp_api_trade_grants DROP CONSTRAINT %I', old_constraint);
END $$;
--> statement-breakpoint
ALTER TABLE mcp_api_trade_grants
  ADD CONSTRAINT mcp_api_grant_spend_limits_valid CHECK (
    per_trade_limit_usd > 0 AND daily_limit_usd >= per_trade_limit_usd
  );
