# Maps reference

Contracts of the official maps that do not fit their README.

## Streets colour knobs

Streets has more than 190 colour tokens. To recolour it without naming them, set a knob: a name
without a dot that stands for many tokens. `Map`'s `colors` prop and a theme controller's
`setColors` accept knobs beside tokens. Each knob has a reference token, and every other token it
governs moves by as much as the reference moves, so lighter and darker tokens stay lighter and
darker: major roads stay stronger than minor ones, and a park keeps its variants. A knob you do not
set leaves its tokens as the theme designed them, so water stays blue unless you give `water` a colour.
A token named in `colors` wins over the knob that governs it.

| Knob         | Colours                                                                                |
| ------------ | -------------------------------------------------------------------------------------- |
| `water`      | Oceans, lakes, rivers and their depth bands. Water labels take its hue.                |
| `greenspace` | Parks, grass, woods and other vegetation, flat and in 3D. Park labels take its hue.    |
| `land`       | The ground between everything else: the background and built-up land.                  |
| `buildings`  | Building fills and outlines, flat and extruded, and the surfaces of building models.   |
| `roads`      | Roads, their casings and tunnels. The color is for a minor road.                       |
| `labels`     | Place, road and neighborhood label text. The color is for ordinary labels.             |
| `labelHalo`  | The outline that keeps labels and icons readable over the map.                         |
| `accent`     | What an application adds: the route line and glow. Its edge and core keep their shade. |

Give each knob the color you want in the theme on screen, and give a dark theme its own colors.
A knob can only be set on a map that declares it; an unknown name is an error that lists the
knobs the map has. Derived maps inherit the knobs and may add or replace them with `colorKnobs`.
