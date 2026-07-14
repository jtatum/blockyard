import { ArchMesher } from '../arch/mesher';
import { generateGrid } from '../grid/generate';
import { Town } from '../town/town';
import { History } from '../town/history';
import { applySnapshot, decodeShareCode, decodeTown, type DecodedTown } from '../town/serialize';
import { buildGridOverlay } from '../render/griddebug';
import { buildTerrainMesh } from '../render/terrainmesh';
import { HoverHighlight } from '../render/highlight';
import { SceneShell, webgl2Available } from '../render/scene';
import { Daylight } from '../render/daylight';
import { Sky } from '../render/sky';
import { Water } from '../render/water';
import { initChrome } from '../ui/chrome';
import { initTimeSlider } from '../ui/timeslider';
import { InputController } from './input';
import { Autosave, clearAutosave, loadAutosave, shareCodeFromUrl, townToUrl } from './persistence';

const ISLAND_RADIUS = 13;

async function boot(): Promise<void> {
  if (!webgl2Available()) {
    document.getElementById('unsupported')!.hidden = false;
    return;
  }
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const shell = new SceneShell(canvas);
  const { scene } = shell;

  // sky, water and the daylight rig (owns sun/ambient/fog/window-glow)
  const daylight = new Daylight(scene);
  const sky = new Sky();
  scene.add(sky.mesh);
  const water = new Water();
  scene.add(water.mesh);

  // world + state — restore BEFORE the mesher so its initial build sees it:
  // a share code in the URL wins, then the autosave, then a fresh island
  let pending: DecodedTown | null = null;
  const shareCode = shareCodeFromUrl();
  if (shareCode) {
    try {
      pending = await decodeShareCode(shareCode);
    } catch {
      console.warn('[blockyard] ignoring bad share code in URL');
    }
  }
  if (!pending) {
    const bytes = await loadAutosave();
    if (bytes) {
      try {
        pending = decodeTown(bytes);
      } catch {
        console.warn('[blockyard] ignoring corrupt autosave');
      }
    }
  }
  const grid = generateGrid(pending ? { seed: pending.gridSeed } : {});
  const town = new Town(grid);
  town.seedIsland(ISLAND_RADIUS);
  if (pending) {
    try {
      applySnapshot(town, pending);
    } catch {
      console.warn('[blockyard] save does not match grid — starting fresh');
    }
  }
  const history = new History(town);

  const applyTime = (t: number): void => {
    town.timeOfDay = t;
    daylight.set(t);
    sky.update(daylight.state);
    shell.renderer.toneMappingExposure = daylight.state.exposure;
    town.notify(new Set()); // nudge autosave; empty set skips remeshing
  };

  // architecture (chunked, incremental) + terrain fill
  const mesher = new ArchMesher(town);
  scene.add(mesher.group);
  let terrainMesh = buildTerrainMesh(town);
  scene.add(terrainMesh);
  town.onChange((dirty) => {
    if (dirty.size === 0) return;
    mesher.update(dirty);
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh = buildTerrainMesh(town);
    scene.add(terrainMesh);
  });

  const gridOverlay = buildGridOverlay(grid);
  gridOverlay.visible = false;
  scene.add(gridOverlay);

  const highlight = new HoverHighlight();
  scene.add(highlight.group);

  const chrome = initChrome(document.getElementById('ui')!, {
    onColor: () => {},
    onUndo: () => history.undo(),
    onRedo: () => history.redo(),
    onToggleGrid: () => (gridOverlay.visible = !gridOverlay.visible),
    onShare: async () => {
      const url = await townToUrl(town);
      // NOT bare `history` — that's the undo stack here
      window.history.replaceState(null, '', url);
      try {
        await navigator.clipboard.writeText(url);
        return true;
      } catch {
        return false; // URL bar still carries the link
      }
    },
    onNew: async () => {
      if (!window.confirm('Start a fresh town? The current one will be cleared.')) return;
      await clearAutosave();
      window.history.replaceState(null, '', location.pathname);
      town.clear(ISLAND_RADIUS);
    },
    onScreenshot: () => exportScreenshot(),
  });

  // high-res PNG export at the current time of day (product P5)
  function exportScreenshot(): void {
    const r = shell.renderer;
    const cam = shell.rig.camera;
    const prevRatio = r.getPixelRatio();
    const w = window.innerWidth;
    const h = window.innerHeight;
    r.setPixelRatio(1);
    r.setSize(w * 2, h * 2, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    r.render(scene, cam);
    r.domElement.toBlob((blob) => {
      if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'blockyard.png';
        a.click();
        URL.revokeObjectURL(a.href);
      }
      r.setPixelRatio(prevRatio);
      r.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }, 'image/png');
  }

  initTimeSlider(document.getElementById('ui')!, town.timeOfDay, applyTime);
  applyTime(town.timeOfDay);

  new InputController(canvas, grid, town, history, shell.rig, chrome, highlight);
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey)
      gridOverlay.visible = !gridOverlay.visible;
  });

  new Autosave(town); // last, so the restore itself doesn't trigger a save

  // dev-only introspection for scripted testing (stripped from prod builds)
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__by = {
      town, history, grid, chrome, mesher, shell, daylight, sky, water, applyTime,
    };
  }

  shell.onFrame((_dt, time) => water.update(time, daylight.state));
  shell.start();
}

void boot();
