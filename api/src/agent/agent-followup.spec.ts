import { isSameReply } from './agent-followup';

describe('duplicate reply detection', () => {
  it('matches the same long reply and ignores a different one', () => {
    const repeated = 'Mostly bullish. '.repeat(4);
    expect(isSameReply(repeated, repeated)).toBe(true);
    expect(isSameReply(`${repeated} More detail.`, repeated)).toBe(false);
    expect(isSameReply('ok', 'ok')).toBe(false);
  });
});
