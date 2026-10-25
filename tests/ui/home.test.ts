import { describe, it, expect } from 'vitest';
import { HOME_ID, isHomeKey } from '../../src/ui/home';
import { HELP_ITEMS } from '../../src/ui/help';
import { get } from '../../src/catalog';
import { registerHygStars } from '../../src/layers/stars/catalog';

describe('home key (Lumi)', () => {
  it('targets the Sun', () => {
    expect(HOME_ID).toBe('star:sol:sun');
  });
  it('HOME_ID resolves in the catalog once the stars layer registers', () => {
    registerHygStars([]);
    expect(get(HOME_ID)?.name).toBe('Sun');
  });
  it('fires on h but not while typing or with modifiers', () => {
    expect(isHomeKey('h')).toBe(true);
    expect(isHomeKey('H', 'CANVAS')).toBe(true);
    expect(isHomeKey('h', 'INPUT')).toBe(false);
    expect(isHomeKey('h', 'DIV', true)).toBe(false);
    expect(isHomeKey('h', 'DIV', false, true)).toBe(false);
    expect(isHomeKey('j')).toBe(false);
  });
  it('is listed in the help overlay', () => {
    expect(HELP_ITEMS.some((i) => i.keys === 'H' && /home/i.test(i.does))).toBe(true);
  });
});
