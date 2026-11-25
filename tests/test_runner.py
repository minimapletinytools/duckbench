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
    def test_starter_duck_step_round_trip(self):
        import runpy
        from build123d import export_step, import_step

        example = Path(__file__).resolve().parents[1] / 'examples' / 'duck.py'
        duck = runpy.run_path(str(example))['result']
        with tempfile.TemporaryDirectory() as directory:
            step = Path(directory) / 'duck.step'
            export_step(duck, step)
            restored = import_step(step)
        source = {part.label.replace(' ', '_'): part for part in duck.children}
        self.assertEqual(set(source), {part.label for part in restored.children})
        for part in restored.children:
            with self.subTest(part=part.label):
                self.assertTrue(part.is_valid)
                self.assertGreater(part.volume, 0)
                self.assertAlmostEqual(part.volume, source[part.label].volume,
                                       delta=source[part.label].volume * 0.001)

    def test_contract_and_last_good_export(self):
        scene=runner.run_model('from build123d import *\nresult = Box(4, 5, 6)')['scene']
        self.assertTrue(scene['parts'])
        for code,error in [('a = 3',ValueError),('result = 7',TypeError)]:
            with self.assertRaises(error):runner.run_model(code)
        self.assertIn(b'ISO-10303-21',base64.b64decode(runner.export_model('step')))
        self.assertGreater(len(base64.b64decode(runner.export_model('stl'))),84)
    def test_export_uses_displayed_build_after_render_failure(self):
        model = 'from build123d import Box\nresult = Box({}, 2, 3)'
        runner.run_model(model.format(4), build_id=1)
        displayed = runner.export_model('stl', build_id=1)
        for build in (2, 3):
            runner.run_model(model.format(20 + build), build_id=build, displayed_build=1)
            self.assertNotEqual(runner.export_model('stl', build_id=build), displayed)
            self.assertEqual(runner.export_model('stl', build_id=1), displayed)

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

    def test_describe_model_measures_each_labelled_part(self):
        code = ('from build123d import *\n'
                'a = Box(10, 20, 30); a.label = "block"\n'
                'b = Pos(40, 0, 0) * Cylinder(5, 10); b.label = "peg"\n'
                'result = Compound(label="pair", children=[a, b])')
        runner.run_model(code, 'model.py', build_id=91)
        info = runner.dispatch({'method': 'describe', 'params': {'build_id': 91}})
        self.assertEqual(info['units'], 'mm')
        self.assertEqual([part['path'] for part in info['parts']], ['pair/block', 'pair/peg'])
        self.assertEqual(info['parts'][0]['size'], [10.0, 20.0, 30.0])
        self.assertAlmostEqual(info['parts'][0]['volume'], 6000, places=1)
        self.assertEqual(info['overall']['solids'], 2)
        with self.assertRaisesRegex(ValueError, 'Run the model first'):
            runner.describe_model(build_id=12345)

    def test_api_lookup_reads_the_installed_build123d(self):
        box = runner.dispatch({'method': 'api', 'params': {'name': 'Box'}})
        self.assertTrue(box['signature'].startswith('(length: '))
        self.assertIn('Part', box['bases'])
        self.assertIn('fillet', runner.api_lookup(search='^fillet$')['matches'][0])
        self.assertIn('Box', runner.api_lookup()['names'])
        with self.assertRaisesRegex(ValueError, 'Similar names: Box'):
            runner.api_lookup('Boxx')

    def test_source_read_lists_reads_and_searches_build123d_only(self):
        self.assertRegex(runner.api_lookup('Box')['source'], r'^build123d/objects_part\.py:\d+$')
        files = runner.dispatch({'method': 'source', 'params': {}})['files']
        self.assertTrue(any(name.startswith('build123d/topology/one_d.py (') for name in files))
        self.assertFalse(any('__pycache__' in name for name in files))
        by_module = runner.source_read('build123d.objects_part')
        self.assertEqual(by_module['path'], 'build123d/objects_part.py')
        self.assertEqual(runner.source_read('build123d/objects_part.py')['text'], by_module['text'])
        self.assertIn('build123d/topology/composite.py', runner.source_read('build123d.topology')['files'][1])
        found = runner.source_read(search=r'^class Box\b')
        self.assertRegex(found['matches'][0], r'^build123d/objects_part\.py:\d+: class Box')
        self.assertTrue(runner.source_read(search='def', limit=3)['truncated'])
        for outside in ['../os.py', 'build123d/../../os.py', '/etc/hosts']:
            with self.assertRaises(ValueError):
                runner.source_read(outside)
