// Duckbench's 3D view: the build's parts, their CAD edges, a grid and dimensions, with Kigumi's
// camera controls (camera-controller.js, view-cube.js) and picking of faces, edges and vertices.
//
// Mouse: left or right drag orbits, middle drag (or shift-drag) pans, the wheel zooms toward the
// pointer, a pinch zooms. A left click picks the feature under the pointer (shift adds), a double
// click orbits about the point, and a right click asks the agent about it (when there is one).
// Keys while the pointer is over the view: F frames the selection, Tab cycles what is under the
// pointer, Escape clears.
import * as THREE from 'three';
import {CSS2DRenderer} from 'three/addons/renderers/CSS2DRenderer.js';
import {LineSegments2} from 'three/addons/lines/LineSegments2.js';
import {LineSegmentsGeometry} from 'three/addons/lines/LineSegmentsGeometry.js';
import {LineMaterial} from 'three/addons/lines/LineMaterial.js';
import {CameraController} from './camera-controller.js';
import {ViewCube} from './view-cube.js';
import {buildScene, disposeScene, featureLabel, pickMaterials} from './scene.js';
import {createDimensions, formatMm} from './dimensions.js';
import './viewer.css';

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const FOV = 35 * Math.PI / 180;
const PICK_RADIUS = 6; // css pixels around the pointer searched for an edge or vertex
const DRAG_SLOP = 3;
const LONG_PRESS_MS = 550;
export const VIEWS = {
  iso: {x: 1, y: -1, z: 0.85}, front: {x: 0, y: -1, z: 0}, rear: {x: 0, y: 1, z: 0}, left: {x: -1, y: 0, z: 0},
  right: {x: 1, y: 0, z: 0}, top: {x: 0, y: 0, z: 1}, bottom: {x: 0, y: 0, z: -1},
};

const GRID_VERTEX = `
varying vec2 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xy;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;
// Lines every 1, 10 and 100 mm (or whichever decades suit the zoom), each fading in as its cells
// grow on screen, the whole grid fading toward its rim. The tenth line of a level is stronger.
const GRID_FRAGMENT = `
uniform vec2 center;
uniform float radius;
uniform float perPixel;
uniform vec3 color;
varying vec2 vWorld;
float lineAt(float cell) {
  vec2 coord = vWorld / cell;
  vec2 dist = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
  return 1.0 - min(min(dist.x, dist.y), 1.0);
}
void main() {
  float minor = pow(10.0, floor(log(perPixel * 6.0) / log(10.0)));
  float px = minor / perPixel;
  float a = lineAt(minor) * smoothstep(6.0, 30.0, px) * 0.45;
  a = max(a, lineAt(minor * 10.0) * mix(0.55, 0.8, smoothstep(30.0, 300.0, px)));
  a = max(a, lineAt(minor * 100.0) * 0.9);
  float fade = 1.0 - smoothstep(0.25, 1.0, distance(vWorld, center) / radius);
  float alpha = a * fade * 0.5;
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(color, alpha);
}`;

/** Fingers: one orbits, two pinch and pan together. After Kigumi's touch-navigation.js. */
class Touches {
  constructor() { this.points = new Map(); this.moved = false; this.multi = false; }
  get active() { return this.points.size > 0; }
  down(id, x, y) {
    this.points.set(id, {x, y});
    if (this.points.size === 1) { this.start = {x, y}; this.moved = false; this.multi = false; } else this.multi = true;
  }
  move(id, x, y) {
    const before = this.points.get(id);
    if (!before) return null;
    if (this.points.size >= 2) {
      const [a, b] = [...this.points.values()];
      this.points.set(id, {x, y});
      const [c, d] = [...this.points.values()];
      this.moved = true;
      const from = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}, to = {x: (c.x + d.x) / 2, y: (c.y + d.y) / 2};
      const was = Math.hypot(a.x - b.x, a.y - b.y), now = Math.hypot(c.x - d.x, c.y - d.y);
      return {kind: 'pinch', factor: now > 0 ? was / now : 1, from, to};
    }
    this.points.set(id, {x, y});
    if (!this.moved && Math.hypot(x - this.start.x, y - this.start.y) < 8) return null;
    this.moved = true;
    return this.multi ? null : {kind: 'orbit', dx: x - before.x, dy: y - before.y};
  }
  up(id) { this.points.delete(id); return this.points.size === 0 && !this.moved && !this.multi; }
  stillHeld() { return this.points.size === 1 && !this.moved && !this.multi; }
  cancel() { this.points.clear(); this.moved = true; }
}

function readColors(element) {
  const style = getComputedStyle(element);
  const get = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return {
    background: get('--viewer-bg', '#f4f5f7'), face: get('--viewer-face', '#d9dde3'), edge: get('--viewer-edge', '#262b33'),
    wire: get('--viewer-wire', '#7a5bd1'), grid: get('--viewer-grid', '#7d8590'), dim: get('--viewer-dim', '#4b525c'),
    hover: get('--viewer-hover', '#3b82f6'), select: get('--viewer-select', '#f59e0b'),
    cubeFace: get('--viewer-cube-face', '#eef0f3'), cubeBorder: get('--viewer-cube-border', '#aab1bb'),
    cubeText: get('--viewer-cube-text', '#3a414b'), cubeMuted: get('--viewer-cube-muted', '#8a929c'),
    sky: get('--viewer-sky', '#ffffff'), ground: get('--viewer-ground', '#b9bfc8'),
    light: Number(get('--viewer-light', '1')) || 1,
  };
}

/**
 * Create the viewer in `container`. Options:
 *   describe({part, kind, indices}) → Promise of the Python side's measurements and selector, or absent
 *   onPrompt({text, spot, selection, image}) when the user asks the agent about a spot, or absent
 *   insertText(text) to put a selector into the editor, or absent
 *   onSelect(selection) when the selection changes
 *   plain: only the model, shaded, on a transparent background (for the app icon)
 */
export function createViewer(container, options = {}) {
  container.classList.add('dbv');
  if (options.plain) container.classList.add('dbv-plain');
  container.innerHTML = `
    <canvas class="dbv-canvas" tabindex="0" aria-label="3D model. Drag to orbit, scroll to zoom, click to pick a face, edge or vertex."></canvas>
    <div class="dbv-labels"></div>
    <div class="dbv-tools" role="toolbar" aria-label="View">
      <button type="button" data-action="parts" aria-pressed="false" title="Parts">Parts</button>
      <button type="button" data-action="fit" title="Frame the model (F)" aria-label="Frame the model">⤢</button>
      <button type="button" data-action="dims" aria-pressed="true" title="Dimensions">⟷</button>
      <button type="button" data-action="grid" aria-pressed="true" title="Grid">#</button>
      <button type="button" data-action="mode" aria-pressed="false" title="Free orbit: tumble the model about the screen instead of turning it about Z">⟲</button>
    </div>
    <canvas class="dbv-cube" aria-label="Orientation cube. Click a face to look along it, drag to orbit."></canvas>
    <nav class="dbv-parts" aria-label="Parts" hidden><ul role="tree" aria-label="Parts"></ul></nav>
    <section class="dbv-card" aria-label="Selection" aria-live="polite" hidden></section>
    <div class="dbv-hint" aria-hidden="true"></div>
    <form class="dbv-prompt" aria-label="Ask the agent about this spot" hidden>
      <span class="dbv-prompt-what"></span>
      <input type="text" aria-label="Ask the agent about this spot" placeholder="Ask about this…" autocomplete="off">
      <button type="submit" aria-label="Send">↑</button>
    </form>`;
  const $ = selector => container.querySelector(selector);
  const canvas = $('.dbv-canvas'), labels = $('.dbv-labels'), cubeCanvas = $('.dbv-cube');
  const partsPanel = $('.dbv-parts'), card = $('.dbv-card'), hint = $('.dbv-hint'), prompt = $('.dbv-prompt');
  if (!options.onPrompt) prompt.remove();

  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: !!options.plain, preserveDrawingBuffer: !!options.plain});
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  const labelRenderer = new CSS2DRenderer({element: labels});
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1000, 1000);
  scene.add(camera);
  const hemisphere = new THREE.HemisphereLight(0xffffff, 0xb9bfc8, 1.6);
  scene.add(hemisphere);
  const headlight = new THREE.DirectionalLight(0xffffff, 1.4);
  headlight.position.set(-0.4, 0.8, 1);
  headlight.target.position.set(0, 0, -1);
  camera.add(headlight, headlight.target);

  const controller = new CameraController();
  const cube = new ViewCube(cubeCanvas);
  const pickTarget = new THREE.WebGLRenderTarget(PICK_RADIUS * 2 + 1, PICK_RADIUS * 2 + 1);
  const pickScene = new THREE.Scene();
  const pickBuffer = new Uint8Array((PICK_RADIUS * 2 + 1) ** 2 * 4);
  const raycaster = new THREE.Raycaster();
  raycaster.params.Line.threshold = 0;
  raycaster.params.Points.threshold = 0;

  let colors = readColors(container);
  const edgeMaterial = new THREE.LineBasicMaterial({color: colors.edge});
  const materials = {
    ...pickMaterials(),
    face(leaf, node) {
      const material = new THREE.MeshStandardMaterial({
        color: leaf.color || colors.face, roughness: 0.78, metalness: 0.02,
        transparent: leaf.alpha < 1, opacity: leaf.alpha, depthWrite: leaf.alpha >= 1,
        side: node.renderback ? THREE.DoubleSide : THREE.FrontSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
      });
      material.userData = {owned: true, themed: !leaf.color};
      return material;
    },
    edge(leaf) {
      if (leaf.type !== 'edges') return edgeMaterial;
      const material = new THREE.LineBasicMaterial({color: leaf.color || colors.wire});
      material.userData = {owned: true, themedWire: !leaf.color};
      return material;
    },
  };

  // The ground: a plane under the model, drawn by the grid shader.
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    vertexShader: GRID_VERTEX, fragmentShader: GRID_FRAGMENT, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {center: {value: new THREE.Vector2()}, radius: {value: 100}, perPixel: {value: 1}, color: {value: new THREE.Color()}},
  }));
  grid.renderOrder = -1;
  grid.frustumCulled = false;
  const axes = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({vertexColors: true, transparent: true, opacity: 0.7}));
  axes.geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(18), 3));
  axes.geometry.setAttribute('color', new THREE.Float32BufferAttribute([0.85, 0.3, 0.3, 0.85, 0.3, 0.3, 0.3, 0.7, 0.35, 0.3, 0.7, 0.35, 0.3, 0.45, 0.9, 0.3, 0.45, 0.9], 3));
  axes.frustumCulled = false;
  scene.add(grid, axes);
  const dims = createDimensions(scene);

  // The orbit centre, shown while the camera turns about it.
  const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({color: 0xf59e0b, transparent: true, opacity: 0.85, depthTest: false}));
  orb.renderOrder = 10;
  orb.visible = false;
  scene.add(orb);

  // Highlights: what is under the pointer, and what is selected.
  const highlightRoot = new THREE.Group();
  scene.add(highlightRoot);
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.55, 1, 40), new THREE.MeshBasicMaterial({color: 0xf59e0b, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide}));
  marker.renderOrder = 12;
  marker.visible = false;
  scene.add(marker);

  const state = {
    built: null, width: 1, height: 1, frame: null, framed: true, dims: true, grid: true,
    hover: null, candidates: [], cycle: 0, selection: [], picks: [], lastPointer: null, spot: null,
    drag: null, renderQueued: false, disposed: false, info: null, infoToken: 0,
  };
  if (options.plain) state.dims = state.grid = false;
  const touches = new Touches();
  let longPress = 0;

  // --- camera -----------------------------------------------------------------------------

  function perPixel() { return (camera.top - camera.bottom) / camera.zoom / Math.max(1, state.height); }

  function applyCamera() {
    const halfHeight = Math.max(1e-4, controller.orbitDist * Math.tan(FOV / 2));
    const aspect = state.width / Math.max(1, state.height);
    camera.left = -halfHeight * aspect; camera.right = halfHeight * aspect; camera.top = halfHeight; camera.bottom = -halfHeight;
    const radius = state.frame ? Math.max(1, state.frame.getSize(new THREE.Vector3()).length()) : 100;
    camera.near = -radius * 40 - controller.orbitDist;
    camera.far = radius * 40 + controller.orbitDist;
    controller.applyTo(camera);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  /** The camera distance that frames `box` from `direction`. */
  function framing(box, direction) {
    const center = box.getCenter(new THREE.Vector3());
    const look = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const {up} = CameraController.snap(look);
    const probe = new THREE.Matrix4().lookAt(look, new THREE.Vector3(), new THREE.Vector3(up.x, up.y, up.z));
    const right = new THREE.Vector3().setFromMatrixColumn(probe, 0), upward = new THREE.Vector3().setFromMatrixColumn(probe, 1);
    let halfW = 0, halfH = 0;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const corner = new THREE.Vector3(x, y, z).sub(center);
      halfW = Math.max(halfW, Math.abs(corner.dot(right)));
      halfH = Math.max(halfH, Math.abs(corner.dot(upward)));
    }
    const aspect = state.width / Math.max(1, state.height);
    // Room around it for the dimensions and the cube.
    const half = Math.max(halfH, halfW / aspect, 0.5) * 1.45 + 70 * Math.max(halfH, halfW / aspect, 0.5) / Math.max(200, state.height);
    return {center, distance: half / Math.tan(FOV / 2)};
  }

  /** Frame `box` (the model by default), looking along `direction` or the current direction. */
  function fit({box = state.frame, direction, jump = false} = {}) {
    if (!box || box.isEmpty()) return;
    const look = direction ? new THREE.Vector3(direction.x, direction.y, direction.z).normalize() : controller.offsetDir.clone();
    const {center, distance} = framing(box, look);
    const snapped = direction ? CameraController.snap(look) : {offsetDir: look, up: controller.mode === 'standard' ? {x: 0, y: 0, z: 1} : controller.up};
    if (box === state.frame) state.framed = true;
    if (jump || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      controller.cancelAnimation();
      controller.offsetDir.copy(look);
      controller.up.set(snapped.up.x, snapped.up.y, snapped.up.z);
      controller.orbitDist = distance;
      controller.setCenter(center);
      requestRender();
      return;
    }
    controller.animateTo({offsetDir: look, up: snapped.up, distance, center, durationMs: 300});
    requestRender();
  }

  function look(direction) {
    const snapped = CameraController.snap(direction);
    controller.animateTo({offsetDir: snapped.offsetDir, up: snapped.up, durationMs: 300});
    requestRender();
  }

  function pointerNdc(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /** Where the pointer meets the plane through the orbit centre facing the camera. */
  function focalPoint(clientX, clientY) {
    applyCamera();
    raycaster.setFromCamera(pointerNdc(clientX, clientY), camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), controller.center());
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  }

  function pan(fromX, fromY, toX, toY) {
    const a = focalPoint(fromX, fromY), b = focalPoint(toX, toY);
    if (!a || !b) return;
    controller.translate(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  function zoomToward(clientX, clientY, factor, {immediate = false} = {}) {
    const from = controller.orbitDist, to = Math.max(1e-3, from * factor);
    const center = controller.center();
    const point = focalPoint(clientX, clientY);
    const target = point ? center.clone().add(point.sub(center).multiplyScalar(1 - to / from)) : center;
    if (immediate) {
      controller.cancelAnimation();
      controller.orbitDist = to;
      controller.setCenter(target);
    } else controller.animateTo({offsetDir: controller.offsetDir, up: controller.up, distance: to, center: target, durationMs: 140});
    state.framed = false;
    requestRender();
  }

  // --- drawing ----------------------------------------------------------------------------

  function requestRender() {
    if (state.renderQueued || state.disposed) return;
    state.renderQueued = true;
    requestAnimationFrame(draw);
  }

  function draw() {
    state.renderQueued = false;
    if (state.disposed) return;
    const animating = controller.step();
    applyCamera();
    const px = perPixel();
    grid.material.uniforms.perPixel.value = px;
    orb.scale.setScalar(5 * px);
    orb.position.copy(controller.center());
    if (marker.visible) marker.scale.setScalar(9 * px);
    for (const line of highlightRoot.children) line.material.resolution?.set(state.width, state.height);
    dims.update({
      box: visibleBox(), view: controller.offsetDir, perPixel: px, enabled: state.dims,
      project: v => {
        const p = v.clone().project(camera);
        return {x: (p.x + 1) / 2 * state.width, y: (1 - p.y) / 2 * state.height};
      },
    });
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
    cube.render(controller.offsetDir, controller.up);
    if (animating) requestRender();
  }

  function visibleBox() {
    const box = new THREE.Box3();
    for (const leaf of state.built?.leaves || []) if (leaf.visible && !leaf.box.isEmpty()) box.union(leaf.box);
    return box.isEmpty() ? null : box;
  }

  function resize() {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    if (width === state.width && height === state.height) return;
    state.width = width; state.height = height;
    renderer.setSize(width, height, false);
    labelRenderer.setSize(width, height);
    cube.resize();
    requestRender();
  }

  function applyClear() { if (options.plain) renderer.setClearColor(0x000000, 0); else renderer.setClearColor(colors.background); }

  function applyColors() {
    colors = readColors(container);
    if (options.plain) renderer.setClearColor(0x000000, 0); else renderer.setClearColor(colors.background);
    edgeMaterial.color.set(colors.edge);
    edgeMaterial.visible = !options.plain;
    hemisphere.color.set(colors.sky);
    hemisphere.groundColor.set(colors.ground);
    hemisphere.intensity = 1.6 * colors.light;
    headlight.intensity = 1.4 * colors.light;
    grid.material.uniforms.color.value.set(colors.grid);
    dims.setColor(colors.dim);
    cube.setColors({face: colors.cubeFace, border: colors.cubeBorder, text: colors.cubeText, muted: colors.cubeMuted});
    for (const leaf of state.built?.leaves || []) {
      if (leaf.mesh?.material.userData.themed) leaf.mesh.material.color.set(colors.face);
      if (leaf.edges?.material.userData.themedWire) leaf.edges.material.color.set(colors.wire);
    }
    refreshHighlights();
    requestRender();
  }

  function placeGround() {
    const box = state.frame;
    grid.visible = axes.visible = !!box && state.grid;
    if (!box) return;
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z * 0.6, 1);
    const radius = Math.max(span * 2.4, 30);
    grid.position.set(center.x, center.y, box.min.z - 1e-3 * span);
    grid.scale.set(radius * 2, radius * 2, 1);
    grid.material.uniforms.center.value.set(center.x, center.y);
    grid.material.uniforms.radius.value = radius;
    const length = Math.max(span * 0.12, 1);
    axes.geometry.attributes.position.array.set([0, 0, 0, length, 0, 0, 0, 0, 0, 0, length, 0, 0, 0, 0, 0, 0, length]);
    axes.geometry.attributes.position.needsUpdate = true;
  }

  // --- picking ----------------------------------------------------------------------------

  /** What is under a point: vertices and edges near it, and the face at it, nearest kind first. */
  function candidatesAt(clientX, clientY) {
    if (!state.built) return [];
    applyCamera();
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const size = PICK_RADIUS * 2 + 1;
    camera.setViewOffset(rect.width, rect.height, x - PICK_RADIUS, y - PICK_RADIUS, size, size);
    pickScene.add(state.built.pickRoot);
    renderer.setRenderTarget(pickTarget);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(pickScene, camera);
    renderer.readRenderTargetPixels(pickTarget, 0, 0, size, size, pickBuffer);
    renderer.setRenderTarget(null);
    applyClear();
    camera.clearViewOffset();
    applyCamera();
    const best = new Map();
    for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
      const o = (row * size + col) * 4;
      const id = pickBuffer[o] | (pickBuffer[o + 1] << 8) | (pickBuffer[o + 2] << 16);
      if (!id) continue;
      // Rows come bottom up.
      const distance = Math.hypot(col - PICK_RADIUS, size - 1 - row - PICK_RADIUS);
      if (!best.has(id) || best.get(id) > distance) best.set(id, distance);
    }
    const found = [];
    for (const [id, distance] of best) {
      const feature = state.built.features[id - 1];
      if (!feature?.leaf.visible) continue;
      const reach = feature.kind === 'vertex' ? 6 : feature.kind === 'edge' ? 4 : 0.75;
      if (distance <= reach) found.push({...feature, distance});
    }
    const rank = {vertex: 0, edge: 1, face: 2};
    return found.sort((a, b) => rank[a.kind] - rank[b.kind] || a.distance - b.distance).slice(0, 6);
  }

  /** The point on the model under the pointer, and the surface's normal there (world). */
  function surfaceAt(clientX, clientY, feature) {
    applyCamera();
    raycaster.setFromCamera(pointerNdc(clientX, clientY), camera);
    const meshes = (state.built?.leaves || []).filter(leaf => leaf.visible && leaf.mesh).map(leaf => leaf.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
    let point = hit?.point.clone(), normal = null;
    if (hit?.face) {
      normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      if (normal.dot(raycaster.ray.direction) > 0) normal.negate();
    }
    if (feature?.kind === 'vertex') point = vertexPosition(feature);
    else if (feature?.kind === 'edge' && (!point || feature.distance > 0.5)) point = nearestOnEdge(feature, raycaster.ray) || point;
    if (!point) return null;
    return {point, normal: normal || raycaster.ray.direction.clone().negate()};
  }

  function vertexPosition({leaf, index}) {
    const p = leaf.vertexPositions;
    return new THREE.Vector3(p[index * 3], p[index * 3 + 1], p[index * 3 + 2]).applyMatrix4(leaf.group.matrix);
  }

  function nearestOnEdge({leaf, index}, ray) {
    const positions = leaf.edges.geometry.attributes.position;
    let best = null, bestDistance = Infinity;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), onSegment = new THREE.Vector3();
    for (let s = leaf.edgeStarts[index]; s < leaf.edgeStarts[index + 1]; s++) {
      a.fromBufferAttribute(positions, s * 2).applyMatrix4(leaf.group.matrix);
      b.fromBufferAttribute(positions, s * 2 + 1).applyMatrix4(leaf.group.matrix);
      const distance = ray.distanceSqToSegment(a, b, null, onSegment);
      if (distance < bestDistance) { bestDistance = distance; best = onSegment.clone(); }
    }
    return best;
  }

  // --- highlights -------------------------------------------------------------------------

  function highlight(feature, color, strong) {
    const {leaf, kind, index} = feature;
    if (kind === 'face' && leaf.mesh) {
      const mesh = new THREE.Mesh(leaf.mesh.geometry, new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: strong ? 0.45 : 0.28, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2, side: THREE.DoubleSide,
      }));
      mesh.userData.drawRange = [leaf.faceStarts[index] * 3, (leaf.faceStarts[index + 1] - leaf.faceStarts[index]) * 3];
      mesh.onBeforeRender = () => mesh.geometry.setDrawRange(...mesh.userData.drawRange);
      mesh.onAfterRender = () => mesh.geometry.setDrawRange(0, Infinity);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(leaf.group.matrix);
      mesh.renderOrder = 3;
      return mesh;
    }
    if (kind === 'edge' && leaf.edges) {
      const source = leaf.edges.geometry.attributes.position.array;
      const from = leaf.edgeStarts[index] * 6, to = leaf.edgeStarts[index + 1] * 6;
      const geometry = new LineSegmentsGeometry().setPositions(source.slice(from, to));
      const line = new LineSegments2(geometry, new LineMaterial({color, linewidth: strong ? 4 : 3, depthTest: false, transparent: true}));
      line.material.resolution.set(state.width, state.height);
      line.matrixAutoUpdate = false;
      line.matrix.copy(leaf.group.matrix);
      line.renderOrder = 4;
      line.userData.ownsGeometry = true;
      return line;
    }
    if (kind === 'vertex') {
      const geometry = new THREE.BufferGeometry().setFromPoints([vertexPosition(feature)]);
      const points = new THREE.Points(geometry, new THREE.PointsMaterial({color, size: strong ? 11 : 9, sizeAttenuation: false, depthTest: false}));
      points.renderOrder = 5;
      points.userData.ownsGeometry = true;
      return points;
    }
    return null;
  }

  function refreshHighlights() {
    for (const child of [...highlightRoot.children]) {
      highlightRoot.remove(child);
      if (child.userData.ownsGeometry) child.geometry.dispose();
      child.material.dispose();
    }
    const add = (feature, color, strong) => { const object = highlight(feature, color, strong); if (object) highlightRoot.add(object); };
    for (const feature of state.selection) {
      if (feature.kind === 'part') for (let f = 0; f < feature.leaf.faceStarts.length - 1; f++) add({...feature, kind: 'face', index: f}, colors.select, true);
      else add(feature, colors.select, true);
    }
    if (state.hover && !state.selection.some(f => same(f, state.hover))) add(state.hover, colors.hover, false);
    requestRender();
  }

  const same = (a, b) => a && b && a.leaf === b.leaf && a.kind === b.kind && a.index === b.index;

  function setHover(feature, clientX, clientY) {
    if (same(feature, state.hover)) return;
    state.hover = feature;
    canvas.style.cursor = feature ? 'pointer' : '';
    if (feature && clientX !== undefined) {
      const rect = container.getBoundingClientRect();
      hint.textContent = state.built.leaves.length > 1 ? `${featureLabel(feature)} · ${feature.leaf.name}` : featureLabel(feature);
      hint.style.transform = `translate(${clientX - rect.left + 14}px, ${clientY - rect.top + 16}px)`;
      hint.classList.add('is-visible');
    } else hint.classList.remove('is-visible');
    refreshHighlights();
  }

  let hoverFrame = 0;
  function hoverAt(clientX, clientY) {
    state.lastPointer = {clientX, clientY};
    cancelAnimationFrame(hoverFrame);
    hoverFrame = requestAnimationFrame(() => {
      if (state.drag || state.disposed) return;
      state.candidates = candidatesAt(clientX, clientY);
      state.cycle = 0;
      setHover(state.candidates[0] || null, clientX, clientY);
    });
  }

  // --- selection --------------------------------------------------------------------------

  function select(feature, {add = false} = {}) {
    if (!feature) {
      if (!add) state.selection = [];
    } else {
      const compatible = state.selection.length && state.selection[0].leaf === feature.leaf && state.selection[0].kind === feature.kind;
      if (add && compatible) {
        const at = state.selection.findIndex(f => same(f, feature));
        if (at >= 0) state.selection.splice(at, 1); else state.selection.push(feature);
      } else state.selection = [feature];
    }
    selectionChanged();
  }

  function selectionChanged() {
    refreshHighlights();
    renderTree();
    const record = selectionRecord();
    if (record) {
      state.picks.unshift(record);
      state.picks.length = Math.min(state.picks.length, 20);
    }
    options.onSelect?.(record);
    showCard(record);
  }

  /** The selection as the agent and the info card see it. */
  function selectionRecord() {
    if (!state.selection.length) return null;
    const first = state.selection[0];
    const {leaf} = first;
    const box = new THREE.Box3();
    if (first.kind === 'part') box.copy(leaf.box);
    const record = {
      at: new Date().toISOString(), name: leaf.name, path: leaf.id, kind: first.kind,
      indices: first.kind === 'part' ? [] : state.selection.map(f => f.index),
      label: first.kind === 'part' ? 'part' : state.selection.length > 1 ? `${state.selection.length} ${featureLabel(first).split(' ').pop()}s` : featureLabel(first),
      types: state.selection.map(f => f.kind === 'part' ? 'part' : featureLabel(f)),
    };
    if (first.kind === 'part') record.boundingBox = {min: box.min.toArray().map(round), max: box.max.toArray().map(round)};
    if (first.point) record.point = first.point.toArray().map(round);
    return record;
  }

  const round = value => Math.round(value * 1e4) / 1e4;

  async function showCard(record) {
    const token = ++state.infoToken;
    if (!record) { card.hidden = true; state.info = null; return; }
    card.hidden = false;
    const title = record.kind === 'part' ? record.name : record.label;
    const sub = record.kind === 'part' ? 'Part' : state.built.leaves.length > 1 ? record.name : '';
    card.innerHTML = `<header><strong></strong><span></span><button type="button" class="dbv-close" aria-label="Clear selection">×</button></header><dl></dl><div class="dbv-selector" hidden><code></code><div class="dbv-card-actions"></div></div><p class="dbv-note"></p>`;
    card.querySelector('strong').textContent = title;
    card.querySelector('header span').textContent = sub;
    card.querySelector('.dbv-close').onclick = () => select(null);
    const rows = card.querySelector('dl'), note = card.querySelector('.dbv-note');
    const row = (term, value) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = term; dd.textContent = value;
      rows.append(dt, dd);
    };
    if (record.kind === 'part') {
      const size = new THREE.Vector3().subVectors(new THREE.Vector3(...record.boundingBox.max), new THREE.Vector3(...record.boundingBox.min));
      row('Size', size.toArray().map(formatMm).join(' × ') + ' mm');
      addActions(card.querySelector('.dbv-card-actions'), null);
      return;
    }
    if (!options.describe) {
      note.textContent = state.selection.length > 1 ? 'Shift-click adds or removes features.' : '';
      addActions(card.querySelector('.dbv-card-actions'), null);
      return;
    }
    note.textContent = 'Measuring…';
    let info;
    try {
      info = await options.describe({part: record.path, kind: record.kind, indices: record.indices});
    } catch (error) {
      if (token === state.infoToken) note.textContent = error.message || String(error);
      return;
    }
    if (token !== state.infoToken) return;
    state.info = info;
    if (state.picks[0]?.at === record.at) state.picks[0].info = info;
    note.textContent = '';
    const features = info.features || [];
    const mm = values => values.map(formatMm).join(', ');
    if (features.length === 1) {
      const f = features[0];
      if (f.kind === 'vertex') row('At', mm(f.position));
      if (f.area !== undefined) row('Area', formatMm(f.area) + ' mm²');
      if (f.diameter !== undefined) row('Diameter', formatMm(f.diameter) + ' mm');
      if (f.length !== undefined) row('Length', formatMm(f.length) + ' mm');
      if (f.normal) row('Normal', mm(f.normal));
      if (f.direction) row('Direction', mm(f.direction));
      if (f.axis) row('Axis', mm(f.axis.direction));
      if (f.center) row('Centre', mm(f.center));
    } else if (features.length > 1) {
      if (features.every(f => f.length !== undefined)) row('Total length', formatMm(features.reduce((sum, f) => sum + f.length, 0)) + ' mm');
      if (features.every(f => f.area !== undefined)) row('Total area', formatMm(features.reduce((sum, f) => sum + f.area, 0)) + ' mm²');
    }
    if (info.between) {
      row('Distance', formatMm(info.between.distance) + ' mm');
      if (info.between.angle !== undefined) row('Angle', formatMm(info.between.angle) + '°');
    }
    if (info.selector) {
      const box = card.querySelector('.dbv-selector');
      box.hidden = false;
      box.querySelector('code').textContent = info.selector;
      if (!info.robust) note.textContent = 'No selector by position or type finds just these; this one uses indices, which change when the model does.';
      else if (info.selector_note) note.textContent = info.selector_note;
      addActions(box.querySelector('.dbv-card-actions'), info.selector);
    }
  }

  function addActions(holder, selector) {
    if (!holder) return;
    const button = (text, label, action) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = text; b.setAttribute('aria-label', label); b.onclick = action;
      holder.append(b);
      return b;
    };
    if (selector) {
      const copy = button('Copy', 'Copy selector', async () => {
        try { await navigator.clipboard.writeText(selector); copy.textContent = 'Copied'; } catch { copy.textContent = 'Copy failed'; }
        setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
      });
      if (options.insertText) button('Insert', 'Insert selector at the cursor', () => options.insertText(selector));
    }
    if (options.onPrompt) button('Ask agent', 'Ask the agent about the selection', () => {
      const first = state.selection[0];
      if (!first) return;
      const rect = card.getBoundingClientRect(), box = container.getBoundingClientRect();
      openPrompt({feature: first.kind === 'part' ? null : first, part: first.leaf, point: first.point || null,
        normal: first.normal || null, x: rect.left - box.left + 8, y: rect.top - box.top - 52});
    });
  }

  // --- prompt here ------------------------------------------------------------------------

  function openPrompt(spot) {
    if (!options.onPrompt) return;
    setHover(null);
    state.spot = spot;
    if (spot.point) {
      marker.visible = true;
      marker.position.copy(spot.point);
      marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), spot.normal || controller.offsetDir);
    }
    const what = spot.feature ? featureLabel(spot.feature) : spot.part ? spot.part.name : 'model';
    prompt.querySelector('.dbv-prompt-what').textContent = what;
    const left = Math.max(8, Math.min(spot.x + 18, state.width - 330));
    const top = Math.max(8, Math.min(spot.y - 18, state.height - 54));
    prompt.style.left = left + 'px';
    prompt.style.top = top + 'px';
    prompt.hidden = false;
    const input = prompt.querySelector('input');
    input.value = '';
    input.focus();
    requestRender();
  }

  function closePrompt() {
    if (!state.spot) return;
    state.spot = null;
    prompt.hidden = true;
    marker.visible = false;
    requestRender();
  }

  /** A square of the view around a point, as base64 JPEG, for the agent to see what the user does. */
  function snapshotAround(point, half = 200, out = 512) {
    draw();
    const p = point.clone().project(camera);
    if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) return null;
    const side = Math.min(2 * half, state.width, state.height);
    const cx = Math.min(Math.max((p.x + 1) / 2 * state.width, side / 2), state.width - side / 2);
    const cy = Math.min(Math.max((1 - p.y) / 2 * state.height, side / 2), state.height - side / 2);
    const scale = canvas.width / state.width;
    const cut = document.createElement('canvas');
    cut.width = cut.height = Math.min(out, Math.round(side * scale));
    cut.getContext('2d').drawImage(canvas, (cx - side / 2) * scale, (cy - side / 2) * scale, side * scale, side * scale, 0, 0, cut.width, cut.height);
    return cut.toDataURL('image/jpeg', 0.85).split(',')[1];
  }

  prompt?.addEventListener('submit', event => {
    event.preventDefault();
    const text = prompt.querySelector('input').value.trim();
    const spot = state.spot;
    if (!text || !spot) return;
    let image = null;
    try { if (spot.point) image = snapshotAround(spot.point); } catch { /* the words and the spot are enough */ }
    const feature = spot.feature;
    options.onPrompt({
      text,
      spot: {
        part: spot.part?.name, path: spot.part?.id, kind: feature?.kind || (spot.part ? 'part' : null),
        index: feature?.index ?? null, label: feature ? featureLabel(feature) : null,
        point: spot.point?.toArray().map(round) || null, normal: spot.normal?.toArray().map(round) || null,
      },
      selection: selectionRecord(), info: state.info, image,
    });
    closePrompt();
  });
  prompt?.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closePrompt(); } });

  // --- parts panel ------------------------------------------------------------------------

  function renderTree() {
    const list = partsPanel.querySelector('ul');
    list.replaceChildren();
    if (!state.built) return;
    const selectedLeaf = state.selection[0]?.kind === 'part' ? state.selection[0].leaf : null;
    const add = (entry, depth) => {
      const li = document.createElement('li');
      li.setAttribute('role', 'treeitem');
      const row = document.createElement('div');
      row.className = 'dbv-part' + (entry.leaf && entry.leaf === selectedLeaf ? ' is-selected' : '');
      row.dataset.path = entry.id;
      row.style.paddingLeft = 6 + depth * 12 + 'px';
      const leaves = collect(entry);
      const shown = leaves.some(leaf => leaf.visible);
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'dbv-eye';
      eye.textContent = shown ? '●' : '○';
      eye.setAttribute('aria-label', (shown ? 'Hide ' : 'Show ') + entry.name);
      eye.setAttribute('aria-pressed', String(shown));
      eye.onclick = () => { for (const leaf of leaves) setVisible(leaf, !shown); renderTree(); };
      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'dbv-part-name';
      name.textContent = entry.name;
      if (entry.leaf) {
        name.onclick = () => select({leaf: entry.leaf, kind: 'part', index: -1});
        name.ondblclick = () => fit({box: entry.leaf.box});
      } else name.onclick = () => fit({box: leaves.reduce((box, leaf) => box.union(leaf.box), new THREE.Box3())});
      row.append(eye, name);
      li.append(row);
      list.append(li);
      for (const child of entry.children) add(child, depth + 1);
    };
    const top = state.built.tree;
    // ocp-tessellate wraps an unnamed result in a Group or Assembly of its own: list what is in it.
    if (!top.leaf && ['Group', 'Assembly'].includes(top.name)) for (const child of top.children) add(child, 0); else add(top, 0);
  }

  function collect(entry) { return entry.leaf ? [entry.leaf] : entry.children.flatMap(collect); }

  function setVisible(leaf, visible) {
    leaf.visible = visible;
    leaf.group.visible = leaf.pickGroup.visible = visible;
    if (!visible) {
      state.selection = state.selection.filter(f => f.leaf !== leaf);
      if (state.hover?.leaf === leaf) state.hover = null;
      refreshHighlights();
    }
    dims.setHoles(state.built.leaves);
    requestRender();
  }

  // --- input ------------------------------------------------------------------------------

  function startDrag(event, action) {
    controller.cancelAnimation();
    if (action === 'orbit') controller.beginDrag();
    state.drag = {action, button: event.button, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false, shift: event.shiftKey};
  }

  canvas.addEventListener('pointerdown', event => {
    canvas.focus({preventScroll: true});
    if (event.pointerType === 'touch') {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const first = !touches.active;
      touches.down(event.pointerId, event.clientX, event.clientY);
      clearTimeout(longPress);
      if (first) {
        controller.beginDrag();
        controller.cancelAnimation();
        const {clientX, clientY} = event;
        longPress = setTimeout(() => {
          if (!touches.stillHeld()) return;
          touches.cancel();
          contextAt(clientX, clientY);
        }, LONG_PRESS_MS);
      }
      return;
    }
    closePrompt();
    const action = event.button === 1 || (event.button === 0 && (event.altKey || event.ctrlKey || event.metaKey)) ? 'pan' : event.button === 0 || event.button === 2 ? 'orbit' : null;
    if (!action) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    startDrag(event, action);
  });

  canvas.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') {
      const gesture = touches.move(event.pointerId, event.clientX, event.clientY);
      if (!gesture) return;
      clearTimeout(longPress);
      if (gesture.kind === 'orbit') controller.orbit(gesture.dx, gesture.dy);
      else {
        zoomToward(gesture.to.x, gesture.to.y, gesture.factor, {immediate: true});
        pan(gesture.from.x, gesture.from.y, gesture.to.x, gesture.to.y);
      }
      state.framed = false;
      requestRender();
      return;
    }
    const drag = state.drag;
    if (!drag) { hoverAt(event.clientX, event.clientY); return; }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_SLOP) return;
    if (!drag.moved) {
      drag.moved = true;
      setHover(null);
      orb.visible = drag.action === 'orbit';
    }
    // A left drag with shift pans, so a trackpad without a middle button can pan too.
    if (drag.action === 'pan' || drag.shift) pan(drag.x, drag.y, event.clientX, event.clientY);
    else controller.orbit(dx, dy);
    drag.x = event.clientX; drag.y = event.clientY;
    state.framed = false;
    requestRender();
  });

  const endDrag = event => {
    if (event.pointerType === 'touch') {
      clearTimeout(longPress);
      if (touches.up(event.pointerId)) clickAt(event.clientX, event.clientY, false);
      return;
    }
    const drag = state.drag;
    state.drag = null;
    orb.visible = false;
    controller.endDrag();
    requestRender();
    if (!drag || drag.moved || event.type === 'pointercancel') return;
    if (drag.button === 0) clickAt(event.clientX, event.clientY, drag.shift);
    else if (drag.button === 2) contextAt(event.clientX, event.clientY);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', event => { touches.cancel(); endDrag(event); });
  canvas.addEventListener('pointerleave', () => { if (!state.drag) setHover(null); });
  canvas.addEventListener('contextmenu', event => event.preventDefault());

  function featureAt(clientX, clientY) {
    const candidates = candidatesAt(clientX, clientY);
    // Tab chose among these while hovering: click what it showed.
    const unchanged = state.candidates.length === candidates.length && candidates.every((c, i) => same(c, state.candidates[i]));
    return unchanged ? candidates[state.cycle % candidates.length] : candidates[0];
  }

  function clickAt(clientX, clientY, add) {
    hint.classList.remove('is-visible');
    const feature = featureAt(clientX, clientY);
    if (feature) {
      const surface = surfaceAt(clientX, clientY, feature);
      if (surface) { feature.point = surface.point; feature.normal = surface.normal; }
    }
    select(feature || null, {add});
  }

  function contextAt(clientX, clientY) {
    const feature = featureAt(clientX, clientY);
    if (!feature || !options.onPrompt) return;
    const surface = surfaceAt(clientX, clientY, feature);
    const rect = container.getBoundingClientRect();
    openPrompt({feature, part: feature.leaf, point: surface?.point, normal: surface?.normal, x: clientX - rect.left, y: clientY - rect.top});
  }

  canvas.addEventListener('dblclick', event => {
    // Orbit about the point clicked.
    const surface = surfaceAt(event.clientX, event.clientY);
    if (!surface) return;
    controller.animateTo({offsetDir: controller.offsetDir, up: controller.up, center: surface.point, durationMs: 220});
    state.framed = false;
    requestRender();
  });

  container.addEventListener('wheel', event => {
    if (!state.built) return;
    event.preventDefault();
    const pixels = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    if (event.ctrlKey) zoomToward(event.clientX, event.clientY, Math.exp(event.deltaY * pixels * 0.01), {immediate: true});
    else if (event.deltaY) zoomToward(event.clientX, event.clientY, controller.zoomFactor(event.deltaY > 0));
  }, {passive: false});

  canvas.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closePrompt(); select(null); }
    else if (event.key === 'f' || event.key === 'F') {
      const leaf = state.selection[0]?.leaf;
      fit({box: leaf ? leaf.box : state.frame});
    } else if (event.key === 'Tab' && state.candidates.length > 1 && state.lastPointer) {
      event.preventDefault();
      state.cycle = (state.cycle + 1) % state.candidates.length;
      setHover(state.candidates[state.cycle], state.lastPointer.clientX, state.lastPointer.clientY);
    }
  });

  // The cube: a click looks along a face, a drag orbits.
  let cubeDrag = null;
  cubeCanvas.addEventListener('pointerdown', event => {
    event.preventDefault();
    cubeCanvas.setPointerCapture(event.pointerId);
    controller.cancelAnimation();
    controller.beginDrag();
    cubeDrag = {x: event.clientX, y: event.clientY, moved: false};
  });
  cubeCanvas.addEventListener('pointermove', event => {
    const rect = cubeCanvas.getBoundingClientRect();
    if (!cubeDrag) {
      const hit = cube.directionAt(event.clientX - rect.left, event.clientY - rect.top);
      const index = hit ? hit.index : -1;
      if (index !== cube.hovered) { cube.hovered = index; requestRender(); }
      return;
    }
    const dx = event.clientX - cubeDrag.x, dy = event.clientY - cubeDrag.y;
    if (Math.abs(dx) + Math.abs(dy) > 1) cubeDrag.moved = true;
    controller.orbit(dx, dy);
    cubeDrag.x = event.clientX; cubeDrag.y = event.clientY;
    state.framed = false;
    requestRender();
  });
  cubeCanvas.addEventListener('pointerup', event => {
    const drag = cubeDrag;
    cubeDrag = null;
    controller.endDrag();
    if (!drag || drag.moved) return;
    const rect = cubeCanvas.getBoundingClientRect();
    const hit = cube.directionAt(event.clientX - rect.left, event.clientY - rect.top);
    if (hit) look(hit.direction);
  });
  cubeCanvas.addEventListener('pointerleave', () => { if (cube.hovered >= 0) { cube.hovered = -1; requestRender(); } });

  $('.dbv-tools').addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'fit') fit();
    if (action === 'parts') { partsPanel.hidden = !partsPanel.hidden; button.setAttribute('aria-pressed', String(!partsPanel.hidden)); }
    if (action === 'dims') { state.dims = !state.dims; button.setAttribute('aria-pressed', String(state.dims)); requestRender(); }
    if (action === 'grid') { state.grid = !state.grid; button.setAttribute('aria-pressed', String(state.grid)); placeGround(); requestRender(); }
    if (action === 'mode') {
      const free = controller.mode === 'standard';
      controller.setMode(free ? 'free' : 'standard');
      button.setAttribute('aria-pressed', String(free));
      if (!free) look(controller.offsetDir);
      requestRender();
    }
  });

  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener?.('change', applyColors);
  const themeObserver = new MutationObserver(applyColors);
  themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ['data-theme', 'class']});
  resize();
  applyColors();

  // --- public -----------------------------------------------------------------------------

  /** One picture into the next: the old view fades out over the new one. */
  function crossFade() {
    if (!state.built || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    draw();
    const still = document.createElement('canvas');
    still.className = 'dbv-was';
    still.width = canvas.width; still.height = canvas.height;
    still.getContext('2d').drawImage(canvas, 0, 0);
    container.insertBefore(still, labels);
    still.animate([{opacity: 1}, {opacity: 0}], {duration: 320, easing: 'ease-in-out', fill: 'forwards'}).finished.then(() => still.remove(), () => still.remove());
  }

  function show(data) {
    const built = buildScene(data, {materials});
    crossFade();
    const previous = state.built;
    if (previous) {
      scene.remove(previous.root);
      pickScene.remove(previous.pickRoot);
      disposeScene(previous);
    }
    state.built = built;
    scene.add(built.root);
    // Which build is on screen, counted, so a check can tell a new scene from the same one.
    container.dataset.scene = String((Number(container.dataset.scene) || 0) + 1);
    // A selection or hover names features of the old build.
    state.selection = []; state.hover = null; state.candidates = [];
    closePrompt();
    card.hidden = true;
    dims.setHoles(built.leaves);
    const before = state.frame;
    state.frame = built.box.isEmpty() ? null : built.box.clone();
    placeGround();
    renderTree();
    refreshHighlights();
    if (!state.frame) { requestRender(); return; }
    // Keep the camera unless the person has not moved it, or the model moved or changed size a lot.
    let refit = !before || state.framed;
    if (!refit) {
      const was = before.getSize(new THREE.Vector3()).length(), now = state.frame.getSize(new THREE.Vector3()).length();
      const moved = before.getCenter(new THREE.Vector3()).distanceTo(state.frame.getCenter(new THREE.Vector3()));
      refit = now > was * 1.8 || now < was * 0.55 || moved > Math.max(was, now);
    }
    if (!before) fit({direction: VIEWS.iso, jump: true});
    else if (refit) fit();
    requestRender();
  }

  function clear() {
    if (state.built) { scene.remove(state.built.root); pickScene.remove(state.built.pickRoot); disposeScene(state.built); }
    state.built = null; state.frame = null; state.selection = []; state.hover = null; state.picks = [];
    card.hidden = true;
    closePrompt();
    placeGround();
    renderTree();
    dims.setHoles([]);
    refreshHighlights();
    requestRender();
  }

  /** The view as a JPEG at most 1024 pixels wide, after moving to a preset view. */
  async function screenshot(view = 'current') {
    if (!state.built) throw new Error('No model is shown. Build one first.');
    if (view !== 'current') {
      fit({direction: VIEWS[view], jump: true});
    }
    // Hover marks are for the person at the mouse, not the picture.
    const hovered = state.hover;
    state.hover = null;
    refreshHighlights();
    draw();
    const scale = Math.min(1, 1024 / canvas.width);
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(canvas.width * scale)); out.height = Math.max(1, Math.round(canvas.height * scale));
    out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
    state.hover = hovered;
    refreshHighlights();
    const jpeg = out.toDataURL('image/jpeg', 0.88);
    return {data: jpeg.slice(jpeg.indexOf(',') + 1), mimeType: 'image/jpeg', width: out.width, height: out.height};
  }

  /** The camera, after moving to a preset view, position, target or zoom when given. Zoom 1 frames the model. */
  function cameraState({view, position, target, zoom} = {}) {
    if (!state.built) throw new Error('No model is shown. Build one first.');
    const fitted = state.frame ? framing(state.frame, controller.offsetDir).distance : 100;
    if (view) fit({direction: VIEWS[view], jump: true});
    if (position || target) {
      const center = target ? new THREE.Vector3(...target) : controller.center();
      const eye = position ? new THREE.Vector3(...position) : center.clone().addScaledVector(controller.offsetDir, controller.orbitDist);
      const offset = eye.clone().sub(center);
      if (offset.lengthSq() > 1e-12) {
        controller.offsetDir.copy(offset).normalize();
        const snapped = CameraController.snap(controller.offsetDir);
        controller.up.set(snapped.up.x, snapped.up.y, snapped.up.z);
      }
      controller.setCenter(center);
    }
    if (zoom !== undefined) controller.orbitDist = (state.frame ? framing(state.frame, controller.offsetDir).distance : fitted) / zoom;
    state.framed = false;
    applyCamera();
    draw();
    const round3 = v => Math.round(v * 1000) / 1000;
    const nowFitted = state.frame ? framing(state.frame, controller.offsetDir).distance : fitted;
    return {
      position: camera.position.toArray().map(round3), target: controller.center().toArray().map(round3),
      zoom: Math.round(nowFitted / controller.orbitDist * 1e4) / 1e4, projection: 'orthographic', mode: controller.mode,
    };
  }

  return {
    show, clear, fit, screenshot, camera: cameraState,
    picks: limit => state.picks.slice(0, limit),
    selection: selectionRecord,
    layout: () => { state.width = 0; resize(); },
    setOptions(next) { Object.assign(options, next); },
    dispose() {
      state.disposed = true;
      observer.disconnect();
      themeObserver.disconnect();
      scheme.removeEventListener?.('change', applyColors);
      if (state.built) disposeScene(state.built);
      for (const child of highlightRoot.children) { if (child.userData.ownsGeometry) child.geometry.dispose(); child.material.dispose(); }
      for (const object of [grid, axes, orb, marker]) { object.geometry.dispose(); object.material.dispose(); }
      for (const material of [edgeMaterial, materials.pickFace, materials.pickEdge, materials.pickVertex]) material.dispose();
      dims.dispose();
      pickTarget.dispose();
      cube.dispose();
      renderer.dispose();
      container.replaceChildren();
      container.classList.remove('dbv');
    },
  };
}
