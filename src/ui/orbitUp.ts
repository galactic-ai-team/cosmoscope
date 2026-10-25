// Orbit axis per frame (Lumi, from Claude's #30 follow-up idea): planets and
// the solar system orbit around ecliptic north so the planetary plane lies
// flat; everything else keeps the default north celestial pole.
import { ECLIPTIC_NORTH, type FrameId } from '../core/frames';

export const CELESTIAL_NORTH: readonly [number, number, number] = [0, 0, 1];

/** Up axis CosmoControls should orbit around when arriving in this frame. */
export function orbitUpFor(frame: FrameId): readonly [number, number, number] {
  return frame === 'helio' || frame === 'planet' ? ECLIPTIC_NORTH : CELESTIAL_NORTH;
}
