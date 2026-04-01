import { describe, expect, it } from 'vitest';
import { getProviderModels } from '../../src/models/ModelRegistry.js';

describe('ModelRegistry', () => {
  it('Claude 정적 모델 목록에 opus[1m] 변형을 포함한다', () => {
    const provider = getProviderModels('claude');
    const modelIds = provider.models.map((model) => model.modelId);

    expect(modelIds).toContain('opus[1m]');
    expect(modelIds).not.toContain('sonnet[1m]');
  });
});
