import { useEffect } from 'react';
import { useRecordingStore } from '../state/recordingStore';

/** Suspended or hidden WebViews do no polling. The native service keeps its own durable GPS journal. */
export function useRecordingLifecycle(): void {
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void useRecordingStore.getState().sync(); };
    refresh();
    const timer = setInterval(() => { if (useRecordingStore.getState().active) refresh(); }, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh); };
  }, []);
}
