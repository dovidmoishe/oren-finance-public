import { Module } from '@nestjs/common';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import { PrivyWalletAuth } from './privy-wallet-auth';

@Module({
  providers: [
    {
      provide: PrivyWalletAuth,
      inject: [APP_ENV],
      useFactory: (env: AppEnv) =>
        new PrivyWalletAuth(env.PRIVY_APP_ID, env.PRIVY_APP_SECRET),
    },
  ],
  exports: [PrivyWalletAuth],
})
export class AuthModule {}
