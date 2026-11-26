// Dimensions drawn around the model: its overall size along X, Y and Z, and the diameter of each
// set of equal round holes. They re-anchor as the camera turns: each sits on a side of the bounding
// box facing the viewer, a fixed distance out on screen, and hides when its axis points at the viewer.
import * as THREE from 'three';
import {CSS2DObject} from 'three/addons/renderers/CSS2DRenderer.js';

const GAP_PX = 26;
const TICK_PX = 5;
const LINE_SLOTS = 3 * 5 * 2; // three dimensions of five segments each

export function formatMm(value) {
  const rounded = Math.round(value * 100) / 100;
  return (Object.is(rounded, -0) ? 0 : rounded).toString();
}

function label(className) {
  const element = document.createElement('div');
  element.className = 'dim-label ' + className;
  return new CSS2DObject(element);
}

export function createDimensions(scene) {
  const group = new THREE.Group();
  group.renderOrder = 5;
  scene.add(group);
  const positions = new Float32Array(LINE_SLOTS * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({transparent: true, opacity: 0.85, depthTest: false});
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  group.add(lines);
  const sizeLabels = [label('is-size'), label('is-size'), label('is-size')];
  group.add(...sizeLabels);
  let holeLabels = [];

  /** The holes of the visible parts, one label per size and direction ("4× ⌀6 mm"). */
  function setHoles(leaves) {
    for (const item of holeLabels) group.remove(item.label);
    const sets = new Map();
    for (const leaf of leaves) {
      if (!leaf.visible) continue;
      for (const hole of leaf.holes) {
        const a = new THREE.Vector3(...hole.a), b = new THREE.Vector3(...hole.b);
        const axis = b.clone().sub(a).normalize();
        if (axis.x < -1e-6 || (Math.abs(axis.x) < 1e-6 && (axis.y < -1e-6 || (Math.abs(axis.y) < 1e-6 && axis.z < 0)))) axis.negate();
        const key = formatMm(hole.d) + '|' + axis.toArray().map(c => c.toFixed(2)).join(',');
        const entry = sets.get(key) || {d: hole.d, ends: []};
        entry.ends.push([a, b]);
        sets.set(key, entry);
      }
    }
    holeLabels = [...sets.values()].slice(0, 40).map(({d, ends}) => {
      const tag = label('is-hole');
      tag.element.textContent = (ends.length > 1 ? ends.length + '× ' : '') + '⌀' + formatMm(d) + ' mm';
      group.add(tag);
      return {label: tag, ends};
    });
  }

  /**
   * Re-anchor for the camera. `box`: what is measured (world); `view`: unit vector from the target
   * to the camera; `perPixel`: world units per screen pixel; `project(v)`: v in screen pixels.
   */
  function update({box, view, perPixel, enabled, project}) {
    group.visible = enabled && !!box && !box.isEmpty();
    if (!group.visible) return;
    const {min, max} = box;
    const size = box.getSize(new THREE.Vector3());
    const gap = GAP_PX * perPixel, tick = TICK_PX * perPixel;
    const v = [view.x, view.y, view.z];
    const lo = [min.x, min.y, min.z], hi = [max.x, max.y, max.z];
    // The side of the box facing the viewer along an axis; a tie takes the low side.
    const near = axis => (Math.abs(v[axis]) < 0.05 ? lo[axis] : v[axis] > 0 ? hi[axis] : lo[axis]);
    const out = axis => (Math.abs(v[axis]) < 0.05 ? -1 : Math.sign(v[axis]));
    let slot = 0;
    const segment = (p, q) => { positions.set([...p, ...q], slot * 6); slot++; };
    const taken = [];
    const rect = (position, text) => {
      const p = project(position);
      const w = 14 + text.length * 6.6;
      return {x: p.x - w / 2, y: p.y - 10, w, h: 20};
    };
    const overlaps = r => taken.some(t => r.x < t.x + t.w && t.x < r.x + r.w && r.y < t.y + t.h && t.y < r.y + r.h);

    for (let axis = 0; axis < 3; axis++) {
      const tag = sizeLabels[axis];
      const others = [0, 1, 2].filter(a => a !== axis);
      // Push the dimension out along whichever other axis lies flattest on the screen; for height,
      // pick the one the camera looks along less, and put it on the far corner from the others.
      const offsetAxis = Math.abs(v[others[0]]) <= Math.abs(v[others[1]]) ? others[0] : others[1];
      const baseAxis = others.find(a => a !== offsetAxis);
      const visible = Math.abs(v[axis]) < 0.94 && size.getComponent(axis) > 1e-6;
      tag.visible = visible;
      if (!visible) continue;
      const direction = axis === 2 ? -out(offsetAxis) : offsetAxis === 2 ? -1 : out(offsetAxis);
      const edge = direction > 0 ? hi[offsetAxis] : lo[offsetAxis];
      const point = t => {
        const p = [0, 0, 0];
        p[axis] = t;
        p[baseAxis] = near(baseAxis);
        p[offsetAxis] = edge;
        return p;
      };
      const push = (p, amount) => { const q = [...p]; q[offsetAxis] += direction * amount; return q; };
      const a = point(lo[axis]), b = point(hi[axis]);
      const a2 = push(a, gap), b2 = push(b, gap);
      segment(a2, b2);
      segment(push(a, gap * 0.15), push(a, gap * 1.25));
      segment(push(b, gap * 0.15), push(b, gap * 1.25));
      const across = (p, s) => { const q = [...p]; q[axis] += s * tick; q[offsetAxis] += s * tick * direction; return q; };
      segment(across(a2, -1), across(a2, 1));
      segment(across(b2, -1), across(b2, 1));
      const text = formatMm(size.getComponent(axis)) + ' mm';
      tag.element.textContent = text;
      tag.position.set(...a2.map((c, i) => (c + b2[i]) / 2));
      const r = rect(tag.position, text);
      if (overlaps(r)) tag.visible = false;
      else taken.push(r);
    }
    positions.fill(0, slot * 6);
    geometry.attributes.position.needsUpdate = true;
    geometry.setDrawRange(0, slot * 2);

    const toward = new THREE.Vector3(...v);
    for (const item of holeLabels) {
      // At the end of the first hole that faces the viewer, when the hole is not seen end-on.
      const [a, b] = item.ends[0];
      item.label.position.copy(a.dot(toward) > b.dot(toward) ? a : b);
      const r = rect(item.label.position, item.label.element.textContent);
      item.label.visible = !overlaps(r);
      if (item.label.visible) taken.push(r);
    }
  }

  return {
    group, setHoles, update,
    setColor(color) { material.color.set(color); },
    dispose() {
      geometry.dispose();
      material.dispose();
      for (const item of [...sizeLabels, ...holeLabels.map(h => h.label)]) item.element.remove();
    },
  };
}
