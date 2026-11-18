import { readyWalks } from '../../application/use-cases/openReadyWalk';

/** Presets are owned by the walk application, including when embedded in CoDoc. */
export function ReadyWalks() {
  return <section className="journey-features" aria-label="Готовые прогулки по Петербургу">
    {readyWalks.map(walk => <article key={walk.id}>
      <span className="journey-eyebrow">Санкт-Петербург · {walk.places.length} места</span>
      <h2>{walk.title}</h2><p>{walk.description}</p>
      <ol>{walk.places.map(place => <li key={place.id}>{place.label}</li>)}</ol>
      <button className="journey-button journey-button--secondary" onClick={() => {
        const url = new URL(location.href);
        for (const key of ['draft', 'points', 'categories', 'view']) url.searchParams.delete(key);
        url.searchParams.set('preset', walk.id);
        location.assign(url.href);
      }}>Открыть прогулку</button>
    </article>)}
  </section>;
}
