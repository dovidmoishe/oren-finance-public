import { buildApiUrl } from './api-client';

export interface FundingSnapshot {
  wallet: string;
  network: 'mainnet';
  commitment: 'confirmed';
  usdcMint: string;
  solLamports: string;
  usdcAtomic: string;
  sol: string;
  usdc: string;
  slot: number;
  updatedAt: string;
}
export type FundingEvent =
  | { type: 'snapshot'; data: FundingSnapshot }
  | { type: 'status'; status: 'connecting' | 'live' | 'reconnecting'; message?: string }
  | { type: 'error'; message: string };

export class FundingStreamError extends Error {
  constructor(message: string, public readonly retryable: boolean) { super(message); }
}

export function parseFundingChunk(previous: string, chunk: string, final = false) {
  let buffer = `${previous}${chunk}`.replaceAll('\r\n', '\n').replace(/\r(?!$)/g, '\n');
  if (buffer.length > 262_144) throw new Error('Funding response is too large');
  if (final) buffer = buffer.replaceAll('\r', '\n');
  const frames: string[] = [];
  let boundary: number;
  while ((boundary = buffer.indexOf('\n\n')) >= 0) {
    frames.push(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2);
  }
  if (final && buffer.trim()) { frames.push(buffer); buffer = ''; }
  const events = frames.flatMap((frame) => {
    const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data) return [];
    const event: unknown = JSON.parse(data);
    if (!isFundingEvent(event)) throw new Error('Invalid funding update');
    return [event];
  });
  return { buffer, events };
}

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function isFundingEvent(event: unknown): event is FundingEvent {
  if (!record(event)) return false;
  if (event.type === 'error') return typeof event.message === 'string';
  if (event.type === 'status') return ['connecting', 'live', 'reconnecting'].includes(String(event.status));
  const data = event.data;
  return event.type === 'snapshot' && record(data) && data.network === 'mainnet' && data.commitment === 'confirmed' &&
    typeof data.wallet === 'string' && data.usdcMint === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' &&
    typeof data.solLamports === 'string' && /^\d{1,30}$/.test(data.solLamports) &&
    typeof data.usdcAtomic === 'string' && /^\d{1,30}$/.test(data.usdcAtomic) &&
    typeof data.sol === 'string' && /^\d+(\.\d{1,9})?$/.test(data.sol) &&
    typeof data.usdc === 'string' && /^\d+(\.\d{1,6})?$/.test(data.usdc) &&
    Number.isSafeInteger(data.slot) && Number(data.slot) >= 0 && typeof data.updatedAt === 'string' && Number.isFinite(Date.parse(data.updatedAt));
}

export async function streamFunding(
  wallet: string, getAccessToken: () => Promise<string | null>, onEvent: (event: FundingEvent) => void, signal: AbortSignal,
) {
  const token = await getAccessToken();
  signal.throwIfAborted();
  if (!token) throw new FundingStreamError('Sign in again to view live balances.', false);
  const connection = new AbortController();
  const stop = () => connection.abort();
  signal.addEventListener('abort', stop, { once: true });
  let idle: ReturnType<typeof setTimeout> | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const armDeadline = () => { clearTimeout(idle); idle = setTimeout(stop, 45_000); };
  try {
    armDeadline();
    const response = await fetch(buildApiUrl(`/portfolio/${wallet}/funding/stream`), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: connection.signal, cache: 'no-store',
    });
    if (!response.ok) {
      const message = response.status === 401 ? 'Your session expired. Sign in again.'
        : response.status === 403 ? 'This wallet is not linked to your account.'
        : 'Live funding updates are unavailable. Please try again later.';
      throw new FundingStreamError(message, ![401, 403, 404, 503].includes(response.status));
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Funding stream unavailable');
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      armDeadline();
      const result = parseFundingChunk(buffer, decoder.decode(value, { stream: !done }), done);
      buffer = result.buffer;
      for (const event of result.events) {
        if (event.type === 'snapshot' && event.data.wallet !== wallet) throw new FundingStreamError('Received balances for a different wallet.', false);
        onEvent(event);
        if (event.type === 'error') throw new FundingStreamError(event.message, true);
      }
      if (done) break;
    }
  } finally {
    clearTimeout(idle);
    signal.removeEventListener('abort', stop);
    connection.abort();
    await reader?.cancel().catch(() => undefined);
  }
}
