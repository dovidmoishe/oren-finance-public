import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

config({ path: '.env' });

if (!process.env.POSTGRES_URL) {
  throw new Error('POSTGRES_URL is not defined');
}

const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));
const connection = postgres(process.env.POSTGRES_URL, { max: 1 });
const db = drizzle(connection);

try {
  console.log('Running database migrations...');
  const start = Date.now();
  await migrate(db, { migrationsFolder });
  console.log(`Migrations completed in ${Date.now() - start}ms.`);
} finally {
  await connection.end({ timeout: 5 });
}
