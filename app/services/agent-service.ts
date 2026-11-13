import { apiRequest, ApiError, buildApiUrl } from './api-client';
import { mapStockDetail, mapStockSummary } from './market-service';
import { mapPortfolio } from './portfolio-service';
import { parseAgentSseChunk } from './agent-sse';
import {
  SESSION_PROVIDER_WAIT_MS,
  sessionAuthorization,
  setSessionTokenProvider,
} from './session-token';
import type {
  AgentArtifact,
  AgentDisplayMessage,
  AgentRequest,
  AgentResponse,
  AgentStreamEvent,
  AgentThreadMessagesResponse,
  VaultPosition,
} from '@/types';

type UnknownRecord = Record<string, unknown>;

/** Kept for existing callers; the provider is shared with other owner-only routes. */
export const setAgentTokenProvider = setSessionTokenProvider;

function agentAuthorization(): Promise<Record<string, string>> {
  return sessionAuthorization(SESSION_PROVIDER_WAIT_MS);
}

export async function sendAgentMessage(request: AgentRequest) {
  const authorization = await agentAuthorization();
  return apiRequest<AgentResponse>('/agent/message', {
    method: 'POST',
    body: request,
    headers: authorization,
  }).then((response) => ({
    ...response,
    message: normalizeMessage(response.message),
    artifacts: response.artifacts?.map(normalizeArtifact),
  }));
}

export async function streamAgentMessage(
  request: AgentRequest,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const authorization = await agentAuthorization();
  const response = await fetch(buildApiUrl('/agent/message/stream'), {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', ...authorization },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => undefined);
    const message =
      isRecord(payload) && 'message' in payload
        ? String(payload.message)
        : `Request failed with status ${response.status}`;
    throw new ApiError(message, response.status, payload);
  }
  if (!response.body) throw new Error('Streaming is unavailable in this browser');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    const parsed = parseAgentSseChunk(
      buffer,
      decoder.decode(value, { stream: !done }),
      done,
    );
    buffer = parsed.buffer;
    for (const event of parsed.events) onEvent(normalizeEvent(event));
    if (done) break;
  }
}

export async function getAgentThreadMessages(
  threadId: string,
  walletAddress: string,
) {
  const authorization = await agentAuthorization();
  return apiRequest<AgentThreadMessagesResponse>(
    `/agent/threads/${threadId}/messages`,
    { query: { walletAddress }, headers: authorization },
  ).then((response) => ({
    ...response,
    messages: response.messages.map(normalizeMessage),
  }));
}

function normalizeEvent(event: AgentStreamEvent): AgentStreamEvent {
  if (event.type === 'tool_completed' && event.artifact) {
    return { ...event, artifact: normalizeArtifact(event.artifact) };
  }
  if (event.type === 'turn_started') {
    return { ...event, message: normalizeMessage(event.message) };
  }
  if (event.type === 'turn_completed') {
    return {
      ...event,
      message: normalizeMessage(event.message),
      artifacts: event.artifacts?.map(normalizeArtifact),
    };
  }
  return event;
}

function normalizeMessage(message: AgentDisplayMessage): AgentDisplayMessage {
  return {
    ...message,
    createdAt: String(message.createdAt),
    artifacts: message.artifacts?.map(normalizeArtifact),
  };
}

function normalizeArtifact(artifact: AgentArtifact): AgentArtifact {
  const raw = artifact as unknown as { type: AgentArtifact['type']; data: UnknownRecord };
  switch (raw.type) {
    case 'portfolio':
      return { type: 'portfolio', data: mapPortfolio(raw.data as never) };
    case 'stock':
      return { type: 'stock', data: mapStockDetail(raw.data as never) };
    case 'opportunities':
      return {
        type: 'opportunities',
        data: Array.isArray(raw.data)
          ? raw.data.map((item) => mapStockSummary(item as never))
          : [],
      };
    case 'vaults':
      return {
        type: 'vaults',
        data: {
          walletAddress: String(raw.data.walletAddress ?? ''),
          totalLockedValueUsd: Number(raw.data.totalLockedValueUsd ?? 0),
          positions: Array.isArray(raw.data.positions)
            ? raw.data.positions.map(normalizeVaultPosition)
            : [],
        },
      };
    default:
      return artifact;
  }
}

function normalizeVaultPosition(value: unknown): VaultPosition {
  const position = isRecord(value) ? value : {};
  return {
    lockAddress: String(position.lockAddress ?? ''),
    owner: String(position.owner ?? ''),
    assetId: String(position.assetId ?? ''),
    ticker: String(position.ticker ?? 'Stock'),
    name: typeof position.name === 'string' ? position.name : undefined,
    mint: String(position.mint ?? ''),
    quantity: Number(position.quantity ?? position.amount ?? 0),
    valueUsd:
      typeof position.valueUsd === 'number' ? position.valueUsd : undefined,
    createdAt: String(position.createdAt ?? ''),
    unlockAt: String(position.unlockAt ?? ''),
    transactionSignature:
      typeof position.transactionSignature === 'string'
        ? position.transactionSignature
        : undefined,
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object';
}
