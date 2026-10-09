"""Regenerate the app icon with Pillow: python scripts/make-icons.py."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parent.parent / "resources"
root.mkdir(exist_ok=True)
scale = 4
image = Image.new("RGBA", (512 * scale, 512 * scale), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 512 * scale - 1, 512 * scale - 1), 112 * scale, fill="#141e21")
draw.arc((104 * scale, 108 * scale, 408 * scale, 412 * scale), 180, 360, fill="#b2f1da", width=18 * scale)
draw.line((89 * scale, 266 * scale, 423 * scale, 266 * scale), fill="#b2f1da", width=18 * scale)
draw.line((124 * scale, 307 * scale, 388 * scale, 307 * scale), fill="#719f93", width=8 * scale)
draw.line((174 * scale, 341 * scale, 338 * scale, 341 * scale), fill="#44695f", width=6 * scale)
image = image.resize((512, 512), Image.Resampling.LANCZOS)
image.save(root / "icon.png")
image.save(root / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
