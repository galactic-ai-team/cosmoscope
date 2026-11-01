import { describe, it, expect } from 'vitest';
import { register, search, designations } from '../../src/catalog';
import { showNoResults } from '../../src/ui/search';

describe('search v1.1', () => {
  it("shows 'No results' only for a focused, non-empty query with no matches", () => {
    expect(showNoResults('zzzz', 0, true)).toBe(true);
    expect(showNoResults('zzzz', 2, true)).toBe(false);
    expect(showNoResults('   ', 0, true)).toBe(false);
    expect(showNoResults('zzzz', 0, false)).toBe(false);
  });

  it('2MRS / 2MASX designations find cosmic-web galaxies', () => {
    register([
      { id: 'cosmicweb:2mrs:0', name: '12561432+5652244', kind: 'galaxy' },
      { id: 'cosmicweb:2mrs:1', name: '00424433+4116074', kind: 'galaxy' },
      { id: 'galaxy:messier:M31', name: 'Andromeda Galaxy', kind: 'galaxy' },
    ]);
    expect(designations({ id: 'cosmicweb:2mrs:0', name: '12561432+5652244', kind: 'galaxy' }))
      .toEqual(['2MASX J12561432+5652244', '2MRS 12561432+5652244']);
    expect(designations({ id: 'galaxy:messier:M31', name: 'Andromeda Galaxy', kind: 'galaxy' })).toEqual([]);
    const ids = (q: string) => search(q).map((e) => e.id);
    expect(ids('2MRS')).toEqual(expect.arrayContaining(['cosmicweb:2mrs:0', 'cosmicweb:2mrs:1']));
    expect(ids('2MASX')).not.toContain('galaxy:messier:M31');
    expect(ids('2MASX J1256')).toEqual(['cosmicweb:2mrs:0']);
    expect(ids('2mrs 0042')).toEqual(['cosmicweb:2mrs:1']);
    expect(ids('12561432')).toEqual(['cosmicweb:2mrs:0']);
  });
});
