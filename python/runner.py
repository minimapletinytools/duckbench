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
_project_modules = set()


def run_model(code, filename="model.py"):
    """Execute source in a fresh namespace and return its result scene."""
    global _last_result, _project_modules
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
        return {"scene": scene, "elapsed": time.perf_counter() - start}
    finally:
        _project_modules = {name for name, mod in sys.modules.items()
                            if name not in before and getattr(mod, "__file__", None)
                            and Path(mod.__file__).resolve().is_relative_to(path.parent)
                            and "site-packages" not in Path(mod.__file__).parts}
        os.chdir(old_cwd)
        sys.path[:] = old_path
        sys.argv[:] = old_argv


def export_model(format):
    """Export the most recent successful model as base64."""
    from build123d import export_step, export_stl
    if _last_result is None:
        raise ValueError("Run a model before exporting.")
    if format not in ("step", "stl"):
        raise ValueError("Supported formats: step, stl")
    with tempfile.TemporaryDirectory() as folder:
        target = Path(folder) / ("model." + format)
        (export_step if format == "step" else export_stl)(_last_result, str(target))
        return base64.b64encode(target.read_bytes()).decode("ascii")


def dispatch(request):
    if request["method"] == "run":
        return run_model(**request["params"])
    if request["method"] == "export":
        return export_model(request["params"]["format"])
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
