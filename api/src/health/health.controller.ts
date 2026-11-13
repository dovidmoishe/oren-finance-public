import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthResponse } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Process liveness only: safe for container restart checks. */
  @Get('live')
  live() {
    return { status: 'ok' as const };
  }

  /** Database readiness only: provider degradation should not restart API. */
  @Get('ready')
  ready() {
    return this.health.ready();
  }

  @Get()
  check(): Promise<HealthResponse> {
    return this.health.check();
  }
}
