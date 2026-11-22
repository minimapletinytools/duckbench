"""Read a CAD document and emit the Duckbench display scene on stdout."""
import json
import os
from pathlib import Path
import sys


def main(filename):
    # CAD libraries can write directly to stdout. Keep that output off the scene channel.
    with os.fdopen(os.dup(1), "w", encoding="utf-8") as output:
        os.dup2(2, 1)
        from build123d import import_step, import_stl
        from ocp_tessellate.convert import export_three_cad_viewer_js

        path = Path(filename)
        reader = {".step": import_step, ".stp": import_step, ".stl": import_stl}[path.suffix.lower()]
        shape = reader(str(path))
        if shape.wrapped is None or shape.wrapped.IsNull():
            raise ValueError("The file contains no displayable geometry.")
        shape.label = shape.label or path.stem
        scene = json.loads(export_three_cad_viewer_js(None, shape))
        json.dump({"version": 1, "name": path.name, "scene": scene}, output)


if __name__ == "__main__":
    main(sys.argv[1])
