import { describe, expect, it } from 'vitest';
import { makeZoneHud, zoneFor, ZONES } from '../../src/ui/zone';

const AU = 1.495978707e11, LY = 9.4607304725808e15;

describe('zoneFor', () => {
  it('names each scale from Earth to the cosmic web', () => {
    expect(zoneFor(1 * AU).name).toBe('Inner Solar System');
    expect(zoneFor(30 * AU).name).toBe('Outer Solar System');
    expect(zoneFor(0.5 * LY).name).toBe('Oort Cloud');
    expect(zoneFor(8.6 * LY).name).toBe('Solar Neighborhood'); // Sirius
    expect(zoneFor(26_000 * LY).name).toBe('Milky Way');        // galactic centre
    expect(zoneFor(2.5e6 * LY).name).toBe('Local Group');       // M31
    expect(zoneFor(5.4e7 * LY).name).toBe('Local Supercluster'); // Virgo
    expect(zoneFor(1e9 * LY).name).toBe('Cosmic Web');
  });
  it('treats bad input as the Sun and Infinity as the cosmic web', () => {
    expect(zoneFor(NaN).name).toBe('Inner Solar System');
    expect(zoneFor(-5).name).toBe('Inner Solar System');
    expect(zoneFor(Infinity).name).toBe('Cosmic Web');
  });
  it('zones are strictly increasing', () => {
    for (let i = 1; i < ZONES.length; i++) expect(ZONES[i].maxM).toBeGreaterThan(ZONES[i - 1].maxM);
  });
});

describe('makeZoneHud', () => {
  it('only rewrites the element when the zone changes', () => {
    let writes = 0, text = '';
    const el = { get textContent() { return text; }, set textContent(v: string) { writes++; text = v; } } as unknown as HTMLElement;
    const hud = makeZoneHud(el);
    hud(1 * AU); hud(2 * AU); hud(10 * LY);
    expect(text).toBe('Solar Neighborhood');
    expect(writes).toBe(2);
  });
});
