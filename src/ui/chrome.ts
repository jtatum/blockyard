/**
 * Minimal UI chrome (product U2): palette bar, a few icon buttons, first-run
 * hint. Pure DOM — no framework in or near the render loop.
 */

import { PALETTE } from '../town/palette';

export interface ChromeCallbacks {
  onColor(index: number): void;
  onUndo(): void;
  onRedo(): void;
  onToggleGrid(): void;
}

export interface Chrome {
  setColor(index: number): void;
  readonly color: number;
}

export function initChrome(root: HTMLElement, cb: ChromeCallbacks): Chrome {
  const style = document.createElement('style');
  style.textContent = `
    .by-bar {
      position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%);
      display: flex; gap: 7px; padding: 9px 11px; border-radius: 16px;
      background: rgba(255,255,255,0.55); backdrop-filter: blur(10px);
      pointer-events: auto; box-shadow: 0 4px 20px rgba(30,50,70,0.18);
      transition: opacity 0.5s; flex-wrap: wrap; justify-content: center;
      max-width: min(92vw, 700px);
    }
    .by-swatch {
      width: 30px; height: 30px; border-radius: 50%;
      border: 2.5px solid rgba(255,255,255,0.65); cursor: pointer;
      transition: transform 0.12s ease-out, border-color 0.12s;
      outline: none; padding: 0;
    }
    .by-swatch:hover { transform: scale(1.14); }
    .by-swatch:focus-visible { border-color: #2b6cb0; }
    .by-swatch.sel { transform: scale(1.18); border-color: #334; }
    .by-corner {
      position: absolute; top: 14px; right: 14px; display: flex; gap: 6px;
      pointer-events: auto;
    }
    .by-btn {
      min-width: 34px; height: 34px; border-radius: 10px; border: none;
      background: rgba(255,255,255,0.55); backdrop-filter: blur(10px);
      cursor: pointer; font-size: 15px; color: #2c3e50; padding: 0 8px;
      box-shadow: 0 2px 10px rgba(30,50,70,0.15);
    }
    .by-btn:hover { background: rgba(255,255,255,0.8); }
    .by-hint {
      position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
      color: rgba(40,60,80,0.85); font-size: 14px; pointer-events: none;
      background: rgba(255,255,255,0.4); padding: 6px 14px; border-radius: 10px;
      backdrop-filter: blur(6px); transition: opacity 1.2s;
    }
  `;
  document.head.appendChild(style);

  let selected = 0;
  const bar = document.createElement('div');
  bar.className = 'by-bar';
  const swatches: HTMLButtonElement[] = [];
  PALETTE.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'by-swatch';
    b.style.background = '#' + p.hex.toString(16).padStart(6, '0');
    b.title = `${p.name}${i < 9 ? ` (${i + 1})` : i === 9 ? ' (0)' : ''}`;
    b.addEventListener('click', () => api.setColor(i));
    swatches.push(b);
    bar.appendChild(b);
  });
  root.appendChild(bar);

  const corner = document.createElement('div');
  corner.className = 'by-corner';
  const mkBtn = (label: string, title: string, fn: () => void) => {
    const b = document.createElement('button');
    b.className = 'by-btn';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', fn);
    corner.appendChild(b);
    return b;
  };
  mkBtn('↩', 'Undo (Ctrl+Z)', cb.onUndo);
  mkBtn('↪', 'Redo (Ctrl+Shift+Z)', cb.onRedo);
  mkBtn('#', 'Toggle grid (G)', cb.onToggleGrid);
  root.appendChild(corner);

  const hint = document.createElement('div');
  hint.className = 'by-hint';
  hint.textContent = 'Click to build · right-click to remove · drag right button to orbit';
  root.appendChild(hint);
  const fadeHint = () => {
    hint.style.opacity = '0';
    setTimeout(() => hint.remove(), 1500);
    window.removeEventListener('pointerdown', fadeHint);
  };
  setTimeout(fadeHint, 9000);
  window.addEventListener('pointerdown', fadeHint);

  const api: Chrome = {
    setColor(i: number) {
      selected = ((i % PALETTE.length) + PALETTE.length) % PALETTE.length;
      swatches.forEach((s, j) => s.classList.toggle('sel', j === selected));
      cb.onColor(selected);
    },
    get color() {
      return selected;
    },
  };
  api.setColor(0);
  return api;
}
