import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgentSseChunk } from '../services/agent-sse.ts';

const event = {
  type: 'assistant_delta',
  turnId: 'turn-1',
  sequence: 4,
  timestamp: '2026-09-14T12:00:00.000Z',
  delta: 'MU looks constructive.',
};

test('parses an event split at every possible chunk boundary', () => {
  const frame = `data: ${JSON.stringify(event)}\r\n\r\n`;

  for (let split = 0; split <= frame.length; split += 1) {
    let result = parseAgentSseChunk('', frame.slice(0, split));
    const events = [...result.events];
    result = parseAgentSseChunk(result.buffer, frame.slice(split), true);
    events.push(...result.events);
    assert.deepEqual(events, [event], `split ${split}`);
    assert.equal(result.buffer, '', `buffer at split ${split}`);
  }
});

test('ignores keepalives and parses multiple ordered events', () => {
  const completed = { ...event, type: 'turn_completed', sequence: 5 };
  const payload = `: keepalive\n\ndata: ${JSON.stringify(event)}\n\ndata: ${JSON.stringify(completed)}\n\n`;
  const result = parseAgentSseChunk('', payload, true);

  assert.deepEqual(result.events, [event, completed]);
});

test('flushes a final frame without a trailing blank line', () => {
  const result = parseAgentSseChunk('', `data: ${JSON.stringify(event)}`, true);
  assert.deepEqual(result.events, [event]);
  assert.equal(result.buffer, '');
});
