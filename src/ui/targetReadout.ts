// src/ui/targetReadout.ts — the "Distance to …" readout (owner: Claude).
//
// It used to show the distance to the camera's internal look-at point. In
// orbit mode that point is the picked object, so it worked. In free-fly it's
// just a point ahead of the camera at the nearest body's distance (that's how
// free-fly keeps the render scale right), so the readout silently switched to
// "distance to whatever is nearest": backing away from Andromeda toward the
// Milky Way, the Sun became nearest and the number shrank while M31 shrank on
// screen. Now it always measures to the object you picked last (search,
// tour, deep link, H) and names it, in both modes.

import type { FramedPoint } from '../core/camera';
import type { FrameId } from '../core/frames';

export interface ReadoutTarget {
  frameId: FrameId;
  worldPos: ArrayLike<number>;
}

export interface ReadoutDeps {
  /** Current position of a catalog object, or null if it can't be resolved. */
  resolve(id: string): ReadoutTarget | null;
  /** Metres from the camera to a point. */
  distanceTo(point: FramedPoint): number;
  /** Display name for an id. */
  nameOf(id: string): string | undefined;
  format(metres: number): string;
}

/**
 * Text for the readout: "Distance to <name>: <distance>" for the last picked
 * object, or '' when nothing has been picked (or it can't be resolved).
 */
export function targetReadout(lastPickId: string | null, deps: ReadoutDeps): string {
  if (!lastPickId) return '';
  const t = deps.resolve(lastPickId);
  if (!t) return '';
  const metres = deps.distanceTo({ frame: t.frameId, position: t.worldPos });
  if (!Number.isFinite(metres)) return '';
  return `Distance to ${deps.nameOf(lastPickId) ?? 'target'}: ${deps.format(metres)}`;
}
