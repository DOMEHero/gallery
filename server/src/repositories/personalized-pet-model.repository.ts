import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import type { Insertable, Kysely, Updateable } from 'kysely';
import { DB } from 'src/schema/index.js';
import { PersonalizedPetModelTable } from 'src/schema/tables/personalized-pet-model.table.js';

export type PersonalizedPetModelStatus = PersonalizedPetModelTable['status'];
export type PersonalizedPetModelInsert = Insertable<PersonalizedPetModelTable>;
export type PersonalizedPetModelUpdate = Updateable<PersonalizedPetModelTable>;

export type PersonalizedPetTrainingSample = {
  faceId: string;
  personGroupId: string;
  species: string;
  embedding: string;
  assetId: string;
  fileCreatedAt: Date;
};

@Injectable()
export class PersonalizedPetModelRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  list(ownerId: string) {
    return this.db
      .selectFrom('personalized_pet_model')
      .selectAll()
      .where('ownerId', '=', ownerId)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  get(id: string, ownerId: string) {
    return this.db
      .selectFrom('personalized_pet_model')
      .selectAll()
      .where('id', '=', id)
      .where('ownerId', '=', ownerId)
      .executeTakeFirst();
  }

  getActive(ownerId: string, species: string) {
    return this.db
      .selectFrom('personalized_pet_model')
      .selectAll()
      .where('ownerId', '=', ownerId)
      .where('species', '=', species)
      .where('status', '=', 'active')
      .orderBy('activatedAt', 'desc')
      .executeTakeFirst();
  }

  createTraining(values: Omit<PersonalizedPetModelInsert, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.db.insertInto('personalized_pet_model').values(values).returningAll().executeTakeFirstOrThrow();
  }

  update(id: string, ownerId: string, values: PersonalizedPetModelUpdate) {
    return this.db
      .updateTable('personalized_pet_model')
      .set(values)
      .where('id', '=', id)
      .where('ownerId', '=', ownerId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async activate(id: string, ownerId: string) {
    return this.db.transaction().execute(async (tx) => {
      const model = await tx
        .selectFrom('personalized_pet_model')
        .selectAll()
        .where('id', '=', id)
        .where('ownerId', '=', ownerId)
        .executeTakeFirstOrThrow();
      await tx
        .updateTable('personalized_pet_model')
        .set({ status: 'disabled' })
        .where('ownerId', '=', ownerId)
        .where('species', '=', model.species)
        .where('status', '=', 'active')
        .execute();
      return tx
        .updateTable('personalized_pet_model')
        .set({ status: 'active', activatedAt: new Date(), error: null })
        .where('id', '=', id)
        .where('ownerId', '=', ownerId)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  deactivate(id: string, ownerId: string) {
    return this.update(id, ownerId, { status: 'disabled' });
  }

  getTrainingSpecies(ownerId: string): Promise<string[]> {
    return this.db
      .selectFrom('pet_recognition_reference')
      .innerJoin('asset_face', 'asset_face.id', 'pet_recognition_reference.faceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('person', 'person.personGroupId', 'asset_face.personGroupId')
      .select('person.species')
      .distinct()
      .where('asset.ownerId', '=', ownerId)
      .where('person.ownerId', '=', ownerId)
      .where('person.type', '=', 'pet')
      .where('person.species', 'is not', null)
      .where('asset.deletedAt', 'is', null)
      .where('asset_face.deletedAt', 'is', null)
      .execute()
      .then((rows) => rows.flatMap(({ species }) => (species ? [species] : [])));
  }

  getTrainingSamples(ownerId: string, species: string): Promise<PersonalizedPetTrainingSample[]> {
    return this.db
      .selectFrom('pet_recognition_reference')
      .innerJoin('asset_face', 'asset_face.id', 'pet_recognition_reference.faceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('person', 'person.personGroupId', 'asset_face.personGroupId')
      .innerJoin('pet_search', 'pet_search.faceId', 'asset_face.id')
      .select([
        'asset_face.id as faceId',
        'asset_face.personGroupId',
        'person.species',
        'pet_search.embedding',
        'asset_face.assetId',
        'asset.fileCreatedAt',
      ])
      .where('asset.ownerId', '=', ownerId)
      .where('person.ownerId', '=', ownerId)
      .where('person.type', '=', 'pet')
      .where('person.species', '=', species)
      .where('asset.deletedAt', 'is', null)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .execute() as Promise<PersonalizedPetTrainingSample[]>;
  }
}
