import { Injectable } from '@nestjs/common';
import type { VolumeInterval, VolumeRange } from '../../types/volume';
import { VolumeRepository } from './volume.repository';

@Injectable()
export class VolumeService {
  constructor(private readonly repository: VolumeRepository) {}

  async overview(range: VolumeRange, interval: VolumeInterval) {
    const [totals, timeSeries] = await Promise.all([
      this.repository.totals(range),
      this.repository.timeSeries(range, interval),
    ]);
    return { ...totals, range, interval, timeSeries, source: 'oren' as const, asOf: new Date().toISOString() };
  }

  async stocks(range: VolumeRange) {
    return { range, items: await this.repository.stocks(range), source: 'oren' as const, asOf: new Date().toISOString() };
  }

  async features(range: VolumeRange) {
    return { range, items: await this.repository.features(range), source: 'oren' as const, asOf: new Date().toISOString() };
  }

  async stock(assetId: string, range: VolumeRange) {
    return { assetId, range, ...(await this.repository.totals(range, assetId)), source: 'oren' as const, asOf: new Date().toISOString() };
  }

  deadJobCount() {
    return this.repository.deadJobCount();
  }
}
