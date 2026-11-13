import { Controller, Get, Inject } from '@nestjs/common';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { deploymentCapabilities } from '../config/deployment';

@Controller('environment')
export class EnvironmentController {
  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {}
  @Get()
  get() {
    return deploymentCapabilities({ ...this.env });
  }
}
