// src/infrastructure/index.ts
import { HttpPlaceRecommendationsRepository } from './api/httpPlaceRecommendationsRepository';
import { HttpHistoricalHouseRepository } from './api/httpHistoricalHouseRepository';
import { HttpRoutePlanner } from './api/httpRoutePlanner';
import { HttpPlaceInfoRepository } from './api/httpPlaceInfoRepository';
import { PhotonGeocoder } from './api/photonGeocoder';
import { LocalDraftStore } from './persistence/localDraftStore';
import { CitywallsHistoryRepository } from './api/citywallsHistoryRepository';
import { GorodBuildingProfileRepository } from './api/gorodBuildingProfileRepository';
import { CianApartmentListingsRepository } from './api/cianApartmentListingsRepository';
import { AvitoApartmentListingsRepository } from './api/avitoApartmentListingsRepository';
import { LocalFavoritesRepository } from './persistence/localFavoritesRepository';
import { FavoritePlacesService } from '../application/use-cases/favoritePlacesService';
import { CityHistoryRepository } from './api/cityHistoryRepository';
import { MoscowHistoryRepository } from './api/moscowHistoryRepository';
import { CodocAreaPoiRepository } from './api/codocAreaPoiRepository';
import { MoscowDataClient } from './api/moscowDataClient';
import { MoscowBuildingProfileRepository } from './api/moscowBuildingProfileRepository';
import { CityBuildingProfileRepository } from './api/cityBuildingProfileRepository';
import { Capacitor } from '@capacitor/core';
import { NativeWalkRecorder } from './recording/nativeWalkRecorder';
import { BrowserWalkRecorder } from './recording/browserWalkRecorder';
import { IndexedWalkRecordingRepository } from './persistence/indexedWalkRecordingRepository';
import { TrackCorridorRepository } from './recording/trackCorridorRepository';
import { RecordedWalkEnricher } from '../application/use-cases/enrichRecordedWalk';
import { RecordedWalkService } from '../application/use-cases/recordedWalkService';

const geocoder = new PhotonGeocoder();

export const placeRepository = new HttpPlaceRecommendationsRepository();
export const historicalHouseRepository = new HttpHistoricalHouseRepository();
export const routePlanner = new HttpRoutePlanner();
export const placeInfoRepository = new HttpPlaceInfoRepository(geocoder);
export { geocoder };
export const draftStore = new LocalDraftStore();
const citywalls = new CitywallsHistoryRepository();
const moscow = new MoscowHistoryRepository();
export const placeHistoryRepository = new CityHistoryRepository([
  { name: 'Citywalls', repository: citywalls },
  { name: 'Узнай Москву', repository: moscow },
]);
export const areaPoiRepository = new CodocAreaPoiRepository(historicalHouseRepository, placeRepository);
export const buildingProfileRepository = new CityBuildingProfileRepository([
  new GorodBuildingProfileRepository(geocoder),
  new MoscowBuildingProfileRepository(new MoscowDataClient(import.meta.env.VITE_MOS_DATA_API_KEY ?? ''), geocoder),
]);
export const apartmentListingsRepository = new CianApartmentListingsRepository();
export const avitoListingsRepository = new AvitoApartmentListingsRepository();
export const favoritePlaces = new FavoritePlacesService(new LocalFavoritesRepository(), geocoder);
export const recordedWalks = new RecordedWalkService(
  Capacitor.getPlatform() === 'android' ? new NativeWalkRecorder() : new BrowserWalkRecorder(),
  new IndexedWalkRecordingRepository(),
  new RecordedWalkEnricher(new TrackCorridorRepository(), areaPoiRepository, placeHistoryRepository, geocoder),
);
