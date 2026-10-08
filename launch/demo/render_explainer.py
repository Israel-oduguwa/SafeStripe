"""Render a plain-language SafeStripe explainer at native 4K resolution.

The failure illustration is conceptual. The final replay result comes from
retained Stripe sandbox evidence. Stock music is licensed separately; raw music
stays in the ignored .media directory and is never published as a standalone file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import tempfile
import wave
from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
DEST = Path(__file__).resolve().parent
EVIDENCE = ROOT / "docs/evidence/stripe-lifecycle-2026-10-07.json"
FPS, SECONDS, SCALE = 30, 30, 2
CREAM, INK, GREEN = "#f6f4ed", "#18362d", "#2b6c52"
MINT, WHITE, MUTED = "#d6efad", "#ffffff", "#64756b"
DARK, PANEL, PALE = "#132e25", "#214238", "#b7d0c0"
PURPLE, LAVENDER, RED = "#6c59ac", "#e9e2fa", "#b24e3a"
FONT_PATHS = {
    "sans": "/System/Library/Fonts/Supplemental/Arial.ttf",
    "bold": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "serif": "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
    "mono": "/System/Library/Fonts/Menlo.ttc",
}
MUSIC_HASH = "a7f05a29d07a84d38072ccd2b35204bca812db86e75b2a837e71cc144d3e739b"
MUSIC_SOURCE = "https://assets.mixkit.co/music/1167/1167.mp3"
MUSIC_LICENSE = "https://mixkit.co/license/modal/musicFree/"
TITLE = "One payment. Repeated updates. One saved result."


def clamp(value):
    return min(1.0, max(0.0, value))


def ease(value):
    return 1 - (1 - clamp(value)) ** 3


def smooth(value):
    value = clamp(value)
    return value * value * (3 - 2 * value)


def spring(value):
    value = max(0, value)
    return 1 - math.exp(-7 * value) * math.cos(10 * value)


@lru_cache(maxsize=100)
def font(size, family="sans"):
    # Glyphs are rasterized at the master resolution, never enlarged from HD.
    return ImageFont.truetype(FONT_PATHS[family], round(size * SCALE))


class Canvas:
    def __init__(self, vertical=False, dark=False, background=None):
        self.vertical, self.dark = vertical, dark
        self.w, self.h = (1080, 1920) if vertical else (1920, 1080)
        self.m = 80 if vertical else 100
        self.bg = background or (DARK if dark else CREAM)
        self.fg, self.sub = (CREAM, PALE) if dark else (INK, MUTED)
        self.image = Image.new("RGB", (self.w * SCALE, self.h * SCALE), self.bg)
        self.draw = ImageDraw.Draw(self.image)

    def rect(
        self, x, y, w, h, fill=WHITE, radius=28, outline=None, stroke=2, shadow=False
    ):
        box = tuple(round(v * SCALE) for v in (x, y, x + w, y + h))
        if shadow:
            shade = tuple(v + (12 * SCALE if i % 2 else 0) for i, v in enumerate(box))
            self.draw.rounded_rectangle(shade, radius=radius * SCALE, fill="#dfe3d7")
        self.draw.rounded_rectangle(
            box,
            radius=round(radius * SCALE),
            fill=fill,
            outline=outline,
            width=max(1, round(stroke * SCALE)),
        )

    def circle(self, x, y, r, fill, outline=None, stroke=2):
        self.draw.ellipse(
            tuple(round(v * SCALE) for v in (x - r, y - r, x + r, y + r)),
            fill=fill,
            outline=outline,
            width=max(1, round(stroke * SCALE)),
        )

    def line(self, points, color=None, width=3):
        self.draw.line(
            [(round(x * SCALE), round(y * SCALE)) for x, y in points],
            fill=color or self.sub,
            width=round(width * SCALE),
            joint="curve",
        )

    def polygon(self, points, fill):
        self.draw.polygon(
            [(round(x * SCALE), round(y * SCALE)) for x, y in points], fill=fill
        )

    def text(
        self,
        x,
        y,
        value,
        size=32,
        color=None,
        family="sans",
        width=None,
        leading=1.16,
        center=False,
    ):
        chosen = font(size, family)
        lines = []
        for explicit in str(value).split("\n"):
            line = ""
            for word in explicit.split():
                candidate = (line + " " + word).strip()
                if (
                    width
                    and line
                    and self.draw.textlength(candidate, font=chosen) / SCALE > width
                ):
                    lines.append(line)
                    line = word
                else:
                    line = candidate
            lines.append(line)
        for i, line in enumerate(lines):
            left = (
                x - self.draw.textlength(line, font=chosen) / (2 * SCALE)
                if center
                else x
            )
            self.draw.text(
                (round(left * SCALE), round((y + i * size * leading) * SCALE)),
                line,
                font=chosen,
                fill=color or self.fg,
            )
        return len(lines) * size * leading

    def check(self, x, y, size=28, color=GREEN, progress=1):
        points = [
            (x - size * 0.42, y),
            (x - size * 0.05, y + size * 0.34),
            (x + size * 0.5, y - size * 0.4),
        ]
        if progress < 0.45:
            q = clamp(progress / 0.45)
            points = [
                points[0],
                (
                    points[0][0] + (points[1][0] - points[0][0]) * q,
                    points[0][1] + (points[1][1] - points[0][1]) * q,
                ),
            ]
        elif progress < 1:
            q = clamp((progress - 0.45) / 0.55)
            points = points[:2] + [
                (
                    points[1][0] + (points[2][0] - points[1][0]) * q,
                    points[1][1] + (points[2][1] - points[1][1]) * q,
                )
            ]
        self.line(points, color, max(3, size / 7))

    def arrow(self, x, y, size=22, color=None):
        self.line([(x - size, y), (x + size, y)], color, 4)
        self.line(
            [
                (x + size * 0.3, y - size * 0.6),
                (x + size, y),
                (x + size * 0.3, y + size * 0.6),
            ],
            color,
            4,
        )

    def chip(self, x, y, label, fill=None, color=None, size=25):
        w = self.draw.textlength(label, font=font(size, "bold")) / SCALE + 40
        self.rect(x, y, w, 48, fill or (PANEL if self.dark else "#e6ede0"), 24)
        self.text(
            x + 20, y + 10, label, size, color or (MINT if self.dark else GREEN), "bold"
        )

    def reveal(self, bounds, age, delay=0, rise=40):
        q = ease((age - delay) / 0.65)
        if q >= 1:
            return
        bounds = tuple(round(v * SCALE) for v in bounds)
        part = self.image.crop(bounds)
        self.draw.rectangle(bounds, fill=self.bg)
        if q > 0:
            self.image.paste(
                part,
                (bounds[0], bounds[1] + round(rise * (1 - q) * SCALE)),
                Image.new("L", part.size, round(q * 255)),
            )

    def brand(self):
        x, y = self.m, 60
        self.rect(x, y, 58, 58, MINT if self.dark else INK, 17)
        self.text(x + 13, y + 1, "s", 47, INK if self.dark else CREAM, "serif")
        self.line([(x + 38, y + 46), (x + 49, y + 14)], GREEN if self.dark else MINT, 3)
        self.text(x + 77, y + 9, "SafeStripe", 38, family="bold")

    def footer(self, t, label="Illustration + retained sandbox evidence"):
        self.line(
            [(self.m, self.h - 87), (self.w - self.m, self.h - 87)],
            PANEL if self.dark else "#dce1d5",
            2,
        )
        self.text(self.m, self.h - 67, label, 22, self.sub)
        self.rect(
            self.m,
            self.h - 9,
            (self.w - self.m * 2) * clamp(t / SECONDS),
            5,
            MINT if self.dark else GREEN,
            0,
        )

    def heading(self, title, detail, age, tag=None):
        y = 180 if self.vertical else 162
        if tag:
            self.chip(self.m, y, tag)
            y += 72
        height = self.text(
            self.m,
            y,
            title,
            80 if self.vertical else 84,
            family="bold",
            width=self.w - self.m * 2,
        )
        self.text(
            self.m,
            y + height + 22,
            detail,
            34 if self.vertical else 32,
            self.sub,
            width=self.w - self.m * 2,
        )
        self.reveal((self.m - 5, 155, self.w - self.m, y + height + 130), age, 0, 24)


def cursor(c, x, y, press=False):
    s = 0.9 if press else 1
    points = [
        (x, y),
        (x + 12 * s, y + 55 * s),
        (x + 24 * s, y + 39 * s),
        (x + 41 * s, y + 45 * s),
        (x + 48 * s, y + 31 * s),
        (x + 31 * s, y + 25 * s),
    ]
    c.polygon([(px + 4, py + 5) for px, py in points], "#bdc8bb")
    c.polygon(points, INK)


def customer(c, x, y):
    c.circle(x, y, 75, LAVENDER)
    c.rect(x - 51, y + 21, 102, 55, GREEN, 34)
    c.rect(x - 15, y + 3, 30, 39, "#e9b88c", 12)
    c.circle(x, y - 15, 39, "#efc6a3")
    c.polygon(
        [
            (x - 39, y - 21),
            (x - 33, y - 50),
            (x + 7, y - 59),
            (x + 39, y - 32),
            (x + 39, y - 8),
            (x + 25, y - 30),
            (x - 19, y - 35),
        ],
        INK,
    )
    for eye in (-13, 13):
        c.circle(x + eye, y - 11, 3, INK)
    c.line([(x - 9, y + 6), (x, y + 11), (x + 9, y + 6)], "#9d6349", 3)
    c.text(x, y + 96, "Customer", 26, MUTED, center=True)


def envelope(c, x, y, w=270, h=120, label="Payment received", fill=WHITE, color=INK):
    c.rect(x, y, w, h, fill, 22)
    c.circle(x + 36, y + 35, 15, GREEN if fill == WHITE else MINT)
    c.check(x + 36, y + 35, 17, WHITE if fill == WHITE else INK)
    c.text(x + 62, y + 18, "Stripe update", 24, color, "bold")
    c.text(x + 22, y + 65, label, 28, color, "bold")


def database(c, x, y, w=380, h=220, verified=False):
    c.rect(
        x,
        y,
        w,
        h,
        PANEL if c.dark else WHITE,
        30,
        outline="#456454" if c.dark else "#dbe1d7",
    )
    c.text(x + 28, y + 22, "Your database", 28, c.sub, "bold")
    c.text(x + 28, y + 77, "Paid · US$5.00", 38, family="bold")
    c.text(x + 28, y + 140, "Original receipt kept", 26, c.sub)
    if verified:
        c.circle(x + w - 48, y + 99, 27, MINT if c.dark else GREEN)
        c.check(x + w - 48, y + 99, 27, INK if c.dark else WHITE)


def scene_payment(vertical, t):
    c = Canvas(vertical)
    c.brand()
    age = t
    if vertical:
        c.heading(
            "Paid once.\nProcessed twice?",
            "Stripe can send the same payment message again.",
            age,
        )
        x, y, w = 150, 740, 780
    else:
        c.text(c.m, 225, "Paid once.", 94, family="bold")
        c.text(c.m, 335, "Processed twice?", 91, GREEN, "serif")
        c.text(
            c.m, 530, "Stripe can send the same payment message again.", 34, width=720
        )
        c.reveal((c.m - 5, 220, 870, 645), age, 0)
        x, y, w = 1080, 215, 640
    c.rect(x, y, w, 480, WHITE, 42, shadow=True)
    c.text(x + 40, y + 34, "Your checkout", 30, MUTED, "bold")
    c.text(x + 40, y + 94, "100 demo credits", 44, family="bold")
    c.text(x + 40, y + 177, "US$5.00", 64, family="bold")
    c.rect(x + 40, y + 293, w - 80, 88, MINT if age >= 1.65 else GREEN, 22)
    c.text(
        x + w / 2,
        y + 312,
        "Payment accepted" if age >= 1.65 else "Pay US$5.00",
        32,
        INK if age >= 1.65 else WHITE,
        "bold",
        center=True,
    )
    if age >= 1.65:
        c.circle(x + 58, y + 428, 17, GREEN)
        c.check(x + 58, y + 428, 20, WHITE, clamp((age - 1.65) / 0.3))
        c.text(x + 90, y + 407, "One successful payment", 28, GREEN)
    if 0.85 < age < 2.6:
        q = ease((age - 0.85) / 0.6)
        cursor(c, x + w - 65 - 90 * q, y + 470 - 123 * q, 1.5 < age < 1.72)
    c.reveal((x - 4, y - 5, x + w + 5, y + 501), age, 0.15)
    hx, hy = (540, 590) if vertical else (950, 700)
    customer(c, hx, hy)
    c.reveal((hx - 78, hy - 80, hx + 78, hy + 136), age, 0.3)
    cy = 1350 if vertical else 825
    c.chip(c.m, cy, "1 customer payment", MINT, GREEN, 28)
    c.footer(t)
    return c.image


def scene_risk(vertical, t):
    c = Canvas(vertical)
    c.brand()
    age = t - 4
    c.heading(
        "One update.\nSent again." if vertical else "One update. Sent again.",
        "Your app might add the same credits twice.",
        age,
        "Potential integration bug",
    )
    if vertical:
        ex, ey = 170, 775
        ax, ay, aw = 170, 1220, 740
    else:
        ex, ey = 160, 520
        ax, ay, aw = 1120, 495, 600
    envelope(
        c, ex, ey, 600 if vertical else 520, 132, "Paid · US$5.00", LAVENDER, PURPLE
    )
    if age > 0.8:
        dy = 160 * (spring((age - 0.8) * 1.8))
        envelope(
            c,
            ex + 38,
            ey + dy,
            600 if vertical else 520,
            132,
            "Same payment, again",
            LAVENDER,
            PURPLE,
        )
    if not vertical:
        c.arrow(880, 670, 54, PURPLE)
    else:
        c.line([(540, 1100), (540, 1170)], PURPLE, 4)
        c.line([(518, 1148), (540, 1170), (562, 1148)], PURPLE, 4)
    c.rect(ax, ay, aw, 380, WHITE, 34, shadow=True)
    c.text(ax + 34, ay + 28, "Your app", 32, family="bold")
    for i in range(2 if age > 2 else 1):
        yy = ay + 102 + i * 108
        c.rect(ax + 30, yy, aw - 60, 82, "#fae9e1", 19)
        c.circle(ax + 61, yy + 42, 20, "#e9c779")
        c.text(ax + 52, yy + 23, "+", 27, INK, "bold")
        c.text(ax + 97, yy + 20, "100 credits added", 30, RED, "bold")
    if age > 2.4:
        c.text(
            ax + 34, ay + 320, "Risk: extra credits for one purchase", 26, RED, "bold"
        )
    c.reveal((ax - 4, ay - 4, ax + aw + 5, ay + 401), age, 0.55)
    c.footer(t, "Illustrative risk · customer paid once")
    return c.image


def scene_guard(vertical, t):
    c = Canvas(vertical, True)
    c.brand()
    age = t - 9
    c.heading(
        "Check it.\nSave it." if vertical else "Check it. Save it.",
        "SafeStripe checks the message really came from Stripe.",
        age,
    )
    if vertical:
        x, y, w = 150, 690, 780
        positions = [(x, y), (x, y + 280), (x, y + 560)]
    else:
        x, y, w = 120, 505, 480
        positions = [(x, y), (x + 610, y), (x + 1220, y)]
    labels = [
        ("Stripe update", "Payment received"),
        ("SafeStripe", "Sender verified"),
        ("Your database", "Update saved"),
    ]
    for i, (xx, yy) in enumerate(positions):
        q = ease((age - i * 0.7) / 0.7)
        c.rect(xx, yy, w, 220, PANEL, 30, outline="#466553")
        c.circle(xx + 48, yy + 47, 23, MINT if q > 0.75 else "#38594a")
        if q > 0.75:
            c.check(xx + 48, yy + 47, 25, INK, clamp((age - i * 0.7 - 0.35) / 0.3))
        c.text(xx + 87, yy + 23, labels[i][0], 32, family="bold")
        c.text(
            xx + 28,
            yy + 123,
            labels[i][1] if q > 0.75 else "Receiving…",
            31,
            MINT if q > 0.75 else PALE,
        )
        c.reveal((xx - 3, yy - 3, xx + w + 4, yy + 224), age, i * 0.25)
        if i < 2:
            if vertical:
                c.line([(xx + w / 2, yy + 235), (xx + w / 2, yy + 264)], PALE, 3)
                c.circle(
                    xx + w / 2,
                    yy + 235 + 29 * clamp((age - i * 0.7 - 0.55) / 0.35),
                    7,
                    MINT,
                )
            else:
                c.line([(xx + w + 12, yy + 110), (xx + w + 113, yy + 110)], PALE, 3)
                c.circle(
                    xx + w + 12 + 101 * clamp((age - i * 0.7 - 0.55) / 0.35),
                    yy + 110,
                    9,
                    MINT,
                )
    if age > 2.8:
        by = 1580 if vertical else 825
        c.rect(c.m, by, c.w - c.m * 2, 93, MINT, 22)
        c.text(
            c.w / 2,
            by + 24,
            "Saved before saying “received”.",
            33,
            INK,
            "bold",
            center=True,
        )
    c.footer(t)
    return c.image


def scene_repeat(vertical, t):
    c = Canvas(vertical, True)
    c.brand()
    age = t - 14
    c.heading(
        "Repeat the message.\nKeep the result.",
        "Repeated updates keep the original saved receipt.",
        age,
    )
    count = min(10, max(0, int((age - 0.6) / 0.35) + 1))
    if vertical:
        ox, oy = 170, 810
        sx, sy = 170, 1110
        rx, ry, rw = 170, 1460, 740
    else:
        ox, oy = 140, 660
        sx, sy = 830, 565
        rx, ry, rw = 1280, 575, 500
    c.circle(ox + 130, oy, 108, "#2c4e42")
    c.text(ox + 130, oy - 63, str(count), 98, MINT, "bold", center=True)
    c.text(ox + 130, oy + 133, "repeat updates", 27, PALE, center=True)
    c.rect(sx, sy, 740 if vertical else 340, 185, PANEL, 30, outline="#456454")
    c.text(sx + 36, sy + 27, "SafeStripe", 40, family="bold")
    c.text(
        sx + 36, sy + 100, "Already recorded" if count else "Ready to check", 28, MINT
    )
    for i in range(10):
        q = clamp((age - 0.6 - i * 0.35) / 0.48)
        if 0 < q < 1:
            if vertical:
                px = ox + 130 + 110 * math.sin(q * math.pi)
                py = oy + 140 + (sy - oy - 140) * ease(q)
            else:
                px = ox + 260 + (sx - ox - 320) * ease(q)
                py = oy - 28 - 65 * math.sin(q * math.pi)
            c.rect(px - 37, py - 29, 74, 58, MINT, 16)
            c.check(px, py, 24, INK)
    if not vertical:
        c.arrow(1210, 660, 32, PALE)
    database(c, rx, ry, rw, 220, True)
    c.footer(t, "Mechanism illustrated · real replay result follows")
    return c.image


def scene_proof(vertical, t):
    c = Canvas(vertical, False, MINT)
    c.brand()
    age = t - 20
    c.heading(
        (
            "Real test.\nSame saved receipt."
            if vertical
            else "Real test. Same saved receipt."
        ),
        "Ten duplicate updates. The original receipt stayed unchanged.",
        age,
    )
    if vertical:
        nx, ny = 540, 770
        rx, ry, rw = 170, 1180, 740
    else:
        nx, ny = 445, 590
        rx, ry, rw = 1030, 525, 690
    c.text(nx, ny, "10", 200 if vertical else 220, GREEN, "bold", center=True)
    c.text(nx, ny + 240, "duplicate updates recorded", 30, GREEN, center=True)
    c.rect(rx, ry, rw, 330, WHITE, 35)
    c.text(rx + 34, ry + 30, "Original Firestore receipt", 30, MUTED, "bold")
    c.text(rx + 38, ry + 86, "1", 132, GREEN, "bold")
    c.text(rx + 150, ry + 138, "retained", 40, family="bold")
    c.check(rx + 47, ry + 260, 26, GREEN, clamp((age - 1.1) / 0.35))
    c.text(rx + 88, ry + 242, "Receipt unchanged", 29, GREEN)
    c.reveal((rx - 3, ry - 3, rx + rw + 4, ry + 334), age, 0.35)
    by = 1630 if vertical else 918
    c.text(
        c.m,
        by,
        "Stripe sandbox · Express + Firestore · 7 October 2026",
        24,
        GREEN,
        width=c.w - c.m * 2,
    )
    c.footer(t, "Measured replay check · safestripe@0.3.0")
    return c.image


def scene_cta(vertical, t):
    c = Canvas(vertical)
    c.brand()
    age = t - 25
    c.heading(
        "Handle the repeats.\nKeep building.",
        "Try SafeStripe with your Stripe test keys.",
        age,
    )
    y = 870 if vertical else 535
    c.rect(c.m, y, c.w - c.m * 2, 137, INK, 27)
    c.text(
        c.m + 38, y + 35, "npm install safestripe", 47 if vertical else 57, MINT, "mono"
    )
    c.reveal((c.m - 3, y - 3, c.w - c.m + 3, y + 141), age, 0.4)
    ly = y + 205
    c.text(c.m, ly, "Open the sandbox", 34, family="bold")
    c.text(c.m, ly + 63, "safestripe-demo.vercel.app", 31, GREEN, "mono")
    c.chip(c.m, ly + 155, "0.3.0 evaluation preview", size=26)
    c.footer(t, "Replay proof linked below · soundtrack: Close Up / Mixkit")
    return c.image


SCENES = [
    (0, scene_payment),
    (4, scene_risk),
    (9, scene_guard),
    (14, scene_repeat),
    (20, scene_proof),
    (25, scene_cta),
]


def frame(vertical, t):
    index = max(i for i, (start, _) in enumerate(SCENES) if start <= t)
    start, draw = SCENES[index]
    current = draw(vertical, t)
    if index and t < start + 0.30:
        previous = SCENES[index - 1][1](vertical, start - 1 / FPS)
        current = Image.blend(previous, current, smooth((t - start) / 0.30))
    if t < 0.2:
        current = Image.blend(
            Image.new("RGB", current.size, CREAM), current, ease(t / 0.2)
        )
    return current


def render_audio(music, output, tmp):
    if hashlib.sha256(music.read_bytes()).hexdigest() != MUSIC_HASH:
        raise ValueError("Music does not match the reviewed source")
    bed = tmp / "music-bed.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-ss",
            "8",
            "-i",
            str(music),
            "-t",
            str(SECONDS),
            "-af",
            "loudnorm=I=-20:TP=-5:LRA=6",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(bed),
        ],
        check=True,
    )
    with wave.open(str(bed), "rb") as source:
        mix = (
            np.frombuffer(source.readframes(source.getnframes()), dtype="<i2")
            .reshape(-1, 2)
            .astype(np.float64)
            / 32768
        )
    rate = 48000
    length = rate * SECONDS
    mix = np.pad(mix, ((0, max(0, length - len(mix))), (0, 0)))[:length]
    time = np.arange(length) / rate
    duck = 1 - 0.25 * smooth_array((time - 4) / 0.35) * (
        1 - smooth_array((time - 8.6) / 0.4)
    )
    fade = np.minimum(1, time / 0.4) * np.minimum(1, (SECONDS - time) / 1.25)
    mix *= (duck * fade)[:, None]
    rng = np.random.default_rng(813)
    cues = [
        (1.48, "click", 0),
        (1.68, "ding", 0),
        (4.35, "pop", -0.25),
        (5.2, "pop", -0.15),
        (6.05, "click", 0.2),
        (9.0, "whoosh", 0),
        (9.75, "pop", -0.25),
        (10.48, "ding", 0),
        (11.2, "ding", 0.25),
        (14.0, "whoosh", 0),
    ]
    cues += [(14.6 + i * 0.35, "pop", -0.35 + i * 0.07) for i in range(10)]
    cues += [
        (18.4, "ding", 0.3),
        (20.0, "whoosh", 0),
        (20.5, "pop", -0.2),
        (21.1, "ding", 0.25),
        (25.0, "whoosh", 0),
        (25.6, "click", 0),
        (26.05, "ding", 0),
    ]
    for moment, kind, pan in cues:
        duration = {"click": 0.055, "pop": 0.16, "ding": 0.55, "whoosh": 0.32}[kind]
        lt = np.arange(round(duration * rate)) / rate
        noise = rng.standard_normal(len(lt))
        if kind == "pop":
            phase = 2 * np.pi * (320 * lt + 80 * (1 - np.exp(-lt * 35)) / 35)
            cue = 0.20 * np.sin(phase) * np.exp(-lt * 27) + 0.022 * noise * np.exp(
                -lt * 75
            )
        elif kind == "click":
            cue = 0.12 * (noise - np.roll(noise, 1)) * np.exp(-lt * 145)
        elif kind == "ding":
            cue = (
                0.12
                * (np.sin(2 * np.pi * 880 * lt) + 0.35 * np.sin(2 * np.pi * 1320 * lt))
                * np.exp(-lt * 8)
            )
        else:
            noise = np.convolve(noise, np.ones(9) / 9, mode="same")
            cue = 0.19 * noise * np.sin(np.pi * lt / duration) ** 2
        cue *= np.minimum(1, lt / 0.003) * np.minimum(1, (duration - lt) / 0.008)
        start = round(moment * rate)
        end = min(start + len(cue), length)
        balance = np.array([math.sqrt((1 - pan) / 2), math.sqrt((1 + pan) / 2)])
        mix[start:end] += cue[: end - start, None] * balance
    raw = tmp / "mix.wav"
    with wave.open(str(raw), "wb") as target:
        target.setnchannels(2)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes((np.clip(mix, -0.95, 0.95) * 32767).astype("<i2").tobytes())
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(raw),
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=6",
            "-ar",
            "48000",
            "-ac",
            "2",
            "-c:a",
            "pcm_s16le",
            str(output),
        ],
        check=True,
    )
    return [{"at": at, "kind": kind, "pan": pan} for at, kind, pan in cues]


def smooth_array(values):
    values = np.clip(values, 0, 1)
    return values * values * (3 - 2 * values)


def render(vertical, sound):
    name = (
        "safestripe-recovery-vertical-4k.mp4"
        if vertical
        else "safestripe-recovery-4k.mp4"
    )
    w, h = (2160, 3840) if vertical else (3840, 2160)
    target = DEST / name
    command = [
        "ffmpeg",
        "-v",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pixel_format",
        "rgb24",
        "-video_size",
        f"{w}x{h}",
        "-framerate",
        str(FPS),
        "-i",
        "pipe:0",
        "-i",
        str(sound),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "17",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "256k",
        "-t",
        str(SECONDS),
        "-movflags",
        "+faststart",
        "-metadata",
        f"title=SafeStripe — {TITLE}",
        "-metadata",
        "comment=Illustrated integration risk and retained Stripe sandbox replay proof. Music: Close Up by Michael Ramir C., Mixkit Stock Music Free License.",
        str(target),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for i in range(FPS * SECONDS):
            process.stdin.write(frame(vertical, i / FPS).tobytes())
            if i % (FPS * 5) == 0:
                print(f"{name}: {i//FPS:02d}/{SECONDS} seconds", flush=True)
    except BaseException:
        process.kill()
        process.wait()
        raise
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("Video rendering failed")
    proxy = DEST / (
        "safestripe-recovery-vertical.mp4" if vertical else "safestripe-recovery.mp4"
    )
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-y",
            "-i",
            str(target),
            "-vf",
            "scale=iw/2:ih/2:flags=lanczos",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            str(proxy),
        ],
        check=True,
    )
    poster = frame(vertical, 2.8)
    poster.thumbnail(
        (1080, 1920) if vertical else (1920, 1080), Image.Resampling.LANCZOS
    )
    poster.save(
        DEST / ("poster-vertical.jpg" if vertical else "poster.jpg"),
        quality=95,
        subsampling=0,
    )
    return [target, proxy]


def inspect(path):
    info = json.loads(
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path),
            ],
            text=True,
        )
    )
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    sound = next(s for s in info["streams"] if s["codec_type"] == "audio")
    assert abs(float(info["format"]["duration"]) - SECONDS) < 0.01
    assert video["nb_frames"] == str(FPS * SECONDS) and video["r_frame_rate"] == "30/1"
    assert (
        video["codec_name"] == "h264"
        and video["pix_fmt"] == "yuv420p"
        and sound["channels"] == 2
    )
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=True
    )
    loud = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(path),
            "-vn",
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=6:print_format=json",
            "-f",
            "null",
            "-",
        ],
        text=True,
        capture_output=True,
        check=True,
    ).stderr
    # FFmpeg can append its output summary after the JSON measurement.
    loud, _ = json.JSONDecoder().raw_decode(loud[loud.rfind("{\n") :])
    assert (
        float(loud["input_tp"]) <= -1.0
    ), "Decoded soundtrack exceeds true peak ceiling"
    return {
        "file": path.name,
        "durationSeconds": float(info["format"]["duration"]),
        "width": video["width"],
        "height": video["height"],
        "frames": int(video["nb_frames"]),
        "fps": FPS,
        "videoCodec": "h264",
        "audioCodec": sound["codec_name"],
        "audioIntegratedLufs": float(loud["input_i"]),
        "audioTruePeakDbtp": float(loud["input_tp"]),
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "fullDecodePassed": True,
    }


def review():
    for vertical in (False, True):
        thumbs = []
        for moment in (2.8, 7.4, 12.5, 18.3, 23.2, 28.4):
            shot = frame(vertical, moment)
            shot.thumbnail(
                (360, 640) if vertical else (640, 360), Image.Resampling.LANCZOS
            )
            thumbs.append(shot)
        w, h = thumbs[0].size
        sheet = Image.new("RGB", (w * 3, (h + 40) * 2), "#e1e7da")
        draw = ImageDraw.Draw(sheet)
        for i, shot in enumerate(thumbs):
            x, y = (i % 3) * w, (i // 3) * (h + 40)
            sheet.paste(shot, (x, y))
            draw.text(
                (x + 12, y + h + 6),
                f"{SCENES[i][0]:02d}s · Scene {i+1}",
                font=font(10),
                fill=INK,
            )
        sheet.save(
            DEST / ("review-vertical.jpg" if vertical else "review-landscape.jpg"),
            quality=94,
        )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-only", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--music", type=Path, default=DEST / ".media/close-up.mp3")
    args = parser.parse_args()
    report = json.loads(EVIDENCE.read_text())
    assert (
        report["passed"]
        and report["cleanupPassed"]
        and report["accountIdentityVerified"]
    )
    replay = report["replayObservation"]
    assert (
        replay["requested"] == 10
        and replay["latest"]["duplicates"] - replay["baseline"]["duplicates"] == 10
    )
    assert "the original receipt and paid time were unchanged" in " ".join(
        report["checks"]
    )
    review()
    if args.review_only:
        print("Native 4K review frames ready.", flush=True)
        return
    with tempfile.TemporaryDirectory(prefix="safestripe-explainer-") as directory:
        tmp = Path(directory)
        soundtrack = tmp / "soundtrack.wav"
        cues = render_audio(args.music, soundtrack, tmp)
        if args.verify_only:
            paths = [
                DEST / name
                for name in (
                    "safestripe-recovery-4k.mp4",
                    "safestripe-recovery.mp4",
                    "safestripe-recovery-vertical-4k.mp4",
                    "safestripe-recovery-vertical.mp4",
                )
            ]
        else:
            paths = []
            for vertical in (False, True):
                paths.extend(render(vertical, soundtrack))
        outputs = [inspect(path) for path in paths]
    manifest = {
        "title": TITLE,
        "kind": "motion explainer with retained sandbox replay proof",
        "testModeOnly": True,
        "illustrativeRiskIsNotAnObservedIncident": True,
        "sourceReport": "docs/evidence/stripe-lifecycle-2026-10-07.json",
        "sourceReportSha256": hashlib.sha256(EVIDENCE.read_bytes()).hexdigest(),
        "testRecordedAt": report["at"],
        "sourceWorkflow": "https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37600727941",
        "packageVersion": report["deployment"]["packageVersion"],
        "stripeSdk": report["sdk"],
        "stripeApiVersion": report["apiVersion"],
        "replayIsSeparateJourney": True,
        "timingIsEdited": True,
        "native4kRendering": True,
        "narration": None,
        "music": {
            "title": "Close Up",
            "artist": "Michael Ramir C.",
            "sourcePage": "https://mixkit.co/free-stock-music/corporate-music/",
            "downloadUrl": MUSIC_SOURCE,
            "sourceSha256": MUSIC_HASH,
            "license": "Mixkit Stock Music Free License",
            "licenseUrl": MUSIC_LICENSE,
            "segmentStartSeconds": 8,
            "standaloneMusicRedistributed": False,
        },
        "soundEffects": "Original synchronized pops, clicks, whooshes and confirmation tones",
        "mixTarget": {"integratedLufs": -16, "truePeakDbtp": -1.5, "stereo": True},
        "cues": cues,
        "outputs": outputs,
    }
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        "Both native 4K masters and HD web exports verified; full decoding and audio peaks passed.",
        flush=True,
    )


if __name__ == "__main__":
    main()
