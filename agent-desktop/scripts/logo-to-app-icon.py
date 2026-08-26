#!/usr/bin/env python3
"""把官方 H logo 做成两套图标。

源图是圆角方烤在画布里、四角纯黑。系统还会再套一层 App 遮罩，
所以桌面包用「铺满方图」：把四角补成和图标底色一样，圆角交给系统切。
网页/预览用「透明圆角方」，打开文件就能看到 App 形状。
"""
from __future__ import annotations

import math
import struct
import sys
import zlib
from pathlib import Path

SIZE = 1024
# iOS / macOS 图标圆角约 22.37%
APP_RX = SIZE * 0.2237
CORNER_LUMA = 12.0


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png(path: Path) -> tuple[int, int, int, list[bytearray]]:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"not png: {path}")
    pos = 8
    chunks: list[tuple[bytes, bytes]] = []
    while pos < len(data):
        ln = struct.unpack(">I", data[pos : pos + 4])[0]
        typ = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + ln]
        pos += 12 + ln
        chunks.append((typ, chunk))
    ihdr = next(c for t, c in chunks if t == b"IHDR")
    w, h, bit, color, _comp, _filt, inter = struct.unpack(">IIBBBBB", ihdr)
    if bit != 8 or color not in (2, 6) or inter != 0:
        raise SystemExit(f"unsupported png {w}x{h} bit={bit} color={color} inter={inter}")
    raw = zlib.decompress(b"".join(c for t, c in chunks if t == b"IDAT"))
    bpp = 4 if color == 6 else 3
    stride = w * bpp
    rows: list[bytearray] = []
    i = 0
    prev = bytearray(stride)
    for _y in range(h):
        ftype = raw[i]
        i += 1
        row = bytearray(raw[i : i + stride])
        i += stride
        if ftype == 1:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + left) & 255
        elif ftype == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 255
        elif ftype == 3:
            for x in range(stride):
                left = row[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + ((left + prev[x]) // 2)) & 255
        elif ftype == 4:
            for x in range(stride):
                a = row[x - bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x - bpp] if x >= bpp else 0
                row[x] = (row[x] + paeth(a, b, c)) & 255
        elif ftype != 0:
            raise SystemExit(f"unsupported filter {ftype}")
        rows.append(row)
        prev = row
    return w, h, bpp, rows


def write_png(path: Path, w: int, h: int, rgba: bytes) -> None:
    def chunk(tag: bytes, payload: bytes) -> bytes:
        crc = zlib.crc32(tag + payload) & 0xFFFFFFFF
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", crc)

    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )
    print("wrote", path, path.stat().st_size)


def luma(r: int, g: int, b: int) -> float:
    return (r + g + b) / 3.0


def sample_fill(w: int, h: int, bpp: int, rows: list[bytearray]) -> tuple[int, int, int]:
    samples: list[tuple[int, int, int]] = []
    points = [
        (w // 2, 8),
        (w // 2, 40),
        (8, h // 2),
        (40, h // 2),
        (w // 2, h - 9),
        (w - 9, h // 2),
    ]
    for x, y in points:
        row = rows[y]
        o = x * bpp
        r, g, b = row[o], row[o + 1], row[o + 2]
        if luma(r, g, b) < 80:
            samples.append((r, g, b))
    if not samples:
        return (0, 0, 0)
    n = len(samples)
    return (
        sum(s[0] for s in samples) // n,
        sum(s[1] for s in samples) // n,
        sum(s[2] for s in samples) // n,
    )


def sdf_rounded_rect(px: float, py: float, size: float, r: float) -> float:
    # Inigo Quilez rounded box：负值在圆角方内，0 在边缘
    x = abs(px - size / 2.0)
    y = abs(py - size / 2.0)
    hx = hy = size / 2.0
    dx = x - hx + r
    dy = y - hy + r
    ox, oy = max(dx, 0.0), max(dy, 0.0)
    inside = min(max(dx, dy), 0.0)
    return inside + math.hypot(ox, oy) - r


def main() -> None:
    src = Path(sys.argv[1])
    out_square = Path(sys.argv[2])
    out_round = Path(sys.argv[3])
    w, h, bpp, rows = read_png(src)
    if w != SIZE or h != SIZE:
        raise SystemExit(f"expected {SIZE}x{SIZE}, got {w}x{h}")
    fill = sample_fill(w, h, bpp, rows)
    print("fill", fill)

    square = bytearray(SIZE * SIZE * 4)
    rounded = bytearray(SIZE * SIZE * 4)
    for y in range(SIZE):
        row = rows[y]
        for x in range(SIZE):
            o = x * bpp
            r, g, b = row[o], row[o + 1], row[o + 2]
            if luma(r, g, b) < CORNER_LUMA:
                r, g, b = fill
            i = (y * SIZE + x) * 4
            square[i : i + 4] = bytes((r, g, b, 255))
            alpha = max(0.0, min(1.0, 0.5 - sdf_rounded_rect(x + 0.5, y + 0.5, SIZE, APP_RX)))
            a = int(round(alpha * 255))
            rounded[i : i + 4] = bytes((r, g, b, a))

    write_png(out_square, SIZE, SIZE, bytes(square))
    write_png(out_round, SIZE, SIZE, bytes(rounded))


if __name__ == "__main__":
    main()
