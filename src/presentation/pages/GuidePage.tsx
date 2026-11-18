import { useSwipeDismiss } from '../hooks/useSwipeDismiss';

/** Concrete guide reflects source coverage and never promises facts missing from an actual house passport. */
export function GuidePage({ onClose, onExplore }: { onClose(): void; onExplore(): void }) {
  const ref = useSwipeDismiss<HTMLElement>(onClose);
  return <main ref={ref} className="journey-guide">
    <header><button className="journey-link" onClick={onClose}>← Назад</button><span className="journey-brand">Пешком</span></header>
    <span className="journey-eyebrow">Небольшой путеводитель</span><h1>Город становится<br />интереснее вблизи</h1>
    <section><span className="guide-symbol" aria-hidden="true">⌂</span><div><h2>Коснитесь любого дома</h2><p>Откроется карточка выбранного места. Для Петербурга ищем историю и фотографии на Citywalls, для Москвы — на «Узнай Москву». Ссылка на источник поможет прочитать больше.</p><p>В Петербурге городской портал дополняет карточку: этажность, материалы, состояние конструкций, сведения о ремонте и доступная статистика жителей. Для Москвы используем официальные открытые данные: год постройки, этажность, проект, подъезды и лифты. Показываем только имеющиеся данные — без пустых строк и догадок.</p></div></section>
    <section><span className="guide-symbol" aria-hidden="true">◎</span><div><h2>Исследуйте область</h2><p>Найдите адрес или нажмите на карту и выберите «Начать отсюда». В разделе «Маршрут» настройте радиус и интересы. Можно добавить несколько точек: места ищутся вокруг каждой.</p><p>Нажмите на число на карте, чтобы раскрыть список мест. Звёздочка в карточке сохранит находку в избранное вашего города.</p></div></section>
    <section><span className="guide-symbol" aria-hidden="true">↝</span><div><h2>Запишите настоящую прогулку</h2><p>Нажмите «Начать запись» перед выходом и «Завершить прогулку» в конце. Приложение сохранит ваш путь и дополнит его рассказом о местах рядом — в порядке прохождения.</p><p>В Android запись продолжается с выключенным экраном и отображается в уведомлении. Путь, схема и полученный текст доступны позже без интернета. Для новых сведений о домах нужно соединение.</p></div></section>
    <button className="journey-button" onClick={onExplore}>Открыть карту</button>
    <p className="journey-muted">Доступность сведений зависит от города и внешнего источника. Данные объявлений могут быть ограничены самим сайтом.</p>
  </main>;
}
