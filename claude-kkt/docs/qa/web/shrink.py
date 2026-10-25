import os, sys
from PIL import Image
d = sys.argv[1]
for f in sorted(os.listdir(d)):
    if not f.endswith('.png'): continue
    p = os.path.join(d, f)
    size = os.path.getsize(p)
    if size <= 300 * 1024: continue
    im = Image.open(p).convert('RGB')
    for colors in (256, 128, 64):
        q = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
        q.save(p, optimize=True)
        if os.path.getsize(p) <= 300 * 1024: break
    print(f, size // 1024, '->', os.path.getsize(p) // 1024, 'KB')
