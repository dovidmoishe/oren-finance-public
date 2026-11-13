// Real ed25519 signatures over versioned messages.
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

import { BadRequestException } from '@nestjs/common';
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { ExecutionService } from './execution.service';
import { QuoteCache } from './quote-cache';

function preparedTransfer(payer: Keypair, lamports: number) {
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: '11111111111111111111111111111111',
    instructions: [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: payer.publicKey,
        lamports,
      }),
    ],
  }).compileToV0Message();
  const unsignedTx = new VersionedTransaction(message);
  const unsigned = Buffer.from(unsignedTx.serialize()).toString('base64');
  unsignedTx.sign([payer]);
  return {
    unsigned,
    signature: bs58.encode(unsignedTx.signatures[0]),
  };
}

describe('swap confirm signature binding', () => {
  const payer = Keypair.generate();
  const wallet = payer.publicKey.toBase58();
  const prepared = preparedTransfer(payer, 0);
  const other = preparedTransfer(payer, 1);

  function service() {
    const cache = new QuoteCache();
    cache.attachExecution('quote-1', 'execution-1', wallet, prepared.unsigned);
    const repository = {
      submitAndEnqueue: jest.fn().mockResolvedValue({ id: 'execution-1' }),
    };
    const portfolio = { getPortfolio: jest.fn() };
    const built = new ExecutionService(
      {} as never,
      {} as never,
      {} as never,
      cache,
      {} as never,
      {} as never,
      {} as never,
      repository as never,
      portfolio as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { built, repository, portfolio };
  }

  it('submits the signature of the prepared transaction without waiting for RPC', async () => {
    const { built, repository, portfolio } = service();
    await expect(
      built.confirm({
        quoteId: 'quote-1',
        executionId: 'execution-1',
        wallet,
        signature: prepared.signature,
      }),
    ).resolves.toMatchObject({
      executionId: 'execution-1',
      signature: prepared.signature,
      status: 'submitted',
    });
    expect(repository.submitAndEnqueue).toHaveBeenCalledWith({
      executionId: 'execution-1',
      walletAddress: wallet,
      transactionSignature: prepared.signature,
    });
    expect(portfolio.getPortfolio).not.toHaveBeenCalled();

    await built.confirm({
      quoteId: 'quote-1',
      wallet,
      signature: prepared.signature,
    });
    expect(repository.submitAndEnqueue).toHaveBeenCalledTimes(2);
  });

  it('does not pin another transaction ahead of the prepared swap', async () => {
    const { built, repository } = service();
    await expect(
      built.confirm({
        quoteId: 'quote-1',
        executionId: 'execution-1',
        wallet,
        signature: other.signature,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.submitAndEnqueue).not.toHaveBeenCalled();

    await expect(
      built.confirm({
        quoteId: 'quote-1',
        executionId: 'execution-other',
        wallet,
        signature: prepared.signature,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.submitAndEnqueue).not.toHaveBeenCalled();
  });
});
