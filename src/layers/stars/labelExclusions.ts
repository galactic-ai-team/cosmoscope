
import type { LabelRect } from './labelCollision';

const SELECTOR = '[data-label-exclude]';

type MutationObserverClass = new (
  callback: MutationCallback,
) => MutationObserver;

type ResizeObserverClass = new (
  callback: ResizeObserverCallback,
) => ResizeObserver;

export interface ExclusionObservers {
  Mutation: MutationObserverClass;
  Resize: ResizeObserverClass;
}

export function hasExcluded(nodes: NodeList): boolean {
  for (const node of nodes) {
    if (node.nodeType !== 1) continue;

    const el = node as Element;
    if (el.matches(SELECTOR) || el.querySelector(SELECTOR)) {
      return true;
    }
  }
  return false;
}

/**
 * Cached screen-space exclusion regions.
 *
 * - Reuses rectangle storage.
 * - Observes each exclusion element once.
 * - Ignores unrelated DOM mutations.
 * - Refreshes during relevant CSS transitions.
 * - Releases observers and event listeners on dispose.
 *
 * Call start() after the application's UI has mounted.
 */
export class LabelExclusions {
  private readonly rects: LabelRect[] = [];
  private readonly observed = new Set<Element>();
  private readonly transitioning = new Set<Element>();

  private activeCount = 0;
  private dirty = true;
  private started = false;

  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private readonly doc: Document,
    private readonly observers?: ExclusionObservers,
  ) {}

  private readonly invalidate = (): void => {
    this.dirty = true;
  };

  private readonly onMutations = (
    records: MutationRecord[],
  ): void => {
    for (const mutation of records) {
      if (mutation.type === 'attributes') {
        const target = mutation.target as Element;

        // An excluded element or one of its descendants.
        if (target.closest?.(SELECTOR)) {
          this.invalidate();
          return;
        }

        // Also handle a wrapper hiding an excluded child.
        if (target.querySelector?.(SELECTOR)) {
          this.invalidate();
          return;
        }

        // Handle removal of data-label-exclude itself:
        // the element may no longer match SELECTOR.
        if (
          mutation.attributeName === 'data-label-exclude'
        ) {
          this.invalidate();
          return;
        }
      } else if (
        mutation.type === 'childList' &&
        (
          hasExcluded(mutation.addedNodes) ||
          hasExcluded(mutation.removedNodes)
        )
      ) {
        this.invalidate();
        return;
      }
    }
  };

  private readonly onTransitionRun = (
    event: Event,
  ): void => {
    const target = event.target;

    if (
      !target ||
      (target as Node).nodeType !== 1
    ) return;

    const el = target as Element;

    if (!el.closest(SELECTOR)) return;

    this.transitioning.add(el);
    this.invalidate();
  };

  private readonly onTransitionEnd = (
    event: Event,
  ): void => {
    const target = event.target;

    if (
      !target ||
      (target as Node).nodeType !== 1
    ) return;

    this.transitioning.delete(target as Element);
    this.invalidate();
  };

  start(): void {
    if (this.started) return;

    const win = this.doc.defaultView;
    if (!win) return;

    const MutationClass =
      this.observers?.Mutation ?? win.MutationObserver;

    const ResizeClass =
      this.observers?.Resize ?? win.ResizeObserver;

    this.mutationObserver = new MutationClass(
      this.onMutations,
    );
    this.resizeObserver = new ResizeClass(
      this.invalidate,
    );

    this.started = true;

    this.mutationObserver.observe(this.doc.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'class',
        'style',
        'hidden',
        'data-label-exclude',
        'aria-expanded',
      ],
    });

    win.addEventListener('resize', this.invalidate);

    this.doc.addEventListener(
      'scroll',
      this.invalidate,
      true,
    );

    this.doc.addEventListener(
      'transitionrun',
      this.onTransitionRun,
      true,
    );

    this.doc.addEventListener(
      'transitionend',
      this.onTransitionEnd,
      true,
    );

    this.doc.addEventListener(
      'transitioncancel',
      this.onTransitionEnd,
      true,
    );

    this.invalidate();
  }

  /**
   * Provides the same reusable rectangle pool every read.
   *
   * Callers must only inspect indices below count.
   * The pool may contain inactive slots from prior frames.
   */
  read(): {
    rects: readonly LabelRect[];
    count: number;
  } {
    // Detached elements may never emit transitionend.
    for (const el of this.transitioning) {
      if (!el.isConnected) {
        this.transitioning.delete(el);
        this.invalidate();
      }
    }

    if (this.dirty || this.transitioning.size > 0) {
      this.refresh();
    }

    return {
      rects: this.rects,
      count: this.activeCount,
    };
  }

  private refresh(): void {
    this.dirty = false;
    this.activeCount = 0;

    const nodes = this.doc.querySelectorAll<HTMLElement>(
      SELECTOR,
    );

    const current = new Set<Element>(nodes);

    // Stop observing elements no longer excluded,
    // including those still connected but whose
    // attribute was removed.
    for (const el of this.observed) {
      if (!current.has(el) || !el.isConnected) {
        this.resizeObserver?.unobserve(el);
        this.observed.delete(el);
      }
    }

    for (const el of this.transitioning) {
      if (!el.isConnected) {
        this.transitioning.delete(el);
      }
    }

    for (const el of nodes) {
      // Observe exactly once per membership period.
      if (!this.observed.has(el)) {
        this.observed.add(el);
        this.resizeObserver?.observe(el);
      }

      if (el.hidden) continue;

      const bounds = el.getBoundingClientRect();

      if (
        bounds.width <= 0 ||
        bounds.height <= 0
      ) continue;

      const index = this.activeCount++;

      if (!this.rects[index]) {
        this.rects.push({
          left: 0,
          top: 0,
          right: 0,
          bottom: 0,
        });
      }

      const rect = this.rects[index];

      rect.left = bounds.left;
      rect.top = bounds.top;
      rect.right = bounds.right;
      rect.bottom = bounds.bottom;
    }
  }

  dispose(): void {
    this.mutationObserver?.disconnect();
    this.resizeObserver?.disconnect();

    if (this.started) {
      const win = this.doc.defaultView;

      win?.removeEventListener(
        'resize',
        this.invalidate,
      );

      this.doc.removeEventListener(
        'scroll',
        this.invalidate,
        true,
      );

      this.doc.removeEventListener(
        'transitionrun',
        this.onTransitionRun,
        true,
      );

      this.doc.removeEventListener(
        'transitionend',
        this.onTransitionEnd,
        true,
      );

      this.doc.removeEventListener(
        'transitioncancel',
        this.onTransitionEnd,
        true,
      );
    }

    this.observed.clear();
    this.transitioning.clear();

    this.activeCount = 0;
    this.dirty = true;
    this.started = false;

    this.mutationObserver = null;
    this.resizeObserver = null;
  }
}

