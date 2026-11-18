import type { Poi } from './Poi';
import type { PlaceHistory } from './PlaceHistory';

export interface TrackPoint { lat: number; lng: number; accuracy: number; timestamp: number }
export interface RawWalkSession {
  id: string; startedAt: number; endedAt?: number; state: 'recording' | 'stopped' | 'interrupted';
  pointCount: number; distanceMeters: number; lastPoint?: TrackPoint; points?: TrackPoint[];
}
export interface RecordedPlace {
  poi: Poi; side: 'left' | 'right' | 'nearby'; progressMeters: number;
  history?: PlaceHistory; photoDataUrl?: string;
}
export interface RecordedWalk {
  id: string; title: string; city?: string; startedAt: number; endedAt: number;
  points: TrackPoint[]; matchedPath?: { lat: number; lng: number }[];
  distanceMeters: number; places: RecordedPlace[]; paragraphs: string[]; previewSvg: string;
  status: 'saved' | 'partial' | 'ready'; interrupted: boolean;
  graph?: { matchedSamples: number; sourceSamples: number; crossings: number };
}
