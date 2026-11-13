CREATE TABLE mcp_api_trade_grants (
  id uuid PRIMARY KEY,
  user_id text NOT NULL,
  wallet_id text NOT NULL,
  wallet text NOT NULL,
  signer_id text NOT NULL,
  policy_id text NOT NULL,
  per_trade_limit_usd numeric(18,6) NOT NULL,
  daily_limit_usd numeric(18,6) NOT NULL,
  max_slippage_bps integer NOT NULL,
  allow_sell boolean NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  activated_at timestamptz,
  CHECK (per_trade_limit_usd > 0 AND per_trade_limit_usd <= 25
    AND daily_limit_usd >= per_trade_limit_usd AND daily_limit_usd <= 50),
  CHECK (max_slippage_bps BETWEEN 1 AND 50),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours')
);
--> statement-breakpoint
CREATE TABLE mcp_api_trade_authorizations (
  intent_id uuid PRIMARY KEY,
  delegation_id uuid NOT NULL REFERENCES mcp_api_trade_grants(id),
  execution_id uuid NOT NULL UNIQUE,
  idempotency_key text NOT NULL,
  canonical_request_base64 text NOT NULL,
  amount_usd numeric(18,6) NOT NULL CHECK (amount_usd > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_api_authorizations_grant_idx ON mcp_api_trade_authorizations(delegation_id);
--> statement-breakpoint
-- No backfill from gate-owned rows: existing grants must be revoked/re-enrolled.
-- NOT VALID preserves legacy inconsistent rows; new inserts/updates are checked.
ALTER TABLE mcp_trade_intents ADD CONSTRAINT mcp_delegated_buy_raw_usd_consistent
CHECK (mode <> 'delegated' OR side <> 'buy' OR COALESCE(
  CASE WHEN max_in_raw ~ '^[1-9][0-9]{0,19}$'
    THEN amount_usd IS NOT NULL
      AND max_in_raw::numeric <= 18446744073709551615
      AND amount_usd * 1000000 = max_in_raw::numeric
    ELSE false END, false)) NOT VALID;
--> statement-breakpoint
-- Enforce permissions during upgrade too, without requiring role re-provisioning.
DO $$ BEGIN
  REVOKE ALL ON mcp_api_trade_grants, mcp_api_trade_authorizations FROM PUBLIC;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_signer_gate') THEN
    REVOKE ALL ON mcp_api_trade_grants, mcp_api_trade_authorizations FROM oren_signer_gate;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'oren_api_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON mcp_api_trade_grants TO oren_api_runtime;
    GRANT SELECT, INSERT ON mcp_api_trade_authorizations TO oren_api_runtime;
    REVOKE UPDATE, DELETE, TRUNCATE ON mcp_api_trade_authorizations FROM oren_api_runtime;
  END IF;
END $$;
