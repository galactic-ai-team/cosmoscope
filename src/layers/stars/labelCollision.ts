/**
 * Pure screen-space collision helpers.
 * Rectangles use CSS pixels in viewport coordinates.
 */

export interface LabelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function rectanglesOverlap(
  a: LabelRect,
  b: LabelRect,
): boolean {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

/**
 * Returns true when a candidate overlaps either:
 *  - a brighter label that has already been accepted, or
 *  - an interface exclusion region.
 *
 * Edge touching alone is not a collision.
 */
export function isLabelBlocked(
  candidate: LabelRect,
  occupied: readonly LabelRect[],
  exclusions: readonly LabelRect[],
  exclusionCount = exclusions.length,
): boolean {
  for (const rect of occupied) {
    if (rectanglesOverlap(candidate, rect)) return true;
  }

  for (let i = 0; i < exclusionCount; i++) {
    if (rectanglesOverlap(candidate, exclusions[i])) {
      return true;
    }
  }

  return false;
}
