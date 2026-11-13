import { BadRequestException } from '@nestjs/common';
import { AgentController } from './agent.controller';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

describe('AgentController', () => {
  const auth = { requireWallet: jest.fn().mockResolvedValue('did:privy:user') };
  it('returns thread, message, artifacts, and events', async () => {
    const agent = {
      message: jest.fn().mockResolvedValue({
        threadId: 'thread-1',
        message: {
          id: 'msg-1',
          threadId: 'thread-1',
          role: 'assistant',
          content: 'Done',
          createdAt: new Date('2026-09-13T10:00:00Z'),
        },
        artifacts: [],
        events: [{ type: 'assistant_completed', timestamp: new Date() }],
      }),
    };
    const controller = new AgentController(agent as never, auth as never);

    await expect(
      controller.message(
        { walletAddress: 'wallet-1', message: 'Hi' },
        'Bearer token',
      ),
    ).resolves.toMatchObject({
      threadId: 'thread-1',
      message: { content: 'Done' },
      artifacts: [],
      events: [{ type: 'assistant_completed' }],
    });
  });

  it('rejects missing wallet or message through the service contract', async () => {
    const agent = {
      message: jest.fn().mockRejectedValue(new BadRequestException()),
    };
    const controller = new AgentController(agent as never, auth as never);

    await expect(
      controller.message({ walletAddress: '', message: '' }, 'Bearer token'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies another wallet before reading private agent history', async () => {
    const agent = { getThreadMessages: jest.fn() };
    auth.requireWallet.mockRejectedValueOnce(
      new BadRequestException('wrong wallet'),
    );
    const controller = new AgentController(agent as never, auth as never);
    await expect(
      controller.getThreadMessages(
        'thread-1',
        { walletAddress: 'other' },
        'Bearer token',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(agent.getThreadMessages).not.toHaveBeenCalled();
  });
});
