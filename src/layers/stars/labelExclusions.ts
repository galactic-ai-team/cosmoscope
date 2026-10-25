import type { LabelRect } from './labelCollision';

const SELECTOR = '[data-label-exclude]';

export class LabelExclusions {
  private readonly elements: HTMLElement[] = [];
  private readonly rects: LabelRect[] = [];

  private activeCount = 0;
  private dirty = true;
  private started = false;
  private transitioning = new Set<Element>();

  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(private readonly doc: Document) {}

  private readonly invalidate = (): void => {
    this.dirty = true;
  };

  private readonly onTransitionRun = (event: Event): void => {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest(SELECTOR)) return;

    this.transitioning.add(event.target);
    this.invalidate();
  };

  private readonly onTransitionEnd = (event: Event): void => {
    if (!(event.target instanceof Element)) return;

    this.transitioning.delete(event.target);
    this.invalidate();
  };

  start(): void {
    if (this.started) return;
    this.started = true;

    const win = this.doc.defaultView;
    if (!win) return;

    this.mutationObserver = new MutationObserver(
      this.invalidate,
    );

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

    this.resizeObserver = new ResizeObserver(
      this.invalidate,
    );

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
   * Returns a reusable rectangle pool and active count.
   * Measurements run only when dirty or transitioning.
   */
  read(): {
    rects: readonly LabelRect[];
    count: number;
  } {
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

    this.resizeObserver?.disconnect();
    this.elements.length = 0;

    const nodes = this.doc.querySelectorAll<HTMLElement>(
      SELECTOR,
    );

    for (const el of nodes) {
      this.elements.push(el);
      this.resizeObserver?.observe(el);

      if (
        el.hidden ||
        this.doc.defaultView
          ?.getComputedStyle(el).display === 'none'
      ) {
        continue;
      }

      const bounds = el.getBoundingClientRect();

      if (bounds.width <= 0 || bounds.height <= 0) {
        continue;
      }

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
    if (!this.started) return;

    this.mutationObserver?.disconnect();
    this.resizeObserver?.disconnect();

    const win = this.doc.defaultView;

    win?.removeEventListener('resize', this.invalidate);

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

    this.transitioning.clear();
    this.elements.length = 0;
    this.activeCount = 0;

    this.mutationObserver = null;
    this.resizeObserver = null;
    this.started = false;
    this.dirty = true;
  }
}
