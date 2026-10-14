import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/** A versioned, user-owned linear classifier trained only from trusted pet references. */
@Table('personalized_pet_model')
@UpdatedAtTrigger('personalized_pet_model_updatedAt')
@Index({ name: 'personalized_pet_model_owner_species_idx', columns: ['ownerId', 'species'] })
@Index({ name: 'personalized_pet_model_owner_status_idx', columns: ['ownerId', 'status'] })
@Index({
  name: 'personalized_pet_model_active_key',
  columns: ['ownerId', 'species'],
  unique: true,
  where: '"status" = \'active\'',
})
export class PersonalizedPetModelTable {
  @PrimaryGeneratedColumn('uuid')
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  ownerId!: string;

  @Column({ type: 'text' })
  species!: string;

  @Column({ type: 'text' })
  version!: string;

  @Column({ type: 'text' })
  status!: 'training' | 'candidate' | 'active' | 'disabled' | 'failed';

  @Column({ type: 'text' })
  embeddingModel!: string;

  @Column({ type: 'integer' })
  embeddingDimension!: number;

  @Column({ type: 'text' })
  normalization!: 'l2';

  @Column({ type: 'jsonb' })
  classes!: string[];

  @Column({ type: 'jsonb' })
  weights!: number[][];

  @Column({ type: 'jsonb' })
  bias!: number[];

  @Column({ type: 'jsonb', nullable: true })
  metrics!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  activatedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
