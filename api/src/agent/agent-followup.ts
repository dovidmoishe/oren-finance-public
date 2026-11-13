/** True when a new assistant reply is the same text as the previous one. */
export function isSameReply(next: string, previous: string): boolean {
  const left = next.replace(/\s+/g, ' ').trim();
  const right = previous.replace(/\s+/g, ' ').trim();
  return left.length >= 40 && left === right;
}

export function previousAssistantContent(
  messages: { role: string; content: string }[],
): string | undefined {
  return [...messages].reverse().find((message) => message.role === 'assistant')
    ?.content;
}
