"""Puddle the duck. All dimensions are in millimetres."""
from build123d import (
    Axis, BuildLine, BuildSketch, Circle, Color, Compound, Ellipse,
    Line, Plane, Pos, Rot, Sphere, ThreePointArc, extrude, fillet, make_face,
    revolve, scale, sweep,
)

YELLOW = "#FFD43B"
WING = "#F4B82A"
ORANGE = "#FF912E"
WATER = "#81D9DE"

HEAD_RADIUS = 11
BILL_LENGTH = 16
BILL_WIDTH = 12
BILL_THICKNESS = 4
NOSTRIL_RADIUS = 0.8


def painted(shape, name, color):
    shape.label = name
    shape.color = Color(color)
    return shape


def pebble(name, radii, center, color, tilt=0):
    shape = scale(Sphere(1), by=radii)
    return painted(Pos(*center) * Rot(0, tilt, 0) * shape, name, color)


# Extrude an oval waterline downwards so the pond surface stays at z = 0.
pond = extrude(Ellipse(27, 21), amount=-3)
pond = fillet(pond.edges().filter_by(Plane.XY), radius=1.2)

# In this side sketch, x is the radius and y is the height above the neck.
# Revolve a semicircle about its straight edge to form the head.
with BuildSketch(Plane.XZ) as head_profile:
    with BuildLine():
        crown = (0, 2 * HEAD_RADIUS)
        ThreePointArc((0, 0), (HEAD_RADIUS, HEAD_RADIUS), crown)
        Line(crown, (0, 0))
    make_face()
head = Pos(10, 0, 16) * revolve(head_profile.sketch, axis=Axis.Z)

# Round the edges of the bill blank, then cut two shallow nostril pockets.
bill = extrude(Ellipse(BILL_LENGTH / 2, BILL_WIDTH / 2), amount=BILL_THICKNESS)
bill = fillet(bill.edges().filter_by(Plane.XY), radius=BILL_THICKNESS * 0.4)
pocket = extrude(Circle(NOSTRIL_RADIUS), amount=-1.2)
for side in (-1, 1):
    bill = bill - Pos(2.5, side * 2.4, BILL_THICKNESS) * pocket
bill = Pos(21, 0, 24 - BILL_THICKNESS / 2) * bill

# Sweep a small round section along the curved wake behind the tail.
wake_path = ThreePointArc((-20, -10, 0), (-24, 0, 0), (-20, 10, 0))
wake_start = Plane(origin=wake_path.position_at(0), z_dir=wake_path.tangent_at(0))
wake = sweep(wake_start * Circle(0.5), path=wake_path)

parts = [
    painted(pond, "Little pond", WATER),
    painted(wake, "Tail wake", "#B4EFF0"),
    pebble("Round belly", (19, 13, 13), (-2, 0, 12), YELLOW),
    pebble("Tail feather", (9, 6, 4), (-18, 0, 19), YELLOW, 25),
    painted(head, "Big head", YELLOW),
    painted(bill, "Orange bill", ORANGE),
    pebble("Left wing", (11, 3, 6.5), (-3, -11, 14), WING, -12),
    pebble("Right wing", (11, 3, 6.5), (-3, 11, 14), WING, -12),
]

for side in (-1, 1):
    parts += [
        pebble(f"Eye {side}", (1.9, 1.3, 2.1), (15, side * 9.2, 30), "#20252B"),
        pebble(f"Eye sparkle {side}", (0.65, 0.45, 0.7),
               (15.6, side * 10.2, 30.8), "#FFFFFF"),
        pebble(f"Cheek {side}", (2.1, 0.65, 1.2),
               (15, side * 9.8, 26.5), "#FFB25F"),
    ]

result = Compound(label="Puddle the duck", children=parts)
