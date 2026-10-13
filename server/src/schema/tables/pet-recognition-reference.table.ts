import { CreateDateColumn, ForeignKeyColumn, type Generated, Table, Timestamp } from '@immich/sql-tools';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';

/**
 * A user-confirmed pet example. The vector remains in `pet_search`; this table only records which
 * existing detection embeddings are safe to use as supervised identity references.
 */
@Table({ name: 'pet_recognition_reference' })
export class PetRecognitionReferenceTable {
  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', primary: true })
  faceId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
