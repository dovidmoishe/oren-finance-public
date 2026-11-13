import { Test } from '@nestjs/testing';
import { AlchemyClient } from '../alchemy/alchemy.client';
import { APP_ENV } from '../config/constants';
import { validateEnv } from '../config/env.schema';
import { JupiterGateway } from './jupiter/jupiter-gateway';
import { JupiterClient } from './jupiter/jupiter.client';
import { JupiterService } from './jupiter/jupiter.service';
import { JupiterTriggerClient } from './jupiter/jupiter-trigger.client';
import { SwapFeeOracle } from './swap-fee-oracle';
import { SwapRouter } from './swap-router';
import { TitanClient } from './titan/titan.client';
import { TitanService } from './titan/titan.service';
import { TitanTxBuilder } from './titan/titan-tx.builder';

describe('swap routing DI wiring', () => {
  async function compile(extra: Record<string, string> = {}) {
    const env = validateEnv({
      POSTGRES_URL: 'postgres://test',
      TOKENS_API_KEY: 'tokens-test',
      ALCHEMY_API_KEY: 'alchemy-test',
      ...extra,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: AlchemyClient, useValue: { call: jest.fn() } },
        JupiterGateway,
        JupiterClient,
        JupiterTriggerClient,
        JupiterService,
        TitanClient,
        TitanTxBuilder,
        TitanService,
        SwapFeeOracle,
        SwapRouter,
      ],
    }).compile();
    return moduleRef;
  }

  it('resolves with Titan disabled by default (Jupiter only)', async () => {
    const moduleRef = await compile();
    const router = moduleRef.get(SwapRouter);
    expect(router.mode).toBe('jupiter');
    // Both Jupiter clients share one budget.
    expect(moduleRef.get(JupiterGateway).limiter.limit).toBe(30);
  });

  it('enables the configured mode once a Titan key is present', async () => {
    const moduleRef = await compile({
      TITAN_API_KEY: 'titan-test',
      SWAP_ROUTER_MODE: 'shadow',
    });
    expect(moduleRef.get(SwapRouter).mode).toBe('shadow');
    expect(moduleRef.get(TitanClient).enabled).toBe(true);
  });
});
