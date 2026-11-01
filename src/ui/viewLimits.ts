// View limits (Lumi, v1.1). Caps how far the camera can zoom out, so the
// cosmic web stays the headline view instead of collapsing to a dot on black
// (Nova's 15:55 test reached 105,700 million ly).
import { METERS } from '../core/frames';

/**
 * Farthest 2MRS galaxy in public/data/cosmic-web-2mrs.json, from the Sun:
 * 416.3 Mpc (~1,358 Mly). tests/ui/viewLimits.test.ts re-derives it from the
 * data file, so this fails loudly if the sample changes.
 */
export const COSMIC_WEB_EXTENT_MPC = 416.3;

/** Zoom-out cap: about 2x the cosmic web extent (~2,716 Mly), in metres. */
export const MAX_VIEW_DISTANCE_M = 2 * COSMIC_WEB_EXTENT_MPC * METERS.mpc;
