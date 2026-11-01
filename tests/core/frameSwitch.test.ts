import { describe, expect, it } from 'vitest';
import { METERS } from '../../src/core/frames';
import { chooseFrame, ENTER_HELIO_M, LEAVE_HELIO_M } from '../../src/core/frameSwitch';

const AU = METERS.au;

describe('chooseFrame (helio <-> galactic auto-rebase)', () => {
  it('leaves helio once past the solar system', () => {
    expect(chooseFrame('helio', 5 * AU)).toBe('helio');
    expect(chooseFrame('helio', LEAVE_HELIO_M * 1.01)).toBe('galactic');
    // ~234 ly, the old all-black Solar Neighborhood case
    expect(chooseFrame('helio', 234 * 9.4607e15)).toBe('galactic');
  });

  it('returns to helio near the Sun', () => {
    expect(chooseFrame('galactic', 50 * 3.0857e16)).toBe('galactic');
    expect(chooseFrame('galactic', ENTER_HELIO_M * 0.99, 'helio')).toBe('helio');
  });

  it('stays galactic near the Sun when the target is not a solar-system object', () => {
    expect(chooseFrame('galactic', ENTER_HELIO_M * 0.99, 'galactic')).toBe('galactic');
    expect(chooseFrame('galactic', ENTER_HELIO_M * 0.99)).toBe('galactic');
  });

  it('leaves helio where the solar fade ends (no dark band)', () => {
    expect(chooseFrame('helio', 121 * AU)).toBe('galactic');
    expect(chooseFrame('helio', 119 * AU)).toBe('helio');
  });

  it('has hysteresis between the two thresholds', () => {
    const mid = (ENTER_HELIO_M + LEAVE_HELIO_M) / 2;
    expect(chooseFrame('helio', mid)).toBe('helio');
    expect(chooseFrame('galactic', mid, 'helio')).toBe('galactic');
  });

  it('never touches planet or cosmic frames', () => {
    expect(chooseFrame('planet', 1e30)).toBe('planet');
    expect(chooseFrame('cosmic', 0)).toBe('cosmic');
  });
});
