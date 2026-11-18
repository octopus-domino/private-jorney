import type { Poi } from '../../domain/Poi';
import { buildingProfileRepository } from '../../infrastructure';
import { summarizeBuildingProfile, BUILDING_CRITERIA } from '../../application/use-cases/summarizeBuildingProfile';
import { usePoiEnrichment } from '../hooks/usePoiEnrichment';
import { MAINTENANCE_STANDARD_URL } from '../../domain/maintenancePolicy';
import { ApartmentListingsSection } from './ApartmentListingsSection';
import { GorodSourceError } from '../../infrastructure/api/gorodSourceError';

export function BuildingProfileSection({ poi }: { poi: Poi }) {
  const { data: profile, status, retry, error } = usePoiEnrichment(poi, buildingProfileRepository);
  if (status === 'unsupported') return <>
    <p className="source-state">Сведения о доме доступны для Санкт-Петербурга и Москвы. В других городах можно посмотреть историю места и объявления.</p>
    {poi.details?.address && <ApartmentListingsSection address={poi.details.address} point={{ lat: poi.lat, lng: poi.lng }} />}
  </>;
  return (
    <section className="building-profile" aria-label="Дом простыми словами" aria-live="polite">
      {status === 'loading' && <p className="source-state">Загружаем паспорт дома…</p>}
      {status === 'error' && <div className="source-state"><p>Не удалось получить сведения о доме.</p>{error instanceof GorodSourceError && <p>{error.message}</p>}<button type="button" className="btn" onClick={retry}>Повторить</button></div>}
      {status === 'empty' && <p className="source-state">Не удалось однозначно найти этот дом в городском реестре.</p>}
      {profile && <>
        <p className="building-profile__address">{profile.address}</p>
        {profile.passportStatus && <div className="source-state"><p>{profile.passportStatus === 'updating'
          ? 'Городской портал сообщает: технический паспорт находится на актуализации. Подробные характеристики пока не опубликованы.'
          : 'Городской портал пока не опубликовал технический паспорт этого здания.'}</p>
          <button type="button" className="btn" onClick={retry}>Проверить сведения ещё раз</button></div>}
        <dl className="building-facts">
          {summarizeBuildingProfile(profile).map((fact) => <div className="building-fact" key={fact.label}>
            <dt>{fact.label}</dt><dd>{fact.value}</dd>
            {fact.detail && <dd><details><summary>Подробнее</summary><p>{fact.detail}</p></details></dd>}
          </div>)}
        </dl>
        {!profile.passportStatus && <details className="building-profile__criteria"><summary>Как составлена сводка</summary><p>{BUILDING_CRITERIA}</p><a href={MAINTENANCE_STANDARD_URL} target="_blank" rel="noopener noreferrer">Источник нормативных порогов</a><p>Сведения из паспорта могут обновляться с задержкой. Получены {new Date(profile.fetchedAt).toLocaleDateString('ru-RU')}.</p></details>}
        <a className="source-link" href={profile.sourceUrl} target="_blank" rel="noopener noreferrer">{profile.passportStatus ? 'Страница здания на «Наш Санкт-Петербург» ↗' : profile.sourceName ? `Источник: ${profile.sourceName} ↗` : 'Паспорт этого дома на «Наш Санкт-Петербург» ↗'}</a>
        {profile.maintenance && <details className="building-profile__criteria"><summary>Источник сведений о ремонте</summary>
          <a href={profile.maintenance.sourceUrl} target="_blank" rel="noopener noreferrer">{profile.maintenance.sourceName} ↗</a>
          <p>Получены {new Date(profile.maintenance.fetchedAt).toLocaleDateString('ru-RU')}. Набор может содержать не все работы по дому. Отсутствие записи не означает, что ремонта не было. Даты работ не определяют степень износа.</p>
        </details>}
        {profile.maintenanceUnavailable && <div className="source-state"><p>Основные сведения загружены. Источник капремонта сейчас не ответил.</p><button type="button" className="btn" onClick={retry}>Повторить загрузку ремонта</button></div>}
      </>}
      {(profile?.address || poi.details?.address) && <ApartmentListingsSection
        address={profile?.address ?? poi.details!.address!}
        point={{ lat: poi.lat, lng: poi.lng }}
      />}
    </section>
  );
}
