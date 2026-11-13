import type { AgentStreamEvent } from '../types/agent';

/** Parse complete SSE frames and retain any arbitrary partial frame suffix. */
export function parseAgentSseChunk(
  previousBuffer: string,
  chunk: string,
  final = false,
): { buffer: string; events: AgentStreamEvent[] } {
  let buffer = `${previousBuffer}${chunk}`
    .replaceAll('\r\n', '\n')
    .replace(/\r(?!$)/g, '\n');
  if (final) buffer = buffer.replaceAll('\r', '\n');

  const frames: string[] = [];
  let boundary = buffer.indexOf('\n\n');
  while (boundary >= 0) {
    frames.push(buffer.slice(0, boundary));
    buffer = buffer.slice(boundary + 2);
    boundary = buffer.indexOf('\n\n');
  }
  if (final && buffer.trim()) {
    frames.push(buffer);
    buffer = '';
  }

  const events = frames.flatMap((frame) => {
    const data = frame
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    return data ? [JSON.parse(data) as AgentStreamEvent] : [];
  });

  return { buffer, events };
}
