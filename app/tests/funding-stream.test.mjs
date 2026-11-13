import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const snapshot = { wallet: 'wallet', network: 'mainnet', commitment: 'confirmed', usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', solLamports: '100', usdcAtomic: '1234567', sol: '0.0000001', usdc: '1.234567', slot: 100, updatedAt: '2026-10-27T12:00:00.000Z' };
function loadStream(fetch) {
  const exports = {};
  const source = readFileSync(new URL('../services/funding-stream.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, fetch, AbortController, TextDecoder, setTimeout, clearTimeout,
    require: () => ({ buildApiUrl: (path) => new URL(path, 'https://oren.test') }),
  });
  return exports;
}
const { parseFundingChunk } = loadStream();

test('funding frames survive every chunk boundary, ignore heartbeats and flush EOF', () => {
  const event = { type: 'snapshot', data: snapshot };
  const frame = `: heartbeat\r\n\r\ndata: ${JSON.stringify(event)}\r\n\r\n`;
  for (let split = 0; split <= frame.length; split++) {
    const first = parseFundingChunk('', frame.slice(0, split));
    const second = parseFundingChunk(first.buffer, frame.slice(split), true);
    assert.equal(JSON.stringify([...first.events, ...second.events]), JSON.stringify([event]));
    assert.equal(second.buffer, '');
  }
});

test('invalid network, unconfirmed balances and malformed atomic amounts are rejected', () => {
  for (const change of [{ network: 'devnet' }, { commitment: 'processed' }, { usdcAtomic: '1.25' }, { solLamports: '-1' }, { slot: NaN }]) {
    assert.throws(() => parseFundingChunk('', `data: ${JSON.stringify({ type: 'snapshot', data: { ...snapshot, ...change } })}\n\n`));
  }
});

test('stream authorization stays in headers and never enters the URL', async () => {
  let requested;
  const events = [];
  const { streamFunding } = loadStream(async (url, options) => {
    requested = { url: String(url), options };
    return new Response(`data: ${JSON.stringify({ type: 'snapshot', data: snapshot })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await streamFunding('wallet', async () => 'private-token', (event) => events.push(event), new AbortController().signal);
  assert.equal(requested.url, 'https://oren.test/portfolio/wallet/funding/stream');
  assert.equal(requested.options.headers.Authorization, 'Bearer private-token');
  assert.equal(events.length, 1);
});

test('missing login and wrong-wallet responses fail closed', async () => {
  let calls = 0;
  const { streamFunding } = loadStream(async () => {
    calls++;
    return new Response(`data: ${JSON.stringify({ type: 'snapshot', data: { ...snapshot, wallet: 'other' } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await assert.rejects(streamFunding('wallet', async () => null, () => {}, new AbortController().signal), (error) => error.retryable === false);
  assert.equal(calls, 0);
  await assert.rejects(streamFunding('wallet', async () => 'token', () => assert.fail('wrong wallet rendered'), new AbortController().signal), (error) => error.retryable === false);
});

test('expired or unlinked sessions stop automatic retries', async () => {
  for (const status of [401, 403, 503]) {
    const { streamFunding } = loadStream(async () => new Response('', { status }));
    await assert.rejects(streamFunding('wallet', async () => 'token', () => {}, new AbortController().signal), (error) => error.retryable === false);
  }
});

test('signing out while a token refresh is pending cannot open a stream', async () => {
  let finish;
  const token = new Promise((resolve) => { finish = resolve; });
  const controller = new AbortController();
  const { streamFunding } = loadStream(async () => assert.fail('old stream opened'));
  const pending = streamFunding('wallet', () => token, () => {}, controller.signal);
  controller.abort(); finish('token');
  await assert.rejects(pending, (error) => error.name === 'AbortError');
});

function loadHook() {
  const document = { hidden: false, handlers: new Map(), addEventListener(event, callback) { this.handlers.set(event, callback); }, removeEventListener(event) { this.handlers.delete(event); } };
  const streams = [], timers = new Map(), states = [];
  let cleanup;
  const exports = {};
  const source = readFileSync(new URL('../hooks/use-funding.ts', import.meta.url), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, document, AbortController,
    setTimeout(callback) { const id = Symbol(); timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    require(id) {
      if (id === 'react') return {
        useEffect(callback) { cleanup = callback(); },
        useState(initial) { const index = states.length; states.push(initial); return [initial, (value) => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
      };
      if (id === '@/store') return { useWalletStore: { getState: () => ({ address: 'wallet' }) }, usePortfolioStore: { getState: () => ({ loadPortfolio: async () => {} }) } };
      if (id === '@/services/funding-stream') return { FundingStreamError: class extends Error {}, streamFunding: (...args) => new Promise((resolve) => streams.push({ args, resolve })) };
      throw new Error(id);
    },
  });
  exports.useFunding('wallet', async () => 'token');
  return { document, streams, timers, states, cleanup: () => cleanup() };
}

test('hiding the screen aborts its connection; returning reconnects without a polling timer', () => {
  const hook = loadHook();
  assert.equal(hook.streams.length, 1);
  assert.equal(hook.timers.size, 0);
  hook.document.hidden = true; hook.document.handlers.get('visibilitychange')();
  assert.equal(hook.streams[0].args[3].aborted, true);
  hook.document.hidden = false; hook.document.handlers.get('visibilitychange')();
  assert.equal(hook.streams.length, 2);
  hook.cleanup();
  assert.equal(hook.streams[1].args[3].aborted, true);
  assert.equal(hook.document.handlers.size, 0);
});

test('lost streams reconnect; old callbacks cannot overwrite balances after cleanup', async () => {
  const hook = loadHook();
  const callback = hook.streams[0].args[2];
  callback({ type: 'snapshot', data: snapshot });
  callback({ type: 'snapshot', data: { ...snapshot, slot: 99, usdc: '999' } });
  assert.equal(hook.states[0].usdc, snapshot.usdc);
  hook.streams[0].resolve(); await new Promise(setImmediate);
  assert.equal(hook.timers.size, 1);
  const reconnect = hook.timers.values().next().value; hook.timers.clear(); reconnect();
  assert.equal(hook.streams.length, 2);
  hook.cleanup(); callback({ type: 'snapshot', data: { ...snapshot, slot: 200, usdc: '999' } });
  assert.equal(hook.states[0].usdc, snapshot.usdc);
});
