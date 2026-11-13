import { ServiceUnavailableException } from '@nestjs/common';
import { Senviok } from 'senviok';
import { SenviokEmailService } from './senviok.service';

const mockSend = jest.fn();

jest.mock('senviok', () => ({
  Senviok: jest.fn().mockImplementation(() => ({
    emails: { send: mockSend },
  })),
}));

describe('SenviokEmailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends email using the Senviok SDK and configured sender', async () => {
    const receipt = { id: 'email-123' };
    mockSend.mockResolvedValue(receipt);
    const service = new SenviokEmailService({
      SENVIOK_API_KEY: 'test-key',
      SENVIOK_FROM: 'updates@oren.finance',
    });

    await expect(
      service.sendEmail({
        to: 'user@example.com',
        subject: 'Trade update',
        text: 'Your trade is complete.',
      }),
    ).resolves.toBe(receipt);

    expect(Senviok).toHaveBeenCalledWith('test-key');
    expect(mockSend).toHaveBeenCalledWith({
      to: 'user@example.com',
      subject: 'Trade update',
      text: 'Your trade is complete.',
      from: 'updates@oren.finance',
    });
  });

  it('fails explicitly when Senviok is not configured', async () => {
    const service = new SenviokEmailService({});

    await expect(
      service.sendEmail({
        to: 'user@example.com',
        subject: 'Trade update',
        text: 'Your trade is complete.',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(mockSend).not.toHaveBeenCalled();
  });
});
