"""Package the approved raster artwork with a real, antialiased alpha mask."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2]
source = root / 'assets/brand/astrix/astrix-dock-source.png'
art = Image.open(source).convert('RGBA')
assert art.size == (1254, 1254), 'Review mask bounds before using different artwork'

# Stay just inside the tile edge; never retain the painted checkerboard.
# The blue symbol and the white interior remain original source pixels.
scale = 4
mask = Image.new('L', (1254 * scale, 1254 * scale), 0)
ImageDraw.Draw(mask).rounded_rectangle(
    tuple(v * scale for v in (100, 75, 1150, 1130)),
    radius=250 * scale, fill=255,
)
art.putalpha(mask.resize(art.size, Image.Resampling.LANCZOS))
icon = art.resize((1024, 1024), Image.Resampling.LANCZOS)
target = root / '客户端/build/astrix-icon.png'
icon.save(target)
icon.save(root / 'assets/brand/astrix/astrix-dock-transparent.png')
iconset = root / '客户端/build/astrix.iconset'
iconset.mkdir(exist_ok=True)
for size in (16, 32, 128, 256, 512):
    for density in (1, 2):
        suffix = '@2x' if density == 2 else ''
        icon.resize((size * density, size * density), Image.Resampling.LANCZOS).save(
            iconset / f'icon_{size}x{size}{suffix}.png'
        )
alpha = icon.getchannel('A')
assert alpha.getextrema() == (0, 255)
assert all(alpha.getpixel(p) == 0 for p in ((0, 0), (1023, 0), (0, 1023), (1023, 1023)))
assert alpha.getpixel((512, 512)) == 255
print('Verified: RGBA icon, transparent corners, opaque interior; 10 iconset sizes.')
