// src/App.tsx
import { PlanPage } from './presentation/pages/PlanPage';
import { useState } from 'react';
import { WelcomePage } from './presentation/pages/WelcomePage';
import { GuidePage } from './presentation/pages/GuidePage';
import { RecordingSheet } from './presentation/components/RecordingSheet';
import { useRecordingLifecycle } from './presentation/hooks/useRecordingLifecycle';
import { useRecordingStore } from './presentation/state/recordingStore';

export function App() {
  const [page, setPage] = useState<'home' | 'map' | 'guide'>(() => location.search || location.hash ? 'map' : 'home');
  const [recording, setRecording] = useState(false);
  const active = useRecordingStore(state => state.active);
  useRecordingLifecycle();
  return <>
    {page === 'home' && <WelcomePage active={active} onExplore={() => setPage('map')} onRecord={() => setRecording(true)} onGuide={() => setPage('guide')} />}
    {page === 'guide' && <GuidePage onClose={() => setPage('home')} onExplore={() => setPage('map')} />}
    {page === 'map' && <PlanPage onHome={() => setPage('home')} onRecord={() => setRecording(true)} />}
    {recording && <RecordingSheet onClose={() => setRecording(false)} />}
  </>;
}
