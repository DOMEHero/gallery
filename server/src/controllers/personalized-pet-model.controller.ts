import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  PersonalizedPetModelListResponseDto,
  PersonalizedPetModelResponseDto,
} from 'src/dtos/personalized-pet-model.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { PersonalizedPetClassifierService } from 'src/services/personalized-pet-classifier.service.js';
import { UUIDv7ParamDto } from 'src/validation.js';

@ApiTags(ApiTag.People)
@Controller('people/personalized-pet-models')
export class PersonalizedPetModelController {
  constructor(private service: PersonalizedPetClassifierService) {}

  private mapModel(
    model: Awaited<ReturnType<PersonalizedPetClassifierService['list']>>[number],
  ): PersonalizedPetModelResponseDto {
    return {
      id: model.id,
      species: model.species,
      version: model.version,
      status: model.status,
      embeddingModel: model.embeddingModel,
      embeddingDimension: model.embeddingDimension,
      normalization: model.normalization,
      classes: model.classes,
      metrics: model.metrics,
      metadata: model.metadata,
      error: model.error,
      activatedAt: model.activatedAt?.toISOString() ?? null,
      createdAt: model.createdAt.toISOString(),
      updatedAt: model.updatedAt.toISOString(),
    };
  }

  @Get()
  @Authenticated({ permission: Permission.PersonRead })
  @Endpoint({
    summary: 'List personalized pet models',
    description: 'List versioned personalized pet classifiers owned by the authenticated user.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  async list(@Auth() auth: AuthDto): Promise<PersonalizedPetModelListResponseDto> {
    const models = await this.service.list(auth.user.id);
    return models.map((model) => this.mapModel(model));
  }

  @Post('train')
  @Authenticated({ permission: Permission.PersonUpdate })
  @HttpCode(HttpStatus.ACCEPTED)
  @Endpoint({
    summary: 'Train personalized pet models',
    description: 'Queue training from scratch using only trusted pet references. New models remain candidates.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  async train(@Auth() auth: AuthDto): Promise<void> {
    await this.service.queueTraining(auth.user.id);
  }

  @Post(':id/activate')
  @Authenticated({ permission: Permission.PersonUpdate })
  @Endpoint({
    summary: 'Activate a personalized pet model',
    description: 'Activate one candidate model for its species and disable the previously active version.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  activate(@Auth() auth: AuthDto, @Param() { id }: UUIDv7ParamDto): Promise<PersonalizedPetModelResponseDto> {
    return this.service.activate(auth.user.id, id).then((model) => this.mapModel(model));
  }

  @Post(':id/rollback')
  @Authenticated({ permission: Permission.PersonUpdate })
  @Endpoint({
    summary: 'Roll back a personalized pet model',
    description: 'Activate a previously saved version for its species.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  rollback(@Auth() auth: AuthDto, @Param() { id }: UUIDv7ParamDto): Promise<PersonalizedPetModelResponseDto> {
    return this.service.activate(auth.user.id, id).then((model) => this.mapModel(model));
  }

  @Post(':id/deactivate')
  @Authenticated({ permission: Permission.PersonUpdate })
  @Endpoint({
    summary: 'Deactivate a personalized pet model',
    description: 'Disable a personalized classifier without changing stored candidates or references.',
    history: new HistoryBuilder().added('v2').stable('v2'),
  })
  deactivate(@Auth() auth: AuthDto, @Param() { id }: UUIDv7ParamDto): Promise<PersonalizedPetModelResponseDto> {
    return this.service.deactivate(auth.user.id, id).then((model) => this.mapModel(model));
  }
}
