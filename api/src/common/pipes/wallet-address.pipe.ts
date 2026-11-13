import { Injectable, PipeTransform } from '@nestjs/common';
import bs58 from 'bs58';
import { InvalidWalletAddressError } from '../errors/provider.errors';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

@Injectable()
export class WalletAddressPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    const wallet = value?.trim();
    if (!wallet || !BASE58_RE.test(wallet)) {
      throw new InvalidWalletAddressError(
        `Invalid Solana wallet address: ${value}`,
      );
    }

    try {
      const decoded = bs58.decode(wallet);
      if (decoded.length !== 32) {
        throw new InvalidWalletAddressError(
          `Invalid Solana wallet address: ${value}`,
        );
      }
    } catch (err) {
      if (err instanceof InvalidWalletAddressError) throw err;
      throw new InvalidWalletAddressError(
        `Invalid Solana wallet address: ${value}`,
      );
    }

    return wallet;
  }
}
