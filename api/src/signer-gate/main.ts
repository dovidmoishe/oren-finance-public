import 'reflect-metadata';
import { gateFailureCode } from './failure-code';
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { Connection } from '@solana/web3.js';
import { PrivyClient } from '@privy-io/node';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { ownerProofSchema } from '../mcp-auth/grant-owner-proof';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { PrivyWalletAuth } from '../auth/privy-wallet-auth';
import { ApprovalRpc } from '../execution/approval-rpc.service';
import { JupiterGateway } from '../execution/jupiter/jupiter-gateway';
import { JupiterClient } from '../execution/jupiter/jupiter.client';
import { TokensClient } from '../tokens/tokens.client';
import { TokensService } from '../tokens/tokens.service';
import type { AppEnv } from '../config/env.schema';
import * as schema from '../database/schema';
import {
  SignerGateService,
  type SignerGateConfig,
} from './signer-gate.service';

function required(key: string) {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`Signer gate requires ${key}`);
  return value;
}

function enabled(key: string) {
  return process.env[key] === 'true';
}

async function readBody(request: AsyncIterable<Buffer | string>) {
  let text = '';
  for await (const chunk of request) {
    text += chunk.toString();
    if (text.length > 4096) throw new Error('Request too large');
  }
  return JSON.parse(text) as Record<string, unknown>;
}

function authorized(value: string | undefined, token: string) {
  const actual = value?.replace(/^Bearer\s+/i, '') ?? '';
  const left = Buffer.from(actual);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

function main() {
  if (process.env.DEPLOYMENT_ENV !== 'production')
    throw new Error('The signer gate runs only in production');
  const active = enabled('SIGNER_GATE_ENABLED');
  const port = Number(process.env.SIGNER_GATE_PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid signer gate port');
  let gate: SignerGateService | undefined;
  let token: string | undefined;
  {
    token = required('SIGNER_GATE_API_TOKEN');
    if (token.length < 32)
      throw new Error('Signer gate API token is too short');
    const publicAccess = enabled('SIGNER_GATE_PUBLIC');
    const allowedUsers = new Set(
      (process.env.SIGNER_GATE_ALLOWED_USERS ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    );
    if (allowedUsers.has('*'))
      throw new Error(
        'Use SIGNER_GATE_PUBLIC=true instead of a wildcard allowlist',
      );
    if (!publicAccess && allowedUsers.size === 0)
      throw new Error(
        'Signer gate requires SIGNER_GATE_ALLOWED_USERS or SIGNER_GATE_PUBLIC=true',
      );
    const config: SignerGateConfig = {
      enabled: active,
      appId: required('PRIVY_APP_ID'),
      appSecret: required('PRIVY_APP_SECRET'),
      apiPublicKeyDerBase64: required('SIGNER_GATE_API_PUBLIC_KEY'),
      gatePrivateKeyDerBase64: required('SIGNER_GATE_PRIVATE_KEY'),
      signerQuorumId: required('SIGNER_GATE_QUORUM_ID'),
      policyId: required('SIGNER_GATE_POLICY_ID'),
      policyOwnerId: required('SIGNER_GATE_POLICY_OWNER_ID'),
      policyHash: required('SIGNER_GATE_POLICY_HASH'),
      allowedUsers,
      publicAccess,
      buysEnabled: enabled('SIGNER_GATE_BUYS_ENABLED'),
      sellsEnabled: enabled('SIGNER_GATE_SELLS_ENABLED'),
    };
    const env = {
      ALCHEMY_API_KEY: required('ALCHEMY_API_KEY'),
      SOLANA_NETWORK: 'mainnet',
      JUPITER_API_KEY: process.env.JUPITER_API_KEY,
      JUPITER_MAX_RPS: 1,
      TOKENS_API_BASE_URL:
        process.env.TOKENS_API_BASE_URL ?? 'https://api.tokens.xyz',
      TOKENS_API_KEY: required('TOKENS_API_KEY'),
    } as AppEnv;
    const databaseUrl = required('POSTGRES_URL');
    if (new URL(databaseUrl).username !== 'oren_signer_gate')
      throw new Error('Signer gate requires its restricted database role');
    const client = postgres(databaseUrl, { max: 5 });
    const db = drizzle(client, { schema });
    const privy = new PrivyClient({
      appId: config.appId,
      appSecret: config.appSecret,
    });
    const alchemy = new AlchemyClient(env);
    const jupiter = new JupiterClient(env, new JupiterGateway(env));
    gate = new SignerGateService(config, {
      db,
      jupiter,
      tokens: new TokensService(new TokensClient(env)),
      rpc: new ApprovalRpc(alchemy),
      connection: new Connection(
        `https://solana-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`,
        'confirmed',
      ),
      privy,
      auth: new PrivyWalletAuth(config.appId, config.appSecret),
    });
    process.on('SIGTERM', () => void client.end({ timeout: 5 }));
  }
  createServer((request, response) => {
    void (async () => {
      response.setHeader('Content-Type', 'application/json');
      response.setHeader('Cache-Control', 'no-store');
      if (request.url === '/health' && request.method === 'GET') {
        response.end(JSON.stringify({ ok: true, signingEnabled: active }));
        return;
      }
      if (!gate || !token) {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: 'disabled' }));
        return;
      }
      if (!authorized(request.headers.authorization, token)) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      try {
        if (request.method !== 'POST') throw new Error('Unsupported method');
        const body = await readBody(request);
        const ownerProof = ownerProofSchema.safeParse(body.authorization);
        let result: unknown;
        if (
          request.url === '/challenge' &&
          typeof body.intentId === 'string' &&
          typeof body.idempotencyKey === 'string'
        )
          result = await gate.challenge(body.intentId, body.idempotencyKey);
        else if (
          request.url === '/slippage-retry' &&
          typeof body.executionId === 'string'
        )
          result = await gate.slippageRetry(body.executionId);
        else if (
          request.url === '/abort-unsigned' &&
          typeof body.executionId === 'string'
        )
          result = await gate.abortUnsigned(body.executionId);
        else if (
          request.url === '/complete' &&
          typeof body.executionId === 'string' &&
          typeof body.apiSignatureBase64 === 'string'
        )
          result = await gate.complete(
            body.executionId,
            body.apiSignatureBase64,
          );
        else if (
          request.url === '/reconcile' &&
          typeof body.executionId === 'string'
        )
          result = await gate.reconcile(body.executionId);
        else if (request.url === '/grant/limits')
          result = await gate.grantLimits();
        else if (
          request.url === '/grant/prepare' &&
          ownerProof.success &&
          typeof body.allowSell === 'boolean' &&
          typeof body.perTradeUsd === 'number' &&
          typeof body.dailyUsd === 'number' &&
          typeof body.maxSlippageBps === 'number' &&
          (typeof body.durationHours === 'number' ||
            body.durationHours === null)
        )
          result = await gate.prepareGrant(ownerProof.data, {
            allowSell: body.allowSell,
            perTradeUsd: body.perTradeUsd,
            dailyUsd: body.dailyUsd,
            maxSlippageBps: body.maxSlippageBps,
            durationHours: body.durationHours,
          });
        else if (
          request.url === '/grant/activate' &&
          ownerProof.success &&
          typeof body.delegationId === 'string'
        )
          result = await gate.activateGrant(ownerProof.data, body.delegationId);
        else if (
          request.url === '/grant/revoke' &&
          ownerProof.success &&
          typeof body.delegationId === 'string'
        )
          result = await gate.revokeGrant(ownerProof.data, body.delegationId);
        else throw new Error('Invalid gate request');
        response.end(JSON.stringify(result));
      } catch (error) {
        // Privy and RPC failures can contain payloads; return only a fixed code.
        response.statusCode = 409;
        const code = gateFailureCode(error);
        response.end(JSON.stringify({ error: code }));
        console.error('Signer gate request rejected', code);
      }
    })();
  }).listen(port, '0.0.0.0');
}

main();
