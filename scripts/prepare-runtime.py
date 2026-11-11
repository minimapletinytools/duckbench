"""Stage the managed Python interpreter and installed packages for Electron."""
from pathlib import Path
import shutil
import sys
import sysconfig
root=Path(__file__).resolve().parents[1]
target=root/'release'/'python'
if target.exists():shutil.rmtree(target)
shutil.copytree(sys.base_prefix,target,symlinks=True)
source=Path(sysconfig.get_path('purelib'))
relative=source.relative_to(sys.prefix)
shutil.copytree(source,target/relative,dirs_exist_ok=True,symlinks=True)
print(target)
