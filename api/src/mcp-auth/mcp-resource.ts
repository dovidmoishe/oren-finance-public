import type { Request, Response } from 'express';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { z } from 'zod';
import {
  mcpConnections,
  mcpDelegatedExecutions,
  mcpTradeDelegations,
  mcpTradeIntents,
  tradeApprovals,
} from '../database/schema';
import type { Database } from '../database/database.provider';
import type { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import type { MarketService } from '../market/market.service';
import type { PortfolioService } from '../portfolio/portfolio.service';
import type { ExecutionService } from '../execution/execution.service';
import type { ApprovalRpc } from '../execution/approval-rpc.service';
import { MAX_MCP_TRADE_USD } from './grant-spend-limits';
import {
  SOL_RENT_MESSAGE,
  SOL_FEE_MESSAGE,
} from '../execution/simulation-failure';
import {
  enforcedMinimumOut,
  rawIn,
  reviewedTermsFor,
} from '../execution/swap-terms';
import type { McpOAuthRuntime } from './oauth-runtime';
import type { SignerGateClient } from './signer-gate.client';
import {
  SignerGateRejection,
  publicGateFailureCode,
} from './signer-gate.errors';
import { signingOutcome } from './signing-outcome';
import { rawSellShares, rawSellReferenceUsd } from './delegated-amounts';
import { canSignInChat, delegatedModeDecision } from './delegated-mode';
import { delegatedFailureBody } from '../execution/simulation-reason';

export interface McpResourceDeps {
  db: Database;
  auth: PrivyWalletAuth;
  market: MarketService;
  portfolio: PortfolioService;
  execution: ExecutionService;
  tradeRpc: Pick<ApprovalRpc, 'status'>;
  research?: {
    getStock(
      assetId: string,
      caller: { userId: string; walletAddress: string; email?: string },
      options?: { audience?: 'app' | 'mcp' },
    ): Promise<unknown>;
  };
  oauth: McpOAuthRuntime;
  gate?: SignerGateClient;
  signerPolicyId?: string;
  delegatedSides?: { buy: boolean; sell: boolean };
}

/** Opaque OAuth access tokens are checked against current grant and wallet state. */
export async function requireMcpAccess(req: Request, deps: McpResourceDeps) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
  if (!match) return undefined;
  const token = await deps.oauth.provider.AccessToken.find(match[1]);
  if (
    !token?.isValid ||
    token.aud !== deps.oauth.resource ||
    ![...token.scopes].some((scope) =>
      ['oren.read', 'oren.trade.prepare', 'oren.trade.execute'].includes(scope),
    ) ||
    !token.accountId ||
    !token.clientId ||
    !token.grantId
  )
    return undefined;
  const [connection] = await deps.db
    .select()
    .from(mcpConnections)
    .where(
      and(
        eq(mcpConnections.grantId, token.grantId),
        eq(mcpConnections.clientId, token.clientId),
        eq(mcpConnections.userId, token.accountId),
        isNull(mcpConnections.revokedAt),
      ),
    )
    .limit(1);
  if (!connection) return undefined;
  if (connection.createdAt.getTime() <= Date.now() - 7 * 24 * 60 * 60_000)
    return undefined;
  const granted = new Set(connection.scopes.split(/\s+/));
  if (
    [...token.scopes].some(
      (scope) => scope.startsWith('oren.') && !granted.has(scope),
    )
  )
    return undefined;
  await deps.auth.verifyMcpWallet(
    connection.userId,
    connection.walletId,
    connection.wallet,
  );
  return { ...connection, tokenScopes: token.scopes };
}

export async function handleMcpRequest(
  req: Request,
  res: Response,
  deps: McpResourceDeps,
) {
  if (req.method !== 'POST') return res.sendStatus(405);
  if (req.headers.origin && req.headers.origin !== deps.oauth.appOrigin)
    return res.sendStatus(403);
  let connection: Awaited<ReturnType<typeof requireMcpAccess>>;
  try {
    connection = await requireMcpAccess(req, deps);
  } catch {
    return res.sendStatus(503);
  }
  if (!connection) {
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${deps.oauth.issuer.replace(/\/oauth$/, '')}/.well-known/oauth-protected-resource/mcp"`,
    );
    return res.sendStatus(401);
  }
  res.setHeader('Cache-Control', 'no-store');
  const server = new McpServer({ name: 'oren', version: '0.1.0' });
  if (connection.tokenScopes.has('oren.read'))
    server.registerTool(
      'get_portfolio',
      {
        title: 'Get portfolio',
        description:
          'Read the Oren portfolio for the wallet approved during connection.',
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
      },
      async () => {
        const result = await deps.portfolio.getPortfolio(connection.wallet);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );
  if (connection.tokenScopes.has('oren.read'))
    server.registerTool(
      'search_stocks',
      {
        title: 'Search stocks',
        description: 'Search tokenized stocks by ticker or company name.',
        inputSchema: z.object({ query: z.string().trim().min(1).max(80) }),
        annotations: { readOnlyHint: true },
      },
      async ({ query }) => {
        const result = await deps.market.searchStocks(query);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );
  if (connection.tokenScopes.has('oren.read'))
    server.registerTool(
      'get_stock',
      {
        title: 'Get stock',
        description: 'Get canonical stock detail by asset id.',
        inputSchema: z.object({ assetId: z.string().trim().min(1).max(80) }),
        annotations: { readOnlyHint: true },
      },
      async ({ assetId }) => {
        const result = await deps.market.getStock(assetId);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );
  if (connection.tokenScopes.has('oren.read'))
    server.registerTool(
      'get_stock_research',
      {
        title: 'Get stock research',
        description:
          'Read the cited research report for one canonical stock, including SEC company facts when the issuer is verified. Portfolio context uses the wallet approved for this connection. Writer-opinion feeds are omitted. This does not prepare or submit a trade.',
        inputSchema: z.object({
          assetId: z.string().trim().min(1).max(80),
        }),
        annotations: { readOnlyHint: true },
      },
      async ({ assetId }) => {
        if (!/^[A-Za-z0-9._:-]{1,80}$/.test(assetId)) {
          return {
            content: [{ type: 'text' as const, text: 'Invalid asset id.' }],
            isError: true,
          };
        }
        if (!deps.research) {
          return {
            content: [
              {
                type: 'text' as const,
                text: 'Company research is unavailable.',
              },
            ],
            isError: true,
          };
        }
        try {
          const result = await deps.research.getStock(
            assetId,
            {
              userId: connection.userId,
              walletAddress: connection.wallet,
            },
            { audience: 'mcp' },
          );
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result) }],
          };
        } catch (error) {
          const message =
            error instanceof Error &&
            (error.message === 'Ambiguous stock' ||
              error.message === 'Unsupported stock')
              ? error.message
              : 'Company research is unavailable.';
          return {
            content: [{ type: 'text' as const, text: message }],
            isError: true,
          };
        }
      },
    );
  if (connection.tokenScopes.has('oren.trade.prepare')) {
    server.registerTool(
      'prepare_trade',
      {
        title: 'Prepare stock trade',
        description:
          'Prepare a USDC stock buy or stock sell. In-chat signing quotes Jupiter. When mode is delegated, call execute_trade. When mode is browser, relay the returned message and browserReason. Share signingSettingsUrl when present to restore in-chat execution. approvalUrl is for signing only this trade in the browser.',
        inputSchema: z.object({
          assetId: z.string().trim().min(1).max(80),
          side: z.enum(['buy', 'sell']),
          amountUsd: z
            .number()
            .finite()
            .min(0.01)
            .max(MAX_MCP_TRADE_USD)
            .optional(),
          amountShares: z
            .number()
            .finite()
            .positive()
            .max(1_000_000_000)
            .optional(),
          slippageBps: z.number().int().min(1).max(50).default(50),
        }),
        annotations: { destructiveHint: false },
      },
      async ({ assetId, side, amountUsd, amountShares, slippageBps }) => {
        if (
          (side === 'buy' &&
            (amountUsd === undefined || amountShares !== undefined)) ||
          (side === 'sell' &&
            (amountShares === undefined || amountUsd !== undefined))
        )
          return {
            content: [
              {
                type: 'text',
                text: 'Use amountUsd for buys or amountShares for sells.',
              },
            ],
            isError: true,
          };
        const executeEnabled = Boolean(
          deps.gate &&
          deps.delegatedSides?.[side] &&
          connection.tokenScopes.has('oren.trade.execute'),
        );
        const [delegation] = executeEnabled
          ? await deps.db
              .select()
              .from(mcpTradeDelegations)
              .where(
                and(
                  eq(mcpTradeDelegations.userId, connection.userId),
                  eq(mcpTradeDelegations.walletId, connection.walletId),
                  eq(mcpTradeDelegations.wallet, connection.wallet),
                ),
              )
              .orderBy(desc(mcpTradeDelegations.createdAt))
              .limit(1)
          : [];
        const quoteRequest = {
          assetId,
          ticker: '',
          side,
          amountUsd,
          amount: amountShares,
          slippageBps,
          wallet: connection.wallet,
        };
        // Chat signing can only sign Jupiter. Ask for that route first, at
        // the caller's slippage. If Jupiter has no route, fall back to
        // best-of so the user can still review in the browser.
        const chatSigning = canSignInChat({
          executeEnabled,
          signerPolicyId: deps.signerPolicyId,
          slippageBps,
          side,
          delegation,
          connectionCreatedAt: connection.createdAt,
        });
        let quote: Awaited<ReturnType<ExecutionService['getQuote']>>;
        if (chatSigning) {
          try {
            quote = await deps.execution.getQuote({
              ...quoteRequest,
              jupiterOnly: true,
            });
          } catch {
            // Jupiter had no signable route. Best-of may still be reviewed.
            quote = await deps.execution.getQuote(quoteRequest);
          }
        } else {
          quote = await deps.execution.getQuote(quoteRequest);
        }
        const maxIn = rawIn(quote);
        const minOut = enforcedMinimumOut(quote);
        const reviewed = reviewedTermsFor(quote);
        if (!maxIn || minOut === undefined || !reviewed)
          return {
            content: [
              {
                type: 'text',
                text: 'The route has no verifiable trade amounts.',
              },
            ],
            isError: true,
          };
        const stock =
          side === 'sell'
            ? await deps.market.getStock(quote.assetId)
            : undefined;
        const stockDecimals = quote.variant.decimals;
        if (stockDecimals === undefined)
          return {
            content: [
              {
                type: 'text',
                text: 'Token precision for this stock is unavailable. Try again shortly.',
              },
            ],
            isError: true,
          };
        const normalizedShares =
          side === 'sell' ? rawSellShares(maxIn, stockDecimals) : null;
        const referenceValueUsd =
          side === 'sell' &&
          stock?.price &&
          Number.isFinite(stock.price) &&
          stock.price > 0
            ? rawSellReferenceUsd(
                maxIn,
                normalizedShares,
                stockDecimals,
                stock.price,
              )
            : null;
        const quotedProceedsUsd =
          side === 'sell' &&
          Number.isFinite(quote.outputAmount) &&
          quote.outputAmount > 0
            ? (Math.ceil(quote.outputAmount * 1_000_000) / 1_000_000).toFixed(6)
            : null;
        const decision = delegatedModeDecision({
          executeEnabled,
          signerPolicyId: deps.signerPolicyId,
          provider: quote.provider,
          slippageBps,
          side,
          delegation,
          connectionCreatedAt: connection.createdAt,
          sellPriced: Boolean(referenceValueUsd && quotedProceedsUsd),
        });
        const delegated = decision.delegated;
        const [intent] = await deps.db
          .insert(mcpTradeIntents)
          .values({
            grantId: connection.grantId,
            clientId: connection.clientId,
            userId: connection.userId,
            wallet: connection.wallet,
            assetId: quote.assetId,
            ticker: quote.ticker,
            side,
            stockMint: quote.variant.mint,
            amountUsd: side === 'buy' ? amountUsd!.toFixed(6) : null,
            amountShares: normalizedShares,
            maxInRaw: maxIn,
            minOutRaw: minOut.toString(),
            referenceValueUsd,
            quotedProceedsUsd,
            mode: delegated ? 'delegated' : 'browser',
            delegationId: delegated ? delegation.id : null,
            reviewedTerms: { ...reviewed },
            slippageBps,
            expiresAt: new Date(Date.now() + 5 * 60_000),
          })
          .returning({
            id: mcpTradeIntents.id,
            expiresAt: mcpTradeIntents.expiresAt,
          });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                intentId: intent.id,
                side,
                ticker: quote.ticker,
                stockMint: quote.variant.mint,
                amountUsd,
                amountShares:
                  normalizedShares === null
                    ? undefined
                    : Number(normalizedShares),
                minOutRaw: minOut.toString(),
                referenceValueUsd,
                quotedProceedsUsd,
                maxInRaw: maxIn,
                slippageBps,
                expiresAt: intent.expiresAt.toISOString(),
                ...(quote.marketSession
                  ? { marketSession: quote.marketSession }
                  : {}),
                mode: delegated ? 'delegated' : 'browser',
                signingGrant: decision.signingGrant,
                ...(delegated
                  ? {}
                  : {
                      browserReason: decision.browserReason,
                      message: decision.message,
                      ...(decision.browserReason === 'delegation_expired'
                        ? {
                            signingGrantExpiresAt:
                              delegation.expiresAt?.toISOString(),
                          }
                        : {}),
                      ...(decision.browserReason === 'delegation_expired' ||
                      decision.browserReason === 'delegation_policy_changed' ||
                      decision.browserReason === 'execute_consent_outdated'
                        ? {
                            signingSettingsUrl: `${deps.oauth.appOrigin}/settings/mcp#chat-trading`,
                          }
                        : {}),
                      approvalUrl: `${deps.oauth.appOrigin}/app/trades/review/${intent.id}`,
                    }),
              }),
            },
          ],
        };
      },
    );
    if (!connection.tokenScopes.has('oren.trade.execute'))
      server.registerTool(
        'prepare_buy',
        {
          title: 'Prepare buy request',
          description:
            'Save a USDC stock buy request for browser review. This does not sign or submit a trade.',
          inputSchema: z.object({
            assetId: z.string().trim().min(1).max(80),
            amountUsd: z.number().finite().min(0.01).max(MAX_MCP_TRADE_USD),
            slippageBps: z.number().int().min(1).max(50).default(50),
          }),
        },
        async ({ assetId, amountUsd, slippageBps }) => {
          const stock = await deps.market.getStock(assetId);
          if (!stock.variants.some((variant) => variant.tradable))
            return {
              content: [
                {
                  type: 'text',
                  text: 'No tradable stock variant is available.',
                },
              ],
              isError: true,
            };
          const [intent] = await deps.db
            .insert(mcpTradeIntents)
            .values({
              grantId: connection.grantId,
              clientId: connection.clientId,
              userId: connection.userId,
              wallet: connection.wallet,
              assetId: stock.id,
              ticker: stock.ticker,
              amountUsd: amountUsd.toFixed(6),
              slippageBps,
              expiresAt: new Date(Date.now() + 10 * 60_000),
            })
            .returning({
              id: mcpTradeIntents.id,
              expiresAt: mcpTradeIntents.expiresAt,
            });
          const result = {
            intentId: intent.id,
            ticker: stock.ticker,
            amountUsd,
            slippageBps,
            expiresAt: intent.expiresAt.toISOString(),
          };
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        },
      );
    const openTradeReview = async ({ intentId }: { intentId: string }) => {
      const unavailable = {
        content: [
          { type: 'text' as const, text: 'Intent expired or unavailable.' },
        ],
        isError: true,
      };
      const [intent] = await deps.db
        .select({ id: mcpTradeIntents.id, mode: mcpTradeIntents.mode })
        .from(mcpTradeIntents)
        .where(
          and(
            eq(mcpTradeIntents.id, intentId),
            eq(mcpTradeIntents.grantId, connection.grantId),
            eq(mcpTradeIntents.clientId, connection.clientId),
            eq(mcpTradeIntents.userId, connection.userId),
            eq(mcpTradeIntents.wallet, connection.wallet),
            gt(mcpTradeIntents.expiresAt, new Date()),
            eq(mcpTradeIntents.status, 'prepared'),
          ),
        )
        .limit(1);
      if (!intent) return unavailable;
      if (intent.mode === 'delegated') {
        // Some clients (Claude.ai) will not execute trades. Hand a still-prepared
        // delegated intent to browser review, as the gate-rejection path does;
        // once converted the delegated path can no longer execute it.
        const [converted] = await deps.db
          .update(mcpTradeIntents)
          .set({ mode: 'browser', delegationId: null })
          .where(
            and(
              eq(mcpTradeIntents.id, intentId),
              eq(mcpTradeIntents.status, 'prepared'),
              eq(mcpTradeIntents.mode, 'delegated'),
              gt(mcpTradeIntents.expiresAt, new Date()),
            ),
          )
          .returning({ id: mcpTradeIntents.id });
        if (!converted) return unavailable;
      } else if (intent.mode !== 'browser') return unavailable;
      const result = {
        intentId,
        status: 'browser_approval_required',
        approvalUrl: `${deps.oauth.appOrigin}/app/trades/review/${intentId}`,
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    };
    server.registerTool(
      'review_trade',
      {
        title: 'Open trade review',
        description:
          'Get the Oren browser review link for a prepared buy or sell intent. The user signs there. Works for delegated intents too: the intent moves to browser review and can no longer be executed by execute_trade.',
        inputSchema: z.object({ intentId: z.uuid() }),
      },
      openTradeReview,
    );
    if (!connection.tokenScopes.has('oren.trade.execute'))
      server.registerTool(
        'execute_buy',
        {
          title: 'Open trade review',
          description:
            'Get the Oren browser review link for a prepared buy or sell intent. The user signs there.',
          inputSchema: z.object({ intentId: z.uuid() }),
        },
        openTradeReview,
      );
    if (deps.gate && connection.tokenScopes.has('oren.trade.execute'))
      server.registerTool(
        'execute_trade',
        {
          title: 'Execute a prepared stock trade',
          description:
            'Execute an intent returned in delegated mode by prepare_trade under the active signing grant. slippage_exceeded means the price moved past the original slippage after one automatic re-quote; the grant is still active. Say that and do not send a browser review link. inactive_delegation is the only result that means signing permission is missing.',
          inputSchema: z.object({
            intentId: z.uuid(),
            idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
          }),
          annotations: { destructiveHint: true },
        },
        async ({ intentId, idempotencyKey }) => {
          const [intent] = await deps.db
            .select()
            .from(mcpTradeIntents)
            .where(
              and(
                eq(mcpTradeIntents.id, intentId),
                eq(mcpTradeIntents.grantId, connection.grantId),
                eq(mcpTradeIntents.clientId, connection.clientId),
                eq(mcpTradeIntents.userId, connection.userId),
                eq(mcpTradeIntents.wallet, connection.wallet),
              ),
            )
            .limit(1);
          if (!intent)
            return {
              content: [{ type: 'text' as const, text: 'Intent unavailable.' }],
              isError: true,
            };
          const browser = () => ({
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  intentId,
                  status: 'browser_approval_required',
                  approvalUrl: `${deps.oauth.appOrigin}/app/trades/review/${intentId}`,
                }),
              },
            ],
          });
          if (
            intent.mode === 'browser' &&
            intent.status === 'prepared' &&
            intent.expiresAt > new Date()
          )
            return browser();
          if (intent.mode !== 'delegated')
            return {
              content: [{ type: 'text' as const, text: 'Intent unavailable.' }],
              isError: true,
            };
          try {
            const result = await deps.gate!.execute(
              intentId,
              idempotencyKey,
              connection,
            );
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    intentId,
                    status: result.state,
                    signature: result.chainSignature,
                    ...signingOutcome(result.reason, result.chainSignature),
                    ...delegatedConfirmationMessage(
                      result.state,
                      result.chainSignature,
                    ),
                  }),
                },
              ],
            };
          } catch (error) {
            if (
              error instanceof SignerGateRejection &&
              [
                'insufficient_sol_for_rent',
                'insufficient_sol_for_fees',
              ].includes(error.code)
            ) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      intentId,
                      status: 'funding_required',
                      reason: error.code,
                      message:
                        error.code === 'insufficient_sol_for_rent'
                          ? SOL_RENT_MESSAGE
                          : SOL_FEE_MESSAGE,
                      fundingAsset: 'SOL',
                      broadcast: false,
                    }),
                  },
                ],
                isError: true,
              };
            }
            if (
              error instanceof SignerGateRejection &&
              error.code === 'reviewed_terms_changed'
            ) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({
                      intentId,
                      status: 'quote_changed',
                      reason: 'reviewed_terms_changed',
                      signingGrant: 'active',
                      message:
                        'The fresh quote no longer meets the price that was approved. The signing grant is still active. Prepare a new quote to continue. No transaction was broadcast.',
                    }),
                  },
                ],
                isError: true,
              };
            }
            if (error instanceof SignerGateRejection) {
              const failure = delegatedFailureBody(
                intentId,
                error.code,
                intent.slippageBps,
              );
              if (failure)
                return {
                  content: [
                    {
                      type: 'text' as const,
                      text: JSON.stringify(failure),
                    },
                  ],
                  isError: true,
                };
            }
            if (
              error instanceof SignerGateRejection &&
              [
                'over_budget',
                'inactive_delegation',
                'unsupported_route',
              ].includes(error.code) &&
              intent.status === 'prepared' &&
              intent.expiresAt > new Date()
            ) {
              const [converted] = await deps.db
                .update(mcpTradeIntents)
                .set({ mode: 'browser', delegationId: null })
                .where(
                  and(
                    eq(mcpTradeIntents.id, intentId),
                    eq(mcpTradeIntents.status, 'prepared'),
                    eq(mcpTradeIntents.mode, 'delegated'),
                  ),
                )
                .returning({ id: mcpTradeIntents.id });
              if (converted) return browser();
            }
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    intentId,
                    status: 'pending_or_unavailable',
                    reason: publicGateFailureCode(error),
                  }),
                },
              ],
              isError: true,
            };
          }
        },
      );
    server.registerTool(
      'trade_status',
      {
        title: 'Get trade request status',
        description:
          'Check an Oren trade by intent ID. Use this tool to verify whether a delegated trade settled on Solana. A broadcast or pending response is not a fill.',
        inputSchema: z.object({ intentId: z.uuid() }),
        annotations: { readOnlyHint: true },
      },
      async ({ intentId }) => {
        const [intent] = await deps.db
          .select({
            id: mcpTradeIntents.id,
            approvalId: mcpTradeIntents.approvalId,
            mode: mcpTradeIntents.mode,
            status: mcpTradeIntents.status,
            slippageBps: mcpTradeIntents.slippageBps,
            expiresAt: mcpTradeIntents.expiresAt,
          })
          .from(mcpTradeIntents)
          .where(
            and(
              eq(mcpTradeIntents.id, intentId),
              eq(mcpTradeIntents.grantId, connection.grantId),
              eq(mcpTradeIntents.clientId, connection.clientId),
              eq(mcpTradeIntents.userId, connection.userId),
              eq(mcpTradeIntents.wallet, connection.wallet),
            ),
          )
          .limit(1);
        if (!intent)
          return {
            content: [{ type: 'text', text: 'Intent unavailable.' }],
            isError: true,
          };
        let status =
          intent.status === 'prepared' && intent.expiresAt <= new Date()
            ? 'expired'
            : intent.mode === 'delegated' || intent.status !== 'prepared'
              ? intent.status
              : 'browser_approval_required';
        let signature: string | undefined;
        let signingDetails = {};
        if (intent.mode === 'delegated') {
          const [execution] = await deps.db
            .select({
              state: mcpDelegatedExecutions.state,
              chainSignature: mcpDelegatedExecutions.chainSignature,
              errorCode: mcpDelegatedExecutions.errorCode,
            })
            .from(mcpDelegatedExecutions)
            .where(eq(mcpDelegatedExecutions.intentId, intentId))
            .limit(1);
          if (execution) {
            signature = execution.chainSignature ?? undefined;
            const chain =
              signature &&
              ['signed', 'pending', 'broadcast'].includes(execution.state)
                ? await deps.tradeRpc
                    .status(signature, AbortSignal.timeout(4_000))
                    .catch(() => undefined)
                : undefined;
            const confirmation = chain?.confirmationStatus;
            const settled =
              chain?.err !== undefined &&
              (confirmation === 'confirmed' || confirmation === 'finalized');
            status = settled
              ? chain?.err
                ? 'failed'
                : 'confirmed'
              : execution.state;
            signingDetails = {
              ...signingOutcome(execution.errorCode, signature),
              ...statusFailure(execution.errorCode, intent.slippageBps),
              ...delegatedConfirmationMessage(status, signature),
              ...(settled ? { confirmationStatus: confirmation } : {}),
              ...(signature && status === 'broadcast' && chain === undefined
                ? {
                    message:
                      'The transaction was submitted, but Solana confirmation could not be checked. Try trade_status again before reporting a fill.',
                  }
                : {}),
              ...(settled && chain?.err
                ? {
                    reason: 'chain_failure',
                    message:
                      'Solana recorded a failed transaction. The trade did not fill. A network fee may have been charged.',
                  }
                : {}),
            };
          }
        }
        if (intent.approvalId) {
          const [approval] = await deps.db
            .select({
              status: tradeApprovals.status,
              signature: tradeApprovals.signature,
              expiresAt: tradeApprovals.expiresAt,
            })
            .from(tradeApprovals)
            .where(
              and(
                eq(tradeApprovals.id, intent.approvalId),
                eq(tradeApprovals.userId, connection.userId),
                eq(tradeApprovals.wallet, connection.wallet),
              ),
            )
            .limit(1);
          if (approval) {
            status =
              approval.status === 'prepared' && approval.expiresAt <= new Date()
                ? 'expired'
                : approval.status;
            signature = approval.signature ?? undefined;
          }
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                intentId,
                status,
                signature,
                ...signingDetails,
                observedAt: new Date().toISOString(),
              }),
            },
          ],
        };
      },
    );
  }
  const transport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await server.close();
  }
}

function delegatedConfirmationMessage(status: string, signature?: string) {
  if (!signature) return {};
  if (status === 'confirmed')
    return {
      confirmationStatus: 'confirmed',
      message: 'Solana confirmed the trade. Quoted amounts are estimates.',
    };
  if (status === 'broadcast' || status === 'pending' || status === 'signed')
    return {
      message:
        status === 'broadcast'
          ? 'The transaction was submitted to Solana. Use trade_status to check confirmation before reporting a fill.'
          : 'The transaction has a signature, but submission or confirmation is pending. Use trade_status before retrying or reporting a fill.',
    };
  return {};
}

function statusFailure(code: string | null, slippageBps: number) {
  if (!code) return {};
  const body = delegatedFailureBody('status', code, slippageBps);
  if (!body) return {};
  return {
    reason: body.reason,
    message: body.message,
    signingGrant: body.signingGrant,
    broadcast: body.broadcast,
  };
}
