// src/presentation/components/LegendBar.tsx
import type { Poi } from '../../domain/Poi';

interface LegendBarProps {
  pois: Poi[];
}

export function LegendBar({ pois }: LegendBarProps) {
  const total = pois.length;
  const history = pois.filter((p) => p.source === 'historical-house').length;
  const mystic = pois.filter((p) => p.source === 'mystic-place').length;
  const withDetails = pois.filter(
    (p) => p.details?.historicalFacts?.length || p.details?.mysticalFacts?.length,
  ).length;

  return (
    <div className="legend">
      {total > 0 && <span className="legend__item">{total} точек</span>}
      {history > 0 && <span className="legend__item legend__item--history">{history} исторических</span>}
      {mystic > 0 && <span className="legend__item legend__item--mystic">{mystic} мистических</span>}
      {withDetails > 0 && <span className="legend__item">{withDetails} с фактами</span>}
    </div>
  );
}
