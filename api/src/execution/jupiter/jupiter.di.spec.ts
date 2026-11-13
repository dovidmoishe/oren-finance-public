import { Test } from '@nestjs/testing';
import { APP_ENV } from '../../config/constants';
import { validateEnv } from '../../config/env.schema';
import { JupiterGateway } from './jupiter-gateway';
import { JupiterClient } from './jupiter.client';
import { JupiterService } from './jupiter.service';
import { JupiterTriggerClient } from './jupiter-trigger.client';

describe('Jupiter DI wiring', () => {
  async function compile(extra: Record<string, string> = {}) {
    const env = validateEnv({
      POSTGRES_URL: 'postgres://test',
      TOKENS_API_KEY: 'tokens-test',
      ALCHEMY_API_KEY: 'alchemy-test',
      ...extra,
    });
    return Test.createTestingModule({
      providers: [
        { provide: APP_ENV, useValue: env },
        JupiterGateway,
        JupiterClient,
        JupiterTriggerClient,
        JupiterService,
      ],
    }).compile();
  }

  it('shares one keyless 30/min budget with half reserved for user traffic', async () => {
    const moduleRef = await compile();
    const gateway = moduleRef.get(JupiterGateway);
    expect(gateway.limiter.limit).toBe(30);
    expect(gateway.limiter.reserved).toBe(15);
    expect(gateway.hasApiKey).toBe(false);
    expect(moduleRef.get(JupiterClient)).toBeDefined();
    expect(moduleRef.get(JupiterTriggerClient)).toBeDefined();
  });

  it('uses the keyed 60/min budget when JUPITER_API_KEY is set', async () => {
    const moduleRef = await compile({ JUPITER_API_KEY: 'k' });
    expect(moduleRef.get(JupiterGateway).limiter.limit).toBe(60);
    expect(moduleRef.get(JupiterGateway).hasApiKey).toBe(true);
  });

  it('routes the swap and trigger clients to api.jup.ag', async () => {
    const moduleRef = await compile();
    const base = (c: object) => (c as unknown as { baseUrl: string }).baseUrl;
    expect(base(moduleRef.get(JupiterClient))).toBe(
      'https://api.jup.ag/swap/v1',
    );
    expect(base(moduleRef.get(JupiterTriggerClient))).toBe(
      'https://api.jup.ag/trigger/v1',
    );
  });
});
