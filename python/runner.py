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


def dispatch(request):
    if request["method"] == "run":
        return run_model(**request["params"])
    if request["method"] == "export":
        return export_model(**request["params"])
    if request["method"] == "describe":
        return describe_model(**request["params"])
    if request["method"] == "api":
        return api_lookup(**request["params"])
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
