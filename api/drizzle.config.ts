import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: '.env' });

// Generate only needs the schema file. Migrate/studio need a real POSTGRES_URL.
const url =
  process.env.POSTGRES_URL ??
  'postgresql://postgres:postgres@localhost:5432/oren';

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url,
  },
});
