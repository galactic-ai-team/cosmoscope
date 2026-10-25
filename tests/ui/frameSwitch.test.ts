import { describe, expect, it } from 'vitest';
import { chooseFrame, ENTER_HELIO_M, LEAVE_HELIO_M } from '../../src/ui/frameSwitch';

const AU = 1.495978707e11;

describe('chooseFrame (helio <-> galactic auto-rebase)', () => {
  it('leaves helio once past the solar system', () => {
    expect(chooseFrame('helio', 5 * AU)).toBe('helio');
    expect(chooseFrame('helio', LEAVE_HELIO_M * 1.01)).toBe('galactic');
    // ~234 ly, the old all-black Solar Neighborhood case
    expect(chooseFrame('helio', 234 * 9.4607e15)).toBe('galactic');
  });

  it('returns to helio near the Sun', () => {
    expect(chooseFrame('galactic', 50 * 3.0857e16)).toBe('galactic');
    expect(chooseFrame('galactic', ENTER_HELIO_M * 0.99)).toBe('helio');
  });

  it('has hysteresis between the two thresholds', () => {
    const mid = (ENTER_HELIO_M + LEAVE_HELIO_M) / 2;
    expect(chooseFrame('helio', mid)).toBe('helio');
    expect(chooseFrame('galactic', mid)).toBe('galactic');
  });

  it('never touches planet or cosmic frames', () => {
    expect(chooseFrame('planet', 1e30)).toBe('planet');
    expect(chooseFrame('cosmic', 0)).toBe('cosmic');
  });
});
