#!/usr/bin/env python3
"""Generate Relayune's two-sided, print-ready hackathon promo card."""

from __future__ import annotations

import io
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter
from pypdf import PdfReader, PdfWriter
from pypdf.generic import RectangleObject
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / "docs" / "marketing" / "hackathon-card" / "assets"
OUTPUT_DIR = ROOT / "output" / "relayune-hackathon-card"
PDF_DIR = ROOT / "output" / "pdf"
TMP_DIR = ROOT / "tmp" / "pdfs" / "relayune-hackathon-card"

BACKGROUND = ASSET_DIR / "relayune-signal-background.png"
COMMUNITY_QR = ASSET_DIR / "community-page-qr.png"
APP_ICON = ROOT / "desktop" / "src-tauri" / "icons" / "128x128@2x.png"

MM = 72 / 25.4
BLEED_MM = 3
TRIM_WIDTH_MM = 90
TRIM_HEIGHT_MM = 54
PAGE_WIDTH_MM = TRIM_WIDTH_MM + BLEED_MM * 2
PAGE_HEIGHT_MM = TRIM_HEIGHT_MM + BLEED_MM * 2
PAGE_SIZE = (PAGE_WIDTH_MM * MM, PAGE_HEIGHT_MM * MM)

DEEP_NIGHT = HexColor("#0B1220")
MOON_WHITE = HexColor("#F6F8F5")
LUNAR_MINT = HexColor("#69E1D2")
INK = HexColor("#111827")
MUTED = HexColor("#667085")


def mm(value: float) -> float:
    return value * MM


def register_fonts() -> None:
    fonts = {
        "RelayuneCN": ("/System/Library/Fonts/STHeiti Medium.ttc", 0),
        "RelayuneCNLight": ("/System/Library/Fonts/STHeiti Light.ttc", 0),
        "RelayuneSans": ("/System/Library/Fonts/Supplemental/Arial.ttf", 0),
        "RelayuneSansBold": ("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 0),
    }
    for name, (path, subfont_index) in fonts.items():
        pdfmetrics.registerFont(TTFont(name, path, subfontIndex=subfont_index))


def cover_reader(path: Path, target_ratio: float) -> ImageReader:
    with Image.open(path) as source:
        image = source.convert("RGB")
        source_ratio = image.width / image.height
        if source_ratio > target_ratio:
            crop_width = round(image.height * target_ratio)
            left = (image.width - crop_width) // 2
            image = image.crop((left, 0, left + crop_width, image.height))
        else:
            crop_height = round(image.width / target_ratio)
            top = (image.height - crop_height) // 2
            image = image.crop((0, top, image.width, top + crop_height))
        payload = io.BytesIO()
        image.save(payload, format="PNG", optimize=True)
        payload.seek(0)
        reader = ImageReader(payload)
        reader._relayune_payload = payload  # Keep the buffer alive until drawImage.
        return reader


def draw_front(card: canvas.Canvas) -> None:
    width, height = PAGE_SIZE
    card.setFillColor(DEEP_NIGHT)
    card.rect(0, 0, width, height, stroke=0, fill=1)
    card.drawImage(
        cover_reader(BACKGROUND, width / height),
        0,
        0,
        width=width,
        height=height,
        mask="auto",
    )

    # A quiet veil keeps the generated paper texture from competing with the copy.
    card.saveState()
    card.setFillColor(Color(11 / 255, 18 / 255, 32 / 255, alpha=0.2))
    card.rect(0, 0, width, height, stroke=0, fill=1)
    card.restoreState()

    safe_left = mm(7)
    safe_right = width - mm(7)

    icon_size = mm(8.6)
    icon_y = height - mm(7) - icon_size
    card.drawImage(
        str(APP_ICON),
        safe_left,
        icon_y,
        width=icon_size,
        height=icon_size,
        preserveAspectRatio=True,
        mask="auto",
    )
    card.setFillColor(MOON_WHITE)
    card.setFont("RelayuneSansBold", 11.5)
    card.drawString(safe_left + mm(11), height - mm(11.9), "Relayune")

    card.setFillColor(LUNAR_MINT)
    card.setFont("RelayuneCNLight", 5.8)
    kicker = "你的本机 Agent  ·  随时在线"
    card.drawRightString(safe_right, height - mm(11.4), kicker)

    card.setFillColor(MOON_WHITE)
    card.setFont("RelayuneCN", 22.5)
    card.drawString(safe_left, height - mm(26.4), "离开电脑，")
    card.drawString(safe_left, height - mm(36.2), "任务不必停下。")

    card.setFillColor(HexColor("#DDE5E5"))
    card.setFont("RelayuneCNLight", 6.7)
    card.drawString(
        safe_left,
        height - mm(43.0),
        "在手机上查看进度 · 回复问题 · 处理审批",
    )

    card.setFillColor(LUNAR_MINT)
    card.circle(safe_left + mm(0.8), mm(9.25), mm(0.55), stroke=0, fill=1)
    card.circle(safe_left + mm(22.6), mm(9.25), mm(0.55), stroke=0, fill=1)
    card.circle(safe_left + mm(47.4), mm(9.25), mm(0.55), stroke=0, fill=1)
    card.setFillColor(MOON_WHITE)
    card.setFont("RelayuneCNLight", 5.5)
    card.drawString(safe_left + mm(2.2), mm(8.45), "本机运行")
    card.drawString(safe_left + mm(24.0), mm(8.45), "跨设备继续")
    card.drawString(safe_left + mm(48.8), mm(8.45), "端到端加密")

    card.setFillColor(HexColor("#B7C3C3"))
    card.setFont("RelayuneSans", 5.2)
    card.drawRightString(safe_right, mm(8.45), "relayune.giraffetree.cn")


def draw_back(card: canvas.Canvas) -> None:
    width, height = PAGE_SIZE
    card.setFillColor(MOON_WHITE)
    card.rect(0, 0, width, height, stroke=0, fill=1)

    safe_left = mm(7)
    safe_right = width - mm(7)
    qr_size = mm(34)
    qr_y = (height - qr_size) / 2
    card.drawImage(
        str(COMMUNITY_QR),
        safe_left,
        qr_y,
        width=qr_size,
        height=qr_size,
        preserveAspectRatio=True,
        mask="auto",
    )

    copy_left = mm(45.2)
    card.setFillColor(LUNAR_MINT)
    card.roundRect(copy_left, height - mm(13.0), mm(27.0), mm(4.3), mm(2.15), stroke=0, fill=1)
    card.setFillColor(DEEP_NIGHT)
    card.setFont("RelayuneSansBold", 5.0)
    card.drawCentredString(copy_left + mm(13.5), height - mm(11.7), "RELAYUNE COMMUNITY")

    card.setFillColor(INK)
    card.setFont("RelayuneCN", 12.2)
    card.drawString(copy_left, height - mm(23.0), "扫码了解 Relayune")
    card.setFont("RelayuneCN", 9.6)
    card.drawString(copy_left, height - mm(29.3), "加入用户内测群")

    card.setFillColor(MUTED)
    card.setFont("RelayuneCNLight", 6.0)
    card.drawString(copy_left, height - mm(35.5), "Codex · Kimi Code · Claude Code")
    card.drawString(copy_left, height - mm(39.3), "微信打开后，长按页面群码加入")

    card.setFillColor(DEEP_NIGHT)
    card.setFont("RelayuneCN", 7.2)
    card.drawString(copy_left, height - mm(45.7), "让 Agent 跟你走。")

    card.setFillColor(MUTED)
    card.setFont("RelayuneSans", 5.3)
    card.drawString(copy_left, mm(9.8), "relayune.giraffetree.cn/community")

    mark_size = mm(5.4)
    card.drawImage(
        str(APP_ICON),
        safe_right - mark_size,
        height - mm(12.0),
        width=mark_size,
        height=mark_size,
        preserveAspectRatio=True,
        mask="auto",
    )


def add_print_boxes(source_pdf: Path, output_pdf: Path) -> None:
    reader = PdfReader(str(source_pdf))
    writer = PdfWriter()
    bleed = mm(BLEED_MM)
    width, height = PAGE_SIZE
    for page in reader.pages:
        page.mediabox = RectangleObject((0, 0, width, height))
        page.cropbox = RectangleObject((0, 0, width, height))
        page.bleedbox = RectangleObject((0, 0, width, height))
        page.trimbox = RectangleObject((bleed, bleed, width - bleed, height - bleed))
        page.artbox = RectangleObject((bleed, bleed, width - bleed, height - bleed))
        writer.add_page(page)
    writer.add_metadata(
        {
            "/Title": "Relayune Hackathon Promo Card - 90x54 mm",
            "/Author": "Relayune",
            "/Subject": "Two-sided business card with 3 mm bleed",
            "/Keywords": "Relayune, hackathon, promo card, WeChat",
        }
    )
    with output_pdf.open("wb") as stream:
        writer.write(stream)


def render_pages(pdf_path: Path) -> tuple[Path, Path]:
    prefix = TMP_DIR / "card"
    subprocess.run(
        ["pdftoppm", "-png", "-r", "300", str(pdf_path), str(prefix)],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    rendered = sorted(TMP_DIR.glob("card-*.png"))
    if len(rendered) != 2:
        raise RuntimeError(f"Expected 2 rendered pages, found {len(rendered)}")
    front = OUTPUT_DIR / "relayune-hackathon-card-front.png"
    back = OUTPUT_DIR / "relayune-hackathon-card-back.png"
    shutil.copy2(rendered[0], front)
    shutil.copy2(rendered[1], back)
    return front, back


def build_preview(front_path: Path, back_path: Path) -> Path:
    with Image.open(front_path) as front_source, Image.open(back_path) as back_source:
        front = front_source.convert("RGB")
        back = back_source.convert("RGB")

    canvas_width = max(front.width, back.width) + 180
    gap = 120
    canvas_height = front.height + back.height + gap + 220
    preview = Image.new("RGB", (canvas_width, canvas_height), "#ECEEEB")
    shadow_layer = Image.new("RGBA", preview.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow_layer)

    x = (canvas_width - front.width) // 2
    front_y = 80
    back_y = front_y + front.height + gap
    for y in (front_y, back_y):
        shadow_draw.rounded_rectangle(
            (x + 18, y + 22, x + front.width + 18, y + front.height + 22),
            radius=24,
            fill=(8, 18, 32, 64),
        )
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(18))
    preview.paste(shadow_layer, (0, 0), shadow_layer)
    preview.paste(front, (x, front_y))
    preview.paste(back, (x, back_y))

    preview_path = OUTPUT_DIR / "relayune-hackathon-card-preview.png"
    preview.save(preview_path, optimize=True)
    return preview_path


def main() -> None:
    for asset in (BACKGROUND, COMMUNITY_QR, APP_ICON):
        if not asset.exists():
            raise FileNotFoundError(asset)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    for old_page in TMP_DIR.glob("card-*.png"):
        old_page.unlink()

    register_fonts()
    raw_pdf = TMP_DIR / "relayune-hackathon-card-raw.pdf"
    print_pdf = PDF_DIR / "relayune-hackathon-card-90x54mm-bleed.pdf"
    card = canvas.Canvas(str(raw_pdf), pagesize=PAGE_SIZE, pageCompression=1)
    card.setTitle("Relayune Hackathon Promo Card - 90x54 mm")
    draw_front(card)
    card.showPage()
    draw_back(card)
    card.showPage()
    card.save()

    add_print_boxes(raw_pdf, print_pdf)
    front, back = render_pages(print_pdf)
    preview = build_preview(front, back)
    print(print_pdf)
    print(front)
    print(back)
    print(preview)


if __name__ == "__main__":
    main()
