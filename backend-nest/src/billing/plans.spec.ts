import { limitsForTier } from './plans.js';
import { describe, it, expect } from 'vitest';

describe('limitsForTier', () => {
  it('returns starter limits for unknown tiers', () => {
    expect(limitsForTier('unknown')).toBeDefined();
    expect(limitsForTier('unknown').max_projects).toBe(3);
  });
  
  it('returns specific limits for known tiers', () => {
    expect(limitsForTier('starter').max_projects).toBe(3);
    expect(limitsForTier('growth').max_projects).toBe(20);
    expect(limitsForTier('enterprise').max_projects).toBe(100);
  });
});
