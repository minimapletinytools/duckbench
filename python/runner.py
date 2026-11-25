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

_last_result = None
_preview_results = {}
_project_modules = set()


def run_model(code, filename="model.py", build_id=None, displayed_build=None):
    """Execute source in a fresh namespace and return its result scene."""
    global _last_result, _project_modules
    # Keep the displayed shape exportable while the UI attempts to render its replacement.
    for previous in list(_preview_results):
        if previous != displayed_build:
            del _preview_results[previous]
    from build123d import Shape, BuildPart, BuildSketch, BuildLine
    from ocp_tessellate.convert import export_three_cad_viewer_js
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
        if "result" not in namespace:
            raise ValueError("Assign the model to a top-level 'result' variable.")
        result = namespace["result"]
        for kind, attr in [(BuildPart, "part"), (BuildSketch, "sketch"), (BuildLine, "line")]:
            if isinstance(result, kind):
                result = getattr(result, attr)
                break
        if not isinstance(result, Shape) or result.wrapped is None:
            raise TypeError("result must be a build123d Shape or a completed BuildPart, BuildSketch or BuildLine. Use Compound(children=[...]) for assemblies.")
        scene = json.loads(export_three_cad_viewer_js(None, result))
        _last_result = result
        if build_id is not None:
            _preview_results[build_id] = result
        return {"scene": scene, "elapsed": time.perf_counter() - start}
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


def dispatch(request):
    if request["method"] == "run":
        return run_model(**request["params"])
    if request["method"] == "export":
        return export_model(**request["params"])
    if request["method"] == "describe":
        return describe_model(**request["params"])
    if request["method"] == "api":
        return api_lookup(**request["params"])
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
