import { describe, it, expect } from 'vitest';
import {
  CONSTELLATION_MODES,
  constellationLabel,
  isConstellationKey,
  nextConstellationMode,
} from '../../src/ui/constellations';
import { HELP_ITEMS } from '../../src/ui/help';

describe('constellation toggle (Lumi)', () => {
  it('cycles Auto -> On -> Off -> Auto', () => {
    expect(CONSTELLATION_MODES).toEqual(['auto', 'on', 'off']);
    expect(nextConstellationMode('auto')).toBe('on');
    expect(nextConstellationMode('on')).toBe('off');
    expect(nextConstellationMode('off')).toBe('auto');
    expect(constellationLabel('auto')).toBe('Constellations: Auto');
  });
  it('fires on c but not while typing or with modifiers', () => {
    expect(isConstellationKey('c')).toBe(true);
    expect(isConstellationKey('C', 'DIV')).toBe(true);
    expect(isConstellationKey('c', 'INPUT')).toBe(false);
    expect(isConstellationKey('c', 'textarea')).toBe(false);
    expect(isConstellationKey('c', 'DIV', true)).toBe(false); // contenteditable
    expect(isConstellationKey('c', 'DIV', false, true)).toBe(false); // Ctrl+C
    expect(isConstellationKey('x')).toBe(false);
  });
  it('is listed in the help overlay', () => {
    expect(HELP_ITEMS.some((i) => i.keys === 'C' && /constellation/i.test(i.does))).toBe(true);
  });
});
