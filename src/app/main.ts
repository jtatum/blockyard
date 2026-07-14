import * as THREE from 'three';
import { generateGrid } from '../grid/generate';
import { Town } from '../town/town';
import { History } from '../town/history';
import { ArchMesher } from '../arch/mesher';
import { buildGridOverlay } from '../render/griddebug';
import { buildTerrainMesh } from '../render/terrainmesh';
import { HoverHighlight } from '../render/highlight';
import { SceneShell, webgl2Available } from '../render/scene';
import { initChrome } from '../ui/chrome';
import { InputController } from './input';

const ISLAND_RADIUS = 13;

function boot(): void {
  if (!webgl2Available()) {
    document.getElementById('unsupported')!.hidden = false;
    return;
  }
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const shell = new SceneShell(canvas);
  const { scene } = shell;

  scene.background = new THREE.Color(0x9fc4dd);
  scene.fog = new THREE.Fog(0x9fc4dd, 60, 140);

  // placeholder lighting until the daylight rig lands
  const hemi = new THREE.HemisphereLight(0xcfe5f5, 0x8b9a7d, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  sun.position.set(30, 45, 20);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);

  // world + state
  const grid = generateGrid({});
  const town = new Town(grid);
  town.seedIsland(ISLAND_RADIUS);
  const history = new History(town);

  // placeholder water
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(200, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4f8fb8, roughness: 0.35 })
  );
  scene.add(water);

  // architecture (chunked, incremental) + terrain fill
  const mesher = new ArchMesher(town);
  scene.add(mesher.group);
  let terrainMesh = buildTerrainMesh(town);
  scene.add(terrainMesh);
  town.onChange((dirty) => {
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
  });

  new InputController(canvas, grid, town, history, shell.rig, chrome, highlight);
  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'g' && !e.metaKey && !e.ctrlKey)
      gridOverlay.visible = !gridOverlay.visible;
  });

  shell.start();
}

boot();
