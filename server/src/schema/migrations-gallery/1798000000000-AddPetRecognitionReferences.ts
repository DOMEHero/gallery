import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "pet_recognition_reference" (
      "faceId" uuid NOT NULL,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "pet_recognition_reference_pkey" PRIMARY KEY ("faceId"),
      CONSTRAINT "pet_recognition_reference_faceId_fkey"
        FOREIGN KEY ("faceId") REFERENCES "asset_face" ("id") ON DELETE CASCADE
    )
  `.execute(db);

  // A non-empty existing pet name is the only durable user-confirmation signal in installations
  // predating this table. This seeds references without changing an assignment or re-embedding data.
  await sql`
    INSERT INTO "pet_recognition_reference" ("faceId")
    SELECT "asset_face"."id"
    FROM "asset_face"
    INNER JOIN "person" ON "person"."personGroupId" = "asset_face"."personGroupId"
    INNER JOIN "pet_search" ON "pet_search"."faceId" = "asset_face"."id"
    WHERE "person"."type" = 'pet'
      AND "person"."name" <> ''
      AND "asset_face"."deletedAt" IS NULL
      AND "asset_face"."isVisible" IS TRUE
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE "pet_recognition_reference"`.execute(db);
}
