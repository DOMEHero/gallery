/**
 * Small, deterministic personalized pet classifier.
 *
 * This intentionally contains no model or image-processing code. Pet embeddings are produced by
 * the existing ML service and are treated as immutable, L2-normalized feature vectors. The only
 * learned parameters are a linear softmax head (one row per trusted pet identity).
 */

export const PERSONALIZED_PET_EMBEDDING_DIMENSION = 512;
export const PERSONALIZED_PET_DEFAULT_MIN_SAMPLES = 10;

export type PersonalizedPetSample = {
  faceId: string;
  personGroupId: string;
  species: string;
  embedding: number[];
  assetId?: string;
  fileCreatedAt?: string;
};

export type PersonalizedPetSplit = {
  train: PersonalizedPetSample[];
  validation: PersonalizedPetSample[];
  test: PersonalizedPetSample[];
  assignments: Record<string, 'train' | 'validation' | 'test'>;
  seed: string;
};

export type PersonalizedPetPrediction = {
  personGroupId: string;
  probability: number;
  secondProbability: number;
  margin: number;
  probabilities: Record<string, number>;
};

export type PersonalizedPetMetrics = {
  accuracy: number;
  macroRecall: number;
  loss: number;
  sampleCount: number;
  confusion: Record<string, Record<string, number>>;
};

export type PersonalizedPetClassifierModel = {
  version: string;
  species: string;
  embeddingModel: string;
  embeddingDimension: number;
  normalization: 'l2';
  classes: string[];
  weights: number[][];
  bias: number[];
  metrics: { validation?: PersonalizedPetMetrics; test?: PersonalizedPetMetrics };
  hyperparameters: {
    seed: string;
    learningRate: number;
    weightDecay: number;
    epochs: number;
    patience: number;
    minSamplesPerClass: number;
  };
};

export type PersonalizedPetTrainingResult = {
  model: PersonalizedPetClassifierModel;
  split: PersonalizedPetSplit;
  classCounts: Record<string, number>;
  metrics: { validation: PersonalizedPetMetrics; test: PersonalizedPetMetrics };
};

const EPSILON = 1e-12;

export function parsePetEmbedding(
  value: string | number[],
  dimension = PERSONALIZED_PET_EMBEDDING_DIMENSION,
): number[] {
  const values = Array.isArray(value)
    ? value
    : value
        .trim()
        .replace(/^\[/, '')
        .replace(/\]$/, '')
        .split(',')
        .filter((part) => part.trim().length > 0)
        .map((part) => Number(part.trim()));

  if (values.length !== dimension || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid pet embedding: expected ${dimension} finite values`);
  }

  return values;
}

export function assertNormalizedPetEmbedding(embedding: number[], tolerance = 0.02): void {
  const norm = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm < EPSILON || Math.abs(norm - 1) > tolerance) {
    throw new Error(`Pet embedding is not L2-normalized (norm=${norm})`);
  }
}

function hash(value: string): number {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.codePointAt(0) ?? 0;
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

/** Split per identity, so every eligible class contributes to every evaluation tier. */
export function splitPersonalizedPetSamples(samples: PersonalizedPetSample[], seed: string): PersonalizedPetSplit {
  const assignments: PersonalizedPetSplit['assignments'] = {};
  const train: PersonalizedPetSample[] = [];
  const validation: PersonalizedPetSample[] = [];
  const test: PersonalizedPetSample[] = [];
  const byClass = Map.groupBy(samples, (sample) => sample.personGroupId);

  for (const [personGroupId, classSamples] of byClass) {
    const groups = Map.groupBy(classSamples, (sample) => sample.assetId ?? sample.faceId);
    const orderedGroups = [...groups].sort(([, left], [, right]) => {
      const leftSample = left[0];
      const rightSample = right[0];
      const leftKey = `${seed}:${leftSample.fileCreatedAt ?? ''}:${leftSample.faceId}`;
      const rightKey = `${seed}:${rightSample.fileCreatedAt ?? ''}:${rightSample.faceId}`;
      return hash(leftKey) - hash(rightKey) || leftSample.faceId.localeCompare(rightSample.faceId);
    });
    const testCount = Math.max(1, Math.floor(classSamples.length * 0.15));
    const validationCount = Math.max(1, Math.floor(classSamples.length * 0.15));
    let testRemaining = testCount;
    let validationRemaining = validationCount;
    for (const [, group] of orderedGroups) {
      const split =
        testRemaining >= group.length && testRemaining > 0
          ? 'test'
          : validationRemaining >= group.length && validationRemaining > 0
            ? 'validation'
            : 'train';
      testRemaining -= split === 'test' ? group.length : 0;
      validationRemaining -= split === 'validation' ? group.length : 0;
      for (const sample of group) {
        assignments[sample.faceId] = split;
        (split === 'test' ? test : split === 'validation' ? validation : train).push(sample);
      }
    }
    if (train.filter((sample) => sample.personGroupId === personGroupId).length === 0) {
      throw new Error(`Identity ${personGroupId} has no training samples`);
    }
  }

  return { train, validation, test, assignments, seed };
}

function softmax(logits: number[]): number[] {
  const maximum = Math.max(...logits);
  const exponentials = logits.map((logit) => Math.exp(logit - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function logits(model: Pick<PersonalizedPetClassifierModel, 'weights' | 'bias'>, embedding: number[]): number[] {
  return model.weights.map((weights, classIndex) => {
    let value = model.bias[classIndex];
    for (let index = 0; index < embedding.length; index++) {
      value += weights[index] * embedding[index];
    }
    return value;
  });
}

export function predictPersonalizedPet(
  model: PersonalizedPetClassifierModel,
  embedding: number[],
): PersonalizedPetPrediction | undefined {
  parsePetEmbedding(embedding, model.embeddingDimension);
  assertNormalizedPetEmbedding(embedding);
  const probabilities = softmax(logits(model, embedding));
  const ranked = probabilities
    .map((probability, index) => ({ probability, index }))
    .sort((left, right) => right.probability - left.probability);
  const best = ranked[0];
  if (!best) {
    return undefined;
  }
  const secondProbability = ranked[1]?.probability ?? 0;
  return {
    personGroupId: model.classes[best.index],
    probability: best.probability,
    secondProbability,
    margin: best.probability - secondProbability,
    probabilities: Object.fromEntries(
      model.classes.map((personGroupId, index) => [personGroupId, probabilities[index]]),
    ),
  };
}

export function isAcceptedPersonalizedPetPrediction(
  prediction: PersonalizedPetPrediction | undefined,
  minProbability: number,
  minMargin: number,
): prediction is PersonalizedPetPrediction {
  return Boolean(
    prediction &&
    Number.isFinite(prediction.probability) &&
    Number.isFinite(prediction.margin) &&
    prediction.probability >= minProbability &&
    prediction.margin >= minMargin,
  );
}

function metricsFor(model: PersonalizedPetClassifierModel, samples: PersonalizedPetSample[]): PersonalizedPetMetrics {
  const confusion: Record<string, Record<string, number>> = {};
  let correct = 0;
  let loss = 0;
  const recalls: number[] = [];
  for (const sample of samples) {
    const prediction = predictPersonalizedPet(model, sample.embedding);
    if (!prediction) {
      continue;
    }
    const actual = sample.personGroupId;
    const predicted = prediction.personGroupId;
    confusion[actual] ??= {};
    confusion[actual][predicted] = (confusion[actual][predicted] ?? 0) + 1;
    correct += actual === predicted ? 1 : 0;
    loss -= Math.log(Math.max(prediction.probabilities[actual] ?? EPSILON, EPSILON));
  }
  for (const classId of model.classes) {
    const row = confusion[classId] ?? {};
    const total = Object.values(row).reduce((sum, value) => sum + value, 0);
    recalls.push(total === 0 ? 0 : (row[classId] ?? 0) / total);
  }
  return {
    accuracy: samples.length === 0 ? 0 : correct / samples.length,
    macroRecall: recalls.length === 0 ? 0 : recalls.reduce((sum, value) => sum + value, 0) / recalls.length,
    loss: samples.length === 0 ? 0 : loss / samples.length,
    sampleCount: samples.length,
    confusion,
  };
}

function cloneModel(model: PersonalizedPetClassifierModel): PersonalizedPetClassifierModel {
  return structuredClone(model);
}

export function trainPersonalizedPetClassifier({
  samples,
  species,
  embeddingModel,
  version,
  seed = 'gallery-personalized-pet-v1',
  minSamplesPerClass = PERSONALIZED_PET_DEFAULT_MIN_SAMPLES,
  learningRate = 0.05,
  weightDecay = 0.0001,
  epochs = 120,
  patience = 12,
}: {
  samples: PersonalizedPetSample[];
  species: string;
  embeddingModel: string;
  version: string;
  seed?: string;
  minSamplesPerClass?: number;
  learningRate?: number;
  weightDecay?: number;
  epochs?: number;
  patience?: number;
}): PersonalizedPetTrainingResult {
  const classCounts: Record<string, number> = {};
  for (const sample of samples) {
    const embedding = parsePetEmbedding(sample.embedding);
    assertNormalizedPetEmbedding(embedding);
    classCounts[sample.personGroupId] = (classCounts[sample.personGroupId] ?? 0) + 1;
  }
  const eligible = Object.entries(classCounts)
    .filter(([, count]) => count >= minSamplesPerClass)
    .map(([classId]) => classId)
    .sort();
  if (eligible.length < 2) {
    throw new Error(`At least two pets with ${minSamplesPerClass} trusted samples are required`);
  }
  const eligibleSet = new Set(eligible);
  const filtered = samples.filter((sample) => eligibleSet.has(sample.personGroupId));
  const split = splitPersonalizedPetSamples(filtered, seed);
  const dimension = parsePetEmbedding(filtered[0].embedding).length;
  const model: PersonalizedPetClassifierModel = {
    version,
    species,
    embeddingModel,
    embeddingDimension: dimension,
    normalization: 'l2',
    classes: eligible,
    weights: eligible.map(() => Array.from({ length: dimension }, () => 0)),
    bias: eligible.map(() => 0),
    metrics: {},
    hyperparameters: { seed, learningRate, weightDecay, epochs, patience, minSamplesPerClass },
  };
  const classIndex = new Map(eligible.map((classId, index) => [classId, index]));
  const counts = new Map(
    eligible.map((classId) => [classId, split.train.filter((sample) => sample.personGroupId === classId).length]),
  );
  const total = split.train.length;
  const bestWeights = cloneModel(model);
  let bestLoss = Infinity;
  let stale = 0;
  const firstMoment = model.weights.map((row) => row.map(() => 0));
  const secondMoment = model.weights.map((row) => row.map(() => 0));
  const biasFirst = model.bias.map(() => 0);
  const biasSecond = model.bias.map(() => 0);

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradients = model.weights.map((row) => row.map(() => 0));
    const biasGradient = model.bias.map(() => 0);
    for (const sample of split.train) {
      const probabilities = softmax(logits(model, sample.embedding));
      const target = classIndex.get(sample.personGroupId);
      if (target === undefined) {
        continue;
      }
      const sampleWeight = total / (eligible.length * (counts.get(sample.personGroupId) ?? 1));
      for (let classNumber = 0; classNumber < eligible.length; classNumber++) {
        const gradient = (probabilities[classNumber] - (classNumber === target ? 1 : 0)) * sampleWeight;
        biasGradient[classNumber] += gradient;
        for (let dimensionIndex = 0; dimensionIndex < dimension; dimensionIndex++) {
          gradients[classNumber][dimensionIndex] += gradient * sample.embedding[dimensionIndex];
        }
      }
    }
    for (let classNumber = 0; classNumber < eligible.length; classNumber++) {
      const biasGradientValue = biasGradient[classNumber] / Math.max(split.train.length, 1);
      biasFirst[classNumber] = 0.9 * biasFirst[classNumber] + 0.1 * biasGradientValue;
      biasSecond[classNumber] = 0.999 * biasSecond[classNumber] + 0.001 * biasGradientValue ** 2;
      model.bias[classNumber] -= (learningRate * biasFirst[classNumber]) / (Math.sqrt(biasSecond[classNumber]) + 1e-8);
      for (let dimensionIndex = 0; dimensionIndex < dimension; dimensionIndex++) {
        const gradient = gradients[classNumber][dimensionIndex] / Math.max(split.train.length, 1);
        firstMoment[classNumber][dimensionIndex] = 0.9 * firstMoment[classNumber][dimensionIndex] + 0.1 * gradient;
        secondMoment[classNumber][dimensionIndex] =
          0.999 * secondMoment[classNumber][dimensionIndex] + 0.001 * gradient ** 2;
        model.weights[classNumber][dimensionIndex] =
          (1 - learningRate * weightDecay) * model.weights[classNumber][dimensionIndex] -
          (learningRate * firstMoment[classNumber][dimensionIndex]) /
            (Math.sqrt(secondMoment[classNumber][dimensionIndex]) + 1e-8);
      }
    }
    const validation = metricsFor(model, split.validation);
    if (validation.loss < bestLoss - 1e-7) {
      bestLoss = validation.loss;
      Object.assign(bestWeights, cloneModel(model));
      stale = 0;
    } else {
      stale++;
      if (stale >= patience) {
        break;
      }
    }
  }
  Object.assign(model, bestWeights);
  const metrics = { validation: metricsFor(model, split.validation), test: metricsFor(model, split.test) };
  model.metrics = metrics;
  return { model, split, classCounts, metrics };
}
