// The orientation cube in the corner, after Kigumi's (kigumi/webview/camera-controls.js): it turns
// with the camera, a click on a face looks along that face, and a drag on it orbits.
import * as THREE from 'three';

// BoxGeometry's material order: +X, -X, +Y, -Y, +Z, -Z. Front looks from -Y, as build123d's Plane.XZ.
const FACES = [['Right', '+X'], ['Left', '−X'], ['Back', '+Y'], ['Front', '−Y'], ['Top', '+Z'], ['Bottom', '−Z']];
const TEXTURE = 192;

function faceTexture(name, axis, colors) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEXTURE;
  const g = canvas.getContext('2d');
  g.fillStyle = colors.face;
  g.fillRect(0, 0, TEXTURE, TEXTURE);
  g.strokeStyle = colors.border;
  g.lineWidth = 6;
  g.strokeRect(3, 3, TEXTURE - 6, TEXTURE - 6);
  g.fillStyle = colors.text;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `600 ${name.length > 5 ? 34 : 40}px system-ui, -apple-system, Segoe UI, sans-serif`;
  g.fillText(name.toUpperCase(), TEXTURE / 2, TEXTURE / 2 - 12);
  g.font = '500 26px ui-monospace, SFMono-Regular, Menlo, monospace';
  g.fillStyle = colors.muted;
  g.fillText(axis, TEXTURE / 2, TEXTURE / 2 + 30);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class ViewCube {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
    this.renderer.setClearColor(0, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-0.95, 0.95, 0.95, -0.95, 0.1, 20);
    this.scene.add(new THREE.AmbientLight(0xffffff, 2.2));
    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(2, -3, 4);
    this.scene.add(light);
    this.cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), FACES.map(() => new THREE.MeshLambertMaterial()));
    this.scene.add(this.cube);
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.cube.geometry), new THREE.LineBasicMaterial());
    this.scene.add(this.edges);
    this.raycaster = new THREE.Raycaster();
    this.hovered = -1;
  }

  setColors(colors) {
    this.colors = colors;
    this.cube.material.forEach((material, i) => {
      material.map?.dispose();
      material.map = faceTexture(FACES[i][0], FACES[i][1], colors);
      material.color.set(0xffffff);
      material.needsUpdate = true;
    });
    this.edges.material.color.set(colors.border);
  }

  resize() {
    const {clientWidth: w, clientHeight: h} = this.canvas;
    if (!w || !h) return;
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.setSize(w, h, false);
  }

  /** Turn the cube as the main camera looks, and draw it. */
  render(offsetDir, up) {
    this.camera.position.copy(offsetDir).normalize().multiplyScalar(3);
    this.camera.up.copy(up);
    this.camera.lookAt(0, 0, 0);
    this.cube.material.forEach((material, i) => material.emissive?.setHex(i === this.hovered ? 0x1f3a5f : 0));
    this.renderer.render(this.scene, this.camera);
  }

  /** The outward direction of the face under a point of the canvas, or null. */
  directionAt(x, y) {
    const w = this.canvas.clientWidth || 1, h = this.canvas.clientHeight || 1;
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, -(y / h) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObject(this.cube, false)[0];
    if (!hit) return null;
    const n = hit.face.normal, ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
    const index = hit.face.materialIndex;
    const direction = ax >= ay && ax >= az ? {x: Math.sign(n.x), y: 0, z: 0} : ay >= az ? {x: 0, y: Math.sign(n.y), z: 0} : {x: 0, y: 0, z: Math.sign(n.z)};
    return {direction, index};
  }

  dispose() {
    this.cube.material.forEach(material => { material.map?.dispose(); material.dispose(); });
    this.cube.geometry.dispose();
    this.edges.geometry.dispose();
    this.edges.material.dispose();
    this.renderer.dispose();
  }
}
