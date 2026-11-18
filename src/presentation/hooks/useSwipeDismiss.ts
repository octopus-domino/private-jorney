import { useEffect, useRef } from 'react';
import { SwipeDismissGesture } from './swipeDismissGesture';

/** Shares one downward-dismiss gesture between cards, dialogs and the route drawer. */
export function useSwipeDismiss<T extends HTMLElement>(onDismiss: () => void, enabled = true) {
  const ref = useRef<T | null>(null);
  const callback = useRef(onDismiss);
  callback.current = onDismiss;

  useEffect(() => {
    if (!enabled || !ref.current) return;
    const gesture = new SwipeDismissGesture(ref.current, () => callback.current());
    return gesture.attach();
  }, [enabled]);

  return ref;
}
