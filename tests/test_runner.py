import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import runner

class RunnerTests(unittest.TestCase):
    def test_contract_and_last_good_export(self):
        scene=runner.run_model('from build123d import *\nresult = Box(4, 5, 6)')['scene']
        self.assertTrue(scene['parts'])
        for code,error in [('a = 3',ValueError),('result = 7',TypeError)]:
            with self.assertRaises(error):runner.run_model(code)
        self.assertIn(b'ISO-10303-21',base64.b64decode(runner.export_model('step')))
        self.assertGreater(len(base64.b64decode(runner.export_model('stl'))),84)
    def test_builder_sketch_line_assembly(self):
        for code in ['with BuildPart() as result:\n Box(1,2,3)', 'result = Circle(4)', 'result = Line((0,0),(3,4))', 'result = Compound(children=[Box(2,2,2), Pos(5,0,0)*Sphere(1)])']:
            self.assertTrue(runner.run_model('from build123d import *\n'+code)['scene']['parts'])
    def test_stdio_isolated_from_native_prints(self):
        p=subprocess.Popen([sys.executable,'python/runner.py'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        request={'id':1,'method':'run','params':{'code':'from build123d import *\nimport os\nprint("python log")\nos.write(1,b"native log\\n")\nresult=Box(1,2,3)','filename':'model.py'}}
        stdout,stderr=p.communicate(json.dumps(request)+'\n',timeout=90)
        self.assertEqual(json.loads(stdout)['id'],1)
        self.assertIn('python log',stderr);self.assertIn('native log',stderr)
    def test_sibling_import_and_cwd_restored(self):
        old=os.getcwd()
        with tempfile.TemporaryDirectory() as d:
            Path(d,'helper_test_model.py').write_text('size=3')
            runner.run_model('from build123d import *\nfrom helper_test_model import size\nresult=Box(size,2,1)',str(Path(d,'model.py')))
        self.assertEqual(os.getcwd(),old)

    def test_repeated_module_reload(self):
        with tempfile.TemporaryDirectory() as d:
            helper=Path(d,'reload_helper.py')
            for value in (3,4,5):
                helper.write_text(f'size={value}')
                runner.run_model('from build123d import *\nfrom reload_helper import size\nresult=Box(size,2,1)',str(Path(d,'model.py')))
                self.assertAlmostEqual(runner._last_result.volume, value*2)
