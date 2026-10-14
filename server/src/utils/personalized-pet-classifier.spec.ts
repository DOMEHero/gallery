import { describe, expect, it } from 'vitest';
import {
  PERSONALIZED_PET_EMBEDDING_DIMENSION,
  assertNormalizedPetEmbedding,
  isAcceptedPersonalizedPetPrediction,
  parsePetEmbedding,
  predictPersonalizedPet,
  splitPersonalizedPetSamples,
  trainPersonalizedPetClassifier,
} from 'src/utils/personalized-pet-classifier.js';

const vector = (sign: 1 | -1, index: number) => {
  const values = Array.from({ length: PERSONALIZED_PET_EMBEDDING_DIMENSION }, () => 0);
  values[index] = sign;
  return values;
};

const samples = ['milo', 'luna'].flatMap((personGroupId, classIndex) =>
  Array.from({ length: 12 }, (_, index) => ({
    faceId: `${personGroupId}-${index}`,
    personGroupId,
    species: 'cat',
    embedding: vector(classIndex === 0 ? 1 : -1, 0),
  })),
);

describe('personalized pet classifier', () => {
  it('parses and validates the stored normalized vector format', () => {
    const embedding = parsePetEmbedding(`[${vector(1, 0).join(',')}]`);
    expect(embedding).toHaveLength(PERSONALIZED_PET_EMBEDDING_DIMENSION);
    expect(() => assertNormalizedPetEmbedding(embedding)).not.toThrow();
    expect(() => assertNormalizedPetEmbedding(embedding.map(() => 0))).toThrow();
  });

  it('creates a deterministic per-class split', () => {
    const first = splitPersonalizedPetSamples(samples, 'test-seed');
    const second = splitPersonalizedPetSamples(samples, 'test-seed');
    expect(first.assignments).toEqual(second.assignments);
    expect(first.train).toHaveLength(20);
    expect(first.validation).toHaveLength(2);
    expect(first.test).toHaveLength(2);
  });

  it('requires two identities with the configured trusted sample minimum', () => {
    expect(() =>
      trainPersonalizedPetClassifier({
        samples: samples.slice(0, 12),
        species: 'cat',
        embeddingModel: 'pet-recognition-base',
        version: 'test',
        minSamplesPerClass: 10,
      }),
    ).toThrow(/two pets/);
  });

  it('trains a linear head and predicts the held-out identities', () => {
    const result = trainPersonalizedPetClassifier({
      samples,
      species: 'cat',
      embeddingModel: 'pet-recognition-base',
      version: 'test',
      minSamplesPerClass: 10,
      epochs: 50,
    });
    expect(result.model.classes).toEqual(['luna', 'milo']);
    expect(result.metrics.test.accuracy).toBe(1);
    expect(predictPersonalizedPet(result.model, vector(1, 0))?.personGroupId).toBe('milo');
  });

  it('rejects low-confidence or ambiguous predictions', () => {
    const prediction = {
      personGroupId: 'milo',
      probability: 0.7,
      secondProbability: 0.6,
      margin: 0.1,
      probabilities: {},
    };
    expect(isAcceptedPersonalizedPetPrediction(prediction, 0.75, 0.05)).toBe(false);
    expect(isAcceptedPersonalizedPetPrediction(prediction, 0.65, 0.15)).toBe(false);
    expect(isAcceptedPersonalizedPetPrediction(prediction, 0.65, 0.05)).toBe(true);
  });
});
