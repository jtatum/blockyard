/**
 * Minimal UI chrome (product U2): palette bar, a few icon buttons, first-run
 * hint. Pure DOM — no framework in or near the render loop.
 */

import { PALETTE } from '../town/palette';

export type Tool = 'build' | 'erase' | 'line' | 'area' | 'land' | 'water';

export interface ChromeCallbacks {
  onColor(index: number): void;
  onUndo(): void;
  onRedo(): void;
  onToggleGrid(): void;
  /** resolves true if the link landed on the clipboard */
  onShare(): Promise<boolean>;
  onNew(): void;
  onScreenshot(): void;
}

export interface Chrome {
  setColor(index: number): void;
  readonly color: number;
  setTool(tool: Tool): void;
  readonly tool: Tool;
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
    .by-tools {
      position: absolute; left: 50%; bottom: 76px; transform: translateX(-50%);
      display: flex; gap: 4px; padding: 5px 6px; border-radius: 12px;
      background: rgba(255,255,255,0.45); backdrop-filter: blur(10px);
      pointer-events: auto; box-shadow: 0 3px 14px rgba(30,50,70,0.14);
    }
    .by-tool {
      min-width: 34px; height: 30px; border-radius: 8px; border: none;
      background: transparent; cursor: pointer; font-size: 14px; color: #2c3e50;
      padding: 0 10px;
    }
    .by-tool:hover { background: rgba(255,255,255,0.6); }
    .by-tool.sel { background: rgba(44,62,80,0.85); color: #fff; }
    .by-bar, .by-tools, .by-corner { transition: opacity 0.9s ease; }
    .by-hint {
      position: absolute; top: 18px; left: 50%; transform: translateX(-50%);
      color: rgba(40,60,80,0.85); font-size: 14px; pointer-events: none;
      background: rgba(255,255,255,0.4); padding: 6px 14px; border-radius: 10px;
      backdrop-filter: blur(6px); transition: opacity 1.2s;
    }
    /* narrow screens: single-row scrollable palette, everything stacked clear
       (last in the sheet so these override the base rules above) */
    @media (max-width: 700px) {
      .by-time { bottom: auto !important; top: 12px !important; left: 12px !important; width: 150px !important; }
      .by-hint { top: 68px; max-width: 86vw; text-align: center; }
      .by-bar {
        bottom: 10px; flex-wrap: nowrap; overflow-x: auto; justify-content: flex-start;
        max-width: calc(100vw - 20px); padding: 7px 9px; scrollbar-width: none;
      }
      .by-swatch { width: 26px; height: 26px; flex: none; }
      .by-tools {
        bottom: 60px; flex-wrap: nowrap; overflow-x: auto;
        max-width: calc(100vw - 20px); scrollbar-width: none;
      }
      .by-tool { font-size: 12px; padding: 0 7px; white-space: nowrap; flex: none; }
      .by-corner { gap: 3px; right: 8px; }
      .by-btn { min-width: 30px; height: 30px; font-size: 13px; padding: 0 5px; }
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

  // tool rail: build / raise land / dig water
  let tool: Tool = 'build';
  const tools = document.createElement('div');
  tools.className = 'by-tools';
  const toolBtns = new Map<Tool, HTMLButtonElement>();
  const mkTool = (t: Tool, label: string, title: string) => {
    const b = document.createElement('button');
    b.className = 'by-tool';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => api.setTool(t));
    toolBtns.set(t, b);
    tools.appendChild(b);
  };
  mkTool('build', '⌂ build', 'Place blocks (B)');
  mkTool('erase', '⌫ erase', 'Remove blocks (E)');
  mkTool('line', '― line', 'Drag a straight run of blocks; Alt-drag removes (N)');
  mkTool('area', '▦ area', 'Drag to fill a region; Alt-drag removes (M)');
  mkTool('land', '▲ land', 'Raise land from water (L)');
  mkTool('water', '≈ water', 'Dig land down to water (W)');
  root.appendChild(tools);

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
  const shareBtn = mkBtn('⛓', 'Copy share link', () => {
    void cb.onShare().then((copied) => {
      // the URL bar always gets the link; tell the user what happened either way
      shareBtn.textContent = copied ? '✓' : '⚠';
      shareBtn.title = copied
        ? 'Link copied to clipboard'
        : 'Could not access the clipboard — copy the link from the address bar';
      setTimeout(() => {
        shareBtn.textContent = '⛓';
        shareBtn.title = 'Copy share link';
      }, 2500);
    });
  });
  mkBtn('📷', 'Save a picture', cb.onScreenshot);
  mkBtn('✕', 'New town', cb.onNew);
  root.appendChild(corner);

  const touch = window.matchMedia('(pointer: coarse)').matches;
  const hint = document.createElement('div');
  hint.className = 'by-hint';
  hint.textContent = touch
    ? 'Tap to build · drag to look around · ⌫ erases'
    : 'Click to build · right-click to remove · drag right button to orbit';
  root.appendChild(hint);
  let hintUses = 0;
  const fadeHint = () => {
    // survive the first couple of interactions so it can actually be read
    if (++hintUses < 3) return;
    hint.style.opacity = '0';
    setTimeout(() => hint.remove(), 1500);
    window.removeEventListener('pointerdown', fadeHint);
  };
  setTimeout(() => {
    hintUses = 99;
    fadeHint();
  }, 14000);
  window.addEventListener('pointerdown', fadeHint);

  // product U2: chrome dims when idle, wakes on any pointer/key activity
  let idleTimer = 0;
  const dimmables = [bar, tools, corner];
  const wake = () => {
    for (const el of dimmables) el.style.opacity = '1';
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      for (const el of dimmables) el.style.opacity = '0.35';
    }, 7000);
  };
  window.addEventListener('pointermove', wake, { passive: true });
  window.addEventListener('pointerdown', wake, { passive: true });
  window.addEventListener('keydown', wake);
  wake();

  const api: Chrome = {
    setColor(i: number) {
      selected = ((i % PALETTE.length) + PALETTE.length) % PALETTE.length;
      swatches.forEach((s, j) => s.classList.toggle('sel', j === selected));
      cb.onColor(selected);
    },
    get color() {
      return selected;
    },
    setTool(t: Tool) {
      tool = t;
      for (const [tt, b] of toolBtns) b.classList.toggle('sel', tt === t);
    },
    get tool() {
      return tool;
    },
  };
  api.setColor(0);
  api.setTool('build');
  return api;
}
