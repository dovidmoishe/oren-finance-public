import {
  ServiceUnavailableException,
  type ArgumentsHost,
} from '@nestjs/common';
import { PriceMovedError } from '../errors/provider.errors';
import { HttpExceptionFilter } from './http-exception.filter';

describe('approval failure response contract', () => {
  function responseFor(body: string | Record<string, unknown>) {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn<void, [Record<string, unknown>]>(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/api/execution/approvals/id/approve' }),
      }),
    } as unknown as ArgumentsHost;
    new HttpExceptionFilter().catch(
      new ServiceUnavailableException(body),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(503);
    return response.json.mock.calls[0][0];
  }
  it('preserves the explicit no-submission marker for Privy sign-only failures', () => {
    expect(
      responseFor({
        message: 'No transaction was submitted.',
        code: 'PRIVY_SIGNING_FAILED',
        submissionState: 'not_submitted',
      }),
    ).toEqual(
      expect.objectContaining({
        code: 'PRIVY_SIGNING_FAILED',
        submissionState: 'not_submitted',
        message: 'No transaction was submitted.',
      }),
    );
  });
  it('does not classify arbitrary service outages as safe to repeat', () => {
    expect(responseFor('Service unavailable')).not.toHaveProperty(
      'submissionState',
    );
  });
});

describe('PRICE_MOVED response contract', () => {
  it('returns 409 PRICE_MOVED with the alternative but never the server quote', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn<void, [Record<string, unknown>]>(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({ url: '/api/execution/approvals' }),
      }),
    } as unknown as ArgumentsHost;
    const details = {
      quoteId: 'q',
      reviewed: {
        provider: 'titan:Titan',
        outputAmount: 4,
        minimumOutputAmount: 3.98,
        minOutRaw: '398000000',
        slippageBps: 50,
        outputSymbol: 'TSLAx',
      },
    };
    new HttpExceptionFilter().catch(
      new PriceMovedError(undefined, undefined, details, {
        routePayload: { secret: true },
      }),
      host,
    );
    expect(response.status).toHaveBeenCalledWith(409);
    const body = response.json.mock.calls[0][0];
    expect(body).toMatchObject({
      statusCode: 409,
      error: 'PRICE_MOVED',
      priceMoved: details,
    });
    expect(JSON.stringify(body)).not.toContain('secret');
  });
});
