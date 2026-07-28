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
    [org] = await db
      .insert(organizations)
      .values({ name: 'Olifant' })
      .returning();
    console.log(`Seed organization created: ${org.name} (${org.id})`);
  } else {
    console.log(`Seed organization already exists: ${org.name} (${org.id})`);
  }

  const seedUsers: {
    email: string;
    role: 'admin' | 'analyst';
    password: string;
  }[] = [
    {
      email: 'admin@olifantdigital.com',
      role: 'admin',
      password: 'OlifantDev2026!',
    },
    // Second Olifant team member — used to verify manager-account connections
    // are shared org-wide, not scoped to whoever personally connected them.
    // Own password, not shared with admin, so the two seed logins are
    // actually distinguishable in testing.
    {
      email: 'mike@olifantdigital.com',
      role: 'analyst',
      password: 'MikeDev2026!',
    },
  ];

  for (const { email, role, password } of seedUsers) {
    const passwordHash = await bcrypt.hash(password, 12);
    // onConflictDoUpdate, not onConflictDoNothing — re-running the seed must
    // actually enforce each account's intended password/role, not silently
    // skip existing rows (which previously left a stale shared password in
    // place even after this file was changed to assign a distinct one).
    await db
      .insert(users)
      .values({ email, passwordHash, role, organizationId: org.id })
      .onConflictDoUpdate({
        target: users.email,
        set: { passwordHash, role },
      });
    console.log(`Seed user ready: ${email} (${role}) — password: ${password}`);
  }

  await client.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
