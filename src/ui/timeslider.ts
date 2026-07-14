/**
 * Sun control (product L1) — a small floating glass pill, bottom-left, with
 * two thin slider rows: time-of-day t∈0..1 (glyph flips sun → low-sun → moon
 * so it explains itself) and sun azimuth 0..1 (🧭, one full turn of the sun
 * path around the town, 0 = classic east→west arc). Pure DOM, self-styled to
 * match the chrome's glass look. `set()` updates the control without echoing
 * onChange (for restoring saved state without a feedback loop).
 */

export function initTimeSlider(
  root: HTMLElement,
  initialTime: number,
  initialAzimuth: number,
  onChange: (t: number, azimuth: number) => void
): { set(t: number, azimuth: number): void } {
  const style = document.createElement('style');
  style.textContent = `
    .by-time {
      position: absolute; left: 18px; bottom: 18px; width: 200px;
      display: flex; flex-direction: column; gap: 6px; padding: 9px 14px;
      border-radius: 16px; background: rgba(255,255,255,0.55);
      backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(30,50,70,0.18);
      pointer-events: auto; box-sizing: border-box;
    }
    .by-time-row {
      display: flex; align-items: center; gap: 10px;
    }
    .by-time-glyph {
      font-size: 16px; width: 20px; text-align: center; user-select: none;
      flex: none;
    }
    .by-time input[type='range'] {
      flex: 1; min-width: 0; margin: 0; height: 18px;
      accent-color: #446; cursor: pointer;
    }
    .by-time-row-az .by-time-glyph { font-size: 13px; }
    .by-time-row-az input[type='range'] { height: 14px; }
  `;
  document.head.appendChild(style);

  const glyphFor = (t: number): string =>
    t >= 0.85 ? '🌙' : t >= 0.7 || t < 0.12 ? '🌅' : '☀️';
  const clamp = (t: number): number => Math.min(1, Math.max(0, t));

  const makeRow = (title: string, extraClass?: string): [HTMLDivElement, HTMLSpanElement, HTMLInputElement] => {
    const row = document.createElement('div');
    row.className = 'by-time-row' + (extraClass ? ` ${extraClass}` : '');
    const glyph = document.createElement('span');
    glyph.className = 'by-time-glyph';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.001';
    slider.title = title;
    row.appendChild(glyph);
    row.appendChild(slider);
    return [row, glyph, slider];
  };

  const pill = document.createElement('div');
  pill.className = 'by-time';
  const [timeRow, glyph, timeSlider] = makeRow('Time of day');
  const [azRow, azGlyph, azSlider] = makeRow('Sun direction', 'by-time-row-az');
  azGlyph.textContent = '🧭';
  pill.appendChild(timeRow);
  pill.appendChild(azRow);
  root.appendChild(pill);

  const show = (t: number, azimuth: number): void => {
    timeSlider.value = String(t);
    azSlider.value = String(azimuth);
    glyph.textContent = glyphFor(t);
  };
  show(clamp(initialTime), clamp(initialAzimuth));

  const emit = (): void => {
    const t = clamp(Number(timeSlider.value));
    glyph.textContent = glyphFor(t);
    onChange(t, clamp(Number(azSlider.value)));
  };
  timeSlider.addEventListener('input', emit);
  azSlider.addEventListener('input', emit);

  return {
    set(t: number, azimuth: number): void {
      show(clamp(t), clamp(azimuth));
    },
  };
}
