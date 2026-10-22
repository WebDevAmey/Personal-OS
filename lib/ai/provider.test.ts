// lib/ai/provider.ts + lib/env.ts: the E2E scripted model is reachable only
// behind both test variables and never on a production deployment.
import { generateText } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SCRIPTED_MODEL_ACK, assertServerEnv, isProductionDeployment, scriptedModelAllowed } from '@/lib/env';
import { DEFAULT_MODEL_ID, getLanguageModel, modelId } from './provider';
import { SCRIPTED_MODEL_ID } from './scripted-model';

const BOTH = { E2E_SCRIPTED_MODEL: '1', E2E_ALLOW_SCRIPTED_MODEL: SCRIPTED_MODEL_ACK };

afterEach(() => vi.unstubAllEnvs());

describe('scriptedModelAllowed', () => {
  it('needs both variables, exactly', () => {
    expect(scriptedModelAllowed({})).toBe(false);
    expect(scriptedModelAllowed({ E2E_SCRIPTED_MODEL: '1' })).toBe(false);
    expect(scriptedModelAllowed({ E2E_ALLOW_SCRIPTED_MODEL: SCRIPTED_MODEL_ACK })).toBe(false);
    expect(scriptedModelAllowed({ E2E_SCRIPTED_MODEL: 'true', E2E_ALLOW_SCRIPTED_MODEL: SCRIPTED_MODEL_ACK })).toBe(false);
    expect(scriptedModelAllowed({ E2E_SCRIPTED_MODEL: '1', E2E_ALLOW_SCRIPTED_MODEL: 'yes' })).toBe(false);
    expect(scriptedModelAllowed(BOTH)).toBe(true);
  });

  it('allows a local `next start` (NODE_ENV=production without Vercel)', () => {
    expect(scriptedModelAllowed({ ...BOTH, NODE_ENV: 'production' })).toBe(true);
  });

  it('is never allowed on a production deployment', () => {
    expect(scriptedModelAllowed({ ...BOTH, VERCEL_ENV: 'production' })).toBe(false);
    expect(scriptedModelAllowed({ ...BOTH, NODE_ENV: 'production', VERCEL: '1' })).toBe(false);
    expect(isProductionDeployment({ VERCEL_ENV: 'preview', NODE_ENV: 'production' })).toBe(false);
  });
});

describe('assertServerEnv with the E2E flag', () => {
  it('refuses to boot a production deployment when E2E_SCRIPTED_MODEL is set at all', () => {
    expect(() => assertServerEnv({ E2E_SCRIPTED_MODEL: '1', VERCEL_ENV: 'production', NODE_ENV: 'production' })).toThrow(/E2E_SCRIPTED_MODEL/);
    expect(() => assertServerEnv({ E2E_SCRIPTED_MODEL: '0', NODE_ENV: 'production', VERCEL: '1' })).toThrow(/E2E_SCRIPTED_MODEL/);
    expect(() => assertServerEnv({ E2E_SCRIPTED_MODEL: '', VERCEL_ENV: 'production' })).toThrow(/E2E_SCRIPTED_MODEL/);
  });

  it('does not mention the flag when it is unset', () => {
    expect(() => assertServerEnv({ NODE_ENV: 'production', VERCEL: '1' })).toThrow(/Invalid server environment/);
    expect(() => assertServerEnv({ NODE_ENV: 'production', VERCEL: '1' })).not.toThrow(/E2E_SCRIPTED_MODEL/);
  });
});

describe('getLanguageModel', () => {
  it('returns the Anthropic model by default', () => {
    vi.stubEnv('E2E_SCRIPTED_MODEL', '');
    vi.stubEnv('E2E_ALLOW_SCRIPTED_MODEL', '');
    vi.stubEnv('AI_MODEL', '');
    const model = getLanguageModel() as { provider: string; modelId: string };
    expect(model.provider).toMatch(/anthropic/);
    expect(modelId()).toBe(DEFAULT_MODEL_ID);
  });

  it('returns the scripted model only with both variables, and not on Vercel production', async () => {
    vi.stubEnv('E2E_SCRIPTED_MODEL', '1');
    vi.stubEnv('E2E_ALLOW_SCRIPTED_MODEL', SCRIPTED_MODEL_ACK);
    const model = getLanguageModel();
    expect((model as { modelId: string }).modelId).toBe(SCRIPTED_MODEL_ID);
    expect(modelId()).toBe(SCRIPTED_MODEL_ID);
    const res = await generateText({ model, prompt: 'User command:\nsomething unscripted' });
    expect(res.text).toMatch(/scripted/);

    vi.stubEnv('VERCEL_ENV', 'production');
    expect((getLanguageModel() as { provider: string }).provider).toMatch(/anthropic/);
  });
});
