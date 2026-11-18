const DEAD_ZONE_PX = 8;
const DISMISS_DISTANCE_PX = 80;

/** Owns gesture state without stealing upward scrolling, nested scrolling or horizontal gestures. */
export class SwipeDismissGesture {
  private start: { x: number; y: number } | null = null;
  private offset = 0;
  private suppressClick = false;
  private initialTransform = '';
  private initialTransition = '';
  private baseTransform = '';

  constructor(private readonly element: HTMLElement, private readonly dismiss: () => void) {}

  /** Installs non-passive move handling only on the sheet; cleanup restores its original styles. */
  attach(): () => void {
    this.element.addEventListener('touchstart', this.onStart, { passive: true });
    this.element.addEventListener('touchmove', this.onMove, { passive: false });
    this.element.addEventListener('touchend', this.onEnd);
    this.element.addEventListener('touchcancel', this.onCancel);
    this.element.addEventListener('click', this.onClick, true);
    return () => {
      this.element.removeEventListener('touchstart', this.onStart);
      this.element.removeEventListener('touchmove', this.onMove);
      this.element.removeEventListener('touchend', this.onEnd);
      this.element.removeEventListener('touchcancel', this.onCancel);
      this.element.removeEventListener('click', this.onClick, true);
      this.reset();
    };
  }

  private onStart = (event: TouchEvent) => {
    this.reset();
    this.suppressClick = false;
    if (event.touches.length !== 1 || !(event.target instanceof HTMLElement)) return;
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (!this.canPull(event.target)) return;
    this.initialTransform = this.element.style.transform;
    this.initialTransition = this.element.style.transition;
    this.baseTransform = getComputedStyle(this.element).transform.replace(/^none$/, '');
    this.start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  };

  private canPull(target: HTMLElement): boolean {
    for (let node: HTMLElement | null = target; node; node = node.parentElement) {
      const scrollable = /^(auto|scroll)$/.test(getComputedStyle(node).overflowY);
      if (scrollable && node.scrollTop > 0 && node.scrollHeight > node.clientHeight) return false;
      if (node === this.element) break;
    }
    return true;
  }

  private onMove = (event: TouchEvent) => {
    if (!this.start) return;
    if (event.touches.length !== 1) { this.reset(); return; }
    const dy = event.touches[0].clientY - this.start.y;
    const dx = Math.abs(event.touches[0].clientX - this.start.x);
    if (Math.max(dx, Math.abs(dy)) < DEAD_ZONE_PX) return;
    if (dy < 0 || dx > dy) { this.reset(); return; }
    this.offset = dy;
    this.suppressClick = true;
    this.element.style.transition = 'none';
    this.element.style.transform = `${this.baseTransform} translateY(${dy}px)`;
    if (event.cancelable) event.preventDefault();
    event.stopPropagation();
  };

  private onEnd = () => {
    const close = this.offset >= DISMISS_DISTANCE_PX;
    this.reset();
    if (close) this.dismiss();
  };

  private onCancel = () => { this.reset(); };

  private onClick = (event: MouseEvent) => {
    if (!this.suppressClick) return;
    event.preventDefault();
    event.stopPropagation();
    this.suppressClick = false;
  };

  private reset() {
    if (this.start) {
      this.element.style.transform = this.initialTransform;
      this.element.style.transition = this.initialTransition;
    }
    this.start = null;
    this.offset = 0;
  }
}
