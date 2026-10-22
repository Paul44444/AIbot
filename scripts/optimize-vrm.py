"""Shrink a VRM (glTF binary) without touching its rig, expressions or spring bones.

- PNG textures become WebP via EXT_texture_webp (resolution is kept, unless
  --max-size is given: then larger textures, WebP ones too, are downscaled so
  the GPU upload on first render stays short).
- The VRM thumbnail is downscaled; it is never shown on the site.
- Dense morph targets become sparse accessors that only store moved vertices.

All VRM extension JSON stays as it is; only images and accessors are rewritten.

usage: python3 -I scripts/optimize-vrm.py input.vrm output.vrm [--max-size 1024]
"""

import io
import json
import struct
import sys

from PIL import Image

COMPONENT_SIZE = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4}
TYPE_COUNT = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}
THUMBNAIL_SIZE = 256


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, _ = struct.unpack_from("<4sII", data, 0)
    assert magic == b"glTF" and version == 2, "not a glTF 2.0 binary"
    json_length = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20:20 + json_length])
    bin_start = 20 + json_length + 8
    bin_length = struct.unpack_from("<I", data, 20 + json_length)[0]
    return gltf, data[bin_start:bin_start + bin_length]


def write_glb(path, gltf, binary):
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode()
    json_bytes += b" " * (-len(json_bytes) % 4)
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    with open(path, "wb") as file:
        file.write(struct.pack("<4sII", b"glTF", 2, total))
        file.write(struct.pack("<I4s", len(json_bytes), b"JSON") + json_bytes)
        file.write(struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def thumbnail_images(gltf):
    """Image indices used only as the VRM 0.x or 1.0 thumbnail."""
    textures = []
    vrm0 = gltf.get("extensions", {}).get("VRM", {}).get("meta", {})
    if isinstance(vrm0.get("texture"), int) and vrm0["texture"] >= 0:
        texture = gltf["textures"][vrm0["texture"]]
        textures.append(texture.get("source", texture.get("extensions", {}).get("EXT_texture_webp", {}).get("source")))
    vrm1 = gltf.get("extensions", {}).get("VRMC_vrm", {}).get("meta", {})
    images = set(textures)
    if isinstance(vrm1.get("thumbnailImage"), int):
        images.add(vrm1["thumbnailImage"])
    return images


def encode_webp(image_bytes, is_thumbnail, is_normal_map, max_size=None):
    image = Image.open(io.BytesIO(image_bytes))
    image.load()
    if is_thumbnail:
        image.thumbnail((THUMBNAIL_SIZE, THUMBNAIL_SIZE))
    elif max_size:
        image.thumbnail((max_size, max_size), Image.LANCZOS)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "A" in image.mode or "transparency" in image.info else "RGB")
    out = io.BytesIO()
    # Normal maps show compression artefacts as lighting noise, so keep them nearer lossless.
    image.save(out, "WEBP", quality=95 if is_normal_map else 88, alpha_quality=100, method=6)
    return out.getvalue()


def main(source, target, max_size=None):
    gltf, binary = read_glb(source)
    views = gltf["bufferViews"]
    accessors = gltf["accessors"]

    def view_bytes(index):
        view = views[index]
        start = view.get("byteOffset", 0)
        return binary[start:start + view["byteLength"]]

    # New contents for each kept buffer view; dense morph views are dropped.
    contents = {index: view_bytes(index) for index in range(len(views))}
    extra_views = []

    # 1. Textures to WebP.
    thumbnails = thumbnail_images(gltf)
    webp_images = set()
    for index, image in enumerate(gltf.get("images", [])):
        if "bufferView" not in image:
            continue
        original = contents[image["bufferView"]]
        too_large = max_size and max(Image.open(io.BytesIO(original)).size) > max_size
        if image.get("mimeType") != "image/png" and not too_large:
            continue
        name = (image.get("name") or "").lower()
        webp = encode_webp(original, index in thumbnails, name.endswith("_nml") or "normal" in name, max_size)
        if too_large or len(webp) < len(original):
            contents[image["bufferView"]] = webp
            image["mimeType"] = "image/webp"
            webp_images.add(index)

    if webp_images:
        for texture in gltf.get("textures", []):
            if texture.get("source") in webp_images:
                texture.setdefault("extensions", {})["EXT_texture_webp"] = {"source": texture.pop("source")}
        for key in ("extensionsUsed", "extensionsRequired"):
            gltf[key] = sorted(set(gltf.get(key, [])) | {"EXT_texture_webp"})

    # 2. Morph targets to sparse accessors.
    morph_accessors = {
        accessor_index
        for mesh in gltf["meshes"]
        for primitive in mesh["primitives"]
        for target in primitive.get("targets", [])
        for accessor_index in target.values()
    }
    dropped_views = set()
    for accessor_index in sorted(morph_accessors):
        accessor = accessors[accessor_index]
        if "bufferView" not in accessor or "sparse" in accessor:
            continue
        assert accessor["componentType"] == 5126 and accessor["type"] == "VEC3"
        view = views[accessor["bufferView"]]
        stride = view.get("byteStride", 12)
        raw = contents[accessor["bufferView"]]
        offset = accessor.get("byteOffset", 0)
        moved_indices, moved_values = [], []
        for vertex in range(accessor["count"]):
            value = raw[offset + vertex * stride:offset + vertex * stride + 12]
            if value != b"\0" * 12 and struct.unpack("<3f", value) != (0.0, 0.0, 0.0):
                moved_indices.append(vertex)
                moved_values.append(value)

        dropped_views.add(accessor["bufferView"])
        del accessor["bufferView"]
        accessor.pop("byteOffset", None)
        if not moved_indices:
            continue  # No bufferView and no sparse data means all zeros.

        index_type = 5123 if accessor["count"] <= 0xFFFF else 5125
        index_bytes = struct.pack(f"<{len(moved_indices)}{'H' if index_type == 5123 else 'I'}", *moved_indices)
        extra_views.append(index_bytes)
        indices_view = len(views) + len(extra_views) - 1
        extra_views.append(b"".join(moved_values))
        values_view = len(views) + len(extra_views) - 1
        accessor["sparse"] = {
            "count": len(moved_indices),
            "indices": {"bufferView": indices_view, "componentType": index_type},
            "values": {"bufferView": values_view},
        }

    # A view may be shared; only drop it when no accessor or image still uses it.
    still_used = {a["bufferView"] for a in accessors if "bufferView" in a}
    still_used |= {i["bufferView"] for i in gltf.get("images", []) if "bufferView" in i}
    dropped_views -= still_used

    # 3. Repack the binary chunk and renumber buffer views.
    all_contents = [contents[i] for i in range(len(views))] + extra_views
    old_views = views + [{"buffer": 0} for _ in extra_views]
    remap, new_views, packed = {}, [], bytearray()
    for index, (view, data) in enumerate(zip(old_views, all_contents)):
        if index in dropped_views:
            continue
        packed += b"\0" * (-len(packed) % 4)
        new_view = {k: v for k, v in view.items() if k not in ("byteOffset", "byteLength")}
        if index >= len(views) or any(index == img.get("bufferView") for img in gltf.get("images", [])):
            new_view.pop("byteStride", None)
            new_view.pop("target", None)
        new_view.update(buffer=0, byteOffset=len(packed), byteLength=len(data))
        remap[index] = len(new_views)
        new_views.append(new_view)
        packed += data

    for accessor in accessors:
        if "bufferView" in accessor:
            accessor["bufferView"] = remap[accessor["bufferView"]]
        if "sparse" in accessor:
            accessor["sparse"]["indices"]["bufferView"] = remap[accessor["sparse"]["indices"]["bufferView"]]
            accessor["sparse"]["values"]["bufferView"] = remap[accessor["sparse"]["values"]["bufferView"]]
    for image in gltf.get("images", []):
        if "bufferView" in image:
            image["bufferView"] = remap[image["bufferView"]]

    gltf["bufferViews"] = new_views
    gltf["buffers"] = [{"byteLength": len(packed) + (-len(packed) % 4)}]
    write_glb(target, gltf, bytes(packed))
    print(f"{source}: {len(binary) / 1e6:.1f} MB -> {target}: {len(packed) / 1e6:.1f} MB "
          f"({len(webp_images)} textures to WebP, {len(morph_accessors)} morph accessors sparse)")


if __name__ == "__main__":
    args = sys.argv[1:]
    size = int(args[args.index("--max-size") + 1]) if "--max-size" in args else None
    main(args[0], args[1], size)
