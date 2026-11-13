jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

import { ForbiddenException } from '@nestjs/common';
import { PortfolioController } from './portfolio.controller';

describe('PortfolioController', () => {
  const wallet = '11111111111111111111111111111111';
  const portfolio = {
    getPortfolio: jest.fn().mockResolvedValue({ walletAddress: wallet }),
    getHistory: jest.fn().mockResolvedValue({ points: [] }),
    getActivity: jest.fn().mockResolvedValue({ items: [] }),
  };
  const calendar = {
    getCalendar: jest.fn().mockResolvedValue({ days: [] }),
    getDay: jest.fn().mockResolvedValue({ agentEvents: [] }),
  };
  const auth = { requireWallet: jest.fn() };
  let controller: PortfolioController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PortfolioController(
      portfolio as never,
      calendar as never,
      auth as never,
    );
  });

  it('keeps on-chain balances public', async () => {
    await controller.getPortfolio(wallet);
    expect(auth.requireWallet).not.toHaveBeenCalled();
    expect(portfolio.getPortfolio).toHaveBeenCalledWith(wallet);
  });

  it.each([
    [
      'history',
      () => controller.getHistory(undefined, wallet),
      portfolio.getHistory,
    ],
    [
      'activity',
      () => controller.getActivity(undefined, wallet),
      portfolio.getActivity,
    ],
    [
      'calendar',
      () => controller.getCalendar(undefined, wallet, {}),
      calendar.getCalendar,
    ],
    [
      'calendar day',
      () => controller.getCalendarDay(undefined, wallet, '2026-11-06', {}),
      calendar.getDay,
    ],
  ])(
    'refuses %s to anyone but the wallet owner',
    async (_name, call, service) => {
      const denied = new ForbiddenException(
        'Wallet is not linked to this account',
      );
      auth.requireWallet.mockRejectedValue(denied);
      await expect(call()).rejects.toBe(denied);
      expect(auth.requireWallet).toHaveBeenCalledWith(undefined, wallet);
      expect(service).not.toHaveBeenCalled();
    },
  );

  it('returns the calendar day, including agent events, to the owner', async () => {
    auth.requireWallet.mockResolvedValue('user-1');
    await expect(
      controller.getCalendarDay('Bearer token', wallet, '2026-11-06', {}),
    ).resolves.toEqual({ agentEvents: [] });
    expect(auth.requireWallet).toHaveBeenCalledWith('Bearer token', wallet);
  });
});
