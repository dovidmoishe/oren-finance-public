import { Global, Module } from '@nestjs/common';
import { DRIZZLE } from '../config/constants';
import { DatabaseService } from './database.provider';

@Global()
@Module({
  providers: [
    DatabaseService,
    {
      provide: DRIZZLE,
      useFactory: (database: DatabaseService) => database.db,
      inject: [DatabaseService],
    },
  ],
  exports: [DatabaseService, DRIZZLE],
})
export class DatabaseModule {}
