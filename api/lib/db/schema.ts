import { relations, sql } from 'drizzle-orm';

import {
  index,
  integer,
  jsonb,
  boolean,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** Durable approval state only; chain confirmations remain the financial ledger. */
export const tradeApprovals = pgTable(
  'trade_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    wallet: text('wallet').notNull(),
    walletId: text('wallet_id').notNull(),
    kind: text('kind').notNull(),
    referenceId: text('reference_id').notNull(),
    executionId: uuid('execution_id').notNull(),
    transaction: text('transaction').notNull(),
    signedTransaction: text('signed_transaction'),
    signature: text('signature'),
    status: text('status').notNull().default('prepared'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
    feeLamports: text('fee_lamports').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('trade_approval_reference').on(
      table.userId,
      table.wallet,
      table.kind,
      table.referenceId,
    ),
    uniqueIndex('trade_approval_wallet_inflight')
      .on(table.wallet)
      .where(sql`${table.status} IN ('signing', 'signed')`),
  ],
);

/** Durable OAuth provider state. Identifiers are HMACed by the adapter. */
export const mcpOauthObjects = pgTable(
  'mcp_oauth_objects',
  {
    key: text('key').primaryKey(),
    model: text('model').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    uidHash: text('uid_hash'),
    userCodeHash: text('user_code_hash'),
    grantId: text('grant_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('mcp_oauth_uid_idx').on(table.model, table.uidHash),
    index('mcp_oauth_user_code_idx').on(table.model, table.userCodeHash),
    index('mcp_oauth_grant_idx').on(table.model, table.grantId),
    index('mcp_oauth_expiry_idx').on(table.expiresAt),
  ],
);

/** Browser-approved OAuth connections. A token is usable only while this row is active. */
export const mcpConnections = pgTable(
  'mcp_connections',
  {
    grantId: text('grant_id').primaryKey(),
    clientId: text('client_id').notNull(),
    userId: text('user_id').notNull(),
    walletId: text('wallet_id').notNull(),
    wallet: text('wallet').notNull(),
    scopes: text('scopes').notNull().default('oren.read'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [index('mcp_connections_user_idx').on(table.userId)],
);

/** Agent buy requests are application intents; no signature or route is stored here. */
export const mcpTradeIntents = pgTable(
  'mcp_trade_intents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    grantId: text('grant_id').notNull(),
    clientId: text('client_id').notNull(),
    userId: text('user_id').notNull(),
    wallet: text('wallet').notNull(),
    assetId: text('asset_id').notNull(),
    ticker: text('ticker').notNull(),
    approvalId: uuid('approval_id'),
    side: text('side').$type<'buy' | 'sell'>().notNull().default('buy'),
    stockMint: text('stock_mint'),
    amountUsd: numeric('amount_usd', { precision: 18, scale: 6 }),
    amountShares: numeric('amount_shares', { precision: 30, scale: 12 }),
    maxInRaw: text('max_in_raw'),
    minOutRaw: text('min_out_raw'),
    mode: text('mode')
      .$type<'browser' | 'delegated'>()
      .notNull()
      .default('browser'),
    status: text('status')
      .$type<'prepared' | 'executing' | 'submitted' | 'confirmed' | 'failed'>()
      .notNull()
      .default('prepared'),
    delegationId: uuid('delegation_id').references(
      () => mcpTradeDelegations.id,
    ),
    idempotencyKey: text('idempotency_key'),
    referenceValueUsd: numeric('reference_value_usd', {
      precision: 18,
      scale: 6,
    }),
    quotedProceedsUsd: numeric('quoted_proceeds_usd', {
      precision: 18,
      scale: 6,
    }),
    reviewedTerms: jsonb('reviewed_terms').$type<Record<string, unknown>>(),
    executionError: text('execution_error'),
    slippageBps: integer('slippage_bps').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('mcp_trade_intents_owner_idx').on(table.userId, table.id)],
);

/** User opt-in and verified Privy signer policy for bounded chat trades. */
export const mcpTradeDelegations = pgTable(
  'mcp_trade_delegations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    walletId: text('wallet_id').notNull(),
    wallet: text('wallet').notNull(),
    status: text('status')
      .$type<'pending_signer' | 'active' | 'revoked' | 'expired'>()
      .notNull()
      .default('pending_signer'),
    signerId: text('signer_id').notNull(),
    policyId: text('policy_id').notNull(),
    policyHash: text('policy_hash').notNull(),
    policyTier: smallint('policy_tier').notNull(),
    perTradeLimitUsd: numeric('per_trade_limit_usd', {
      precision: 18,
      scale: 6,
    }).notNull(),
    dailyLimitUsd: numeric('daily_limit_usd', {
      precision: 18,
      scale: 6,
    }).notNull(),
    maxSlippageBps: integer('max_slippage_bps').notNull(),
    allowSell: boolean('allow_sell').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokeReason: text('revoke_reason'),
  },
  (table) => [
    uniqueIndex('mcp_delegation_wallet_open_idx')
      .on(table.walletId)
      .where(sql`${table.status} IN ('pending_signer', 'active')`),
    index('mcp_delegation_owner_idx').on(table.userId, table.walletId),
  ],
);

/** API-owned browser terms: the gate role cannot create or change these. */
export const mcpApiTradeGrants = pgTable('mcp_api_trade_grants', {
  id: uuid('id').primaryKey(),
  userId: text('user_id').notNull(),
  walletId: text('wallet_id').notNull(),
  wallet: text('wallet').notNull(),
  signerId: text('signer_id').notNull(),
  policyId: text('policy_id').notNull(),
  perTradeLimitUsd: numeric('per_trade_limit_usd', {
    precision: 18,
    scale: 6,
  }).notNull(),
  dailyLimitUsd: numeric('daily_limit_usd', {
    precision: 18,
    scale: 6,
  }).notNull(),
  maxSlippageBps: integer('max_slippage_bps').notNull(),
  allowSell: boolean('allow_sell').notNull(),
  status: text('status')
    .$type<'pending' | 'active' | 'revoked'>()
    .notNull()
    .default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
});

/** Append-only API budget and exact-request claim. No gate-writable foreign keys. */
export const mcpApiTradeAuthorizations = pgTable(
  'mcp_api_trade_authorizations',
  {
    intentId: uuid('intent_id').primaryKey(),
    delegationId: uuid('delegation_id')
      .notNull()
      .references(() => mcpApiTradeGrants.id),
    executionId: uuid('execution_id').notNull().unique(),
    idempotencyKey: text('idempotency_key').notNull(),
    canonicalRequestBase64: text('canonical_request_base64').notNull(),
    amountUsd: numeric('amount_usd', { precision: 18, scale: 6 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('mcp_api_authorizations_grant_idx').on(table.delegationId)],
);

/** A reserved amount remains charged until confirmation or definite failure. */
export const mcpBudgetReservations = pgTable(
  'mcp_budget_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    delegationId: uuid('delegation_id')
      .notNull()
      .references(() => mcpTradeDelegations.id),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => mcpTradeIntents.id),
    amountUsd: numeric('amount_usd', { precision: 18, scale: 6 }).notNull(),
    status: text('status')
      .$type<'reserved' | 'consumed' | 'released'>()
      .notNull()
      .default('reserved'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('mcp_budget_intent_idx').on(table.intentId),
    index('mcp_budget_window_idx')
      .on(table.delegationId, table.createdAt)
      .where(sql`${table.status} IN ('reserved', 'consumed')`),
  ],
);

/** Exact Privy request and signed bytes retained for idempotent reconciliation. */
export const mcpDelegatedExecutions = pgTable(
  'mcp_delegated_executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => mcpTradeIntents.id),
    idempotencyKey: text('idempotency_key').notNull(),
    state: text('state')
      .$type<
        | 'challenged'
        | 'signing'
        | 'signed'
        | 'broadcast'
        | 'confirmed'
        | 'failed'
        | 'pending'
      >()
      .notNull()
      .default('challenged'),
    unsignedTransaction: text('unsigned_transaction').notNull(),
    privyRequest: jsonb('privy_request')
      .$type<Record<string, unknown>>()
      .notNull(),
    requestExpiresAt: timestamp('request_expires_at', {
      withTimezone: true,
    }).notNull(),
    signedTransaction: text('signed_transaction'),
    chainSignature: text('chain_signature'),
    lastValidBlockHeight: integer('last_valid_block_height'),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('mcp_delegated_execution_intent_idx').on(table.intentId),
  ],
);

/** Redacted lifecycle records; no token, raw error, or transaction bytes. */
export const mcpAuditEvents = pgTable(
  'mcp_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    walletId: text('wallet_id'),
    grantId: text('grant_id'),
    delegationId: uuid('delegation_id').references(
      () => mcpTradeDelegations.id,
    ),
    intentId: uuid('intent_id').references(() => mcpTradeIntents.id),
    eventType: text('event_type').notNull(),
    details: jsonb('details')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('mcp_audit_user_idx').on(table.userId, table.createdAt),
    index('mcp_audit_grant_idx').on(table.grantId, table.createdAt),
  ],
);

/**
 * Postgres is Oren's application memory — not the financial ledger.
 * Required: portfolio_snapshots, stock_signals, executions, vault_positions
 * Optional: agent_threads, agent_messages, cached_news
 *
 * Equity registry / market data remains authoritative in Tokens API. Postgres
 * may keep short-lived read-through caches for responsive application reads.
 */

export const executionTypeEnum = pgEnum('execution_type', [
  'stock_purchase',
  'stock_sale',
  'basket_purchase',
  'lock',
  'unlock',
  'limit_buy',
  'limit_sell',
  'limit_cancel',
]);

export const limitOrderStatusEnum = pgEnum('limit_order_status', [
  'open',
  'filled',
  'cancelled',
  'expired',
  'failed',
  'awaiting_signature',
]);

export const limitOrderSideEnum = pgEnum('limit_order_side', ['buy', 'sell']);

export const executionStatusEnum = pgEnum('execution_status', [
  'preparing',
  'awaiting_signature',
  'submitted',
  'confirming',
  'confirmed',
  'failed',
]);

export const executionFeatureEnum = pgEnum('execution_feature', [
  'direct',
  'agent',
  'basket',
  'copy_trade',
  'limit_order',
]);

export const tradeSideEnum = pgEnum('trade_side', ['buy', 'sell']);

export const executionJobKindEnum = pgEnum('execution_job_kind', [
  'swap_fill',
  'limit_fill',
  'dune_sync',
]);

export const executionJobStatusEnum = pgEnum('execution_job_status', [
  'pending',
  'processing',
  'retry',
  'completed',
  'dead',
]);

export const agentMessageRoleEnum = pgEnum('agent_message_role', [
  'user',
  'assistant',
  'tool',
  'system',
]);

export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true })
      .defaultNow()
      .notNull(),
    totalValueUsd: numeric('total_value_usd', {
      precision: 20,
      scale: 8,
    }).notNull(),
    availableValueUsd: numeric('available_value_usd', {
      precision: 20,
      scale: 8,
    }).notNull(),
    lockedValueUsd: numeric('locked_value_usd', {
      precision: 20,
      scale: 8,
    }).notNull(),
    positionsJson: jsonb('positions_json').notNull().default([]),
  },
  (table) => [
    index('portfolio_snapshots_wallet_timestamp_idx').on(
      table.walletAddress,
      table.timestamp,
    ),
  ],
);

export const stockSignals = pgTable(
  'stock_signals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: text('asset_id').notNull(),
    ticker: text('ticker').notNull(),
    momentum7d: numeric('momentum_7d', { precision: 20, scale: 8 }).notNull(),
    momentum30d: numeric('momentum_30d', { precision: 20, scale: 8 }).notNull(),
    volatility30d: numeric('volatility_30d', {
      precision: 20,
      scale: 8,
    }).notNull(),
    volumeTrend: numeric('volume_trend', { precision: 20, scale: 8 }).notNull(),
    rsi14: numeric('rsi_14', { precision: 20, scale: 8 }).notNull(),
    sma20: numeric('sma_20', { precision: 20, scale: 8 }).notNull(),
    sma50: numeric('sma_50', { precision: 20, scale: 8 }).notNull(),
    liquidityScore: numeric('liquidity_score', {
      precision: 20,
      scale: 8,
    }).notNull(),
    activityScore: numeric('activity_score', {
      precision: 20,
      scale: 8,
    }).notNull(),
    opportunityScore: numeric('opportunity_score', {
      precision: 5,
      scale: 2,
    }).notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('stock_signals_asset_id_idx').on(table.assetId),
    index('stock_signals_ticker_idx').on(table.ticker),
    index('stock_signals_opportunity_score_idx').on(table.opportunityScore),
  ],
);

/** Cached stock discovery data. Tokens remains the upstream source of truth. */
export const cachedStocks = pgTable(
  'cached_stocks',
  {
    assetId: text('asset_id').primaryKey(),
    ticker: text('ticker').notNull(),
    name: text('name').notNull(),
    category: text('category').notNull(),
    logo: text('logo'),
    price: numeric('price', { precision: 24, scale: 8 }),
    priceChange24h: numeric('price_change_24h', { precision: 20, scale: 8 }),
    volume24h: numeric('volume_24h', { precision: 28, scale: 8 }),
    liquidity: numeric('liquidity', { precision: 28, scale: 8 }),
    sortRank: integer('sort_rank').notNull(),
    cachedAt: timestamp('cached_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('cached_stocks_sort_rank_idx').on(table.sortRank),
    index('cached_stocks_ticker_idx').on(table.ticker),
    index('cached_stocks_expires_at_idx').on(table.expiresAt),
  ],
);

export const traderProfiles = pgTable(
  'trader_profiles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    isPublic: boolean('is_public').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('trader_profiles_wallet_address_idx').on(table.walletAddress),
    uniqueIndex('trader_profiles_slug_idx').on(table.slug),
    index('trader_profiles_is_public_idx').on(table.isPublic),
  ],
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    type: executionTypeEnum('type').notNull(),
    assetId: text('asset_id'),
    ticker: text('ticker'),
    tokenMint: text('token_mint'),
    inputAsset: text('input_asset'),
    outputAsset: text('output_asset'),
    amount: numeric('amount', { precision: 40, scale: 18 }),
    amountUsd: numeric('amount_usd', { precision: 20, scale: 8 }),
    provider: text('provider'),
    featureSource: executionFeatureEnum('feature_source')
      .notNull()
      .default('direct'),
    transactionSignature: text('transaction_signature'),
    status: executionStatusEnum('status').notNull().default('preparing'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
  },
  (table) => [
    index('executions_wallet_created_at_idx').on(
      table.walletAddress,
      table.createdAt,
    ),
    index('executions_status_idx').on(table.status),
    index('executions_asset_id_idx').on(table.assetId),
    uniqueIndex('executions_transaction_signature_idx').on(
      table.transactionSignature,
    ),
  ],
);

/** Verified Oren-routed stock/USDC fills. Public volume is aggregated only. */
export const tradeFills = pgTable(
  'trade_fills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    executionId: uuid('execution_id').references(() => executions.id),
    orderKey: text('order_key'),
    transactionSignature: text('transaction_signature').notNull(),
    fillIndex: integer('fill_index').notNull().default(0),
    walletAddress: text('wallet_address').notNull(),
    assetId: text('asset_id').notNull(),
    ticker: text('ticker').notNull(),
    tokenMint: text('token_mint').notNull(),
    side: tradeSideEnum('side').notNull(),
    stockAmount: numeric('stock_amount', {
      precision: 40,
      scale: 18,
    }).notNull(),
    usdNotional: numeric('usd_notional', { precision: 28, scale: 8 }).notNull(),
    executionPriceUsd: numeric('execution_price_usd', {
      precision: 28,
      scale: 8,
    }).notNull(),
    featureSource: executionFeatureEnum('feature_source').notNull(),
    provider: text('provider').notNull(),
    slot: numeric('slot', { precision: 20, scale: 0 }).notNull(),
    blockTime: timestamp('block_time', { withTimezone: true }).notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('trade_fills_signature_asset_fill_idx').on(
      table.transactionSignature,
      table.assetId,
      table.fillIndex,
    ),
    index('trade_fills_asset_time_idx').on(table.assetId, table.blockTime),
    index('trade_fills_side_time_idx').on(table.side, table.blockTime),
    index('trade_fills_feature_time_idx').on(
      table.featureSource,
      table.blockTime,
    ),
  ],
);

/** Durable Postgres outbox. Workers lease rows; user requests never await RPC/Dune. */
export const executionJobs = pgTable(
  'execution_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: executionJobKindEnum('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    executionId: uuid('execution_id').references(() => executions.id),
    orderKey: text('order_key'),
    transactionSignature: text('transaction_signature'),
    status: executionJobStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lastError: text('last_error'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('execution_jobs_dedupe_key_idx').on(table.dedupeKey),
    index('execution_jobs_status_available_idx').on(
      table.status,
      table.availableAt,
    ),
  ],
);

export const vaultPositions = pgTable(
  'vault_positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lockAddress: text('lock_address').notNull(),
    owner: text('owner').notNull(),
    mint: text('mint').notNull(),
    assetId: text('asset_id'),
    ticker: text('ticker'),
    amount: numeric('amount', { precision: 40, scale: 18 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    unlockAt: timestamp('unlock_at', { withTimezone: true }).notNull(),
    transactionSignature: text('transaction_signature').notNull(),
    indexedAt: timestamp('indexed_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('vault_positions_lock_address_idx').on(table.lockAddress),
    index('vault_positions_owner_idx').on(table.owner),
    index('vault_positions_asset_id_idx').on(table.assetId),
    index('vault_positions_unlock_at_idx').on(table.unlockAt),
  ],
);

/** Jupiter Trigger V1 orders indexed for app memory (Jupiter remains ledger). */
export const limitOrders = pgTable(
  'limit_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    orderKey: text('order_key').notNull(),
    side: limitOrderSideEnum('side').notNull(),
    assetId: text('asset_id'),
    ticker: text('ticker'),
    inputMint: text('input_mint').notNull(),
    outputMint: text('output_mint').notNull(),
    makingAmount: numeric('making_amount', {
      precision: 40,
      scale: 18,
    }).notNull(),
    takingAmount: numeric('taking_amount', {
      precision: 40,
      scale: 18,
    }).notNull(),
    limitPriceUsd: numeric('limit_price_usd', {
      precision: 20,
      scale: 8,
    }).notNull(),
    amountUsd: numeric('amount_usd', { precision: 20, scale: 8 }),
    status: limitOrderStatusEnum('status').notNull().default('open'),
    basis: text('basis'),
    openSignature: text('open_signature'),
    closeSignature: text('close_signature'),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('limit_orders_order_key_idx').on(table.orderKey),
    index('limit_orders_wallet_created_at_idx').on(
      table.walletAddress,
      table.createdAt,
    ),
    index('limit_orders_status_idx').on(table.status),
    index('limit_orders_asset_id_idx').on(table.assetId),
  ],
);

export const agentThreads = pgTable(
  'agent_threads',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    walletAddress: text('wallet_address').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('agent_threads_wallet_address_idx').on(table.walletAddress),
  ],
);

export const agentMessages = pgTable(
  'agent_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => agentThreads.id, { onDelete: 'cascade' }),
    role: agentMessageRoleEnum('role').notNull(),
    content: text('content').notNull(),
    toolName: text('tool_name'),
    toolPayload: jsonb('tool_payload'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('agent_messages_thread_id_created_at_idx').on(
      table.threadId,
      table.createdAt,
    ),
  ],
);

/** Saved research is user-owned app memory, not a financial position record. */
export const savedResearch = pgTable(
  'saved_research',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    assetId: text('asset_id').notNull(),
    note: text('note').notNull(),
    snapshot: jsonb('snapshot')
      .$type<import('../../types/research').ResearchSnapshot>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('saved_research_user_asset_idx').on(
      table.userId,
      table.assetId,
    ),
  ],
);

export const researchUsage = pgTable(
  'research_usage',
  {
    bucket: text('bucket').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (table) => [
    uniqueIndex('research_usage_bucket_window_idx').on(
      table.bucket,
      table.windowStart,
    ),
  ],
);

export const researchEvents = pgTable(
  'research_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    assetId: text('asset_id').notNull(),
    kind: text('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('research_events_kind_created_idx').on(table.kind, table.createdAt),
  ],
);

/** User feedback and support requests; the team reads and resolves these. */
export const feedbackTickets = pgTable(
  'feedback_tickets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    walletAddress: text('wallet_address').notNull(),
    email: text('email'),
    kind: text('kind').notNull(),
    subject: text('subject').notNull(),
    message: text('message').notNull(),
    page: text('page'),
    status: text('status').notNull().default('open'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index('feedback_tickets_user_created_idx').on(
      table.userId,
      table.createdAt,
    ),
    index('feedback_tickets_status_created_idx').on(
      table.status,
      table.createdAt,
    ),
  ],
);

/** Optional short-lived news cache — not a Tokens API mirror. */
export const cachedNews = pgTable(
  'cached_news',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    assetId: text('asset_id'),
    headline: text('headline').notNull(),
    source: text('source'),
    summary: text('summary'),
    url: text('url'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    payload: jsonb('payload'),
    cachedAt: timestamp('cached_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    index('cached_news_asset_id_idx').on(table.assetId),
    index('cached_news_expires_at_idx').on(table.expiresAt),
  ],
);

export const agentThreadsRelations = relations(agentThreads, ({ many }) => ({
  messages: many(agentMessages),
}));

export const agentMessagesRelations = relations(agentMessages, ({ one }) => ({
  thread: one(agentThreads, {
    fields: [agentMessages.threadId],
    references: [agentThreads.id],
  }),
}));
