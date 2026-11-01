// Lumi: automatic helio <-> galactic rebase by distance from the Sun.
// Without it, a camera that flies to a planet (helio frame) and then zooms
// out stays in 'helio' forever, so the galactic-only layers (stars, galaxies)
// never activate and the view goes black. Hysteresis keeps a camera hovering
// near the boundary from flipping every frame. rebaseTo() is exact, so the
// switch itself doesn't move anything on screen.
import { METERS, type FrameId } from './frames';

/**
 * helio -> galactic where Gemini's solar fade ends (120 AU, solarSystemLayer.ts),
 * so stars switch on as the planets finish fading and there's no dark band.
 * Keep in step with that fadeEnd (Claude's #44 review).
 */
export const LEAVE_HELIO_M = 120 * METERS.au;
/** galactic -> helio once the camera comes back this close to the Sun (hysteresis band). */
export const ENTER_HELIO_M = 80 * METERS.au;

/**
 * Frame the camera should be in, given its current frame, metres from the Sun
 * and the frame of what it's looking at. It only drops back into 'helio' when
 * the target is a solar-system object, so a Sun or star view near the Sun
 * keeps the (galactic-only) star field, as before.
 */
export function chooseFrame(current: FrameId, metresFromSun: number, targetFrame: FrameId | null = null): FrameId {
  if (current === 'helio' && metresFromSun > LEAVE_HELIO_M) return 'galactic';
  if (current === 'galactic' && targetFrame === 'helio' && metresFromSun < ENTER_HELIO_M) return 'helio';
  return current;
}
