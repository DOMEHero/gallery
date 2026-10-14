import { BadRequestException, Injectable } from '@nestjs/common';
import type { JobOf } from 'src/types.js';
import { OnJob } from 'src/decorators.js';
import { JobName, JobStatus, QueueName } from 'src/enum.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { PersonalizedPetModelRepository } from 'src/repositories/personalized-pet-model.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { getConfig } from 'src/utils/config.js';
import { isRecognizablePetSpecies } from 'src/utils/misc.js';
import {
  PERSONALIZED_PET_DEFAULT_MIN_SAMPLES,
  PersonalizedPetClassifierModel,
  PersonalizedPetPrediction,
  isAcceptedPersonalizedPetPrediction,
  parsePetEmbedding,
  predictPersonalizedPet,
  trainPersonalizedPetClassifier,
} from 'src/utils/personalized-pet-classifier.js';
import {
  evaluatePetRecognitionMatches,
  matchKnownPet,
  preparePetRecognitionReferences,
} from 'src/utils/pet-recognition-matcher.js';

type PersonalizedPetConfig = {
  modelName: string;
  maxDistance: number;
  identityMargin: number;
  referenceTopK: number;
  personalizedClassifierEnabled: boolean;
  personalizedClassifierMinSamples: number;
  personalizedClassifierMinProbability: number;
  personalizedClassifierMinMargin: number;
  personalizedClassifierReferenceValidation: boolean;
};

@Injectable()
export class PersonalizedPetClassifierService {
  constructor(
    private logger: LoggingRepository,
    private configRepository: ConfigRepository,
    private systemMetadataRepository: SystemMetadataRepository,
    private jobRepository: JobRepository,
    private personRepository: PersonRepository,
    private personalizedPetModelRepository: PersonalizedPetModelRepository,
  ) {
    this.logger?.setContext(PersonalizedPetClassifierService.name);
  }

  private getConfig(options: { withCache: boolean }) {
    return getConfig(
      { configRepo: this.configRepository, metadataRepo: this.systemMetadataRepository, logger: this.logger },
      options,
    );
  }

  async queueTraining(ownerId: string): Promise<void> {
    const models = await this.personalizedPetModelRepository.list(ownerId);
    if (models.some((model) => model.status === 'training')) {
      return;
    }
    await this.jobRepository.queue({ name: JobName.PersonalizedPetClassifierTrain, data: { ownerId } });
  }

  @OnJob({ name: JobName.PersonalizedPetClassifierTrain, queue: QueueName.BackgroundTask })
  async handleTraining({ ownerId }: JobOf<JobName.PersonalizedPetClassifierTrain>): Promise<JobStatus> {
    const config = await this.getConfig({ withCache: true });
    const petConfig = config.machineLearning.petRecognition;
    const species = await this.personalizedPetModelRepository.getTrainingSpecies(ownerId);
    if (species.length === 0) {
      this.logger.warn(`Personalized pet training skipped for ${ownerId}: no trusted pet references`);
      return JobStatus.Skipped;
    }

    for (const speciesName of species) {
      const samples = await this.personalizedPetModelRepository.getTrainingSamples(ownerId, speciesName);
      const version = `pet-${new Date().toISOString().replaceAll(/[-:.TZ]/g, '')}-${speciesName}`;
      const row = await this.personalizedPetModelRepository.createTraining({
        ownerId,
        species: speciesName,
        version,
        status: 'training',
        embeddingModel: petConfig.modelName,
        embeddingDimension: 512,
        normalization: 'l2',
        classes: [],
        weights: [],
        bias: [],
        metrics: null,
        metadata: { sampleCount: samples.length },
        error: null,
        activatedAt: null,
      });
      try {
        const result = trainPersonalizedPetClassifier({
          samples: samples.map((sample) => ({
            faceId: sample.faceId,
            personGroupId: sample.personGroupId,
            species: sample.species,
            embedding: parsePetEmbedding(sample.embedding),
            assetId: sample.assetId,
            fileCreatedAt: sample.fileCreatedAt.toISOString(),
          })),
          species: speciesName,
          embeddingModel: petConfig.modelName,
          version,
          minSamplesPerClass: petConfig.personalizedClassifierMinSamples ?? PERSONALIZED_PET_DEFAULT_MIN_SAMPLES,
        });
        const baseline = evaluatePetRecognitionMatches(
          result.split.test.map((sample) => ({
            faceId: sample.faceId,
            embedding: `[${sample.embedding.join(',')}]`,
            expectedPersonGroupId: sample.personGroupId,
          })),
          samples.map((sample) => ({
            faceId: sample.faceId,
            embedding: sample.embedding,
            name: sample.personGroupId,
            personGroupId: sample.personGroupId,
            species: sample.species,
          })),
          {
            identityMargin: petConfig.identityMargin,
            maxDistance: petConfig.maxDistance,
            referenceTopK: petConfig.referenceTopK,
          },
        );
        await this.personalizedPetModelRepository.update(row.id, ownerId, {
          status: 'candidate',
          classes: result.model.classes,
          weights: result.model.weights,
          bias: result.model.bias,
          metrics: { ...result.metrics, baseline },
          metadata: {
            classCounts: result.classCounts,
            split: result.split.assignments,
            seed: result.split.seed,
            hyperparameters: result.model.hyperparameters,
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await this.personalizedPetModelRepository.update(row.id, ownerId, { status: 'failed', error: message });
        this.logger.warn(`Personalized pet training failed for ${ownerId}/${speciesName}: ${message}`);
      }
    }
    return JobStatus.Success;
  }

  list(ownerId: string) {
    return this.personalizedPetModelRepository.list(ownerId);
  }

  async activate(ownerId: string, modelId: string) {
    const candidate = await this.personalizedPetModelRepository.get(modelId, ownerId);
    if (!candidate || !['candidate', 'active', 'disabled'].includes(candidate.status)) {
      throw new BadRequestException('Only a completed personalized pet model can be activated');
    }
    const model = await this.personalizedPetModelRepository.activate(modelId, ownerId);
    return model;
  }

  async deactivate(ownerId: string, modelId: string) {
    const model = await this.personalizedPetModelRepository.deactivate(modelId, ownerId);
    return model;
  }

  async classify({
    ownerId,
    species,
    embedding,
    config,
  }: {
    ownerId: string;
    species: string | undefined;
    embedding: string;
    config: PersonalizedPetConfig;
  }): Promise<{ personGroupId: string; prediction: PersonalizedPetPrediction } | undefined> {
    if (!config.personalizedClassifierEnabled || !species || !isRecognizablePetSpecies(species)) {
      return undefined;
    }
    const row = await this.personalizedPetModelRepository.getActive(ownerId, species);
    if (!row) {
      return undefined;
    }
    const model: PersonalizedPetClassifierModel = {
      version: row.version,
      species: row.species,
      embeddingModel: row.embeddingModel,
      embeddingDimension: row.embeddingDimension,
      normalization: row.normalization,
      classes: row.classes,
      weights: row.weights,
      bias: row.bias,
      metrics: (row.metrics ?? {}) as PersonalizedPetClassifierModel['metrics'],
      hyperparameters: {
        seed: String((row.metadata as Record<string, unknown> | null)?.seed ?? 'unknown'),
        learningRate: 0,
        weightDecay: 0,
        epochs: 0,
        patience: 0,
        minSamplesPerClass: 10,
      },
    };
    if (model.embeddingModel !== config.modelName) {
      this.logger.debug(
        `Ignoring personalized pet model ${model.version}: embedding model changed from ${model.embeddingModel} to ${config.modelName}`,
      );
      return undefined;
    }
    let prediction: PersonalizedPetPrediction | undefined;
    try {
      prediction = predictPersonalizedPet(model, parsePetEmbedding(embedding, model.embeddingDimension));
    } catch (error) {
      this.logger.warn(`Ignoring invalid personalized pet model ${model.version}: ${String(error)}`);
      return undefined;
    }
    if (
      !isAcceptedPersonalizedPetPrediction(
        prediction,
        config.personalizedClassifierMinProbability,
        config.personalizedClassifierMinMargin,
      )
    ) {
      return undefined;
    }
    if (config.personalizedClassifierReferenceValidation) {
      const references = preparePetRecognitionReferences(
        (await this.personRepository.getTrustedPetReferences({ ownerId, species })) ?? [],
      );
      const referenceMatch = matchKnownPet(embedding, references, {
        identityMargin: config.identityMargin,
        maxDistance: config.maxDistance,
        referenceTopK: config.referenceTopK,
      });
      if (referenceMatch.decision !== 'matched' || referenceMatch.best?.personGroupId !== prediction.personGroupId) {
        return undefined;
      }
    }
    return { personGroupId: prediction.personGroupId, prediction };
  }
}
