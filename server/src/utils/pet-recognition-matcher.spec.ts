import {
  type PetRecognitionMatchConfig,
  type TrustedPetReference,
  buildPetRecognitionCalibrationPairs,
  evaluatePetRecognitionMatches,
  matchKnownPet,
} from 'src/utils/pet-recognition-matcher.js';

const config: PetRecognitionMatchConfig = {
  identityMargin: 0.05,
  maxDistance: 0.3,
  referenceTopK: 3,
};

const reference = (faceId: string, personGroupId: string, embedding: string): TrustedPetReference => ({
  embedding,
  faceId,
  name: personGroupId,
  personGroupId,
});

describe('matchKnownPet', () => {
  it('selects the correct identity from several confirmed examples', () => {
    const result = matchKnownPet(
      '[0.99,0.1]',
      [
        reference('a-1', 'cat-a', '[1,0]'),
        reference('a-2', 'cat-a', '[0.98,0.2]'),
        reference('b-1', 'cat-b', '[0,1]'),
        reference('b-2', 'cat-b', '[0.2,0.98]'),
      ],
      config,
    );

    expect(result).toMatchObject({ decision: 'matched', best: { personGroupId: 'cat-a' } });
  });

  it('rejects an ambiguous runner-up even when the closest identity clears the absolute threshold', () => {
    const result = matchKnownPet(
      '[1,0]',
      [reference('a-1', 'cat-a', '[1,0]'), reference('b-1', 'cat-b', '[0.999,0.045]')],
      config,
    );

    expect(result).toMatchObject({ decision: 'ambiguous', best: { personGroupId: 'cat-a' } });
  });

  it('rejects a query that is too distant from every confirmed identity', () => {
    const result = matchKnownPet(
      '[0,1]',
      [reference('a-1', 'cat-a', '[1,0]'), reference('b-1', 'cat-b', '[0.9,0.1]')],
      config,
    );

    expect(result).toMatchObject({ decision: 'unknown' });
  });

  it('uses one confirmed reference and averages only the closest top-k references', () => {
    const oneReference = matchKnownPet('[1,0]', [reference('a-1', 'cat-a', '[1,0]')], config);
    const topK = matchKnownPet(
      '[1,0]',
      [reference('a-1', 'cat-a', '[1,0]'), reference('a-2', 'cat-a', '[0.8,0.6]'), reference('a-3', 'cat-a', '[0,1]')],
      { ...config, identityMargin: 0, referenceTopK: 2 },
    );

    expect(oneReference).toMatchObject({ decision: 'matched', best: { personGroupId: 'cat-a' } });
    expect(topK.best?.distance).toBeCloseTo(0.1, 5);
  });

  it('scores every trusted reference while averaging only the closest top-k', () => {
    const references = [
      reference('front', 'cat-a', '[1,0]'),
      ...Array.from({ length: 10 }, (_, index) => reference(`side-${index}`, 'cat-a', '[0,1]')),
    ];

    const result = matchKnownPet('[0,1]', references, { ...config, referenceTopK: 1 });

    expect(result).toMatchObject({ decision: 'matched', best: { personGroupId: 'cat-a', scoredReferenceCount: 11 } });
  });

  it('holds each labelled detection out of its own reference pool during evaluation', () => {
    const evaluation = evaluatePetRecognitionMatches(
      [{ embedding: '[1,0]', expectedPersonGroupId: 'cat-a', faceId: 'a-1' }],
      [reference('a-1', 'cat-a', '[1,0]')],
      config,
    );

    expect(evaluation).toMatchObject({ accuracy: 0, knownExampleCount: 1, matchedCount: 0 });
  });

  it('reports per-identity recall and false rejects for threshold tuning', () => {
    const evaluation = evaluatePetRecognitionMatches(
      [
        { embedding: '[1,0]', expectedPersonGroupId: 'cat-a', faceId: 'query-a' },
        { embedding: '[0,1]', expectedPersonGroupId: 'cat-b', faceId: 'query-b' },
      ],
      [reference('a-1', 'cat-a', '[0.707,0.707]'), reference('b-1', 'cat-b', '[0.707,0.707]')],
      { ...config, maxDistance: 0.01 },
    );

    expect(evaluation).toMatchObject({
      falseRejectRate: 1,
      perIdentityRecall: { 'cat-a': 0, 'cat-b': 0 },
      confusionMatrix: {
        'cat-a': { unknown: 1 },
        'cat-b': { unknown: 1 },
      },
    });
  });

  it('builds same-species hard negatives without creating cat-dog pairs', () => {
    const pairs = buildPetRecognitionCalibrationPairs([
      { ...reference('cat-a', 'a', '[1,0]'), species: 'cat' },
      { ...reference('cat-b', 'b', '[0.99,0.1]'), species: 'cat' },
      { ...reference('dog-a', 'd', '[0,1]'), species: 'dog' },
      { ...reference('dog-b', 'e', '[0.1,0.99]'), species: 'dog' },
    ]);

    expect(pairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 0, species: 'cat' }),
        expect.objectContaining({ label: 0, species: 'dog' }),
      ]),
    );
    expect(
      pairs.some(({ leftFaceId, rightFaceId }) => leftFaceId.startsWith('cat') && rightFaceId.startsWith('dog')),
    ).toBe(false);
  });
});
