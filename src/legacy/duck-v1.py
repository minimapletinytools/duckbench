"""A tiny sunshine duck, floating on a turquoise puddle. Dimensions in mm."""
from build123d import Color, Compound, Pos, Rot, Sphere, scale

YELLOW = "#FFD43B"
WING = "#F4B82A"
ORANGE = "#FF912E"
BLACK = "#20252B"
WHITE = "#FFFFFF"
WATER = "#81D9DE"


def pebble(name, radii, center, color, tilt=0):
    """Make a soft ellipsoid with a label and color."""
    shape = scale(Sphere(1), by=radii)
    shape = Pos(*center) * Rot(0, tilt, 0) * shape
    shape.label = name
    shape.color = Color(color)
    return shape


parts = [
    pebble("Little pond", (27, 21, 1.5), (0, 0, -1.5), WATER),
    pebble("Round belly", (19, 13, 13), (-2, 0, 12), YELLOW),
    pebble("Tail feather", (9, 6, 4), (-18, 0, 19), YELLOW, 25),
    pebble("Big head", (11, 10, 11), (10, 0, 27), YELLOW),
    pebble("Orange bill", (8, 6, 2.7), (21, 0, 24), ORANGE),
    pebble("Left wing", (11, 3, 6.5), (-3, -11, 14), WING, -12),
    pebble("Right wing", (11, 3, 6.5), (-3, 11, 14), WING, -12),
]

for side in (-1, 1):
    parts += [
        pebble(f"Eye {side}", (1.9, 1.3, 2.1), (15, side * 8.5, 30), BLACK),
        pebble(f"Eye sparkle {side}", (0.65, 0.45, 0.7),
               (15.6, side * 9.5, 30.8), WHITE),
        pebble(f"Cheek {side}", (2.1, 0.65, 1.2),
               (15, side * 8.9, 26.5), "#FFB25F"),
    ]

result = Compound(label="Puddle the duck", children=parts)
