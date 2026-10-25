import { describe, expect, it } from 'vitest';
import {
  rectanglesOverlap,
  isLabelBlocked,
  type LabelRect,
} from '../../src/layers/stars/labelCollision';

const rect = (
  left: number,
  top: number,
  right: number,
  bottom: number,
): LabelRect => ({ left, top, right, bottom });

describe('stellar label collision', () => {
  const candidate = rect(10, 10, 30, 30);

  it('detects partial overlap', () => {
    expect(
      rectanglesOverlap(candidate, rect(20, 20, 40, 40)),
    ).toBe(true);
  });

  it('does not treat touching edges as overlap', () => {
    expect(
      rectanglesOverlap(candidate, rect(30, 10, 50, 30)),
    ).toBe(false);
  });

  it('detects containment', () => {
    expect(
      rectanglesOverlap(candidate, rect(0, 0, 50, 50)),
    ).toBe(true);
  });

  it('blocks overlapping brighter labels', () => {
    expect(
      isLabelBlocked(
        candidate,
        [rect(15, 15, 25, 25)],
        [],
      ),
    ).toBe(true);
  });

  it('blocks UI exclusion zones', () => {
    expect(
      isLabelBlocked(
        candidate,
        [],
        [rect(0, 0, 20, 20)],
      ),
    ).toBe(true);
  });

  it('ignores inactive pooled exclusions', () => {
    expect(
      isLabelBlocked(
        candidate,
        [],
        [rect(100, 100, 120, 120), candidate],
        1,
      ),
    ).toBe(false);
  });

  it('allows labels in free space', () => {
    expect(
      isLabelBlocked(
        candidate,
        [rect(40, 40, 60, 60)],
        [rect(100, 100, 120, 120)],
      ),
    ).toBe(false);
  });
});
