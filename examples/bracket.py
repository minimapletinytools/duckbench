from build123d import *

result = Box(40, 30, 8) - Cylinder(6, 12)
result = fillet(result.edges().filter_by(Axis.Z), radius=2)
result.label = "Mounting plate"
