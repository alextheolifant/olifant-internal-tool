// One-time migration of the pre-existing single-manager-account
// ADS_REFRESH_TOKEN env var into the new ads_manager_accounts table.
// Safe to run more than once — no-ops if ADS_REFRESH_TOKEN is unset, or if
// this organization already has a manager account row.
//
// Usage:
//   pnpm migrate:ads-token
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, isNull } from 'drizzle-orm';
import { adsManagerAccounts, amazonAdsAccounts, organizations, users } from '../db/schema';
import { encrypt } from '../common/crypto.util';

const ATTRIBUTED_TO_EMAIL = 'admin@olifantdigital.com';

async function main() {
  const refreshToken = process.env.ADS_REFRESH_TOKEN;
  if (!refreshToken) {
    console.log('ADS_REFRESH_TOKEN is not set — nothing to migrate.');
    return;
  }

  const url =
    process.env.DATABASE_URL ??
    'postgresql://olifant:olifant_dev@localhost:5433/olifant';
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  try {
    const [org] = await db.select().from(organizations).limit(1);
    if (!org) {
      throw new Error(
        'No organization row found — run migration 0018 before this script.',
      );
    }

    const [attributedUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, ATTRIBUTED_TO_EMAIL))
      .limit(1);
    if (!attributedUser) {
      throw new Error(
        `User ${ATTRIBUTED_TO_EMAIL} not found — cannot attribute the migrated token.`,
      );
    }

    const [existing] = await db
      .select()
      .from(adsManagerAccounts)
      .where(eq(adsManagerAccounts.organizationId, org.id))
      .limit(1);
    if (existing) {
      console.log(
        `Organization "${org.name}" already has a manager account (${existing.id}) — skipping insert.`,
      );
      return;
    }

    const [inserted] = await db
      .insert(adsManagerAccounts)
      .values({
        organizationId: org.id,
        connectedByUserId: attributedUser.id,
        refreshToken: encrypt(refreshToken),
        isActive: true,
      })
      .returning();

    console.log(
      `Migrated ADS_REFRESH_TOKEN into ads_manager_accounts (${inserted.id}), attributed to ${ATTRIBUTED_TO_EMAIL}.`,
    );

    const backfilled = await db
      .update(amazonAdsAccounts)
      .set({ adsManagerAccountId: inserted.id })
      .where(isNull(amazonAdsAccounts.adsManagerAccountId))
      .returning({ id: amazonAdsAccounts.id });

    console.log(`Backfilled ads_manager_account_id on ${backfilled.length} existing amazon_ads_accounts row(s).`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
