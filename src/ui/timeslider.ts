/**
 * Time-of-day slider (product L1) — a small floating pill, bottom-left, that
 * scrubs t∈0..1. Pure DOM, self-styled to match the chrome's glass look; the
 * glyph flips sun → low-sun → moon so the control explains itself without a
 * label. `set()` updates the control without echoing onChange (for restoring
 * saved state without a feedback loop).
 */

export function initTimeSlider(
  root: HTMLElement,
  initial: number,
  onChange: (t: number) => void
): { set(t: number): void } {
  const style = document.createElement('style');
  style.textContent = `
    .by-time {
      position: absolute; left: 18px; bottom: 18px; width: 200px;
      display: flex; align-items: center; gap: 10px; padding: 9px 14px;
      border-radius: 16px; background: rgba(255,255,255,0.55);
      backdrop-filter: blur(10px); box-shadow: 0 4px 20px rgba(30,50,70,0.18);
      pointer-events: auto; box-sizing: border-box;
    }
    .by-time-glyph {
      font-size: 16px; width: 20px; text-align: center; user-select: none;
      flex: none;
    }
    .by-time input[type='range'] {
      flex: 1; min-width: 0; margin: 0; height: 18px;
      accent-color: #446; cursor: pointer;
    }
  `;
  document.head.appendChild(style);

  const glyphFor = (t: number): string =>
    t >= 0.85 ? '🌙' : t >= 0.7 || t < 0.12 ? '🌅' : '☀️';
  const clamp = (t: number): number => Math.min(1, Math.max(0, t));

  const pill = document.createElement('div');
  pill.className = 'by-time';
  const glyph = document.createElement('span');
  glyph.className = 'by-time-glyph';
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '1';
  slider.step = '0.001';
  slider.title = 'Time of day';
  pill.appendChild(glyph);
  pill.appendChild(slider);
  root.appendChild(pill);

  const show = (t: number): void => {
    slider.value = String(t);
    glyph.textContent = glyphFor(t);
  };
  show(clamp(initial));

  slider.addEventListener('input', () => {
    const t = clamp(Number(slider.value));
    glyph.textContent = glyphFor(t);
    onChange(t);
  });

  return {
    set(t: number): void {
      show(clamp(t));
    },
  };
}
