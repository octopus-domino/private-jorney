// src/presentation/components/RadiusSlider.tsx
interface RadiusSliderProps {
  value: number;
  onChange(value: number): void;
}

const MIN = 100;
const MAX = 5000;
const STEP = 50;

export function RadiusSlider({ value, onChange }: RadiusSliderProps) {
  return (
    <div className="radius">
      <div className="radius__value">
        {value < 1000 ? `${value} м` : `${(value / 1000).toFixed(1)} км`}
      </div>
      <input
        className="radius__input"
        type="range"
        min={MIN}
        max={MAX}
        step={STEP}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="radius__scale">
        <span>100 м</span>
        <span>5 км</span>
      </div>
    </div>
  );
}