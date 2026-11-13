export type AgentClient = 'claude' | 'cursor' | 'codex';

export const AGENT_CLIENTS: { id: AgentClient; label: string; logo: string }[] = [
  { id: 'claude', label: 'Claude', logo: '/integrations/claude.svg' },
  { id: 'cursor', label: 'Cursor', logo: '/integrations/cursor.svg' },
  { id: 'codex', label: 'Codex', logo: '/integrations/codex.svg' },
];
