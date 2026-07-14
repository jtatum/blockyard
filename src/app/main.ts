import * as THREE from 'three';
import { generateGrid } from '../grid/generate';
import { buildGridOverlay } from '../render/griddebug';
import { SceneShell, webgl2Available } from '../render/scene';

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
  scene.add(sun);

  // the world grid
  const grid = generateGrid({});

  // debug: island ground fill (cells near center = land) — replaced by real terrain later
  const landR = 13;
  const positions: number[] = [];
  const colors: number[] = [];
  const landColor = new THREE.Color(0xb5c78e);
  const jitter = new THREE.Color();
  for (const cell of grid.cells) {
    if (Math.hypot(cell.cx, cell.cy) > landR) continue;
    jitter.copy(landColor).offsetHSL(0, 0, ((cell.id * 2654435761) % 100) / 100 * 0.06 - 0.03);
    const y = 0.3;
    const c = [grid.corner(cell, 0), grid.corner(cell, 1), grid.corner(cell, 2), grid.corner(cell, 3)];
    // grid CCW -> three.js XZ needs reversed winding for +Y-facing faces
    for (const tri of [[0, 2, 1], [0, 3, 2]] as const) {
      for (const i of tri) {
        positions.push(c[i]!.x, y, c[i]!.y);
        colors.push(jitter.r, jitter.g, jitter.b);
      }
    }
  }
  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  // placeholder water
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(200, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x4f8fb8, roughness: 0.35, metalness: 0.0 })
  );
  water.position.y = 0;
  scene.add(water);

  scene.add(buildGridOverlay(grid));

  shell.start();
}

boot();
