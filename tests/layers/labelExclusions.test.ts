import { describe, expect, it } from 'vitest';
import { LabelExclusions } from '../../src/layers/stars/labelExclusions';

describe('LabelExclusions lifecycle', () => {
  it('starts with an empty, reusable cache', () => {
    const doc = {
      querySelectorAll: () => [],
      defaultView: null,
    } as unknown as Document;

    const cache = new LabelExclusions(doc);

    const first = cache.read();
    const second = cache.read();

    expect(first.count).toBe(0);
    expect(second.count).toBe(0);
    expect(first.rects).toBe(second.rects);

    cache.dispose();
  });

  it('does not invent exclusions when none exist', () => {
    const doc = {
      querySelectorAll: () => [],
      defaultView: null,
    } as unknown as Document;

    const cache = new LabelExclusions(doc);
    expect(cache.read().count).toBe(0);
  });
});
