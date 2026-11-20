import { walkSpeedLegend } from '../../domain/walkSpeed';
import './walkSpeed.css';

export function WalkSpeedLegend() {
  return <ul className="walk-speed-legend" aria-label="Скорость на маршруте">
    {walkSpeedLegend.map(({ id, color, label }) => <li key={id}>
      <span className={id === 'unknown' ? 'walk-speed-legend__gap' : undefined}
        style={{ borderColor: color }} aria-hidden="true" />
      {label}
    </li>)}
  </ul>;
}
