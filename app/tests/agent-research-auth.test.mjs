import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function load(calls) {
  const exports = {};
  const sessionToken = {};
  vm.runInNewContext(transpile('../services/session-token.ts'), {
    exports: sessionToken,
    setTimeout,
    clearTimeout,
  });
  const code = transpile('../services/agent-service.ts');
  vm.runInNewContext(code, {
    exports,
    fetch: async (_url, options) => {
      calls.push(options);
      return { ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) } };
    },
    TextDecoder,
    URL,
    require(id) {
      if (id === './api-client') return { apiRequest: async (_path, options) => { calls.push(options); return { messages: [] }; }, buildApiUrl: (path) => new URL(path, 'https://api.example.test'), ApiError: Error };
      if (id === './session-token') return sessionToken;
      if (id === './agent-sse') return { parseAgentSseChunk: () => ({ buffer: '', events: [] }) };
      if (id === './market-service') return { mapStockDetail: (x) => x, mapStockSummary: (x) => x };
      if (id === './portfolio-service') return { mapPortfolio: (x) => x };
      throw new Error(`unexpected import ${id}`);
    },
  });
  return exports;
}

test('agent streaming and history carry the verified bearer token', async () => {
  const calls = [];
  const agent = load(calls);
  agent.setAgentTokenProvider(async () => 'privy-token');
  await agent.streamAgentMessage({ walletAddress: 'owned', message: 'Research NVDA' }, () => {});
  await agent.getAgentThreadMessages('thread-id', 'owned');
  assert.equal(calls.length, 2);
  for (const call of calls) assert.equal(call.headers.Authorization, 'Bearer privy-token');
});

test('history waits when the session provider is registered after the call starts', async () => {
  const calls = [];
  const agent = load(calls);
  const pending = agent.getAgentThreadMessages('thread-id', 'owned');
  setTimeout(() => agent.setAgentTokenProvider(async () => 'late-token'), 0);
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, 'Bearer late-token');
});
