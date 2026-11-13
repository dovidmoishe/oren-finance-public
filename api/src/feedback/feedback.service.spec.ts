import { BadRequestException, HttpException } from '@nestjs/common';
import { FeedbackController } from './feedback.controller';
import {
  FEEDBACK_HOURLY_LIMIT,
  FeedbackService,
  parseFeedback,
} from './feedback.service';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

const owner = {
  userId: 'did:privy:user',
  walletAddress: 'owned',
  email: 'user@example.com',
};

describe('parseFeedback', () => {
  it('trims fields and keeps only an in-app page path', () => {
    expect(
      parseFeedback({
        kind: 'bug',
        subject: '  Chart is blank  ',
        message: '  NVDA chart shows nothing  ',
        page: 'https://evil.example/phish',
      }),
    ).toEqual({
      kind: 'bug',
      subject: 'Chart is blank',
      message: 'NVDA chart shows nothing',
    });
    expect(
      parseFeedback({
        kind: 'support',
        subject: 'Help',
        message: 'Deposit missing',
        page: '/app/vault',
      }).page,
    ).toBe('/app/vault');
  });

  it('rejects unknown kinds and empty or oversized text', () => {
    const valid = { kind: 'feedback', subject: 'Nice', message: 'Love it' };
    expect(() => parseFeedback({ ...valid, kind: 'spam' })).toThrow(
      BadRequestException,
    );
    expect(() => parseFeedback({ ...valid, subject: '   ' })).toThrow(
      BadRequestException,
    );
    expect(() => parseFeedback({ ...valid, subject: 'x'.repeat(121) })).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseFeedback({ ...valid, message: 'x'.repeat(4001) }),
    ).toThrow(BadRequestException);
    expect(() => parseFeedback(null)).toThrow(BadRequestException);
  });
});

describe('FeedbackService', () => {
  const repository = {
    countSince: jest.fn(),
    create: jest.fn(),
    list: jest.fn(),
  };
  const service = new FeedbackService(repository as never);

  beforeEach(() => jest.clearAllMocks());

  it('saves a ticket for the verified owner', async () => {
    repository.countSince.mockResolvedValue(0);
    repository.create.mockResolvedValue({ id: 't1', status: 'open' });
    await expect(
      service.submit(owner, {
        kind: 'feedback',
        subject: 'Nice',
        message: 'Love it',
      }),
    ).resolves.toEqual({ id: 't1', status: 'open' });
    expect(repository.create).toHaveBeenCalledWith(owner, {
      kind: 'feedback',
      subject: 'Nice',
      message: 'Love it',
    });
  });

  it('stops a user after the hourly limit without saving', async () => {
    repository.countSince.mockResolvedValue(FEEDBACK_HOURLY_LIMIT);
    await expect(
      service.submit(owner, {
        kind: 'feedback',
        subject: 'Again',
        message: 'Again',
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('FeedbackController', () => {
  const feedback = { submit: jest.fn(), list: jest.fn() };
  const auth = { requireResearchIdentity: jest.fn() };
  const controller = new FeedbackController(feedback as never, auth as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects an unlinked wallet before saving or listing', async () => {
    auth.requireResearchIdentity.mockRejectedValue(
      new HttpException('forbidden', 403),
    );
    await expect(
      controller.submit('other', { kind: 'feedback' }, 'Bearer token'),
    ).rejects.toBeInstanceOf(HttpException);
    await expect(
      controller.list('other', 'Bearer token'),
    ).rejects.toBeInstanceOf(HttpException);
    expect(feedback.submit).not.toHaveBeenCalled();
    expect(feedback.list).not.toHaveBeenCalled();
  });

  it('lists only the signed-in user tickets', async () => {
    auth.requireResearchIdentity.mockResolvedValue(owner);
    feedback.list.mockResolvedValue([]);
    await controller.list('owned', 'Bearer token');
    expect(feedback.list).toHaveBeenCalledWith('did:privy:user');
  });

  it('requires a wallet address', async () => {
    await expect(controller.list('', 'Bearer token')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
