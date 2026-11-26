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

    def test_picked_features_are_measured_and_selected(self):
        code = '''from build123d import *
with BuildPart() as p:
    Box(30, 20, 10)
    fillet(p.edges().filter_by(Axis.Z), 2)
    with Locations((5, 0, 5)):
        Hole(3)
result = p.part
'''
        out = runner.run_model(code, 'picks.py', build_id=41)
        leaf = out['scene']['parts'][0]
        self.assertEqual(leaf['holes'], [{'a': [5.0, 0.0, 5.0], 'b': [5.0, 0.0, -5.0], 'd': 6.0}])
        shape = runner._preview_leaves[41][leaf['id']]
        # The scene numbers features as build123d does, so an index means the same face either side.
        from viewer_import import feature_map
        self.assertTrue(all(a.wrapped.IsSame(b.wrapped) for a, b in zip(feature_map(shape, 'face'), shape.faces())))
        self.assertEqual(len(feature_map(shape, 'edge')), len(leaf['shape']['segments_per_edge']))
        faces = feature_map(shape, 'face')
        top = max(range(len(faces)), key=lambda i: faces[i].center().Z)
        info = runner.dispatch({'method': 'feature', 'params': {'build_id': 41, 'part': leaf['id'], 'kind': 'face', 'indices': [top]}})
        self.assertEqual(info['selector'], 'result.faces().sort_by(Axis.Z)[-1]')
        self.assertEqual(info['features'][0]['normal'], [0.0, 0.0, 1.0])
        edges = feature_map(shape, 'edge')
        vertical = [i for i, e in enumerate(edges) if e.geom_type.name == 'LINE' and abs((e.position_at(1) - e.position_at(0)).normalized().Z) > 0.99]
        self.assertEqual(runner.feature_info(41, leaf['id'], 'edge', vertical)['selector'], 'result.edges().filter_by(Axis.Z)')
        hole = next(i for i, f in enumerate(faces) if f.geom_type.name == 'CYLINDER' and f.radius > 2.5)
        hole_info = runner.feature_info(41, leaf['id'], 'face', [hole])
        self.assertEqual(hole_info['features'][0]['diameter'], 6.0)
        self.assertTrue(hole_info['robust'])
        self.assertEqual(runner.feature_info(41, leaf['id'], 'face', [top, hole])['between']['distance'], 0.0)
        with self.assertRaisesRegex(ValueError, 'no longer on screen'):
            runner.feature_info(40, leaf['id'], 'face', [0])
        with self.assertRaisesRegex(ValueError, 'not among them'):
            runner.feature_info(41, leaf['id'], 'face', [999])

    def test_fit_and_printability_checks(self):
        code = '''from build123d import *
base = Box(40, 40, 4, align=(Align.CENTER, Align.CENTER, Align.MIN)); base.label = "Base"
post = Pos(0, 0, 3) * Cylinder(3, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)); post.label = "Post"
cap = Pos(23.5, 0, 0) * Box(5, 10, 2, align=(Align.CENTER, Align.CENTER, Align.MIN)); cap.label = "Cap"
shelf = Pos(-45, 0, 0) * (Box(20, 20, 20, align=(Align.CENTER, Align.CENTER, Align.MIN)) - Pos(0, 3, 2) * Box(20, 20, 14, align=(Align.CENTER, Align.CENTER, Align.MIN)))
shelf.label = "Shelf"
fin = Pos(0, 40, 0) * Box(0.8, 20, 10, align=(Align.CENTER, Align.CENTER, Align.MIN)); fin.label = "Fin"
result = Compound(children=[base, post, cap, shelf, fin])
'''
        runner.run_model(code, 'checks.py', build_id=51)
        fit = runner.dispatch({'method': 'fit', 'params': {'build_id': 51, 'min_clearance': 2.0}})
        self.assertEqual([o['parts'] for o in fit['overlaps']], [['Base', 'Post']])
        self.assertAlmostEqual(fit['overlaps'][0]['volume'], 28.2743, places=3)
        self.assertEqual([(c['parts'], c['distance']) for c in fit['too_close']], [(['Base', 'Cap'], 1.0)])
        self.assertFalse(fit['ok'])
        report = {p['part']: p for p in runner.dispatch({'method': 'printability', 'params': {'build_id': 51}})['parts']}
        self.assertEqual(report['Fin']['thinnest_wall']['thickness'], 0.8)
        self.assertTrue(report['Fin']['thin_walls'])
        self.assertEqual(report['Base']['thin_walls'], [])
        self.assertEqual(report['Base']['overhangs'], [])  # its underside rests on the build plate
        roof = report['Shelf']['overhangs'][0]
        self.assertEqual((roof['area'], roof['max_angle']), (340.0, 90.0))
        only = runner.check_printability(51, part='Fin', min_wall=0.5)
        self.assertEqual([p['part'] for p in only['parts']], ['Fin'])
        self.assertTrue(only['ok'])
        with self.assertRaisesRegex(ValueError, 'No solid part'):
            runner.check_printability(51, part='Nothing')
