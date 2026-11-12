import { describe, it, expect } from 'vitest';
import { initialProfileId, emptyCanvasPrompt } from './profileChoice.js';

describe('initialProfileId', () => {
  it('opens the requested profile when the bundle has it', () => {
    expect(initialProfileId(['a', 'b'], 'b')).toBe('b');
  });
  it('falls back to the first profile', () => {
    expect(initialProfileId(['a', 'b'], 'missing')).toBe('a');
    expect(initialProfileId(['a', 'b'], null)).toBe('a');
  });
  it('is null for a bundle with no profiles', () => {
    expect(initialProfileId([], 'a')).toBeNull();
  });
});

describe('emptyCanvasPrompt', () => {
  it('asks for a bundle, a new profile or a choice', () => {
    expect(emptyCanvasPrompt({ bundleOpen: false, profileCount: 0 })).toMatch(/Open a bundle/);
    expect(emptyCanvasPrompt({ bundleOpen: true, profileCount: 0 })).toMatch(/no profiles/);
    expect(emptyCanvasPrompt({ bundleOpen: true, profileCount: 3 })).toMatch(/Choose a profile/);
  });
});
