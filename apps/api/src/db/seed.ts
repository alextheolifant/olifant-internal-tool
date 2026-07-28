import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as bcrypt from 'bcrypt';
import { organizations, users } from './schema';

async function seed() {
  const url =
    process.env.DATABASE_URL ??
    'postgresql://olifant:olifant_dev@localhost:5433/olifant';

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  // Migration 0018 already seeds this row in the normal migrate-then-seed
  // order, but look-or-create here too so seed.ts stays runnable standalone
  // (e.g. against a freshly reset DB where migrations ran in a different order).
  let [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    [org] = await db.insert(organizations).values({ name: 'Olifant' }).returning();
    console.log(`Seed organization created: ${org.name} (${org.id})`);
  } else {
    console.log(`Seed organization already exists: ${org.name} (${org.id})`);
  }

  const plainPassword = 'OlifantDev2026!';
  const passwordHash = await bcrypt.hash(plainPassword, 12);

  const seedUsers: { email: string; role: 'admin' | 'analyst' }[] = [
    { email: 'admin@olifantdigital.com', role: 'admin' },
    // Second Olifant team member — used to verify manager-account connections
    // are shared org-wide, not scoped to whoever personally connected them.
    { email: 'mike@olifantdigital.com', role: 'analyst' },
  ];

  for (const { email, role } of seedUsers) {
    await db
      .insert(users)
      .values({ email, passwordHash, role, organizationId: org.id })
      .onConflictDoNothing();
    console.log(`Seed user ready: ${email} (${role})`);
  }
  console.log(`Password (all seed users): ${plainPassword}`);

  await client.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
