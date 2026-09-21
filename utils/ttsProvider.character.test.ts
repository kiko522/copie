import { describe, expect, it } from 'vitest';
import type { APIConfig, CharacterProfile } from '../types';
import { resolveCharacterTtsProvider } from './ttsProvider';

const config = (ttsProvider: APIConfig['ttsProvider']): APIConfig => ({
  baseUrl: '',
  apiKey: '',
  model: '',
  ttsProvider,
});

describe('resolveCharacterTtsProvider', () => {
  it('uses the character provider before the global default', () => {
    const char = { voiceProfile: { provider: 'elevenlabs' } } as CharacterProfile;
    expect(resolveCharacterTtsProvider(char, config('minimax'))).toBe('elevenlabs');
  });

  it('inherits the global provider for old and unconfigured characters', () => {
    expect(resolveCharacterTtsProvider({} as CharacterProfile, config('elevenlabs'))).toBe('elevenlabs');
    const legacy = { voiceProfile: { provider: 'custom' } } as CharacterProfile;
    expect(resolveCharacterTtsProvider(legacy, config('fishaudio'))).toBe('fishaudio');
  });
});
