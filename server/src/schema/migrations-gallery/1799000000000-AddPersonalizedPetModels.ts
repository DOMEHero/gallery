import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "personalized_pet_model" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "ownerId" uuid NOT NULL,
      "species" text NOT NULL,
      "version" text NOT NULL,
      "status" text NOT NULL,
      "embeddingModel" text NOT NULL,
      "embeddingDimension" integer NOT NULL,
      "normalization" text NOT NULL,
      "classes" jsonb NOT NULL,
      "weights" jsonb NOT NULL,
      "bias" jsonb NOT NULL,
      "metrics" jsonb,
      "metadata" jsonb,
      "error" text,
      "activatedAt" timestamp with time zone,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "personalized_pet_model_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "personalized_pet_model_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "personalized_pet_model_status_chk" CHECK ("status" IN ('training', 'candidate', 'active', 'disabled', 'failed'))
    )
  `.execute(db);
  await sql`CREATE INDEX "personalized_pet_model_owner_species_idx" ON "personalized_pet_model" ("ownerId", "species")`.execute(
    db,
  );
  await sql`CREATE INDEX "personalized_pet_model_owner_status_idx" ON "personalized_pet_model" ("ownerId", "status")`.execute(
    db,
  );
  await sql`CREATE UNIQUE INDEX "personalized_pet_model_active_key" ON "personalized_pet_model" ("ownerId", "species") WHERE "status" = 'active'`.execute(
    db,
  );
  await sql`
    INSERT INTO "migration_overrides" ("name", "value") VALUES
      ('index_personalized_pet_model_active_key', '{"type":"index","name":"personalized_pet_model_active_key","sql":"CREATE UNIQUE INDEX \\"personalized_pet_model_active_key\\" ON \\"personalized_pet_model\\" (\\"ownerId\\", \\"species\\") WHERE \\"status\\" = ''active''"}'::jsonb)
  `.execute(db);
  await sql`
    CREATE OR REPLACE TRIGGER "personalized_pet_model_updatedAt"
    BEFORE UPDATE ON "personalized_pet_model"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value") VALUES
      ('trigger_personalized_pet_model_updatedAt', '{"type":"trigger","name":"personalized_pet_model_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"personalized_pet_model_updatedAt\\"\\n  BEFORE UPDATE ON \\"personalized_pet_model\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'trigger_personalized_pet_model_updatedAt'`.execute(db);
  await sql`DROP TRIGGER IF EXISTS "personalized_pet_model_updatedAt" ON "personalized_pet_model"`.execute(db);
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_personalized_pet_model_active_key'`.execute(db);
  await sql`DROP INDEX IF EXISTS "personalized_pet_model_active_key"`.execute(db);
  await sql`DROP TABLE "personalized_pet_model"`.execute(db);
}
