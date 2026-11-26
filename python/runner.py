"""Execute a build123d script and exchange JSON messages over stdio."""
import base64
import contextlib
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile
import time
import traceback

try:
    from viewer_import import cad_scene, feature_map
except ImportError:  # In the browser, viewer_import's source is run into these globals after this one.
    pass

# ---- Boolean cache ----
# A model is rebuilt from scratch on every run, and often makes the same part several times (four
# identical wheels) or keeps most parts unchanged between runs (a parameter changed elsewhere).
# Booleans are where the kernel spends its time, and a boolean's result depends only on its inputs'
# geometry and the operation's options. So results are kept by a digest of exactly those, and a later
# boolean with the same inputs gets a fresh object around the same result, finished as build123d
# finishes its own (the class, the first input's label and colour, the record of what was made).
# Set DUCKBENCH_BOOLEAN_CACHE=0 to turn it off.
_BOOLEAN_CACHE_LIMIT = 800
_boolean_cache = None


def _copy_history(history):
    """A history of its own: build123d extends one in place, and a cached one is handed out again."""
    if history is None:
        return None
    from OCP.BRepTools import BRepTools_History
    from build123d.topology.history import ShapeHistory
    copied = BRepTools_History()
    copied.Merge(history.wrapped)
    return ShapeHistory(copied, history.before, history.brought)


def _shape_digest(topods):
    import hashlib
    import io
    from OCP.BinTools import BinTools, BinTools_FormatVersion
    buffer = io.BytesIO()
    # Geometry only: the preview meshes the shapes it shows, and a mesh is no part of what a boolean makes.
    BinTools.Write_s(topods, buffer, False, False, BinTools_FormatVersion.BinTools_FormatVersion_CURRENT)
    return hashlib.blake2b(buffer.getvalue(), digest_size=20).digest()


def _install_boolean_cache():
    global _boolean_cache
    if _boolean_cache is not None or os.environ.get("DUCKBENCH_BOOLEAN_CACHE") == "0":
        return
    from collections import OrderedDict
    from OCP.TopoDS import TopoDS_Compound
    from build123d import SkipClean
    from build123d.topology import shape_core
    original = shape_core.Shape._bool_op
    _boolean_cache = cache = OrderedDict()
    stats = _boolean_cache_stats

    def options(operation):
        try:
            return (operation.FuzzyValue(), str(operation.Glue()), operation.NonDestructive(), operation.CheckInverted())
        except Exception:
            return None

    def cached_bool_op(self, args, tools, operation):
        args, tools = list(args), list(tools)
        if not args or any(shape._wrapped is None for shape in args + tools):
            return original(self, args, tools, operation)
        settings = options(operation)
        if settings is None:
            return original(self, args, tools, operation)
        try:
            key = (type(operation).__name__, SkipClean.clean, settings,
                   tuple(_shape_digest(shape.wrapped) for shape in args), tuple(_shape_digest(shape.wrapped) for shape in tools))
        except Exception:
            return original(self, args, tools, operation)
        # The class of the result, as build123d picks it: the highest order among the inputs.
        orders = {type(s): type(s).order for s in [self] + args + tools if hasattr(type(s), "order")}
        highest = sorted(orders.items(), key=lambda item: item[1])[-1]
        hit = cache.get(key)
        if hit is not None:
            cache.move_to_end(key)
            stats["hits"] += 1
            topods, history = hit
            result = highest[0].cast(topods)
            args[0].copy_attributes_to(result, ["wrapped", "_NodeMixin__children"])
            return result._made_by(_copy_history(history))
        stats["misses"] += 1
        result = original(self, args, tools, operation)
        # A result split into a composite of pieces is not kept: its pieces carry attributes of their own.
        if result._wrapped is not None and not (isinstance(result.wrapped, TopoDS_Compound) and highest[1] != 4):
            cache[key] = (result.wrapped, _copy_history(result._history))
            if len(cache) > _BOOLEAN_CACHE_LIMIT:
                cache.popitem(last=False)
        return result

    shape_core.Shape._bool_op = cached_bool_op


_boolean_cache_stats = {"hits": 0, "misses": 0}

_last_result = None
_preview_results = {}
# Each displayed build's leaves, by scene id, located: what a pick in the preview refers to.
_preview_leaves = {}
_project_modules = set()


def run_model(code, filename="model.py", build_id=None, displayed_build=None):
    """Execute source in a fresh namespace and return its result scene."""
    global _last_result, _project_modules
    # Keep the displayed shape exportable while the UI attempts to render its replacement.
    for previous in list(_preview_results):
        if previous != displayed_build:
            del _preview_results[previous]
            _preview_leaves.pop(previous, None)
    from build123d import Shape, BuildPart, BuildSketch, BuildLine
    _install_boolean_cache()
    _boolean_cache_stats.update(hits=0, misses=0)
    start = time.perf_counter()
    path = Path(filename).resolve()
    for name in _project_modules:
        old_module = sys.modules.pop(name, None)
        cached = getattr(old_module, "__cached__", None)
        if cached:
            Path(cached).unlink(missing_ok=True)
    before = set(sys.modules)
    importlib.invalidate_caches()
    old_cwd, old_path, old_argv = os.getcwd(), sys.path[:], sys.argv[:]
    namespace = {"__name__": "__main__", "__file__": str(path)}
    try:
        os.chdir(path.parent)
        sys.path.insert(0, str(path.parent))
        sys.argv = [str(path)]
        exec(compile(code, str(path), "exec"), namespace)
        modelled = time.perf_counter()
        if "result" not in namespace:
            raise ValueError("Assign the model to a top-level 'result' variable.")
        result = namespace["result"]
        for kind, attr in [(BuildPart, "part"), (BuildSketch, "sketch"), (BuildLine, "line")]:
            if isinstance(result, kind):
                result = getattr(result, attr)
                break
        if not isinstance(result, Shape) or result.wrapped is None:
            raise TypeError("result must be a build123d Shape or a completed BuildPart, BuildSketch or BuildLine. Use Compound(children=[...]) for assemblies.")
        scene, leaves = cad_scene(result)
        shown = time.perf_counter()
        _last_result = result
        if build_id is not None:
            _preview_results[build_id] = result
            _preview_leaves[build_id] = leaves
        return {"scene": scene, "elapsed": time.perf_counter() - start,
                "phases": {"model": modelled - start, "preview": shown - modelled},
                "booleans": dict(_boolean_cache_stats)}
    finally:
        _project_modules = {name for name, mod in sys.modules.items()
                            if name not in before and getattr(mod, "__file__", None)
                            and Path(mod.__file__).resolve().is_relative_to(path.parent)
                            and "site-packages" not in Path(mod.__file__).parts}
        os.chdir(old_cwd)
        sys.path[:] = old_path
        sys.argv[:] = old_argv


def export_model(format, build_id=None):
    """Export the most recent successful model as base64."""
    from build123d import export_step, export_stl
    shape = _last_result if build_id is None else _preview_results.get(build_id)
    if shape is None:
        raise ValueError("Run a model before exporting.")
    if format not in ("step", "stl"):
        raise ValueError("Supported formats: step, stl")
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / ("model." + format)
        (export_step if format == "step" else export_stl)(shape, str(target))
        return base64.b64encode(target.read_bytes()).decode("ascii")


def _vector(value, digits=4):
    return [round(float(c), digits) for c in (value.X, value.Y, value.Z)]


def _measure(shape):
    """Size, position and topology of one shape, in millimetres."""
    box = shape.bounding_box()
    info = {
        "min": _vector(box.min), "max": _vector(box.max), "size": _vector(box.size),
        "solids": len(shape.solids()), "faces": len(shape.faces()), "edges": len(shape.edges()),
    }
    for key, measure in (("volume", lambda: shape.volume), ("area", lambda: shape.area)):
        try:
            info[key] = round(float(measure()), 3)
        except Exception:
            pass
    try:
        if info.get("volume"):
            info["center_of_mass"] = _vector(shape.center())
    except Exception:
        pass
    return info


def describe_model(build_id=None, limit=60):
    """Describe the displayed model: overall size, then each labelled part of an assembly."""
    from build123d import Compound
    shape = _last_result if build_id is None else _preview_results.get(build_id)
    if shape is None:
        raise ValueError("No built model to describe. Run the model first.")
    parts = []

    def walk(node, path):
        name = node.label or type(node).__name__
        here = path + "/" + name if path else name
        children = list(node.children) if isinstance(node, Compound) and node.children else []
        if children:
            for child in children:
                walk(child, here)
        elif len(parts) < limit:
            entry = {"path": here, "type": type(node).__name__, **_measure(node)}
            color = getattr(node, "color", None)
            if color is not None:
                entry["color"] = str(color)
            parts.append(entry)

    walk(shape, "")
    return {"units": "mm", "overall": {"type": type(shape).__name__, **_measure(shape)},
            "parts": parts, "truncated": len(parts) >= limit}


def _summary(doc):
    return (doc or "").strip().split("\n\n")[0].replace("\n", " ")[:240]


def api_lookup(name=None, search=None):
    """build123d's real signatures and docstrings, so the agent need not guess."""
    import inspect
    import re
    import build123d
    public = sorted(n for n in dir(build123d) if not n.startswith("_"))
    if search:
        pattern = re.compile(search, re.IGNORECASE)
        found = []
        for n in public:
            obj = getattr(build123d, n)
            if pattern.search(n) or pattern.search(_summary(getattr(obj, "__doc__", ""))):
                found.append(n + ": " + _summary(getattr(obj, "__doc__", ""))[:120])
        return {"version": build123d.__version__, "matches": found[:80], "truncated": len(found) > 80}
    if not name:
        return {"version": build123d.__version__, "names": public}
    obj = build123d
    if any(part.startswith("_") for part in name.split(".")):
        raise ValueError("Look up public build123d names only.")
    for part in name.removeprefix("build123d.").split("."):
        if not hasattr(obj, part):
            close = [n for n in public if n.lower().startswith(part.lower()[:3])][:20]
            raise ValueError(f"build123d has no {name}. Similar names: {', '.join(close) or 'none'}")
        obj = getattr(obj, part)
    info = {"name": name, "kind": type(obj).__name__}
    short = lambda text: re.sub(r"\b(?:[a-z_][a-z0-9_]*\.)+(?=[A-Za-z_])", "", text)
    for target in ([obj.__init__, obj] if inspect.isclass(obj) else [obj]):
        try:
            signature = str(inspect.signature(target))
        except (TypeError, ValueError):
            continue
        if signature != "(*args, **kwargs)":
            info["signature"] = short(signature.replace("(self, ", "(").replace("(self)", "()"))
            break
    where = _source_location(obj)
    if where:
        info["source"] = where
    doc = inspect.getdoc(obj) or ""
    info["doc"] = doc[:6000] + ("\n[…cut off]" if len(doc) > 6000 else "")
    if inspect.isclass(obj):
        info["bases"] = [b.__name__ for b in obj.__mro__[1:6]]
        # Its own members described; what it inherits from build123d's base shapes by name only.
        own = set().union(*(vars(c) for c in obj.__mro__[:2]))
        members, inherited = [], []
        for member, value in inspect.getmembers(obj):
            if member.startswith("_"):
                continue
            if member not in own:
                inherited.append(member)
                continue
            kind = "property" if isinstance(inspect.getattr_static(obj, member, None), property) else "method" if callable(value) else "attribute"
            members.append(f"{member} ({kind}): {_summary(getattr(value, '__doc__', '') if kind != 'attribute' else '')[:100]}")
        info["members"] = members[:100]
        info["inherited"] = ", ".join(inherited[:200])
    return info


def _source_location(obj):
    """Where build123d defines `obj`, as build123d/path.py:line, for build123d_source."""
    import inspect
    import build123d
    target = obj.fget if isinstance(obj, property) else obj
    try:
        file = inspect.getsourcefile(target)
        line = inspect.getsourcelines(target)[1]
    except (TypeError, OSError):
        return None
    root = os.path.dirname(os.path.realpath(build123d.__file__))
    file = os.path.realpath(file or "")
    if not file.startswith(root + os.sep):
        return None
    return "build123d/" + os.path.relpath(file, root).replace(os.sep, "/") + f":{line}"


_SOURCE_TYPES = (".py", ".pyi", ".js", ".txt")


def _source_files(root, folder):
    for path, dirs, names in os.walk(folder):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__" and not d.startswith("."))
        for name in sorted(names):
            if name.endswith(_SOURCE_TYPES):
                yield os.path.relpath(os.path.join(path, name), root).replace(os.sep, "/")


def source_read(path=None, search=None, ignore_case=False, limit=100):
    """The installed build123d's own source, read-only: list it, read a file or module, or search it."""
    import re
    import build123d
    root = os.path.dirname(os.path.realpath(build123d.__file__))
    shown = lambda relative: "build123d/" + relative if relative != "." else "build123d"
    target = root
    if path:
        wanted = path.strip().strip("/")
        if re.fullmatch(r"build123d(\.[A-Za-z_][A-Za-z0-9_]*)+", wanted):
            # A module name, e.g. build123d.topology.one_d.
            wanted = wanted.replace(".", "/")
            wanted += ".py" if os.path.isfile(os.path.join(root, wanted.split("/", 1)[1] + ".py")) else ""
        wanted = wanted.removeprefix("build123d").lstrip("/")
        target = os.path.realpath(os.path.join(root, wanted))
        if target != root and not target.startswith(root + os.sep):
            raise ValueError("Read files inside build123d only.")
        if not os.path.exists(target):
            raise ValueError(f"build123d has no {path}. List its files with no path.")
    if search:
        pattern = re.compile(search, re.IGNORECASE if ignore_case else 0)
        files = [os.path.relpath(target, root)] if os.path.isfile(target) else list(_source_files(root, target))
        matches = []
        for relative in files:
            with open(os.path.join(root, relative), encoding="utf-8", errors="replace") as handle:
                for number, line in enumerate(handle, 1):
                    if pattern.search(line):
                        matches.append(f"{shown(relative)}:{number}: {line.strip()[:200]}")
                        if len(matches) > limit:
                            return {"version": build123d.__version__, "matches": matches[:limit], "truncated": True}
        return {"version": build123d.__version__, "matches": matches, "truncated": False}
    if os.path.isdir(target):
        files = []
        for relative in _source_files(root, target):
            with open(os.path.join(root, relative), encoding="utf-8", errors="replace") as handle:
                files.append(f"{shown(relative)} ({sum(1 for _ in handle)} lines)")
        return {"version": build123d.__version__, "files": files}
    if not target.endswith(_SOURCE_TYPES):
        raise ValueError("Read build123d's source and text files only.")
    with open(target, encoding="utf-8", errors="replace") as handle:
        return {"version": build123d.__version__, "path": shown(os.path.relpath(target, root).replace(os.sep, "/")), "text": handle.read()}


def _point(vector, digits=4):
    return [round(float(c), digits) for c in vector]


def _describe_feature(item, kind):
    """One face, edge or vertex, measured, in model millimetres."""
    from build123d import GeomType, Vector
    if kind == "vertex":
        return {"kind": "vertex", "position": _point(Vector(item))}
    info = {"kind": kind, "type": item.geom_type.name.lower()}
    box = item.bounding_box()
    info["box"] = {"min": _point(box.min), "max": _point(box.max)}
    if kind == "face":
        center = item.center()
        info.update(area=round(item.area, 4), center=_point(center))
        if item.geom_type == GeomType.PLANE:
            info["normal"] = _point(item.normal_at(center))
        elif item.geom_type in (GeomType.CYLINDER, GeomType.CONE, GeomType.SPHERE, GeomType.TORUS):
            try:
                info["radius"] = round(item.radius, 4)
                info["diameter"] = round(2 * item.radius, 4)
            except Exception:
                pass
            if item.geom_type != GeomType.SPHERE:
                try:
                    info["axis"] = {"origin": _point(item.axis_of_rotation.position), "direction": _point(item.axis_of_rotation.direction)}
                except Exception:
                    pass
    else:
        info.update(length=round(item.length, 4), start=_point(item.position_at(0)), end=_point(item.position_at(1)))
        if item.geom_type == GeomType.CIRCLE:
            info.update(radius=round(item.radius, 4), diameter=round(2 * item.radius, 4), center=_point(item.arc_center), closed=item.is_closed)
        elif item.geom_type == GeomType.LINE:
            info["direction"] = _point((item.position_at(1) - item.position_at(0)).normalized())
    return info


def _between(items, kind):
    """Between two picked features: the shortest distance, and the angle when both have a direction."""
    from build123d import GeomType, Vector
    a, b = items
    result = {"distance": round(a.distance_to(b), 4)}
    direction = lambda item: (item.normal_at(item.center()) if kind == "face" and item.geom_type == GeomType.PLANE
                              else (item.position_at(1) - item.position_at(0)) if kind == "edge" and item.geom_type == GeomType.LINE else None)
    if kind != "vertex":
        da, db = direction(a), direction(b)
        if da is not None and db is not None and da.length > 1e-9 and db.length > 1e-9:
            result["angle"] = round(da.get_angle(db), 3)
    else:
        result["delta"] = _point(Vector(b) - Vector(a))
    return result


def _selector(shape, kind, chosen, name):
    """The shortest build123d expression on `name` that selects exactly `chosen`, or an index list."""
    from build123d import Axis, GeomType, SortBy
    same = lambda found: len(found) == len(chosen) and all(any(f.wrapped.IsSame(c.wrapped) for f in found) for c in chosen)
    method = {"face": "faces", "edge": "edges", "vertex": "vertices"}[kind]
    everything = getattr(shape, method)()
    bases = [(f"{name}.{method}()", everything)]
    types = {item.geom_type for item in chosen} if kind != "vertex" else set()
    if len(types) == 1:
        kind_type = next(iter(types))
        bases.append((f"{name}.{method}().filter_by(GeomType.{kind_type.name})", everything.filter_by(kind_type)))
    for axis in ("X", "Y", "Z"):
        if kind == "face" and all(item.geom_type == GeomType.PLANE for item in chosen) or kind == "edge" and types == {GeomType.LINE}:
            try:
                bases.append((f"{name}.{method}().filter_by(Axis.{axis})", everything.filter_by(getattr(Axis, axis))))
            except Exception:
                pass
    keys = [(f"Axis.{axis}", getattr(Axis, axis)) for axis in ("Z", "X", "Y")]
    keys += {"face": [("SortBy.AREA", SortBy.AREA)], "edge": [("SortBy.LENGTH", SortBy.LENGTH)]}.get(kind, [])
    if types & {GeomType.CIRCLE, GeomType.CYLINDER}:
        keys.append(("SortBy.RADIUS", SortBy.RADIUS))
    found = []

    def consider(text, items):
        if same(items):
            found.append(text)

    def groups(text, items):
        for key_text, key in keys:
            try:
                grouped = items.group_by(key)
            except Exception:
                continue
            if not grouped:
                continue
            for index in (0, -1):
                group = grouped[index]
                if len(chosen) == 1 and len(group) == 1:
                    # A single extreme reads better as a sort.
                    consider(f"{text}.sort_by({key_text})[{index}]", group)
                else:
                    consider(f"{text}.group_by({key_text})[{index}]", group)
                yield f"{text}.group_by({key_text})[{index}]", group

    for text, items in bases:
        consider(text, items)
        for inner_text, inner in list(groups(text, items)):
            if found:
                break
            if len(inner) > len(chosen):
                list(groups(inner_text, inner))
    if found:
        return {"selector": min(found, key=len), "robust": True}
    indices = [next(i for i, item in enumerate(everything) if item.wrapped.IsSame(c.wrapped)) for c in chosen]
    text = f"{name}.{method}()[{indices[0]}]" if len(indices) == 1 else f"[{name}.{method}()[i] for i in {tuple(indices)}]"
    return {"selector": text, "robust": False}


def feature_info(build_id=None, part=None, kind="face", indices=()):
    """What was picked in the preview: each feature measured, a measurement between two, and a selector for them."""
    leaves = _preview_leaves.get(build_id)
    if leaves is None:
        raise ValueError("That model is no longer on screen. Pick it again after the next build.")
    shape = leaves.get(part)
    if shape is None:
        raise ValueError(f"No part {part} in the model on screen.")
    if kind not in ("face", "edge", "vertex"):
        raise ValueError("kind is face, edge or vertex.")
    items = feature_map(shape, kind)
    try:
        chosen = [items[int(i)] for i in indices][:24]
    except (IndexError, ValueError):
        raise ValueError(f"{part} has {len(items)} {kind}s; that one is not among them.")
    if not chosen:
        raise ValueError("Pick at least one feature.")
    name = "result" if len(leaves) == 1 else "part"
    result = {"part": part, "kind": kind, "features": [_describe_feature(item, kind) for item in chosen]}
    if len(chosen) == 2:
        result["between"] = _between(chosen, kind)
    try:
        result.update(_selector(shape, kind, chosen, name))
    except Exception as error:  # A selector is a convenience; the measurements still stand.
        result["selector_error"] = str(error)
    if name == "part":
        result["selector_note"] = f"`part` is the shape shown as {part.rsplit('/', 1)[-1]}."
    return result


def _solid_leaves(build_id, part=None):
    """The displayed build's parts that have volume, by name, located as drawn."""
    leaves = _preview_leaves.get(build_id)
    if leaves is None:
        raise ValueError("Build the model first: the checks measure the model on screen.")
    found = {}
    for path, shape in leaves.items():
        if part is not None and part not in (path, path.rsplit("/", 1)[-1]):
            continue
        try:
            if shape.solids() and shape.volume > 1e-9:
                found[path] = shape
        except Exception:
            continue
    if part is not None and not found:
        raise ValueError(f"No solid part {part} in the model on screen.")
    return found


def check_fit(build_id=None, min_clearance=0.0, limit=60):
    """Which parts overlap, by how much, and which come closer than `min_clearance` millimetres."""
    parts = list(_solid_leaves(build_id).items())[:limit]
    name = lambda path: path.rsplit("/", 1)[-1]
    overlaps, close, checked = [], [], 0
    for i, (path_a, a) in enumerate(parts):
        box_a = a.bounding_box()
        for path_b, b in parts[i + 1:]:
            box_b = b.bounding_box()
            # Boxes further apart than the clearance cannot overlap or come too close.
            gap = max(box_b.min.X - box_a.max.X, box_a.min.X - box_b.max.X,
                      box_b.min.Y - box_a.max.Y, box_a.min.Y - box_b.max.Y,
                      box_b.min.Z - box_a.max.Z, box_a.min.Z - box_b.max.Z)
            if gap > max(min_clearance, 0) + 1e-6:
                continue
            checked += 1
            shared, common = 0.0, None
            try:
                # intersect gives a ShapeList in build123d 0.13; & gives the common solid.
                common = a & b
                shared = common.volume if common is not None else 0.0
            except Exception:
                pass
            if shared > 1e-6:
                center = common.center()
                overlaps.append({"parts": [name(path_a), name(path_b)], "paths": [path_a, path_b],
                                 "volume": round(shared, 4), "at": _point(center) if center is not None else None})
                continue
            distance = a.distance_to(b)
            if distance < min_clearance - 1e-9 or distance < 1e-6:
                close.append({"parts": [name(path_a), name(path_b)], "paths": [path_a, path_b], "distance": round(distance, 4),
                              "touching": distance < 1e-6})
    return {"parts": len(parts), "pairs_checked": checked, "min_clearance": min_clearance,
            "overlaps": overlaps, "too_close": close,
            "ok": not overlaps and not [c for c in close if not c["touching"] or min_clearance > 0]}


def _facets(face, tolerance=0.05, angular=0.15):
    """A face's triangles as (centroid, outward unit normal, area)."""
    from build123d import Vector
    points, triangles = face.tessellate(tolerance, angular)
    for i, j, k in triangles:
        a, b, c = points[i], points[j], points[k]
        cross = (b - a).cross(c - a)
        area = cross.length / 2
        if area < 1e-9:
            continue
        yield (a + b + c) / 3, cross.normalized(), area


def check_printability(build_id=None, part=None, min_wall=1.2, max_overhang=45.0, up=(0, 0, 1), samples=300):
    """FDM printability of each solid part: overhangs past `max_overhang` degrees from vertical, and
    walls thinner than `min_wall` millimetres, printed with `up` as the build direction.

    After cad-khana's checks (github.com/cyberchitta/cad-khana, Apache-2.0): a wall is measured by a
    ray cast inward along a facet's normal, from where it enters the material to where it next leaves;
    an overhang is downward-facing surface steeper than the limit, except what rests on the build plate.
    """
    import math
    from build123d import Axis, Vector
    up = Vector(*up).normalized()
    report = []
    for path, shape in _solid_leaves(build_id, part).items():
        faces = shape.faces()
        heights = [v.dot(up) for v in (Vector(p) for p in shape.vertices())] or [0.0]
        plate = min(min(heights), shape.bounding_box().min.dot(up) if up == Vector(0, 0, 1) else min(heights))
        overhangs, facets = [], []
        for index, face in enumerate(faces):
            area_over, steepest, weighted = 0.0, 0.0, Vector()
            for centroid, normal, area in _facets(face):
                facets.append((area, centroid, normal, index))
                down = -normal.dot(up)
                if down <= 1e-6:
                    continue
                if abs(centroid.dot(up) - plate) < 1e-3 and down > 0.999:
                    continue  # on the build plate
                angle = math.degrees(math.asin(min(1.0, down)))
                if angle > max_overhang + 1e-6:
                    area_over += area
                    steepest = max(steepest, angle)
                    weighted += centroid * area
            if area_over > 0.05:
                overhangs.append({"face": index, "type": face.geom_type.name.lower(), "area": round(area_over, 3),
                                  "max_angle": round(steepest, 1), "at": _point(weighted / area_over, 3)})
        # Walls: rays from the largest facets, spread across every face.
        facets.sort(key=lambda f: -f[0])
        chosen, per_face = [], {}
        for facet in facets:
            if per_face.get(facet[3], 0) >= max(2, samples // max(1, len(faces))):
                continue
            per_face[facet[3]] = per_face.get(facet[3], 0) + 1
            chosen.append(facet)
            if len(chosen) >= samples:
                break
        thinnest, thin = None, {}
        for area, centroid, normal, index in chosen:
            inward = -normal
            origin = centroid - inward * 0.02
            try:
                hits = shape.find_intersection_points(Axis(tuple(origin), tuple(inward)))
            except Exception:
                continue
            crossings = sorted(((hit - origin).dot(inward), hit, n.normalized().dot(inward)) for hit, n in hits)
            forward = [c for c in crossings if c[0] >= -1e-9]
            if not forward or forward[0][2] >= 0:
                continue
            leaving = next((c for c in forward[1:] if c[2] > 0), None)
            if leaving is None:
                continue
            thickness = leaving[0] - forward[0][0]
            if thickness <= 1e-4:
                continue
            sample = {"face": index, "thickness": round(thickness, 3), "at": _point(forward[0][1], 3), "to": _point(leaving[1], 3)}
            if thinnest is None or thickness < thinnest["thickness"]:
                thinnest = sample
            if thickness < min_wall and (index not in thin or thickness < thin[index]["thickness"]):
                thin[index] = sample
        overhangs.sort(key=lambda o: -o["area"])
        report.append({
            "part": path.rsplit("/", 1)[-1], "path": path, "volume": round(shape.volume, 3),
            "thinnest_wall": thinnest, "thin_walls": sorted(thin.values(), key=lambda t: t["thickness"])[:20],
            "overhangs": overhangs[:20], "overhang_area": round(sum(o["area"] for o in overhangs), 3),
            "rays": len(chosen),
        })
    return {"min_wall": min_wall, "max_overhang": max_overhang, "up": _point(up),
            "parts": report, "ok": all(not p["thin_walls"] and not p["overhangs"] for p in report)}


def dispatch(request):
    if request["method"] == "run":
        return run_model(**request["params"])
    if request["method"] == "export":
        return export_model(**request["params"])
    if request["method"] == "describe":
        return describe_model(**request["params"])
    if request["method"] == "api":
        return api_lookup(**request["params"])
    if request["method"] == "fit":
        return check_fit(**request["params"])
    if request["method"] == "printability":
        return check_printability(**request["params"])
    if request["method"] == "feature":
        return feature_info(**request["params"])
    if request["method"] == "source":
        return source_read(**request["params"])
    raise ValueError("Unknown runner method")


def main():
    output = sys.stdout
    # Redirect the OS descriptor too, since OCCT may print from native code.
    protocol_fd = os.dup(sys.stdout.fileno())
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    output = os.fdopen(protocol_fd, "w", buffering=1)
    sys.stdout = sys.stderr
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            response = {"id": request["id"], "result": dispatch(request)}
        except BaseException:
            response = {"id": request.get("id"), "error": traceback.format_exc()}
        output.write(json.dumps(response) + "\n")
        output.flush()


if __name__ == "__main__":
    main()
