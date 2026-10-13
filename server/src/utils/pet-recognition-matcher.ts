export interface TrustedPetReference {
  faceId: string;
  personGroupId: string;
  name: string;
  embedding: string;
  /** Optional in old exports; production retrieval supplies the detector species. */
  species?: string | null;
  /** Internal cache populated once per reference-version refresh. */
  embeddingVector?: number[];
}

export interface PetRecognitionMatchConfig {
  identityMargin: number;
  maxDistance: number;
  referenceTopK: number;
}

export interface PetIdentityMatchScore {
  distance: number;
  name: string;
  personGroupId: string;
  referenceCount: number;
  scoredReferenceCount: number;
}

export interface KnownPetMatchResult {
  best?: PetIdentityMatchScore;
  /** Sorted shortlist reserved for an optional expensive local-reranking stage. */
  candidates: PetIdentityMatchScore[];
  decision: 'matched' | 'ambiguous' | 'unknown';
  trustedReferenceCount: number;
  margin?: number;
  second?: PetIdentityMatchScore;
}

/** Keep the expensive second stage bounded without changing global scoring. */
export const PET_RECOGNITION_CANDIDATE_COUNT = 5;

export interface PetRecognitionEvaluationExample {
  embedding: string;
  expectedPersonGroupId: string | null;
  faceId: string;
}

export interface PetRecognitionEvaluation {
  accuracy: number;
  confusionMatrix: Record<string, Record<string, number>>;
  falseRejectRate: number;
  falseMatchRate: number;
  knownExampleCount: number;
  matchedCount: number;
  perIdentityRecall: Record<string, number>;
  totalCount: number;
  unknownRejectionRate: number;
}

export interface PetRecognitionCalibrationPair {
  leftFaceId: string;
  rightFaceId: string;
  /** 1 means the references belong to the same confirmed identity. */
  label: 0 | 1;
  species: string;
  distance: number;
}

export interface PetRecognitionCalibrationPairOptions {
  /** Caps pairwise work for large exports; references are sampled deterministically before ranking. */
  maxNegativeComparisonsPerReference?: number;
  maxHardNegativesPerReference?: number;
  maxPositivePairsPerIdentity?: number;
}

export interface PetRecognitionEvaluationGridEntry {
  evaluation: PetRecognitionEvaluation;
  identityMargin: number;
  maxDistance: number;
}

// Representative references are not used by the global decision path. They remain available for
// the optional local-reranking stage, where a bounded number of real crops keeps comparisons cheap.
const maximumReferencesBeforePrototypes = 10;

const parseEmbedding = (raw: string): number[] => raw.replaceAll(/\[|]/g, '').split(',').map(Number);

export const preparePetRecognitionReferences = (references: TrustedPetReference[]): TrustedPetReference[] =>
  references.map((reference) => ({ ...reference, embeddingVector: parseEmbedding(reference.embedding) }));

const cosineDistance = (a: number[], b: number[]): number => {
  if (a.length !== b.length || a.length === 0) {
    throw new Error('Pet recognition embeddings must have the same non-zero dimension');
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index++) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (normA === 0 || normB === 0) {
    throw new Error('Pet recognition embeddings must not be zero vectors');
  }

  // PostgreSQL's `<=>` operator is cosine distance (1 - cosine similarity). Calculate the
  // same metric here rather than assuming that the model's persisted vectors are unit-normalized.
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

const closestToCentroid = (embeddings: number[][]): number => {
  const centroid = Array.from({ length: embeddings[0].length }, () => 0);
  for (const embedding of embeddings) {
    for (let index = 0; index < embedding.length; index++) {
      centroid[index] += embedding[index];
    }
  }

  let bestIndex = 0;
  let bestDistance = Infinity;
  for (const [index, embedding] of embeddings.entries()) {
    const distance = cosineDistance(embedding, centroid);
    if (!(distance < bestDistance)) {
      continue;
    }

    bestDistance = distance;
    bestIndex = index;
  }
  return bestIndex;
};

/**
 * Returns real reference embeddings rather than averaged vectors. The centroid starts farthest-point
 * sampling in the densest appearance mode, then each next prototype covers the most distinct remaining
 * mode. This is O(n * prototypes), deterministic, and needs no additional ML dependency.
 */
const representativeReferences = (references: TrustedPetReference[], maxPrototypes: number) => {
  if (references.length <= maximumReferencesBeforePrototypes) {
    return references;
  }

  const prototypeCount = Math.min(maxPrototypes, references.length);
  const embeddings = references.map(({ embedding }) => parseEmbedding(embedding));
  const selected = [closestToCentroid(embeddings)];

  while (selected.length < prototypeCount) {
    let farthestIndex = -1;
    let farthestNearestDistance = -Infinity;
    for (const [index, embedding] of embeddings.entries()) {
      if (selected.includes(index)) {
        continue;
      }
      const nearestDistance = Math.min(
        ...selected.map((selectedIndex) => cosineDistance(embedding, embeddings[selectedIndex])),
      );
      if (!(nearestDistance > farthestNearestDistance)) {
        continue;
      }

      farthestNearestDistance = nearestDistance;
      farthestIndex = index;
    }
    selected.push(farthestIndex);
  }

  return selected.map((index) => references[index]);
};

/**
 * Prepares a compact, real-vector representation for each identity. Callers can cache this result
 * while the trusted-reference version is unchanged, so prototype selection is not repeated for
 * every detection.
 */
export const getPetRecognitionPrototypes = (references: TrustedPetReference[], maxPrototypes: number) => {
  const referencesByPerson = Map.groupBy(references, ({ personGroupId }) => personGroupId);

  return referencesByPerson
    .values()
    .flatMap((personReferences) => representativeReferences(personReferences, maxPrototypes))
    .toArray();
};

/**
 * Scores only trusted, species-filtered references. It deliberately does not promote a matched
 * detection: automatic matches remain ordinary clustering output until a user confirms them.
 */
export const matchKnownPet = (
  queryEmbedding: string,
  references: TrustedPetReference[],
  config: PetRecognitionMatchConfig,
): KnownPetMatchResult => {
  const query = parseEmbedding(queryEmbedding);
  const referencesByPerson = Map.groupBy(references, ({ personGroupId }) => personGroupId);

  const scores: PetIdentityMatchScore[] = [];
  for (const [personGroupId, personReferences] of referencesByPerson) {
    // Score the complete trusted reference set. Representative/medoid selection is deliberately
    // kept as a separate optional optimisation for a future local-feature stage: using it here
    // would discard confirmed appearance modes before the cheap global matcher has seen them.
    const distances = personReferences
      .map(({ embedding, embeddingVector }) => cosineDistance(query, embeddingVector ?? parseEmbedding(embedding)))
      .toSorted((a, b) => a - b);
    const topK = distances.slice(0, Math.min(config.referenceTopK, distances.length));
    scores.push({
      distance: mean(topK),
      name: personReferences[0].name,
      personGroupId,
      referenceCount: personReferences.length,
      scoredReferenceCount: personReferences.length,
    });
  }

  scores.sort((left, right) => left.distance - right.distance);
  const [best, second] = scores;
  const candidates = scores.slice(0, PET_RECOGNITION_CANDIDATE_COUNT);
  const trustedReferenceCount = references.length;
  if (!best || best.distance > config.maxDistance) {
    return { best, candidates, second, trustedReferenceCount, decision: 'unknown' };
  }

  const margin = second ? second.distance - best.distance : undefined;
  if (second && margin! < config.identityMargin) {
    return { best, candidates, second, margin, trustedReferenceCount, decision: 'ambiguous' };
  }

  return { best, candidates, second, margin, trustedReferenceCount, decision: 'matched' };
};

/**
 * A developer-side evaluation primitive for labelled reference JSON. Each example is held out from
 * its own reference pool, preventing train/test leakage while callers sweep threshold and margin.
 */
export const evaluatePetRecognitionMatches = (
  examples: PetRecognitionEvaluationExample[],
  references: TrustedPetReference[],
  config: PetRecognitionMatchConfig,
): PetRecognitionEvaluation => {
  let correctMatches = 0;
  let falseMatches = 0;
  let knownExamples = 0;
  let matched = 0;
  let falseRejects = 0;
  let rejectedUnknowns = 0;
  let unknownExamples = 0;
  const expectedCounts = new Map<string, number>();
  const correctCounts = new Map<string, number>();
  const confusionMatrix: Record<string, Record<string, number>> = {};

  for (const example of examples) {
    const match = matchKnownPet(
      example.embedding,
      references.filter((reference) => reference.faceId !== example.faceId),
      config,
    );
    if (example.expectedPersonGroupId) {
      knownExamples++;
      expectedCounts.set(example.expectedPersonGroupId, (expectedCounts.get(example.expectedPersonGroupId) ?? 0) + 1);
      const predicted = match.decision === 'matched' ? (match.best?.personGroupId ?? 'unknown') : 'unknown';
      const row = (confusionMatrix[example.expectedPersonGroupId] ??= {});
      row[predicted] = (row[predicted] ?? 0) + 1;
      if (match.decision === 'matched') {
        matched++;
        if (match.best?.personGroupId === example.expectedPersonGroupId) {
          correctMatches++;
          correctCounts.set(example.expectedPersonGroupId, (correctCounts.get(example.expectedPersonGroupId) ?? 0) + 1);
        } else {
          falseMatches++;
        }
      } else {
        falseRejects++;
      }
    } else {
      unknownExamples++;
      const row = (confusionMatrix.unknown ??= {});
      const predicted = match.decision === 'matched' ? (match.best?.personGroupId ?? 'unknown') : 'unknown';
      row[predicted] = (row[predicted] ?? 0) + 1;
      if (match.decision === 'matched') {
        falseMatches++;
      } else {
        rejectedUnknowns++;
      }
    }
  }

  return {
    accuracy: knownExamples === 0 ? 0 : correctMatches / knownExamples,
    confusionMatrix,
    falseMatchRate: examples.length === 0 ? 0 : falseMatches / examples.length,
    falseRejectRate: knownExamples === 0 ? 0 : falseRejects / knownExamples,
    knownExampleCount: knownExamples,
    matchedCount: matched,
    perIdentityRecall: Object.fromEntries(
      expectedCounts
        .entries()
        .map(([personGroupId, count]) => [personGroupId, (correctCounts.get(personGroupId) ?? 0) / count]),
    ),
    totalCount: examples.length,
    unknownRejectionRate: unknownExamples === 0 ? 0 : rejectedUnknowns / unknownExamples,
  };
};

/**
 * Builds a bounded, deterministic calibration set from confirmed references. Positives are sampled
 * within each identity. Negatives are the nearest references from another identity of the same
 * species, which gives calibration useful hard cases instead of easy cat-vs-dog pairs. The caller
 * can fit a logistic/isotonic model on `distance` without adding a runtime ML dependency.
 */
export const buildPetRecognitionCalibrationPairs = (
  references: TrustedPetReference[],
  {
    maxNegativeComparisonsPerReference = 512,
    maxHardNegativesPerReference = 3,
    maxPositivePairsPerIdentity = 100,
  }: PetRecognitionCalibrationPairOptions = {},
): PetRecognitionCalibrationPair[] => {
  const byIdentity = Map.groupBy(
    references,
    (reference) => `${reference.species ?? 'unknown'}:${reference.personGroupId}`,
  );
  const bySpecies = Map.groupBy(references, (reference) => reference.species ?? 'unknown');
  const pairs: PetRecognitionCalibrationPair[] = [];
  const seen = new Set<string>();
  const addPair = (left: TrustedPetReference, right: TrustedPetReference, label: 0 | 1) => {
    if (left.faceId === right.faceId) {
      return;
    }
    const [first, second] = [left.faceId, right.faceId].toSorted();
    const key = `${first}:${second}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    pairs.push({
      distance: cosineDistance(parseEmbedding(left.embedding), parseEmbedding(right.embedding)),
      label,
      leftFaceId: first,
      rightFaceId: second,
      species: left.species ?? right.species ?? 'unknown',
    });
  };

  for (const identityReferences of byIdentity.values()) {
    let added = 0;
    for (let leftIndex = 0; leftIndex < identityReferences.length && added < maxPositivePairsPerIdentity; leftIndex++) {
      // Pair nearby list positions first; callers can shuffle their export before invoking this helper
      // when they want date/event-stratified positives.
      for (let rightIndex = leftIndex + 1; rightIndex < identityReferences.length; rightIndex++) {
        addPair(identityReferences[leftIndex], identityReferences[rightIndex], 1);
        added++;
        if (added >= maxPositivePairsPerIdentity) {
          break;
        }
      }
    }
  }

  for (const speciesReferences of bySpecies.values()) {
    for (const reference of speciesReferences) {
      const otherReferences = speciesReferences.filter(
        (candidate) => candidate.personGroupId !== reference.personGroupId,
      );
      const stride = Math.max(1, Math.ceil(otherReferences.length / maxNegativeComparisonsPerReference));
      const comparisonPool = otherReferences
        .filter((_, index) => index % stride === 0)
        .slice(0, maxNegativeComparisonsPerReference);
      const nearestHardNegatives = comparisonPool
        .map((candidate) => ({
          candidate,
          distance: cosineDistance(parseEmbedding(reference.embedding), parseEmbedding(candidate.embedding)),
        }))
        .toSorted((left, right) => left.distance - right.distance)
        .slice(0, maxHardNegativesPerReference);
      for (const { candidate } of nearestHardNegatives) {
        addPair(reference, candidate, 0);
      }
    }
  }

  return pairs;
};

/**
 * Evaluates a threshold × ambiguity-margin grid without model inference. A small developer script
 * can load labelled detections from a database export and call this function to tune the existing
 * DINOv2 embedding space for a particular library.
 */
export const evaluatePetRecognitionGrid = (
  examples: PetRecognitionEvaluationExample[],
  references: TrustedPetReference[],
  config: Omit<PetRecognitionMatchConfig, 'identityMargin' | 'maxDistance'>,
  { identityMargins, maxDistances }: { identityMargins: number[]; maxDistances: number[] },
): PetRecognitionEvaluationGridEntry[] => {
  const entries: PetRecognitionEvaluationGridEntry[] = [];
  for (const maxDistance of maxDistances) {
    for (const identityMargin of identityMargins) {
      entries.push({
        evaluation: evaluatePetRecognitionMatches(examples, references, {
          ...config,
          identityMargin,
          maxDistance,
        }),
        identityMargin,
        maxDistance,
      });
    }
  }
  return entries;
};
