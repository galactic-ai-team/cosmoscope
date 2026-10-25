// Lumi: automatic helio <-> galactic rebase by distance from the Sun.
// Without it, a camera that flies to a planet (helio frame) and then zooms
// out stays in 'helio' forever, so the galactic-only layers (stars, galaxies)
// never activate and the view goes black. Hysteresis keeps a camera hovering
// near the boundary from flipping every frame. rebaseTo() is exact, so the
// switch itself doesn't move anything on screen.
import type { FrameId } from '../core/frames';

const AU = 1.495978707e11;
/** helio -> galactic once the camera is this far from the Sun (past the solar fade). */
export const LEAVE_HELIO_M = 1_000 * AU;
/** galactic -> helio once the camera comes back this close to the Sun. */
export const ENTER_HELIO_M = 500 * AU;

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
