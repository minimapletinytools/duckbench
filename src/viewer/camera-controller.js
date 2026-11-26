// The orbit camera's state and math, after Kigumi's (kigumi/webview/camera-controller.js): a centre,
// a direction from it to the camera, a distance and an up vector. It knows nothing of the DOM: the
// viewer passes pointer deltas in and calls applyToCamera.
//
// 'standard' mode turns about world Z, so the model never rolls; 'free' mode tumbles about the
// screen's axes as they were when the drag began.
import * as THREE from 'three';

const ORBIT_SPEED = 0.008;
const PHI_EPSILON = 0.05;

export class CameraController {
  constructor({theta = -Math.PI / 4, phi = Math.PI / 3, distance = 100, center = {x: 0, y: 0, z: 0}} = {}) {
    this.cx = center.x; this.cy = center.y; this.cz = center.z;
    this.orbitDist = distance;
    this.offsetDir = new THREE.Vector3();
    this.setAngles(theta, phi);
    this.up = new THREE.Vector3(0, 0, 1);
    this.mode = 'standard';
    this.dragUp = this.dragRight = null;
    this.animation = null;
  }

  setMode(mode) {
    this.mode = mode === 'free' ? 'free' : 'standard';
    if (this.mode === 'standard') this.up.set(0, 0, 1);
  }

  clampPhi(value) { return Math.max(PHI_EPSILON, Math.min(Math.PI - PHI_EPSILON, value)); }

  setAngles(theta, phi) {
    this.offsetDir.set(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
  }

  angles() {
    const d = this.offsetDir;
    return {theta: Math.atan2(d.y, d.x), phi: Math.acos(Math.max(-1, Math.min(1, d.z)))};
  }

  center() { return new THREE.Vector3(this.cx, this.cy, this.cz); }
  setCenter({x, y, z}) { this.cx = x; this.cy = y; this.cz = z; }
  translate(dx, dy, dz) { this.cx += dx; this.cy += dy; this.cz += dz; }

  /** Fix the screen axes at the start of a drag, so a free orbit turns about them as they were. */
  beginDrag() {
    const up = this.up.clone().normalize();
    const forward = this.offsetDir.clone().negate();
    let right = new THREE.Vector3().crossVectors(forward, up);
    if (right.lengthSq() < 1e-12) right = new THREE.Vector3().crossVectors(forward, Math.abs(up.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0));
    this.dragUp = up;
    this.dragRight = right.normalize();
  }

  endDrag() { this.dragUp = this.dragRight = null; }

  orbit(dx, dy, speed = ORBIT_SPEED) {
    if (this.mode === 'standard') {
      // Leaving a view looked at straight down or up: carry on from where it pointed.
      const {theta, phi} = this.angles();
      const flat = Math.hypot(this.offsetDir.x, this.offsetDir.y) < 1e-6;
      // Straight down or up, the camera sits on the side the screen's bottom points to.
      const start = flat ? Math.atan2(-this.up.y, -this.up.x) : theta;
      this.setAngles(start - dx * speed, this.clampPhi(phi + dy * speed));
      this.up.set(0, 0, 1);
      return;
    }
    if (!this.dragUp) this.beginDrag();
    const turn = new THREE.Quaternion().setFromAxisAngle(this.dragUp, -dx * speed)
      .multiply(new THREE.Quaternion().setFromAxisAngle(this.dragRight, -dy * speed));
    this.offsetDir.applyQuaternion(turn).normalize();
    this.up.applyQuaternion(turn).normalize();
  }

  /** How much one wheel step zooms: more at a distance, so it feels the same at every scale. */
  zoomFactor(out) {
    const base = out ? 1.2 : 1 / 1.2;
    const scale = Math.max(0.8, Math.log(this.orbitDist + 1) / 3);
    return Math.pow(base, Math.min(scale, 1.6));
  }

  /** The direction and up vector that look along an axis: top and bottom keep +Y up the screen. */
  static snap(direction) {
    const offsetDir = {...direction};
    if (direction.z > 0.999) return {offsetDir, up: {x: 0, y: 1, z: 0}};
    if (direction.z < -0.999) return {offsetDir, up: {x: 0, y: -1, z: 0}};
    return {offsetDir, up: {x: 0, y: 0, z: 1}};
  }

  applyTo(camera) {
    camera.position.set(this.cx + this.offsetDir.x * this.orbitDist, this.cy + this.offsetDir.y * this.orbitDist,
      this.cz + this.offsetDir.z * this.orbitDist);
    camera.up.copy(this.up);
    camera.lookAt(this.cx, this.cy, this.cz);
  }

  animateTo({offsetDir, up, distance, center, durationMs = 260}) {
    const target = new THREE.Vector3(offsetDir.x, offsetDir.y, offsetDir.z);
    if (!target.lengthSq()) return;
    const targetUp = up ? new THREE.Vector3(up.x, up.y, up.z).normalize() : this.up.clone();
    const to = center || {x: this.cx, y: this.cy, z: this.cz};
    this.animation = {
      started: performance.now(), durationMs,
      startDir: this.offsetDir.clone(), targetDir: target.normalize(),
      startUp: this.up.clone(), targetUp,
      startDist: this.orbitDist, deltaDist: (distance ?? this.orbitDist) - this.orbitDist,
      start: {x: this.cx, y: this.cy, z: this.cz}, delta: {x: to.x - this.cx, y: to.y - this.cy, z: to.z - this.cz},
    };
  }

  cancelAnimation() { this.animation = null; }

  /** Advance the animation; false once it is over. */
  step(now = performance.now()) {
    const a = this.animation;
    if (!a) return false;
    const t = Math.max(0, Math.min(1, a.durationMs > 0 ? (now - a.started) / a.durationMs : 1));
    const eased = 1 - Math.pow(1 - t, 3);
    slerp(this.offsetDir, a.startDir, a.targetDir, eased);
    slerp(this.up, a.startUp, a.targetUp, eased);
    this.orbitDist = Math.max(1e-3, a.startDist + a.deltaDist * eased);
    this.cx = a.start.x + a.delta.x * eased;
    this.cy = a.start.y + a.delta.y * eased;
    this.cz = a.start.z + a.delta.z * eased;
    if (t >= 1) { this.animation = null; return false; }
    return true;
  }
}

function slerp(out, a, b, t) {
  const dot = Math.max(-1, Math.min(1, a.dot(b)));
  if (dot > 0.9995) return out.lerpVectors(a, b, t).normalize();
  if (dot < -0.9995) {
    // Opposite: turn about any perpendicular axis.
    const axis = Math.abs(a.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    axis.cross(a).normalize();
    return out.copy(a).applyAxisAngle(axis, Math.PI * t);
  }
  const omega = Math.acos(dot), sin = Math.sin(omega);
  return out.set(0, 0, 0).addScaledVector(a, Math.sin((1 - t) * omega) / sin).addScaledVector(b, Math.sin(t * omega) / sin);
}
