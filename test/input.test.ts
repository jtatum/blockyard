/**
 * InputController gestures (tech doc §4 /app/input), driven headlessly: the
 * canvas and window are bare EventTargets, the camera is a top-down
 * orthographic view, and picking/town/history are the real modules. Pointer
 * events are plain Events carrying the PointerEvent fields input.ts reads.
 */

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InputController } from '../src/app/input';
import { generateGrid } from '../src/grid/generate';
import type { CameraRig } from '../src/render/camera';
import type { HoverHighlight } from '../src/render/highlight';
import { History } from '../src/town/history';
import { Town } from '../src/town/town';
import type { Chrome, Tool } from '../src/ui/chrome';

const grid = generateGrid(); // default world (seed 1337)
const SIZE = 800; // canvas px, square

function cellNear(x: number, y: number): number {
  let best = 0;
  let bd = Infinity;
  for (const c of grid.cells) {
    const d = (c.cx - x) ** 2 + (c.cy - y) ** 2;
    if (d < bd) {
      bd = d;
      best = c.id;
    }
  }
  return best;
}

function setup() {
  const win = new EventTarget();
  vi.stubGlobal('window', win);
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: SIZE, height: SIZE }),
  }) as unknown as HTMLCanvasElement;

  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 200);
  camera.position.set(0, 100, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const rig = { camera, controls: { enabled: true } } as unknown as CameraRig;

  let tool: Tool = 'build';
  const chrome: Chrome = {
    get tool() {
      return tool;
    },
    get color() {
      return 4;
    },
    setTool: (t) => void (tool = t),
    setColor: () => {},
  };
  const highlight = {
    show: vi.fn(),
    showCells: vi.fn(),
    hide: vi.fn(),
  } as unknown as HoverHighlight;

  const town = new Town(grid);
  town.seedIsland(13);
  const history = new History(town);
  new InputController(canvas, grid, town, history, rig, chrome, highlight);

  /** screen position of a cell's centroid on the ground */
  const at = (cell: number) => {
    const c = grid.cells[cell]!;
    const v = new THREE.Vector3(c.cx, 0, c.cy).project(camera);
    return { clientX: ((v.x + 1) / 2) * SIZE, clientY: ((1 - v.y) / 2) * SIZE };
  };
  const fire = (target: EventTarget, type: string, fields: Record<string, unknown>) =>
    target.dispatchEvent(
      Object.assign(new Event(type), { button: 0, pointerType: 'mouse', altKey: false, ...fields })
    );
  const touch = { pointerType: 'touch' };

  return { win, canvas, rig, chrome, highlight, town, history, at, fire, touch };
}

describe('input gestures', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('a touch line gesture places a connected run as one undo step', () => {
    const { win, canvas, rig, chrome, town, history, at, fire, touch } = setup();
    const a = cellNear(-3, 0);
    const b = cellNear(3, 0);
    expect(town.isLand(a) && town.isLand(b)).toBe(true);

    chrome.setTool('line');
    fire(canvas, 'pointerdown', { ...touch, ...at(a) });
    expect(rig.controls.enabled).toBe(false); // the gesture owns the finger
    fire(canvas, 'pointermove', { ...touch, ...at(b) });
    fire(win, 'pointerup', { ...touch, ...at(b) });

    expect(rig.controls.enabled).toBe(true);
    expect(town.isFilled(a, 0)).toBe(true);
    expect(town.isFilled(b, 0)).toBe(true);
    expect(town.blockCount()).toBeGreaterThan(2);
    history.undo();
    expect(town.blockCount()).toBe(0);
  });

  it('a cancelled touch line gesture commits nothing and gives the camera back', () => {
    const { win, canvas, rig, chrome, highlight, town, at, fire, touch } = setup();
    const a = cellNear(-3, 0);
    const b = cellNear(3, 0);
    const elsewhere = cellNear(0, 5);

    chrome.setTool('line');
    fire(canvas, 'pointerdown', { ...touch, ...at(a) });
    fire(canvas, 'pointermove', { ...touch, ...at(b) });
    fire(win, 'pointercancel', { ...touch, ...at(b) }); // no pointerup follows

    expect(rig.controls.enabled).toBe(true); // orbit must not stay frozen
    expect(highlight.hide).toHaveBeenCalled();
    expect(town.blockCount()).toBe(0);

    // the next ordinary tap builds exactly one block where it lands —
    // not the abandoned line
    chrome.setTool('build');
    fire(canvas, 'pointerdown', { ...touch, ...at(elsewhere) });
    fire(win, 'pointerup', { ...touch, ...at(elsewhere) });
    expect(town.blockCount()).toBe(1);
    expect(town.isFilled(elsewhere, 0)).toBe(true);
    expect(town.isFilled(a, 0)).toBe(false);
  });
});
