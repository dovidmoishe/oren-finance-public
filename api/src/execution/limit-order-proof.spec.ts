// Real transaction bytes. The module mapper would replace web3.js with a stub.
jest.mock(
  'rpc-websockets',
  () => ({ CommonClient: class {}, WebSocket: class {} }),
  { virtual: true },
);
jest.mock('@solana/web3.js', () =>
  jest.requireActual<Record<string, unknown>>(
    '@solana/web3.js/lib/index.cjs.js',
  ),
);

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { ExecutionService } from './execution.service';
import { LimitOrderCache } from './limit-order-cache';
import { OnchainTransactions } from './onchain-transaction';

const blockhash = '11111111111111111111111111111111';

function orderTransaction(payer: Keypair, order: PublicKey, data: Buffer) {
  const tx = new Transaction({
    feePayer: payer.publicKey,
    recentBlockhash: blockhash,
  });
  tx.add(
    new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: order, isSigner: false, isWritable: false },
      ],
      data,
    }),
  );
  const unsigned = tx
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString('base64');
  tx.sign(payer);
  const signature = bs58.encode(tx.signature!);
  const raw = {
    transaction: [tx.serialize().toString('base64'), 'base64'] as [
      string,
      string,
    ],
    meta: { err: null },
  };
  return { unsigned, signature, raw };
}

describe('limit order confirmation proof', () => {
  const payer = Keypair.generate();
  const wallet = payer.publicKey.toBase58();
  const order = Keypair.generate().publicKey;
  const cancel = orderTransaction(payer, order, Buffer.from('cancel-order'));
  const open = orderTransaction(payer, order, Buffer.from('open-order'));

  function onchainFor(raw: (typeof cancel)['raw']) {
    return new OnchainTransactions({
      getConfirmedRawTransaction: jest.fn().mockResolvedValue(raw),
    } as never);
  }

  it('accepts the prepared cancel and rejects the open transaction and any other reference', async () => {
    await expect(
      onchainFor(cancel.raw).assertPreparedTransaction(
        cancel.signature,
        wallet,
        cancel.unsigned,
        order.toBase58(),
      ),
    ).resolves.toBeTruthy();

    await expect(
      onchainFor(open.raw).assertPreparedTransaction(
        open.signature,
        wallet,
        cancel.unsigned,
        order.toBase58(),
      ),
    ).rejects.toThrow('does not match the prepared transaction');

    const unrelated = orderTransaction(
      payer,
      order,
      Buffer.from('mention-only'),
    );
    await expect(
      onchainFor(unrelated.raw).assertPreparedTransaction(
        unrelated.signature,
        wallet,
        cancel.unsigned,
        order.toBase58(),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not mark another wallet cancelled and ignores an open signature', async () => {
    const orders = {
      findByOrderKey: jest.fn(),
      updateStatus: jest.fn(),
      upsert: jest.fn(),
    };
    const executions = { updateStatus: jest.fn() };
    const portfolio = { getPortfolio: jest.fn().mockResolvedValue({}) };
    const limits = new LimitOrderCache();
    const service = new ExecutionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      limits,
      orders as never,
      executions as never,
      portfolio as never,
      {} as never,
      {} as never,
      onchainFor(open.raw),
    );
    limits.setCancel({
      orderKey: order.toBase58(),
      wallet,
      transaction: cancel.unsigned,
      requestId: 'request',
      provider: 'jupiter-trigger',
      expiresAt: new Date(Date.now() + 60_000),
      executionId: 'exec-cancel',
    });
    orders.findByOrderKey.mockResolvedValue({
      walletAddress: Keypair.generate().publicKey.toBase58(),
    });

    await expect(
      service.confirmCancelLimitOrder({
        orderKey: order.toBase58(),
        wallet,
        signature: open.signature,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(orders.updateStatus).not.toHaveBeenCalled();

    orders.findByOrderKey.mockResolvedValue({ walletAddress: wallet });
    await expect(
      service.confirmCancelLimitOrder({
        orderKey: order.toBase58(),
        wallet,
        signature: open.signature,
      }),
    ).rejects.toThrow('does not match the prepared transaction');
    expect(orders.updateStatus).not.toHaveBeenCalled();

    const accepting = new ExecutionService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      limits,
      orders as never,
      executions as never,
      portfolio as never,
      {} as never,
      {} as never,
      onchainFor(cancel.raw),
    );
    orders.updateStatus.mockResolvedValue({ id: 'row' });
    await accepting.confirmCancelLimitOrder({
      orderKey: order.toBase58(),
      wallet,
      signature: cancel.signature,
    });
    expect(orders.updateStatus).toHaveBeenCalledWith(
      order.toBase58(),
      { status: 'cancelled', closeSignature: cancel.signature },
      wallet,
    );
  });
});
