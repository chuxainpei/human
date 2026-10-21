"""Build a 2.5D talking-photo avatar from three generated stills (base / mouth-open / blink).
Aligns each variant to the base (translation search), finds the changed region, and cuts a feathered
patch that the web player overlays on the base with opacity driven by real audio amplitude.
Usage: python3 build_avatar.py <base.png> <open.png> <blink.png> <outdir> <name> [preview.png]
"""
import json, sys
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter

base_p, open_p, blink_p, outdir, name = sys.argv[1:6]
b = Image.open(base_p).convert('RGB'); W, H = b.size
bl = np.asarray(b.convert('L'), dtype=float)


def align(img):
    a = np.asarray(img.convert('L').resize((W, H)), dtype=float)
    cy, cx = H // 3, W // 2; hh, hw = H // 8, W // 10
    ref = bl[cy - hh:cy + hh, cx - hw:cx + hw]; best = (1e18, 0, 0)
    for dx in range(-24, 25, 2):
        for dy in range(-24, 25, 2):
            p = a[cy - hh + dy:cy + hh + dy, cx - hw + dx:cx + hw + dx]
            v = ((p - ref) ** 2).mean()
            if v < best[0]: best = (v, dx, dy)
    out = Image.new('RGB', (W, H)); out.paste(img.convert('RGB').resize((W, H)), (-best[1], -best[2]))
    return out, best


def region(var, y_from, y_to):
    face = (int(W * .35), int(H * y_from), int(W * .65), int(H * y_to))
    d = ImageChops.difference(b.crop(face), var.crop(face)).convert('L').point(lambda v: 255 if v > 38 else 0)
    d = d.filter(ImageFilter.MedianFilter(5)); bb = d.getbbox()
    if not bb: raise SystemExit('no change found')
    return (face[0] + bb[0], face[1] + bb[1], face[0] + bb[2], face[1] + bb[3])


meta = {"image": f"{name}.jpg", "aspect": W / H}
preview = b.copy()
for key, path, yr in (("mouth", open_p, (.36, .56)), ("eyes", blink_p, (.22, .40))):
    var, al = align(Image.open(path))
    x0, y0, x1, y1 = region(var, *yr)
    padx, pady = int((x1 - x0) * .25) + 8, int((y1 - y0) * .35) + 8
    ell = (x0 - padx // 2, y0 - pady // 2, x1 + padx // 2, y1 + pady // 2)
    box = (ell[0] - 14, ell[1] - 14, ell[2] + 14, ell[3] + 14)
    m = Image.new('L', (W, H), 0); ImageDraw.Draw(m).ellipse(ell, fill=255); m = m.filter(ImageFilter.GaussianBlur(9))
    rgba = var.copy(); rgba.putalpha(m); c = rgba.crop(box)
    c.save(f"{outdir}/{name}-{key}.png", optimize=True)
    preview.paste(c, box[:2], c)
    meta[key] = {"src": f"{name}-{key}.png", "left": round(box[0] / W * 100, 3), "top": round(box[1] / H * 100, 3),
                 "width": round((box[2] - box[0]) / W * 100, 3), "height": round((box[3] - box[1]) / H * 100, 3),
                 "alignMse": round(al[0], 1), "shift": [al[1], al[2]]}
b.save(f"{outdir}/{name}.jpg", quality=86, optimize=True)
json.dump(meta, open(f"{outdir}/{name}.json", "w"), indent=1)
print(json.dumps(meta))
if len(sys.argv) > 6: preview.crop((int(W * .3), int(H * .1), int(W * .7), int(H * .6))).save(sys.argv[6])
