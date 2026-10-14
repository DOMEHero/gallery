import { Kysely, sql } from 'kysely';

/** Add the sync watermark required by the shared updated_at() trigger. */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE "personalized_pet_model"
    ADD COLUMN IF NOT EXISTS "updateId" uuid NOT NULL DEFAULT immich_uuid_v7()
  `.execute(db);
  await sql`
    CREATE INDEX IF NOT EXISTS "personalized_pet_model_updateId_idx"
    ON "personalized_pet_model" ("updateId")
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX "personalized_pet_model_updateId_idx"`.execute(db);
  await sql`ALTER TABLE "personalized_pet_model" DROP COLUMN "updateId"`.execute(db);
}
