import { OREN_AGENT_PROMPT } from './agent.prompt';

describe('Oren agent prompt market hours', () => {
  it('tells the model to speak the server summary and does not force a tool', () => {
    expect(OREN_AGENT_PROMPT).toContain('marketSession');
    expect(OREN_AGENT_PROMPT).toContain('say summary once, unchanged');
    expect(OREN_AGENT_PROMPT).toContain(
      'When marketSession is missing or regular is true',
    );
    expect(OREN_AGENT_PROMPT).not.toMatch(/must call[^\n]*market/i);
    expect(OREN_AGENT_PROMPT).not.toContain('getMarketSession');
  });

  it('does not call an opportunity score sentiment or push a trade after research', () => {
    expect(OREN_AGENT_PROMPT).toMatch(/opportunity score is momentum/i);
    expect(OREN_AGENT_PROMPT).toContain(
      'Do not offer to prepare a buy quote, limit order, or basket',
    );
    expect(OREN_AGENT_PROMPT).toMatch(/company report/i);
    expect(OREN_AGENT_PROMPT).toMatch(/do not substitute a price read/i);
  });
});
