import {
  activate as activatePersonalizedPetModel,
  deactivate as deactivatePersonalizedPetModel,
  list as listPersonalizedPetModels,
  Permission,
  train as trainPersonalizedPetModels,
} from '@immich/sdk';
import { authenticate, BaseOptions, requirePermissions } from 'src/utils.js';

export const personalizedPetClassifier = async (
  action: 'train' | 'list' | 'activate' | 'deactivate' | 'rollback',
  modelId: string | undefined,
  options: BaseOptions,
) => {
  await authenticate(options);
  await requirePermissions([action === 'list' ? Permission.PersonRead : Permission.PersonUpdate]);
  if (action === 'train') {
    await trainPersonalizedPetModels();
    console.log('Personalized pet training queued. New models remain candidates until activated.');
    return;
  }
  if (action === 'list') {
    console.log(JSON.stringify(await listPersonalizedPetModels(), undefined, 2));
    return;
  }
  if (!modelId) {
    throw new Error(`A model id is required for ${action}`);
  }
  const model = await (action === 'activate' || action === 'rollback'
    ? activatePersonalizedPetModel({ id: modelId })
    : deactivatePersonalizedPetModel({ id: modelId }));
  console.log(JSON.stringify(model, undefined, 2));
};
