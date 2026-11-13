import { BadRequestException } from '@nestjs/common';
import { ResearchController } from './research.controller';

jest.mock('@privy-io/node', () => ({ PrivyClient: jest.fn() }));

describe('ResearchController', () => {
  const research = {
    getStock: jest.fn(),
    save: jest.fn(),
    listSaved: jest.fn(),
    recordSourceOpen: jest.fn(),
  };
  const auth = { requireResearchIdentity: jest.fn() };
  const controller = new ResearchController(research as never, auth as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects an unlinked wallet before reading or saving research', async () => {
    auth.requireResearchIdentity.mockRejectedValue(
      new BadRequestException('wrong wallet'),
    );
    await expect(
      controller.getStock('nvda', 'other', 'Bearer token'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.save('nvda', 'other', { note: 'My thesis' }, 'Bearer token'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(research.getStock).not.toHaveBeenCalled();
    expect(research.save).not.toHaveBeenCalled();
  });

  it('saves a user note against a fresh server-generated snapshot', async () => {
    auth.requireResearchIdentity.mockResolvedValue({
      userId: 'did:privy:user',
      walletAddress: 'owned',
    });
    research.getStock.mockResolvedValue({ assetId: 'nvda' });
    research.save.mockResolvedValue({
      assetId: 'nvda',
      note: 'Demand is growing',
    });
    await expect(
      controller.save(
        'nvda',
        'owned',
        { note: '  Demand is growing  ' },
        'Bearer token',
      ),
    ).resolves.toMatchObject({ note: 'Demand is growing' });
    expect(research.getStock).toHaveBeenCalledWith('nvda', {
      userId: 'did:privy:user',
      walletAddress: 'owned',
    });
    expect(research.save).toHaveBeenCalledWith(
      { assetId: 'nvda' },
      'did:privy:user',
      'Demand is growing',
    );
  });
});
