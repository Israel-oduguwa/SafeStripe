"""Render the SafeStripe sandbox recovery film from the retained test evidence.

Requires Pillow, NumPy and FFmpeg. Uses installed fonts; font files are not
redistributed. The graphics are an editorial reconstruction, not screen footage.
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
FPS = 30
SECONDS = 30
CREAM = "#f5f4ee"
INK = "#19382f"
GREEN = "#28664f"
MINT = "#d9efb8"
MUTED = "#68756c"
LINE = "#dfe5dc"
WHITE = "#ffffff"
RED = "#b5513e"
RED_BG = "#fae9e3"
DARK = "#162e27"
DARK_PANEL = "#203d33"
PALE = "#adc4b5"

FONT_PATHS = {
    "sans": "/System/Library/Fonts/Supplemental/Arial.ttf",
    "bold": "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "serif": "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
    "mono": "/System/Library/Fonts/Menlo.ttc",
}


def clamp(value, low=0.0, high=1.0):
    return min(high, max(low, value))


def ease(value):
    value = clamp(value)
    return 1 - (1 - value) ** 3


def smooth(value):
    value = clamp(value)
    return value * value * (3 - 2 * value)


@lru_cache(maxsize=100)
def font(size, family="sans"):
    return ImageFont.truetype(FONT_PATHS[family], int(size))


class Canvas:
    def __init__(self, vertical=False, dark=False):
        self.vertical = vertical
        self.w, self.h = (1080, 1920) if vertical else (1920, 1080)
        self.m = 72 if vertical else 96
        self.dark = dark
        self.bg = DARK if dark else CREAM
        self.fg = CREAM if dark else INK
        self.sub = PALE if dark else MUTED
        self.image = Image.new("RGB", (self.w, self.h), self.bg)
        self.draw = ImageDraw.Draw(self.image)

    def text(
        self, x, y, value, size=30, color=None, family="sans", width=None, leading=1.2
    ):
        chosen = font(size, family)
        lines = []
        for explicit in str(value).split("\n"):
            if not width:
                lines.append(explicit)
                continue
            row = ""
            for word in explicit.split():
                candidate = (row + " " + word).strip()
                if row and self.draw.textlength(candidate, font=chosen) > width:
                    lines.append(row)
                    row = word
                else:
                    row = candidate
            lines.append(row)
        for i, line in enumerate(lines):
            self.draw.text(
                (int(x), int(y + i * size * leading)),
                line,
                font=chosen,
                fill=color or self.fg,
            )
        return len(lines) * size * leading

    def box(self, x, y, w, h, fill=WHITE, radius=24, outline=LINE, stroke=2):
        self.draw.rounded_rectangle(
            (int(x), int(y), int(x + w), int(y + h)),
            radius=radius,
            fill=fill,
            outline=outline,
            width=stroke,
        )

    def line(self, points, fill=None, width=3):
        self.draw.line(points, fill=fill or LINE, width=width, joint="curve")

    def circle(self, x, y, r, fill, outline=None, stroke=2):
        self.draw.ellipse(
            (x - r, y - r, x + r, y + r), fill=fill, outline=outline, width=stroke
        )

    def check(self, x, y, color=GREEN, size=26, progress=1):
        points = [
            (x - size * 0.42, y),
            (x - size * 0.09, y + size * 0.32),
            (x + size * 0.48, y - size * 0.38),
        ]
        if progress < 0.45:
            q = progress / 0.45
            points = [
                points[0],
                (
                    points[0][0] + (points[1][0] - points[0][0]) * q,
                    points[0][1] + (points[1][1] - points[0][1]) * q,
                ),
            ]
        elif progress < 1:
            q = (progress - 0.45) / 0.55
            points = points[:2] + [
                (
                    points[1][0] + (points[2][0] - points[1][0]) * q,
                    points[1][1] + (points[2][1] - points[1][1]) * q,
                )
            ]
        self.line(points, color, max(3, int(size / 7)))

    def cross(self, x, y, color=RED, size=16):
        self.line([(x - size, y - size), (x + size, y + size)], color, 4)
        self.line([(x - size, y + size), (x + size, y - size)], color, 4)

    def lock(self, x, y, color=GREEN):
        self.draw.arc((x - 12, y - 20, x + 12, y + 8), 180, 360, fill=color, width=4)
        self.box(x - 18, y - 4, 36, 28, color, radius=6, outline=color)

    def chip(self, x, y, value, dark=False, color=None, width=None):
        text_font = font(25, "bold")
        width = width or int(self.draw.textlength(value, font=text_font)) + 42
        self.box(
            x,
            y,
            width,
            48,
            DARK_PANEL if dark else "#e7eee3",
            24,
            outline="#365146" if dark else "#dce5d7",
        )
        self.text(x + 21, y + 10, value, 25, color or (MINT if dark else GREEN), "bold")
        return width

    def enter(self, bounds, age, delay=0, duration=0.65, rise=34):
        """Reveal one group with an optical rise, preserving surrounding layout."""
        q = ease((age - delay) / duration)
        if q >= 1:
            return
        x1, y1, x2, y2 = (int(value) for value in bounds)
        part = self.image.crop((x1, y1, x2, y2))
        self.draw.rectangle((x1, y1, x2, y2), fill=self.bg)
        if q > 0:
            mask = Image.new("L", part.size, int(q * 255))
            self.image.paste(part, (x1, y1 + int(rise * (1 - q))), mask)

    def brand(self):
        x, y = self.m, 62
        self.box(x, y, 58, 58, MINT if self.dark else INK, 17, outline=None)
        self.text(x + 14, y + 3, "s", 47, INK if self.dark else CREAM, "serif")
        self.line([(x + 38, y + 46), (x + 49, y + 14)], GREEN if self.dark else MINT, 3)
        self.text(x + 76, y + 8, "SafeStripe", 38, self.fg, "bold")
        if not self.vertical:
            self.text(
                self.w - self.m - 330,
                y + 18,
                "Stripe sandbox test replay",
                24,
                self.sub,
            )

    def footer(self, t, extra=""):
        self.line(
            [(self.m, self.h - 96), (self.w - self.m, self.h - 96)],
            "#365046" if self.dark else LINE,
            2,
        )
        label = "Real sandbox evidence · motion reconstruction"
        self.text(self.m, self.h - 70, label, 23 if self.vertical else 24, self.sub)
        if self.vertical:
            self.text(
                self.m, self.h - 38, extra or "Test run: 7 October 2026", 21, self.sub
            )
        else:
            self.text(
                self.w - self.m - 384,
                self.h - 70,
                extra or "Test run: 7 October 2026",
                24,
                self.sub,
            )
        self.draw.rectangle(
            (
                self.m,
                self.h - 8,
                self.m + (self.w - 2 * self.m) * clamp(t / SECONDS),
                self.h,
            ),
            fill=MINT if self.dark else GREEN,
        )


def stage_header(c, title, subtitle, small=None, age=2):
    y = 218 if c.vertical else 210
    size = 90 if c.vertical else 86
    if small:
        c.chip(c.m, 151, small, c.dark)
        y += 10
    height = c.text(
        c.m, y, title, size, family="bold", width=c.w - 2 * c.m, leading=1.08
    )
    sub_height = c.text(
        c.m,
        y + height + 24,
        subtitle,
        31 if c.vertical else 32,
        c.sub,
        width=c.w - 2 * c.m,
        leading=1.4,
    )
    c.enter(
        (c.m - 2, y - 2, c.w - c.m + 2, y + height + sub_height + 44),
        age,
        duration=0.72,
        rise=25,
    )


def checkout(c, x, y, w, h, mode="neutral", t=0):
    if mode == "declined" and t < 0.45:
        x += math.sin(t * 75) * 8 * (1 - t / 0.45)
    c.box(x, y, w, h, WHITE, radius=30)
    c.text(x + 36, y + 28, "Sandbox checkout", 27, MUTED)
    c.text(x + 36, y + 76, "Test purchase", 38, INK, "bold")
    c.text(x + w - 242, y + 65, "US$5.00", 48, INK, "bold")
    c.line([(x + 36, y + 144), (x + w - 36, y + 144)])
    c.text(x + 36, y + 173, "Card", 25, MUTED)
    c.box(
        x + 36,
        y + 217,
        w - 72,
        80,
        "#fafbf8",
        radius=13,
        outline=RED if mode == "declined" else LINE,
    )
    last = (
        "9995"
        if mode == "declined"
        else "4242" if mode == "paid" or mode == "retry" and t >= 0.65 else "••••"
    )
    c.text(x + 58, y + 239, "••••  ••••  ••••  " + last, 30, INK, "mono")
    c.box(
        x + 36, y + 324, w - 72, 76, MINT if mode == "paid" else GREEN, 15, outline=None
    )
    action = (
        "Payment accepted"
        if mode == "paid"
        else "Retry with working test card" if mode == "retry" else "Pay US$5.00"
    )
    c.text(x + 64, y + 344, action, 29, INK if mode == "paid" else WHITE, "bold")
    if mode == "declined":
        c.circle(x + 53, y + 444, 15, RED_BG)
        c.cross(x + 53, y + 444, size=6)
        c.text(
            x + 80,
            y + 422,
            "Card declined. Insufficient funds.",
            26,
            RED,
            width=w - 115,
        )
    elif mode == "paid":
        c.check(x + 53, y + 446, size=22, progress=ease(t / 0.45))
        c.text(x + 80, y + 426, "Stripe accepted the retry.", 26, GREEN)
    else:
        c.lock(x + 58, y + 449)
        c.text(x + 91, y + 433, "Checkout Session retained", 26, GREEN)


def ledger(c, x, y, w, h, phase, t):
    c.box(x, y, w, h, "#eef1e9", radius=30, outline=LINE)
    c.text(x + 36, y + 30, "SafeStripe · saved state", 27, MUTED)
    c.text(x + 36, y + 88, "The same checkout.", 43, INK, "bold")
    c.lock(x + 55, y + 181)
    c.text(x + 92, y + 164, "Session identity unchanged", 29, GREEN)
    c.line([(x + 36, y + 225), (x + w - 36, y + 225)])
    rows = [
        ("Order state", "Unpaid" if phase == "declined" else "Awaiting signed receipt"),
        ("Paid receipt", "None yet"),
    ]
    for i, (key, value) in enumerate(rows):
        yy = y + 245 + i * (100 if h >= 520 else 80)
        c.text(x + 36, yy, key, 26, MUTED)
        c.text(
            x + 36,
            yy + 34,
            value,
            32,
            RED if phase == "declined" and i == 0 else INK,
            "bold",
        )
    c.text(
        x + 36,
        y + h - 53,
        "A decline never marks this order paid.",
        25,
        MUTED,
        width=w - 72,
    )


def scene_intro(vertical, t):
    c = Canvas(vertical)
    c.brand()
    if vertical:
        c.chip(c.m, 171, "A real Stripe sandbox journey")
        c.text(c.m, 294, "A failed\npayment.", 126, family="bold", leading=1.05)
        c.text(c.m, 580, "A clean recovery.", 92, GREEN, "serif", width=c.w - 2 * c.m)
        c.text(
            c.m, 833, "Keep the checkout.\nVerify the outcome.", 39, MUTED, leading=1.45
        )
        checkout(
            c,
            c.m,
            1080,
            c.w - 2 * c.m,
            532,
            "declined" if t > 1.3 else "neutral",
            max(0, t - 1.3),
        )
        c.enter((c.m - 3, 291, c.w - c.m + 3, 1030), t, duration=0.8, rise=30)
        c.enter(
            (c.m - 3, 1077, c.w - c.m + 3, 1616), t, delay=0.4, duration=0.9, rise=60
        )
    else:
        c.chip(c.m, 216, "A real Stripe sandbox journey")
        c.text(c.m, 335, "A failed payment.", 110, family="bold")
        c.text(c.m, 477, "A clean recovery.", 106, GREEN, "serif")
        c.text(c.m, 684, "Keep the checkout. Verify the outcome.", 38, MUTED)
        checkout(
            c,
            1160,
            271,
            664,
            536,
            "declined" if t > 1.3 else "neutral",
            max(0, t - 1.3),
        )
        c.enter((c.m - 3, 332, 1100, 764), t, duration=0.8, rise=30)
        c.enter((1157, 268, 1828, 811), t, delay=0.4, duration=0.9, rise=60)
    c.footer(t)
    return c.image


def scene_decline(vertical, t):
    c = Canvas(vertical)
    c.brand()
    stage_header(
        c,
        "The first card\nis declined." if vertical else "The first card is declined.",
        "Stripe rejects the payment. The order stays unpaid.",
        age=t - 4,
    )
    y = 622 if vertical else 429
    w = c.w - 2 * c.m if vertical else 820
    checkout(c, c.m, y, w, 535, "declined", t - 4.0)
    ledger(
        c,
        c.m if vertical else 980,
        1223 if vertical else y,
        w if vertical else 844,
        476 if vertical else 535,
        "declined",
        t,
    )
    c.enter((c.m - 12, y - 3, c.m + w + 12, y + 540), t - 4, delay=0.18, duration=0.72)
    lx, ly, lw, lh = (c.m, 1223, w, 476) if vertical else (980, y, 844, 535)
    c.enter(
        (lx - 3, ly - 3, lx + lw + 3, ly + lh + 4), t - 4, delay=0.42, duration=0.83
    )
    c.footer(t)
    return c.image


def scene_retry(vertical, t):
    c = Canvas(vertical)
    c.brand()
    stage_header(
        c,
        "Retry the\nsame checkout." if vertical else "Retry the same checkout.",
        "The customer uses a working test card. No new Session.",
        age=t - 10,
    )
    y = 622 if vertical else 429
    w = c.w - 2 * c.m if vertical else 820
    mode = "paid" if t >= 13.9 else "retry"
    checkout(c, c.m, y, w, 535, mode, t - 13.9 if mode == "paid" else t - 10)
    ledger(
        c,
        c.m if vertical else 980,
        1223 if vertical else y,
        w if vertical else 844,
        476 if vertical else 535,
        "retry",
        t,
    )
    c.enter((c.m - 3, y - 3, c.m + w + 3, y + 540), t - 10, delay=0.17, duration=0.68)
    lx, ly, lw, lh = (c.m, 1223, w, 476) if vertical else (980, y, 844, 535)
    c.enter(
        (lx - 3, ly - 3, lx + lw + 3, ly + lh + 4), t - 10, delay=0.35, duration=0.72
    )
    # A traveling signal keeps the identity card in place while the retry completes.
    if 11.1 < t < 13.9:
        q = ease((t - 11.1) / 2.8)
        xx = c.m + 40 + (w - 80) * q
        yy = y + 510
        c.circle(xx, yy, 7, GREEN)
    c.footer(t)
    return c.image


def scene_receipt(vertical, t):
    c = Canvas(vertical, dark=True)
    c.brand()
    stage_header(
        c,
        "Signed. Saved.\nVerified." if vertical else "Signed. Saved. Verified.",
        "A signed webhook completes the saved payment record.",
        age=t - 16,
    )
    labels = [
        ("Stripe", "Payment accepted"),
        ("Webhook", "Signature verified"),
        ("SafeStripe", "Durable worker"),
        ("Firestore", "Receipt saved"),
    ]
    if vertical:
        boxes = [(c.m, 620 + i * 189, c.w - 2 * c.m, 135) for i in range(4)]
    else:
        boxes = [(c.m + i * 444, 487, 396, 220) for i in range(4)]
    for i, (x, y, w, h) in enumerate(boxes):
        arrived = t >= 16.7 + i * 0.73
        c.box(x, y, w, h, DARK_PANEL, 23, "#456052" if arrived else "#2f493d")
        c.circle(
            x + 43, y + 44 if vertical else y + 48, 16, MINT if arrived else "#365146"
        )
        if arrived:
            c.check(
                x + 43,
                y + 44 if vertical else y + 48,
                INK,
                18,
                ease((t - 16.7 - i * 0.73) / 0.35),
            )
        c.text(
            x + 80,
            y + 23 if vertical else y + 27,
            labels[i][0],
            34 if vertical else 32,
            CREAM,
            "bold",
        )
        c.text(x + 36, y + 76 if vertical else y + 123, labels[i][1], 27, PALE)
        c.enter(
            (x - 2, y - 2, x + w + 2, y + h + 3),
            t - 16,
            delay=0.35 + i * 0.12,
            duration=0.72,
            rise=28,
        )
        if i < 3:
            x2, y2, _, _ = boxes[i + 1]
            start = (x + w / 2, y + h + 8) if vertical else (x + w + 5, y + h / 2)
            end = (x2 + w / 2, y2 - 8) if vertical else (x2 - 5, y2 + h / 2)
            c.line([start, end], "#5c7968", 3)
            progress = (t - (16.7 + i * 0.73)) / 0.73
            if 0 <= progress <= 1:
                q = smooth(progress)
                c.circle(
                    start[0] + (end[0] - start[0]) * q,
                    start[1] + (end[1] - start[1]) * q,
                    10,
                    MINT,
                )
    paid = t >= 19.5
    yy = 1490 if vertical else 781
    c.box(
        c.m,
        yy,
        c.w - 2 * c.m,
        225 if vertical else 173,
        MINT if paid else DARK_PANEL,
        26,
        None,
    )
    cc = INK if paid else PALE
    c.text(
        c.m + 38,
        yy + 27,
        "Authenticated Firestore receipt" if paid else "Waiting for the saved receipt",
        27,
        cc,
    )
    c.text(
        c.m + 38,
        yy + 76,
        "US$5.00 · Paid" if paid else "US$5.00 · Pending",
        63 if vertical else 62,
        cc,
        "bold",
    )
    if paid:
        c.circle(c.w - c.m - 70, yy + 107, 36, INK)
        c.check(c.w - c.m - 70, yy + 107, MINT, 40, ease((t - 19.5) / 0.6))
    c.enter(
        (c.m - 3, yy - 3, c.w - c.m + 3, yy + (225 if vertical else 173) + 4),
        t - 16,
        delay=0.85,
        duration=0.8,
        rise=24,
    )
    c.footer(t)
    return c.image


def scene_replays(vertical, t):
    c = Canvas(vertical, dark=True)
    c.brand()
    stage_header(
        c,
        "Ten repeat\ndeliveries." if vertical else "Ten repeat deliveries.",
        "The original receipt and paid time stay unchanged.",
        "Separate replay check",
        age=t - 22,
    )
    count = min(10, max(0, math.floor((t - 23.02) / 0.17) + 1)) if t >= 23.02 else 0
    x, y = (c.m, 621) if vertical else (c.m, 490)
    c.text(x, y, str(count).zfill(2), 170, MINT, "bold")
    c.text(x, y + 190, "duplicate deliveries recorded", 28, PALE)
    if vertical:
        rx, ry, rw, rh = c.m, 1157, c.w - 2 * c.m, 472
    else:
        rx, ry, rw, rh = 1080, 468, 744, 430
    c.box(rx, ry, rw, rh, DARK_PANEL, 30, "#456052")
    c.text(rx + 40, ry + 30, "Original Firestore receipt", 29, PALE)
    c.text(rx + 40, ry + 91, "1", 148, MINT, "bold")
    c.text(rx + 157, ry + 172, "retained", 40, CREAM, "bold")
    c.check(rx + 65, ry + 304, MINT, 25)
    c.text(rx + 95, ry + 284, "Receipt unchanged", 28, CREAM)
    c.check(rx + 65, ry + 366, MINT, 25)
    c.text(rx + 95, ry + 346, "Original paid time preserved", 28, CREAM)
    c.enter(
        (rx - 3, ry - 3, rx + rw + 3, ry + rh + 4),
        t - 22,
        delay=0.2,
        duration=0.75,
        rise=24,
    )
    # Each chip travels once, then collapses at the durable boundary.
    for i in range(10):
        progress = (t - (22.15 + i * 0.17)) / 0.87
        if not 0 <= progress <= 1:
            continue
        q = smooth(progress)
        if vertical:
            sx, sy = c.m + 45 + (i % 4) * 232, 966
            ex, ey = c.m + rw / 2, ry - 22
        else:
            sx, sy = c.m + 290, 537 + (i % 4) * 96
            ex, ey = rx - 28, ry + rh / 2
        xx, yy = sx + (ex - sx) * q, sy + (ey - sy) * q
        size = 56 * (1 - 0.35 * q)
        c.box(xx - size / 2, yy - size / 2, size, size, MINT, 11, None)
        c.line([(xx - 10, yy - 5), (xx + 10, yy - 5)], GREEN, 3)
        c.line([(xx - 10, yy + 5), (xx + 4, yy + 5)], GREEN, 3)
    c.footer(t)
    return c.image


def scene_end(vertical, t):
    c = Canvas(vertical)
    c.brand()
    if vertical:
        c.text(c.m, 294, "Follow the\nfailure.", 124, family="bold", leading=1.08)
        c.text(c.m, 611, "Trust the\nsaved state.", 102, GREEN, "serif", leading=1.13)
        yy = 1033
        c.text(c.m, 920, "Try it with your own test keys.", 35, MUTED)
        c.box(c.m, yy, c.w - 2 * c.m, 142, INK, 25, None)
        c.text(c.m + 32, yy + 49, "npm install safestripe", 39, MINT, "mono")
        c.text(c.m, 1296, "Open the sandbox", 43, INK, "bold")
        c.text(c.m, 1378, "safestripe-demo.vercel.app", 31, GREEN, "mono")
        c.chip(c.m, 1535, "0.3.0 evaluation preview")
        c.enter((c.m - 3, 291, c.w - c.m + 3, 873), t - 26, duration=0.8, rise=32)
        c.enter(
            (c.m - 3, 917, c.w - c.m + 3, 1590),
            t - 26,
            delay=0.27,
            duration=0.8,
            rise=28,
        )
    else:
        c.text(c.m, 263, "Follow the failure.", 114, family="bold")
        c.text(c.m, 409, "Trust the saved state.", 110, GREEN, "serif")
        c.text(c.m, 604, "Try it with your own test keys.", 37, MUTED)
        c.box(c.m, 720, 1030, 125, INK, 24, None)
        c.text(c.m + 38, 757, "npm install safestripe", 46, MINT, "mono")
        c.text(1190, 719, "Open the sandbox", 34, INK, "bold")
        c.text(1190, 783, "safestripe-demo.vercel.app", 27, GREEN, "mono")
        c.chip(c.m, 893, "0.3.0 evaluation preview")
        c.enter((c.m - 3, 260, c.w - c.m + 3, 675), t - 26, duration=0.8, rise=32)
        c.enter(
            (c.m - 3, 717, c.w - c.m + 3, 948),
            t - 26,
            delay=0.27,
            duration=0.8,
            rise=28,
        )
    c.footer(t, "Stripe · Express · Firestore")
    return c.image


SCENES = [
    (0, scene_intro),
    (4, scene_decline),
    (10, scene_retry),
    (16, scene_receipt),
    (22, scene_replays),
    (26, scene_end),
]


def frame(vertical, t):
    index = max(i for i, (start, _) in enumerate(SCENES) if start <= t)
    start, draw = SCENES[index]
    current = draw(vertical, t)
    if index and t < start + 0.42:
        previous = SCENES[index - 1][1](vertical, start - 1 / FPS)
        q = smooth((t - start) / 0.42)
        # Small optical rise alongside the dissolve gives continuity without a hard cut.
        shifted = Image.new("RGB", current.size, DARK if index in (3, 4) else CREAM)
        shifted.paste(current, (0, int(22 * (1 - q))))
        current = Image.blend(previous, shifted, q)
    # Only the opening has a fade; the final CTA holds through the last frame.
    if t < 0.35:
        current = Image.blend(
            Image.new("RGB", current.size, CREAM), current, ease(t / 0.35)
        )
    return current


def audio(path):
    rate = 48000
    time = np.arange(SECONDS * rate, dtype=np.float64) / rate
    mix = np.zeros_like(time)
    # Original, quiet harmonic bed. No sampled music or synthetic narration.
    for frequency, weight in [
        (130.8128, 1),
        (196.0, 0.42),
        (261.6256, 0.32),
        (329.6276, 0.24),
    ]:
        mix += (
            0.014
            * weight
            * np.sin(2 * np.pi * frequency * time)
            * (0.72 + 0.28 * np.sin(2 * np.pi * 0.095 * time))
        )
    for moment, frequency in [
        (1.3, 164.8),
        (4.1, 164.8),
        (10.2, 261.6),
        (13.9, 392),
        (16.8, 440),
        (17.5, 493.9),
        (18.2, 523.3),
        (19.5, 659.25),
        (22.1, 329.6),
        (24.2, 523.3),
        (26.1, 392),
    ]:
        local = time - moment
        mask = (local >= 0) & (local < 0.65)
        lt = local[mask]
        envelope = np.minimum(1, lt / 0.01) * np.exp(-lt * 9)
        mix[mask] += (
            0.05
            * envelope
            * (
                np.sin(2 * np.pi * frequency * lt)
                + 0.25 * np.sin(2 * np.pi * frequency * 2 * lt)
            )
        )
    envelope = np.minimum(1, time / 1.5) * np.minimum(1, (SECONDS - time) / 1.8)
    mix *= envelope
    # Same program, small stereo spread, no audible clicks at the endpoints.
    stereo = np.column_stack((mix, 0.97 * mix))
    pcm = (np.clip(stereo, -0.95, 0.95) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(rate)
        output.writeframes(pcm.tobytes())


def validate_evidence():
    report = json.loads(EVIDENCE.read_text())
    assert (
        report["passed"]
        and report["cleanupPassed"]
        and report["accountIdentityVerified"]
    )
    assert (
        "A real card decline left the order unpaid; retrying the same Session produced its signed receipt"
        in report["checks"]
    )
    replay = report["replayObservation"]
    assert (
        replay["requested"] == 10
        and replay["latest"]["duplicates"] - replay["baseline"]["duplicates"] == 10
    )
    assert "the original receipt and paid time were unchanged" in " ".join(
        report["checks"]
    )
    return report


def render(vertical, audio_path):
    name = "safestripe-recovery-vertical.mp4" if vertical else "safestripe-recovery.mp4"
    w, h = (1080, 1920) if vertical else (1920, 1080)
    target = DEST / name
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
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
        str(audio_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "19",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-t",
        str(SECONDS),
        "-movflags",
        "+faststart",
        "-metadata",
        "title=SafeStripe — A failed payment. A clean recovery.",
        "-metadata",
        "comment=Editorial motion reconstruction of retained Stripe sandbox evidence. Card retry and replay are separate checks.",
        str(target),
    ]
    process = subprocess.Popen(command, stdin=subprocess.PIPE)
    try:
        for i in range(FPS * SECONDS):
            image = frame(vertical, i / FPS)
            process.stdin.write(image.tobytes())
            if i % (FPS * 5) == 0:
                print(f"{name}: {i//FPS:02d}/{SECONDS} seconds", flush=True)
    except BaseException:
        process.kill()
        process.wait()
        raise
    finally:
        process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("FFmpeg could not finish the film")
    poster = frame(vertical, 2.6)
    poster.save(
        DEST / ("poster-vertical.jpg" if vertical else "poster.jpg"),
        quality=94,
        subsampling=0,
    )
    return target


def review_frames():
    for vertical in (False, True):
        thumbs = []
        for t in (2.6, 6.5, 14.7, 20.5, 25.1, 28.4):
            image = frame(vertical, t)
            image.thumbnail(
                (360, 640) if vertical else (640, 360), Image.Resampling.LANCZOS
            )
            thumbs.append(image)
        tw, th = thumbs[0].size
        sheet = Image.new("RGB", (tw * 3, (th + 42) * 2), "#e4e7df")
        draw = ImageDraw.Draw(sheet)
        for i, image in enumerate(thumbs):
            x, y = (i % 3) * tw, (i // 3) * (th + 42)
            sheet.paste(image, (x, y))
            draw.text((x + 12, y + th + 10), f"Scene {i+1}", font=font(20), fill=INK)
        sheet.save(
            DEST / ("review-vertical.jpg" if vertical else "review-landscape.jpg"),
            quality=92,
        )


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
    video = next(
        stream for stream in info["streams"] if stream["codec_type"] == "video"
    )
    sound = next(
        stream for stream in info["streams"] if stream["codec_type"] == "audio"
    )
    assert abs(float(info["format"]["duration"]) - SECONDS) < 0.01
    assert video["nb_frames"] == str(FPS * SECONDS)
    assert video["codec_name"] == "h264" and video["pix_fmt"] == "yuv420p"
    assert video["r_frame_rate"] == "30/1" and sound["channels"] == 2
    subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "null", "-"], check=True
    )
    return {
        "file": path.name,
        "durationSeconds": float(info["format"]["duration"]),
        "width": video["width"],
        "height": video["height"],
        "frames": int(video["nb_frames"]),
        "fps": 30,
        "videoCodec": "h264",
        "audioCodec": sound["codec_name"],
        "bytes": path.stat().st_size,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "fullDecodePassed": True,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--review-only", action="store_true")
    parser.add_argument(
        "--format", choices=("both", "landscape", "vertical"), default="both"
    )
    args = parser.parse_args()
    report = validate_evidence()
    review_frames()
    if args.review_only:
        print("Six review frames per format rendered.")
        return
    formats = (False, True) if args.format == "both" else (args.format == "vertical",)
    with tempfile.TemporaryDirectory(prefix="safestripe-film-") as tmp:
        audio_path = Path(tmp) / "sound.wav"
        audio(audio_path)
        outputs = [inspect(render(vertical, audio_path)) for vertical in formats]
    manifest = {
        "title": "A failed payment. A clean recovery.",
        "kind": "editorial motion reconstruction",
        "testModeOnly": True,
        "sourceReport": "docs/evidence/stripe-lifecycle-2026-10-07.json",
        "sourceReportSha256": hashlib.sha256(EVIDENCE.read_bytes()).hexdigest(),
        "testRecordedAt": report["at"],
        "sourceWorkflow": "https://github.com/Israel-oduguwa/SafeStripe/actions/runs/37600727941",
        "packageVersion": report["deployment"]["packageVersion"],
        "stripeSdk": report["sdk"],
        "stripeApiVersion": report["apiVersion"],
        "replayIsSeparateJourney": True,
        "timingIsEdited": True,
        "soundtrack": "Original synthesized tones; no sampled music or narration",
        "outputs": outputs,
    }
    (DEST / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(
        "Finished. Duration, frame count, codecs and complete decoding verified.",
        flush=True,
    )


if __name__ == "__main__":
    main()
