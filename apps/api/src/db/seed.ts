import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import { users } from './schema';

async function seed() {
  const url =
    process.env.DATABASE_URL ??
    'postgresql://olifant:olifant_dev@localhost:5433/olifant';

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  const email = 'admin@olifantdigital.com';
  const plainPassword = 'OlifantDev2026!';
  const passwordHash = await bcrypt.hash(plainPassword, 12);

  await db
    .insert(users)
    .values({ email, passwordHash, role: 'admin' })
    .onConflictDoNothing();

  console.log(`Seed user ready: ${email}`);
  console.log(`Password:        ${plainPassword}`);

  await client.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
