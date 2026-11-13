import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { APP_ENV } from '../config/constants';
import type { AppEnv } from '../config/env.schema';
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly client: ReturnType<typeof postgres>;

  readonly db: Database;

  constructor(@Inject(APP_ENV) env: AppEnv) {
    this.client = postgres(env.POSTGRES_URL, { max: 10 });
    this.db = drizzle(this.client, { schema });
  }

  async ping(): Promise<number> {
    const start = Date.now();
    await this.client`SELECT 1`;
    return Date.now() - start;
  }

  async onModuleDestroy() {
    await this.client.end({ timeout: 5 });
  }
}
