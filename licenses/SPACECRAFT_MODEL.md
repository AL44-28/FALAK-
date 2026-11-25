# FALAK communications spacecraft model

This is an original procedural visualization asset created for the FALAK project. No third-party spacecraft geometry, agency logos or photographic textures are embedded. It is a credible illustrative engineering model, not a replica or identification of a specific operational satellite.

## Contents

- Octagonal equipment bus with shallow geometric MLI wrinkles.
- Gold foil normal and metallic/roughness maps generated deterministically from seed418.
- Aluminum structural rails, deck plates, screw heads, paired radiator faces and heat-pipe strips.
- Opposed array rotation joints, yoke braces, two hinged solar-array leaves per wing, clipped photovoltaic cells and individual cell interconnect bars.
- Concave parabolic reflector with thickness, rolled rim, three feed-support struts and RF feed.
- Paired optical-sensor baffles/lenses, propulsion-side nozzles and a slender RF whip.

The satellite keeps natural metal/gold/blue-black material colors. Mission identity colors are intentionally absent from its physical surfaces.

## Formats and scale

- `site/assets/satellite.glb`: glTF2.0 binary, 416804bytes, ten physically based material groups and two embedded material maps.
- `site/assets/satellite-mesh.json`: identical triangle geometry with representative material colors for a CPU fallback renderer.
- `site/assets/satellite-preview.svg`: embedded transparent raster thumbnail rendered from that geometry.
- `site/assets/spacecraft-model.json`: measured bounds, triangle counts, checksum and validation status.

Model axes: deployed solar wings along X; reflector boresight along +Z. Bounds are X±4.58, Y±0.961, Z−1.7813 to+1.99 model units. These are visualization dimensions. Enlarging or orienting the model does not change the orbital propagation or radio calculations.

## Rebuilding

From the project root:

```text
python -m pip install numpy Pillow trimesh
python python/tools/build_premium_model.py
```

The generator produces the GLB, CPU mesh, material maps and model metadata. The thumbnail is a static presentation view; it is not telemetry.

## Validation

The exported GLB was reloaded with trimesh. All vertices and indices were finite and valid, its triangle count and bounds matched the source scene, and the material scalar parameters were within the glTF0–1 range. Result: 13476triangles,9190vertices,812construction pieces,10merged material groups. CPU inspection used depth-tested triangle rasterization to verify the deployed panels, curved bus and reflector assembly.

Implementation references:
- Trimesh PBR material API: https://trimesh.org/trimesh.visual.material.html
- Trimesh formats: https://trimesh.org/formats.html
- Khronos glTF2.0 specification: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.pdf

Trimesh is an external build-time dependency with its own MIT license; it is not needed to display the prebuilt website assets.
