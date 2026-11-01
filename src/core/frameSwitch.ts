// Lumi: automatic helio <-> galactic <-> cosmic rebase by distance from the Sun.
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
 * galactic -> cosmic past 0.5 Mpc (Lumi, taking over Nova's frame-switch task).
 * That's beyond the Milky Way's satellites (LMC 50 kpc, Leo I ~250 kpc) but
 * short of Andromeda (~0.78 Mpc), so Local Group and cosmic-web views
 * (Nova's 2MRS data in #28, Mpc, frame 'cosmic') run in Mpc units. We measure
 * from the Sun, not the Galactic Centre: the 8 kpc offset is under 3% of
 * either threshold and it keeps one distance input for every rule.
 */
export const LEAVE_GALACTIC_M = 0.5 * METERS.mpc;
/** cosmic -> galactic once back inside 0.3 Mpc (hysteresis band 0.3..0.5 Mpc). */
export const ENTER_GALACTIC_M = 0.3 * METERS.mpc;

/** Targets that live in or below the galactic frame (worth coming back for). */
const NEAR_TARGET: ReadonlySet<FrameId> = new Set<FrameId>(['planet', 'helio', 'galactic']);

/** One step of the rules; chooseFrame applies it until nothing changes. */
function step(current: FrameId, metresFromSun: number, targetFrame: FrameId | null): FrameId {
  if (current === 'helio' && metresFromSun > LEAVE_HELIO_M) return 'galactic';
  if (current === 'galactic' && targetFrame === 'helio' && metresFromSun < ENTER_HELIO_M) return 'helio';
  if (current === 'galactic' && metresFromSun > LEAVE_GALACTIC_M) return 'cosmic';
  if (current === 'cosmic' && targetFrame !== null && NEAR_TARGET.has(targetFrame) && metresFromSun < ENTER_GALACTIC_M) {
    return 'galactic';
  }
  return current;
}

/**
 * Frame the camera should be in, given its current frame, metres from the Sun
 * and the frame of what it's looking at.
 *   - It only drops back into 'helio' when the target is a solar-system
 *     object, so a Sun or star view near the Sun keeps the (galactic-only)
 *     star field, as before.
 *   - It only drops back from 'cosmic' to 'galactic' when the target is in
 *     the galactic frame or below (a galaxy, star or planet). With a cosmic
 *     target, or none, it stays cosmic; the galaxies layer draws in both.
 * The rules are applied until stable, so a jump from 1 AU to 1 Mpc lands in
 * 'cosmic' in one call (the bands don't overlap, so this ends in <= 3 steps).
 * 'planet' is never entered or left here.
 */
export function chooseFrame(current: FrameId, metresFromSun: number, targetFrame: FrameId | null = null): FrameId {
  let frame = current;
  for (let i = 0; i < 3; i++) {
    const next = step(frame, metresFromSun, targetFrame);
    if (next === frame) break;
    frame = next;
  }
  return frame;
}
