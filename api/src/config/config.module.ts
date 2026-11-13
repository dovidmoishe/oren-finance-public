import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { APP_ENV } from './constants';
import { validateEnv, type AppEnv } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Resolve from cwd and from api/ so start works from repo root or api/
      envFilePath: [
        join(process.cwd(), '.env'),
        join(process.cwd(), 'api', '.env'),
      ],
      validate: (config) => validateEnv(config),
    }),
  ],
  providers: [
    {
      provide: APP_ENV,
      useFactory: (): AppEnv => validateEnv(),
    },
  ],
  exports: [NestConfigModule, APP_ENV],
})
export class ConfigModule {}
