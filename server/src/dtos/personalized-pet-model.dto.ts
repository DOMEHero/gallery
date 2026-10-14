import { createZodDto } from 'nestjs-zod';
import z from 'zod';

const PersonalizedPetModelResponseSchema = z
  .object({
    id: z.uuidv4(),
    species: z.string(),
    version: z.string(),
    status: z.enum(['training', 'candidate', 'active', 'disabled', 'failed']),
    embeddingModel: z.string(),
    embeddingDimension: z.number().int(),
    normalization: z.literal('l2'),
    classes: z.array(z.string()),
    metrics: z.record(z.string(), z.unknown()).nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable(),
    error: z.string().nullable(),
    activatedAt: z.string().meta({ format: 'date-time' }).nullable(),
    createdAt: z.string().meta({ format: 'date-time' }),
    updatedAt: z.string().meta({ format: 'date-time' }),
  })
  .meta({ id: 'PersonalizedPetModelResponseDto' });

export class PersonalizedPetModelResponseDto extends createZodDto(PersonalizedPetModelResponseSchema) {}

export const PersonalizedPetModelListResponseSchema = z.array(PersonalizedPetModelResponseSchema).meta({
  id: 'PersonalizedPetModelListResponseDto',
});

export class PersonalizedPetModelListResponseDto extends createZodDto(PersonalizedPetModelListResponseSchema) {}
