jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));
import { ForbiddenException } from '@nestjs/common';
import { ExecutionController } from './execution.controller';

describe('ExecutionController', () => {
  const execution = {
    getQuote: jest.fn(),
    prepare: jest.fn(),
    confirm: jest.fn(),
    confirmLimitOrder: jest.fn(),
    confirmCancelLimitOrder: jest.fn(),
    createBasket: jest.fn(),
    prepareBasketPurchase: jest.fn(),
  };

  const auth = { requireWallet: jest.fn() };
  let controller: ExecutionController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ExecutionController(execution as never, auth as never);
  });

  it('delegates basket creation to ExecutionService', async () => {
    execution.createBasket.mockResolvedValue({ id: 'basket-1' });

    await expect(
      controller.basket({
        amountUsd: 100,
        prompt: 'Build a basket',
      }),
    ).resolves.toEqual({ id: 'basket-1' });

    expect(execution.createBasket).toHaveBeenCalledWith({
      amountUsd: 100,
      prompt: 'Build a basket',
      candidates: undefined,
    });
  });

  it('delegates basket preparation to ExecutionService', async () => {
    execution.prepareBasketPurchase.mockResolvedValue({
      basketId: 'basket-1',
      transactions: [],
    });

    await expect(
      controller.prepareBasket({
        basketId: 'basket-1',
        wallet: '11111111111111111111111111111111',
      }),
    ).resolves.toEqual({
      basketId: 'basket-1',
      transactions: [],
    });

    expect(execution.prepareBasketPurchase).toHaveBeenCalledWith({
      basketId: 'basket-1',
      wallet: '11111111111111111111111111111111',
    });
  });

  describe('signature-reporting routes require the wallet owner', () => {
    const wallet = '11111111111111111111111111111111';
    const denied = new ForbiddenException('Wallet is not linked to this account');

    it.each([
      ['prepare', 'prepare', () => controller.prepare(undefined, { quoteId: 'q', wallet })],
      ['confirm', 'confirm', () => controller.confirm(undefined, { quoteId: 'q', wallet, signature: 's' })],
      ['limit-order/confirm', 'confirmLimitOrder', () => controller.confirmLimitOrder(undefined, { proposalId: 'p', wallet, signature: 's' })],
      ['limit-order/confirm-cancel', 'confirmCancelLimitOrder', () => controller.confirmCancelLimitOrder(undefined, { orderKey: 'o', wallet, signature: 's' })],
    ] as const)('%s rejects callers who do not own the wallet', async (_route, method, call) => {
      auth.requireWallet.mockRejectedValue(denied);
      await expect(call()).rejects.toBe(denied);
      expect(auth.requireWallet).toHaveBeenCalledWith(undefined, wallet);
      expect(execution[method]).not.toHaveBeenCalled();
    });

    it('passes the bearer token and wallet to the ownership check', async () => {
      auth.requireWallet.mockResolvedValue('user-1');
      execution.confirm.mockResolvedValue({ status: 'submitted' });
      await controller.confirm('Bearer token', { quoteId: 'q', wallet, signature: 's' });
      expect(auth.requireWallet).toHaveBeenCalledWith('Bearer token', wallet);
      expect(execution.confirm).toHaveBeenCalled();
    });
  });
});
