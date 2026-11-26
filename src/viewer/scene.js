// The scene a build sends (ocp-tessellate's tree of tessellated parts) as three.js objects: what is
// drawn, and a second, flat-coloured copy whose colours name the face, edge or vertex at each pixel
// (picking.js). A leaf's faces, edges and vertices keep the build's order, so the Python side can
// find the same feature again by its index (python/viewer_import.py feature_map).
import * as THREE from 'three';

// ocp-tessellate's colours for a shape that was given none; the viewer draws those in its own.
const DEFAULT_COLORS = new Set(['#e8b024', '#ee82ee']);
export const FACE_TYPES = ['plane', 'cylinder', 'cone', 'sphere', 'torus', 'bezier', 'bspline', 'revolution', 'extrusion', 'offset', 'other'];
export const EDGE_TYPES = ['line', 'circle', 'ellipse', 'hyperbola', 'parabola', 'bezier', 'bspline', 'offset', 'other'];

export const PICK_VERTEX = `
attribute vec3 pickColor;
varying vec3 vPick;
uniform float pointSize;
void main() {
  vPick = pickColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = pointSize;
}`;
export const PICK_FRAGMENT = `
varying vec3 vPick;
void main() { gl_FragColor = vec4(vPick, 1.0); }`;

function pickMaterial(options = {}) {
  return new THREE.ShaderMaterial({vertexShader: PICK_VERTEX, fragmentShader: PICK_FRAGMENT,
    uniforms: {pointSize: {value: options.pointSize ?? 1}}, ...options.extra});
}

const TYPED = {float32: Float32Array, uint32: Uint32Array, int32: Int32Array};

/** An array of the scene: a JSON list, or {dtype, b64} as python/viewer_import.py packs the big ones. */
function unpack(value) {
  if (!value || Array.isArray(value) || ArrayBuffer.isView(value) || !value.b64) return value;
  const Type = TYPED[value.dtype];
  if (!Type) throw new Error('Unsupported array type ' + value.dtype + ' in the scene.');
  let bytes;
  if (typeof Uint8Array.fromBase64 === 'function') bytes = Uint8Array.fromBase64(value.b64);
  else {
    const text = atob(value.b64);
    bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  }
  return new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT);
}

function unpackShape(shape = {}) {
  const out = {...shape};
  for (const key of ['vertices', 'normals', 'edges', 'obj_vertices', 'triangles']) if (out[key]) out[key] = unpack(out[key]);
  return out;
}

function localMatrix(loc) {
  const matrix = new THREE.Matrix4();
  if (!Array.isArray(loc)) return matrix;
  const [position, quaternion] = loc;
  return matrix.compose(new THREE.Vector3(...position), new THREE.Quaternion(...quaternion), new THREE.Vector3(1, 1, 1));
}

/** The id's colour, as three bytes. Id 0 is the background. */
function idBytes(id) { return [id & 255, (id >> 8) & 255, (id >> 16) & 255]; }

/**
 * Build the scene. Returns {root, pickRoot, leaves, tree, features, box}: `features[id - 1]` is
 * {leaf, kind, index} for a pick id; `tree` mirrors the build's assembly for the parts panel.
 */
export function buildScene(data, {materials}) {
  const root = new THREE.Group(), pickRoot = new THREE.Group();
  const leaves = [], features = [];
  const box = new THREE.Box3();
  const register = (leaf, kind, index) => { features.push({leaf, kind, index}); return idBytes(features.length); };

  function visit(node, parentMatrix, depth) {
    const matrix = parentMatrix.clone().multiply(localMatrix(node.loc));
    const entry = {id: node.id, name: node.name || 'Part', depth, children: []};
    if (Array.isArray(node.parts)) {
      for (const part of node.parts) entry.children.push(visit(part, matrix, depth + 1));
      return entry;
    }
    const leaf = buildLeaf(node, matrix, leaves.length);
    leaves.push(leaf);
    entry.leaf = leaf;
    root.add(leaf.group);
    pickRoot.add(leaf.pickGroup);
    if (!leaf.box.isEmpty()) box.union(leaf.box);
    return entry;
  }

  function buildLeaf(node, matrix, index) {
    const shape = unpackShape(node.shape);
    const group = new THREE.Group(), pickGroup = new THREE.Group();
    for (const g of [group, pickGroup]) { g.matrixAutoUpdate = false; g.matrix.copy(matrix); g.matrixWorldNeedsUpdate = true; }
    const color = typeof node.color === 'string' && !DEFAULT_COLORS.has(node.color.toLowerCase()) ? node.color : null;
    const leaf = {index, id: node.id, name: node.name || 'Part', type: node.type, group, pickGroup, color,
      alpha: node.alpha ?? 1, holes: node.holes || [], faceTypes: shape.face_types || [], edgeTypes: shape.edge_types || [],
      faceStarts: [], edgeStarts: [], vertexCount: (shape.obj_vertices?.length || 0) / 3, box: new THREE.Box3(), visible: true};

    // Faces: one indexed mesh, each face's triangles a contiguous run of the index.
    if (shape.triangles?.length && shape.vertices?.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(shape.vertices, 3));
      if (shape.normals?.length === shape.vertices.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(shape.normals, 3));
      else geometry.computeVertexNormals();
      geometry.setIndex(Array.isArray(shape.triangles) ? shape.triangles : new THREE.BufferAttribute(Uint32Array.from(shape.triangles), 1));
      let start = 0;
      for (const count of shape.triangles_per_face || [shape.triangles.length / 3]) { leaf.faceStarts.push(start); start += count; }
      leaf.faceStarts.push(start);
      const material = materials.face(leaf, node);
      leaf.mesh = new THREE.Mesh(geometry, material);
      leaf.mesh.userData.leaf = leaf;
      group.add(leaf.mesh);

      // Its pick copy: unindexed, so each triangle carries its face's id.
      const triangles = shape.triangles, vertices = shape.vertices;
      const positions = new Float32Array(triangles.length * 3), colors = new Uint8Array(triangles.length * 3);
      for (let face = 0; face < leaf.faceStarts.length - 1; face++) {
        const bytes = register(leaf, 'face', face);
        for (let t = leaf.faceStarts[face]; t < leaf.faceStarts[face + 1]; t++) {
          for (let k = 0; k < 3; k++) {
            const v = triangles[t * 3 + k], o = (t * 3 + k) * 3;
            positions[o] = vertices[v * 3]; positions[o + 1] = vertices[v * 3 + 1]; positions[o + 2] = vertices[v * 3 + 2];
            colors[o] = bytes[0]; colors[o + 1] = bytes[1]; colors[o + 2] = bytes[2];
          }
        }
      }
      const pick = new THREE.BufferGeometry();
      pick.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      pick.setAttribute('pickColor', new THREE.BufferAttribute(colors, 3, true));
      leaf.pickFaces = new THREE.Mesh(pick, materials.pickFace);
      pickGroup.add(leaf.pickFaces);
      geometry.computeBoundingBox();
      leaf.box.copy(geometry.boundingBox).applyMatrix4(matrix);
    }

    // Edges: segment pairs, each edge a contiguous run of segments.
    if (shape.edges?.length) {
      const segments = shape.edges;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
      let start = 0;
      const perEdge = shape.segments_per_edge?.length ? shape.segments_per_edge : [segments.length / 6];
      for (const count of perEdge) { leaf.edgeStarts.push(start); start += count; }
      leaf.edgeStarts.push(start);
      leaf.edges = new THREE.LineSegments(geometry, materials.edge(leaf, node));
      leaf.edges.userData.leaf = leaf;
      group.add(leaf.edges);
      const colors = new Uint8Array(segments.length);
      for (let edge = 0; edge < perEdge.length; edge++) {
        const bytes = register(leaf, 'edge', edge);
        for (let s = leaf.edgeStarts[edge] * 2; s < leaf.edgeStarts[edge + 1] * 2; s++) colors.set(bytes, s * 3);
      }
      const pick = new THREE.BufferGeometry();
      pick.setAttribute('position', geometry.getAttribute('position'));
      pick.setAttribute('pickColor', new THREE.BufferAttribute(colors, 3, true));
      leaf.pickEdges = new THREE.LineSegments(pick, materials.pickEdge);
      pickGroup.add(leaf.pickEdges);
      if (!leaf.mesh) {
        geometry.computeBoundingBox();
        leaf.box.copy(geometry.boundingBox).applyMatrix4(matrix);
      }
    }

    // Vertices: picked as small squares, drawn only when highlighted.
    if (shape.obj_vertices?.length) {
      const points = shape.obj_vertices;
      leaf.vertexPositions = points;
      const colors = new Uint8Array(points.length);
      for (let v = 0; v < points.length / 3; v++) colors.set(register(leaf, 'vertex', v), v * 3);
      const pick = new THREE.BufferGeometry();
      pick.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      pick.setAttribute('pickColor', new THREE.BufferAttribute(colors, 3, true));
      leaf.pickVertices = new THREE.Points(pick, materials.pickVertex);
      pickGroup.add(leaf.pickVertices);
      if (leaf.box.isEmpty()) {
        pick.computeBoundingBox();
        leaf.box.copy(pick.boundingBox).applyMatrix4(matrix);
      }
    }
    return leaf;
  }

  const tree = visit(data, new THREE.Matrix4(), 0);
  return {root, pickRoot, leaves, tree, features, box};
}

export function pickMaterials() {
  return {
    pickFace: pickMaterial({extra: {polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1}}),
    pickEdge: pickMaterial(),
    pickVertex: pickMaterial({pointSize: 7}),
  };
}

/** Free a built scene's geometry (materials belong to the viewer). */
export function disposeScene(built) {
  for (const leaf of built?.leaves || []) {
    for (const object of [leaf.mesh, leaf.edges, leaf.pickFaces, leaf.pickEdges, leaf.pickVertices]) object?.geometry.dispose();
    if (leaf.mesh?.material && leaf.mesh.material.userData.owned) leaf.mesh.material.dispose();
    if (leaf.edges?.material && leaf.edges.material.userData.owned) leaf.edges.material.dispose();
  }
}

/** Which kind a pick id names, as words: "plane face", "circle edge", "vertex". */
export function featureLabel(feature) {
  if (!feature) return '';
  const {leaf, kind, index} = feature;
  if (kind === 'face') return (FACE_TYPES[leaf.faceTypes[index]] || 'other') + ' face';
  if (kind === 'edge') return (EDGE_TYPES[leaf.edgeTypes[index]] || 'other') + ' edge';
  return 'vertex';
}
