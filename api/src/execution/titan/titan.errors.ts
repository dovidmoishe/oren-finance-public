import { ProviderError } from '../../common/errors/provider.errors';
import type { TitanErrorCode } from './titan.types';

/**
 * Titan failures never reach users directly: the swap router falls back to
 * Jupiter. The code is what ends up in comparison logs.
 */
export class TitanError extends ProviderError {
  constructor(
    readonly titanCode: TitanErrorCode,
    message: string,
    readonly httpStatus?: number,
    cause?: unknown,
  ) {
    super(message, `TITAN_${titanCode.toUpperCase()}`, 502, cause);
    this.name = 'TitanError';
  }
}

export function titanErrorCode(err: unknown): TitanErrorCode | 'unknown' {
  return err instanceof TitanError ? err.titanCode : 'unknown';
}
