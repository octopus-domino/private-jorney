import { ReadyWalks } from '../components/ReadyWalks';

interface WelcomeProps { onExplore(): void; onRecord(): void; onGuide(): void; active: boolean }

/** Explains the value before asking for permissions or starting any location watcher. */
export function WelcomePage({ onExplore, onRecord, onGuide, active }: WelcomeProps) {
  return <main className="journey-home">
    <header className="journey-home__header"><span className="journey-brand">Пешком <span>· личные прогулки</span></span><button className="journey-link" onClick={onGuide}>Как это работает</button></header>
    <section className="journey-hero">
      <div className="journey-hero__copy"><span className="journey-eyebrow">Ваш город. Ваш темп.</span>
        <h1>У каждой прогулки<br />есть своя история</h1>
        <p>Открывайте необычные дома, находите места рядом и сохраняйте пройденный путь — вместе с историями, которые встретились по дороге.</p>
        <div className="journey-actions"><button className="journey-button" onClick={onRecord}>{active ? 'Продолжить запись' : 'Записать прогулку'}</button><button className="journey-button journey-button--secondary" onClick={onExplore}>Исследовать карту</button></div>
        <span className="journey-muted">Без регистрации. Ваши записи хранятся на устройстве.</span>
      </div>
      <RouteIllustration />
    </section>
    <ReadyWalks />
    <section className="journey-features" aria-label="Возможности приложения">
      <Feature number="01" title="Посмотрите на дом иначе" text="Коснитесь здания на карте: узнайте его историю, архитектуру и доступные сведения о доме." />
      <Feature number="02" title="Найдите повод свернуть" text="Выберите точку, область и интересы. Добавьте понравившиеся места в маршрут или избранное." />
      <Feature number="03" title="Оставьте прогулку себе" text="От первого шага до последнего: путь, его схема и рассказ о встреченных местах в одной записи." />
    </section>
    <footer className="journey-home__footer"><span>Больше замечать. Меньше спешить.</span><button className="journey-link" onClick={onGuide}>Что можно узнать о домах →</button></footer>
  </main>;
}

function Feature({ number, title, text }: { number: string; title: string; text: string }) {
  return <article><span className="journey-eyebrow">{number}</span><h2>{title}</h2><p>{text}</p></article>;
}

function RouteIllustration() {
  return <svg className="journey-illustration" viewBox="0 0 480 400" role="img" aria-label="Пешая прогулка среди городских домов">
    <rect x="12" y="12" width="456" height="376" rx="100" fill="#e7ede2" />
    <path d="M30 250L450 140M100 20L190 390M280 15L370 390" stroke="#f9faf5" strokeWidth="36" fill="none" />
    <g fill="#ced9c8" stroke="#becfb9" strokeWidth="2"><rect x="65" y="65" width="70" height="85" rx="8" transform="rotate(-14 100 100)" /><rect x="214" y="62" width="61" height="72" rx="8" /><rect x="230" y="251" width="65" height="86" rx="8" transform="rotate(-14 260 280)" /><rect x="363" y="224" width="63" height="62" rx="8" /></g>
    <path d="M109 324L84 234L186 207L166 134L313 95L337 182L395 166" stroke="#317559" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none" strokeDasharray="1 11" />
    <circle cx="109" cy="324" r="12" fill="#317559" stroke="white" strokeWidth="5" />
    <circle cx="395" cy="166" r="12" fill="#c58953" stroke="white" strokeWidth="5" />
    <g transform="translate(195 155)"><rect width="148" height="49" rx="15" fill="white" /><text x="18" y="30" fill="#365849" fontSize="14" fontFamily="sans-serif">Истории по пути</text></g>
    <g fill="#8fae87"><circle cx="69" cy="302" r="16" /><circle cx="410" cy="101" r="20" /><circle cx="322" cy="327" r="17" /></g>
  </svg>;
}
