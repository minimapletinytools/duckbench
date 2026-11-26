"""Read a CAD document and emit the Duckbench display scene on stdout.

Also the scene every build is shown with (`cad_scene`), shared with runner.py.
"""
import json
import os
from pathlib import Path
import sys


def _leaves(node):
    for part in node.get("parts", []):
        if "parts" in part:
            yield from _leaves(part)
        else:
            yield part


def _decode(instances, node):
    """Put each leaf's tessellation in place of its reference to the shared instance."""
    for part in node.get("parts", []):
        if "parts" in part:
            _decode(instances, part)
        elif isinstance(part.get("shape"), dict) and part["shape"].get("ref") is not None:
            part["shape"] = instances[part["shape"]["ref"]]


def _holes(shape):
    """Round holes of a located shape: concave cylindrical faces bounded by a full circle, for ⌀ labels."""
    from build123d import GeomType, Vector
    holes = []
    for face in shape.faces():
        if face.geom_type != GeomType.CYLINDER:
            continue
        if not any(edge.geom_type == GeomType.CIRCLE and edge.is_closed for edge in face.edges()):
            continue
        try:
            axis_origin = Vector(face.axis_of_rotation.position)
            axis = Vector(face.axis_of_rotation.direction).normalized()
            center = face.center()
            radial = center - axis_origin - axis * (center - axis_origin).dot(axis)
            if face.normal_at(center).dot(radial) >= 0:
                continue  # convex: a boss or a rounded outside, not a hole
            along = [(Vector(v) - axis_origin).dot(axis) for v in face.vertices()]
            a, b = axis_origin + axis * min(along), axis_origin + axis * max(along)
            holes.append({"a": [round(c, 4) for c in a], "b": [round(c, 4) for c in b],
                          "d": round(2 * face.radius, 4)})
        except Exception:
            continue
    return holes[:200]


def _located(leaf):
    """A leaf of the tessellation's mapping as a build123d shape where it is drawn."""
    from build123d import Compound
    from build123d.topology.shape_core import Shape
    shape = leaf["shape"]
    if isinstance(shape, list):  # Edges or vertices, already in place.
        return Compound([Shape.cast(item) for item in shape])
    obj = shape["obj"]
    return Shape.cast(obj.Moved(leaf["loc"]) if leaf.get("loc") is not None else obj)


def cad_scene(shape):
    """The display scene of a build123d shape, and each leaf's located shape by its scene id.

    A leaf's faces, edges and vertices are numbered in the scene as `feature_map` numbers them,
    so a picked index finds the same feature here.
    """
    from build123d.topology.shape_core import Shape
    from ocp_tessellate.convert import numpy_to_js, tessellate_group, to_ocpgroup

    group, instances = to_ocpgroup(shape)
    instances, scene, mapping = tessellate_group(group, instances)
    _decode(instances, scene)
    scene = json.loads(numpy_to_js(None, scene))
    leaves = {leaf["id"]: _located(leaf) for leaf in _leaves(mapping)}
    for node in _leaves(scene):
        located = leaves.get(node["id"])
        if located is not None and node.get("type") == "shapes":
            node["holes"] = _holes(located)
    return scene, leaves


def feature_map(shape, kind):
    """A located shape's faces, edges or vertices in the scene's order: ocp-tessellate's own enumeration."""
    from build123d.topology.shape_core import Shape
    from ocp_tessellate.ocp_utils import get_edges, get_faces, get_vertices
    if kind == "face":
        items = list(get_faces(shape.wrapped))
    elif kind == "vertex":
        items = list(get_vertices(shape.wrapped))
    else:
        # The scene draws only edges that bound a face, when the shape has faces.
        has_faces = next(iter(get_faces(shape.wrapped)), None) is not None
        items = [edge for edge, _ in get_edges(shape.wrapped, True)] if has_faces else list(get_edges(shape.wrapped))
    return [Shape.cast(item) for item in items]


def read_model(filename):
    from build123d import import_step, import_stl

    path = Path(filename)
    reader = {".step": import_step, ".stp": import_step, ".stl": import_stl}[path.suffix.lower()]
    shape = reader(str(path))
    if shape.wrapped is None or shape.wrapped.IsNull():
        raise ValueError("The file contains no displayable geometry.")
    shape.label = shape.label or path.stem
    scene, _ = cad_scene(shape)
    return {"version": 1, "name": path.name, "scene": scene}


def main(filename):
    # CAD libraries can write directly to stdout. Keep that output off the scene channel.
    with os.fdopen(os.dup(1), "w", encoding="utf-8") as output:
        os.dup2(2, 1)
        json.dump(read_model(filename), output)


if __name__ == "__main__":
    main(sys.argv[1])
