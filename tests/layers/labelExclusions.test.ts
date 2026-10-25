
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  LabelExclusions,
  hasExcluded,
  type ExclusionObservers,
} from '../../src/layers/stars/labelExclusions';

const SELECTOR = '[data-label-exclude]';

function makeHarness() {
  type FakeElement = {
    nodeType: number;
    hidden: boolean;
    isConnected: boolean;
    matches: (selector: string) => boolean;
    closest: (selector: string) => FakeElement | null;
    querySelector: (selector: string) => FakeElement | null;
    getBoundingClientRect: ReturnType<typeof vi.fn>;
  };

  const elements: FakeElement[] = [];
  const documentListeners = new Map<string, Function>();

  let mutationCallback: MutationCallback | null = null;
  let resizeCallback: ResizeObserverCallback | null = null;

  const observe = vi.fn();
  const unobserve = vi.fn();
  const disconnectResize = vi.fn();
  const disconnectMutation = vi.fn();
  const query = vi.fn(() =>
    elements.filter(
      (el) => el.isConnected && el.matches(SELECTOR),
    ),
  );

  class FakeMutationObserver {
    constructor(callback: MutationCallback) {
      mutationCallback = callback;
    }

    observe = vi.fn();
    disconnect = disconnectMutation;
    takeRecords = () => [];
  }

  class FakeResizeObserver {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }

    observe = observe;
    unobserve = unobserve;
    disconnect = disconnectResize;
  }

  const win = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };

  const doc = {
    defaultView: win,
    body: {},
    querySelectorAll: query,
    addEventListener: vi.fn(
      (type: string, callback: Function) => {
        documentListeners.set(type, callback);
      },
    ),
    removeEventListener: vi.fn(),
  } as unknown as Document;

  const observers: ExclusionObservers = {
    Mutation:
      FakeMutationObserver as unknown as
        ExclusionObservers['Mutation'],
    Resize:
      FakeResizeObserver as unknown as
        ExclusionObservers['Resize'],
  };

  function element(
    excluded = true,
    left = 10,
  ): FakeElement {
    const el: FakeElement = {
      nodeType: 1,
      hidden: false,
      isConnected: true,
      matches: (s) => s === SELECTOR && excluded,
      closest: (s) =>
        s === SELECTOR && excluded ? el : null,
      querySelector: () => null,
      getBoundingClientRect: vi.fn(() => ({
        left,
        top: 20,
        right: left + 100,
        bottom: 60,
        width: 100,
        height: 40,
      })),
    };

    elements.push(el);
    return el;
  }

  function mutate(
    record: Partial<MutationRecord>,
  ): void {
    const cb = mutationCallback;
    if (!cb) throw new Error('MutationObserver not started');

    cb(
      [record as MutationRecord],
      {} as MutationObserver,
    );
  }

  function resize(): void {
    const cb = resizeCallback;
    if (!cb) throw new Error('ResizeObserver not started');

    cb([], {} as ResizeObserver);
  }

  function transition(
    eventName: string,
    target: FakeElement,
  ): void {
    documentListeners.get(eventName)?.({
      target,
    });
  }

  return {
    doc,
    observers,
    element,
    mutate,
    resize,
    transition,
    query,
    observe,
    unobserve,
    disconnectResize,
    disconnectMutation,
    win,
  };
}

describe('LabelExclusions observer cache', () => {
  it('measures initially, then stays clean when idle', () => {
    const h = makeHarness();
    const el = h.element();

    const cache = new LabelExclusions(
      h.doc,
      h.observers,
    );

    cache.start();

    expect(cache.read().count).toBe(1);
    expect(el.getBoundingClientRect).toHaveBeenCalledTimes(1);

    // Simulate ResizeObserver's initial delivery.
    h.resize();
    cache.read();

    expect(el.getBoundingClientRect).toHaveBeenCalledTimes(2);
    expect(h.observe).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 120; i++) cache.read();

    expect(el.getBoundingClientRect).toHaveBeenCalledTimes(2);
    expect(h.observe).toHaveBeenCalledTimes(1);

    cache.dispose();
  });

  it('ignores unrelated HUD text mutations', () => {
    const h = makeHarness();
    const el = h.element();

    const cache = new LabelExclusions(
      h.doc,
      h.observers,
    );

    cache.start();
    cache.read();

    h.mutate({
      type: 'childList',
      addedNodes: [] as unknown as NodeList,
      removedNodes: [] as unknown as NodeList,
    });

    cache.read();
    expect(el.getBoundingClientRect).toHaveBeenCalledTimes(1);

    cache.dispose();
  });

  it('refreshes on excluded attribute changes', () => {
    const h = makeHarness();
    const el = h.element();

    const cache = new LabelExclusions(
      h.doc,
      h.observers,
    );

    cache.start();
    cache.read();

    h.mutate({
      type: 'attributes',
      target: el as unknown as Element,
      attributeName: 'style',
    });

    cache.read();
    expect(el.getBoundingClientRect).toHaveBeenCalledTimes(2);

    cache.dispose();
  });

  it('discovers newly added exclusions', () => {
    const h = makeHarness();
    h.element();

    const cache = new LabelExclusions(
      h.doc,
      h.observers,
    );

    cache.start();
    expect(cache.read().count).toBe(1);

    const added = h.element(true, 200);

    h.mutate({
      type: 'childList',
      addedNodes: [added] as unknown as NodeList,
      removedNodes: [] as unknown as NodeList,
    });

    const result = cache.read();

    expect(result.count).toBe(2);
    expect(result.rects[1].left).toBe(200);
    expect(h.observe).toHaveBeenCalledTimes(2);

    cache.dispose();
  });

  it('unobserves removed elements', () => {
    const h = makeHarness();
    const el = h.element();

    const cache = new LabelExclusions(
      h.doc,
      h.observers,
    );

    cache.start();
    cache.read();

    el.isConnected = false;

    h.mutate({
      type: 'childList',
      addedNodes: [] as unknown as NodeList,
      removedNodes: [el] as unknown as NodeList,
    });

    cache.read();
    expect(h.unobserve).toHaveBeenCalledWith(el);

    cache.dispose();
  });

  it('clears detached transitions', () => {
    const h = makeHarness();
    const el = h.element();

    const cache = new LabelExclusions(
      h.doc,
      h.observers,
    );

    cache.start();
    cache.read();

    h.transition('transitionrun', el);
    cache.read();

    el.isConnected = false;
    h.mutate({
      type: 'childList',
      addedNodes: [] as unknown as NodeList,
      removedNodes: [el] as unknown as NodeList,
    });

    cache.read();
    const calls = el.getBoundingClientRect.mock.calls.length;

    for (let i = 0; i < 100; i++) cache.read();

    expect(
      el.getBoundingClientRect.mock.calls.length,
    ).toBe(calls);

    cache.dispose();
  });

  it('disconnects observers on dispose', () => {
    const h = makeHarness();
    h.element();

    const cache = new LabelExclusions(
      h.doc,
      h.observers,
    );

    cache.start();
    cache.read();
    cache.dispose();

    expect(h.disconnectMutation).toHaveBeenCalledTimes(1);
    expect(h.disconnectResize).toHaveBeenCalledTimes(1);
    expect(h.win.removeEventListener).toHaveBeenCalled();
  });
});

describe('hasExcluded', () => {
  it('detects a newly inserted excluded element', () => {
    const excluded = {
      nodeType: 1,
      matches: (s: string) => s === SELECTOR,
      querySelector: () => null,
    };

    expect(
      hasExcluded([excluded] as unknown as NodeList),
    ).toBe(true);
  });

  it('ignores ordinary text nodes', () => {
    expect(
      hasExcluded(
        [{ nodeType: 3 }] as unknown as NodeList,
      ),
    ).toBe(false);
  });

  it('detects an excluded descendant in a wrapper', () => {
    const wrapper = {
      nodeType: 1,
      matches: () => false,
      querySelector: (s: string) =>
        s === SELECTOR ? {} : null,
    };

    expect(
      hasExcluded([wrapper] as unknown as NodeList),
    ).toBe(true);
  });
});

