// Lumi: search -> flyTo bridge routes every catalog prefix (incl. Gemini's cosmicweb:2mrs ids, #48).
import { describe, expect, it } from 'vitest';
import { flightKind, kindFromId, linkSearchToFlight, type Flyer } from '../../src/ui/flyLink';

describe('flyLink kinds', () => {
  it('routes cosmicweb ids and flies them as galaxies', () => {
    expect(kindFromId('cosmicweb:2mrs:100')).toBe('cosmicweb');
    expect(flightKind('cosmicweb')).toBe('galaxy');
    expect(flightKind('cluster')).toBe('galaxy');
    expect(kindFromId('nope:x')).toBeNull();
  });

  it('a cosmicweb pick reaches flyTo with the id unchanged', () => {
    const calls: { kind: string; id: string }[] = [];
    const flyer: Flyer = {
      flyTo(t) { calls.push(t); return { promise: new Promise<void>(() => {}), cancel() {} }; },
    };
    const errors: string[] = [];
    linkSearchToFlight(flyer, () => {}, (id) => errors.push(id), () => 0)('cosmicweb:2mrs:100');
    expect(errors).toEqual([]);
    expect(calls).toEqual([{ kind: 'galaxy', id: 'cosmicweb:2mrs:100', approach: 'orbit' }]);
  });
});
