"""Own-asset stylisation for the 'dithered / pixel' imagery.
ordered(): Bayer 8x8 ordered dithering on a reduced palette, upscaled with nearest-neighbour.
dissolve(): image that breaks into drifting squares towards one side (mosaic dissolve).
"""
import sys, random
import numpy as np
from PIL import Image

B8 = np.array([[0,32,8,40,2,34,10,42],[48,16,56,24,50,18,58,26],[12,44,4,36,14,46,6,38],[60,28,52,20,62,30,54,22],
               [3,35,11,43,1,33,9,41],[51,19,59,27,49,17,57,25],[15,47,7,39,13,45,5,37],[63,31,55,23,61,29,53,21]]) / 64.0 - 0.5

def ordered(src, out, width=320, levels=4, scale=4, tint=None):
    im = Image.open(src).convert('RGB'); h = int(im.height * width / im.width)
    a = np.asarray(im.resize((width, h), Image.LANCZOS)).astype(float) / 255
    th = np.tile(B8, (h // 8 + 1, width // 8 + 1))[:h, :width][..., None]
    q = np.clip(np.round(a * (levels - 1) + th * 1.0) / (levels - 1), 0, 1)
    if tint is not None:  # map luminance onto a 2-colour ramp
        lum = q.mean(axis=2, keepdims=True); c0, c1 = (np.array(t) / 255 for t in tint); q = c0 + (c1 - c0) * lum
    img = Image.fromarray((q * 255).astype('uint8'))
    if scale > 1: img = img.resize((width * scale, h * scale), Image.NEAREST)
    img.quantize(colors=64, dither=Image.Dither.NONE).save(out, optimize=True)  # 网页端用 image-rendering: pixelated 放大

def ramp(src, out, width, colors, contrast=1.0, bias=0.0):
    """Ordered dithering of luminance onto an N-colour ramp (dark→light)."""
    im = Image.open(src).convert('L'); h = int(im.height * width / im.width)
    a = np.asarray(im.resize((width, h), Image.LANCZOS)).astype(float) / 255
    a = np.clip((a - a.mean()) * contrast + a.mean() + bias, 0, 1)
    th = np.tile(B8, (h // 8 + 1, width // 8 + 1))[:h, :width]
    n = len(colors); idx = np.clip(np.floor(a * (n - 1) + 0.5 + th), 0, n - 1).astype(int)
    pal = np.array(colors, dtype='uint8'); Image.fromarray(pal[idx]).save(out, optimize=True)

def dissolve(src, out, size=900, cell=18, seed=3, side='right'):
    random.seed(seed)
    im = Image.open(src).convert('RGB'); s = min(im.size)
    im = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width + s) // 2, (im.height + s) // 2)).resize((size, size), Image.LANCZOS)
    base = Image.new('RGB', (size, size), (247, 244, 239)); n = size // cell
    small = im.resize((n, n), Image.BOX)
    for y in range(n):
        for x in range(n):
            t = x / n if side == 'right' else 1 - x / n
            if t < 0.66 or random.random() > (1.25 - t):
                base.paste(im.crop((x * cell, y * cell, (x + 1) * cell, (y + 1) * cell)), (x * cell, y * cell)); continue
            if random.random() < (t - 0.6) * 1.6: continue  # dropped cell
            c = small.getpixel((x, y)); dx = int((t - 0.6) * random.uniform(0, 8)) * cell
            base.paste(Image.new('RGB', (cell, cell), c), (min(size - cell, x * cell + dx), y * cell))
    base.save(out, quality=88)

if __name__ == '__main__':
    S = 'tools/assets-src/'; O = 'apps/web/public/assets/art/'
    ramp(S + 'sky-src.png', O + 'sky-dither.png', 320, [(107,150,214), (152,190,240), (203,231,255), (232,244,255), (255,255,255)], contrast=1.5)
    ramp(S + 'hall-src.png', O + 'hall-dither.png', 220, [(20,2,6), (110,72,58), (191,138,113), (246,193,168), (247,244,239)], contrast=1.2)
    dissolve(S + 'laoshi-base.png', O + 'laoshi-dissolve.jpg', size=900, cell=18)
    # small dithered icons for result bars (crops of our own teacher photo), 2-tone ink/paper
    im = Image.open(S + 'laoshi-base.png').convert('RGB'); W, H = im.size
    for i, box in enumerate([(0.40, 0.18, 0.62, 0.40), (0.36, 0.10, 0.66, 0.62), (0.30, 0.30, 0.70, 0.95)]):
        c = im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H))); c.save('/tmp/ic.png')
        ordered('/tmp/ic.png', O + f'icon-{i}.png', width=56, levels=2, scale=1, tint=((20, 2, 6), (247, 244, 239)))
    print('ok')
