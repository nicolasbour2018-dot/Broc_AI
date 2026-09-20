from __future__ import annotations

import re
from collections import Counter
from datetime import datetime
from decimal import Decimal
from io import BytesIO
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query, Response
from reportlab.graphics.shapes import Drawing, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import Event, Listing

router = APIRouter(prefix="/api/seller", tags=["seller"])
PARIS = ZoneInfo("Europe/Paris")

INK = colors.HexColor("#20231D")
MUTED = colors.HexColor("#697064")
PAPER = colors.HexColor("#F7F4EC")
LINE = colors.HexColor("#DED9CE")
SELLER = colors.HexColor("#C87045")
ACTIVE = colors.HexColor("#71806A")


def _money(value: Decimal | float | int) -> str:
    return f"{float(value):.2f}".replace(".", ",") + " €"


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9_-]+", "-", value.strip()).strip("-")
    return cleaned or "stand"


def _status_chart(sold: int, active: int) -> Drawing:
    drawing = Drawing(470, 88)
    maximum = max(1, sold, active)
    rows = (("Vendus", sold, SELLER, 52), ("En vente", active, ACTIVE, 16))
    for label, value, color, y in rows:
        drawing.add(String(0, y + 4, label, fontName="Helvetica-Bold", fontSize=9, fillColor=INK))
        width = 260 * value / maximum
        drawing.add(Rect(78, y, 260, 18, rx=7, ry=7, fillColor=colors.HexColor("#EEEAE1"), strokeColor=None))
        if value:
            drawing.add(Rect(78, y, width, 18, rx=7, ry=7, fillColor=color, strokeColor=None))
        drawing.add(String(350, y + 4, str(value), fontName="Helvetica-Bold", fontSize=10, fillColor=INK))
    return drawing


def _category_chart(counts: Counter[str]) -> Drawing:
    rows = counts.most_common(5)
    height = 32 + max(1, len(rows)) * 28
    drawing = Drawing(470, height)
    if not rows:
        drawing.add(String(0, 12, "Aucune vente catégorisée pour le moment.", fontName="Helvetica", fontSize=9, fillColor=MUTED))
        return drawing

    maximum = max(value for _, value in rows)
    for index, (category, value) in enumerate(rows):
        y = height - 28 - index * 28
        label = category if len(category) <= 22 else category[:21] + "…"
        drawing.add(String(0, y + 4, label, fontName="Helvetica", fontSize=8.5, fillColor=INK))
        width = 220 * value / max(1, maximum)
        drawing.add(Rect(145, y, 220, 14, rx=6, ry=6, fillColor=colors.HexColor("#EEEAE1"), strokeColor=None))
        drawing.add(Rect(145, y, width, 14, rx=6, ry=6, fillColor=SELLER, strokeColor=None))
        drawing.add(String(377, y + 3, str(value), fontName="Helvetica-Bold", fontSize=9, fillColor=INK))
    return drawing


def _metric_cell(label: str, value: str, styles: dict[str, ParagraphStyle]) -> list:
    return [
        Paragraph(label, styles["metric_label"]),
        Spacer(1, 1.5 * mm),
        Paragraph(value, styles["metric_value"]),
    ]


def build_seller_report(db: Session, stand: str) -> bytes:
    listings = list(
        db.scalars(
            select(Listing)
            .where(Listing.stand_number == stand)
            .order_by(Listing.created_at.asc())
        ).all()
    )
    sold = [item for item in listings if item.sold_at is not None]
    active = [item for item in listings if item.sold_at is None]
    sold_total = sum((item.price_eur for item in sold), Decimal("0"))
    average_sold = sold_total / len(sold) if sold else Decimal("0")
    sell_through = round((len(sold) / len(listings) * 100), 1) if listings else 0.0

    ids = {item.id for item in listings}
    views: Counter[str] = Counter()
    if ids:
        events = db.scalars(
            select(Event).where(Event.event_name == "listing_viewed")
        ).all()
        for event in events:
            listing_id = (event.properties or {}).get("listing_id")
            if isinstance(listing_id, str) and listing_id in ids:
                views[listing_id] += 1
    total_views = sum(views.values())

    aliases = Counter(item.seller_alias.strip() for item in listings if item.seller_alias and item.seller_alias.strip())
    seller_name = aliases.most_common(1)[0][0] if aliases else None
    sold_categories = Counter((item.category or "Autre") for item in sold)

    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            name="ReportTitle",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            leading=25,
            textColor=INK,
            spaceAfter=3 * mm,
        )
    )
    styles.add(
        ParagraphStyle(
            name="ReportSubtitle",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=9,
            leading=13,
            textColor=MUTED,
        )
    )
    styles.add(
        ParagraphStyle(
            name="SectionTitle",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=INK,
            spaceBefore=4 * mm,
            spaceAfter=2.5 * mm,
        )
    )
    styles.add(
        ParagraphStyle(
            name="MetricLabel",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=7.5,
            leading=9,
            textColor=MUTED,
            alignment=TA_CENTER,
        )
    )
    styles.add(
        ParagraphStyle(
            name="MetricValue",
            parent=styles["BodyText"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=17,
            textColor=INK,
            alignment=TA_CENTER,
        )
    )
    styles.add(
        ParagraphStyle(
            name="Small",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=7.7,
            leading=10.5,
            textColor=MUTED,
        )
    )
    styles.add(
        ParagraphStyle(
            name="TableText",
            parent=styles["BodyText"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=INK,
        )
    )

    style_map = {
        "metric_label": styles["MetricLabel"],
        "metric_value": styles["MetricValue"],
    }

    buffer = BytesIO()
    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=16 * mm,
        leftMargin=16 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        title=f"BrocAI - bilan stand {stand}",
        author="BrocAI by Gaia Vector Studio",
    )

    generated = datetime.now(PARIS)
    story: list = [
        Paragraph("BrocAI · bilan de journée", styles["ReportTitle"]),
        Paragraph(
            f"Stand <b>{stand}</b>"
            + (f" · {seller_name}" if seller_name else "")
            + f" · généré le {generated.strftime('%d/%m/%Y à %H:%M')}",
            styles["ReportSubtitle"],
        ),
        Spacer(1, 5 * mm),
    ]

    metrics = [
        _metric_cell("OBJETS PUBLIÉS", str(len(listings)), style_map),
        _metric_cell("VENDUS", str(len(sold)), style_map),
        _metric_cell("TAUX DE VENTE", f"{sell_through:.1f} %".replace(".", ","), style_map),
        _metric_cell("CA DÉCLARÉ", _money(sold_total), style_map),
        _metric_cell("PRIX MOYEN VENDU", _money(average_sold), style_map),
        _metric_cell("VUES DES ANNONCES", str(total_views), style_map),
    ]
    metric_table = Table([metrics[:3], metrics[3:]], colWidths=[55 * mm] * 3, rowHeights=[24 * mm, 24 * mm])
    metric_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PAPER),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
            ]
        )
    )
    story.extend(
        [
            metric_table,
            Paragraph("Ventes du stand", styles["SectionTitle"]),
            _status_chart(len(sold), len(active)),
            Paragraph("Ventes par catégorie", styles["SectionTitle"]),
            _category_chart(sold_categories),
            Paragraph("Objets vendus", styles["SectionTitle"]),
        ]
    )

    if sold:
        table_data = [
            [
                Paragraph("<b>Objet</b>", styles["TableText"]),
                Paragraph("<b>Catégorie</b>", styles["TableText"]),
                Paragraph("<b>Vues</b>", styles["TableText"]),
                Paragraph("<b>Prix</b>", styles["TableText"]),
            ]
        ]
        for item in sorted(sold, key=lambda row: row.sold_at or row.created_at):
            table_data.append(
                [
                    Paragraph(item.title, styles["TableText"]),
                    Paragraph(item.category or "Autre", styles["TableText"]),
                    Paragraph(str(views[item.id]), styles["TableText"]),
                    Paragraph(_money(item.price_eur), styles["TableText"]),
                ]
            )
        sold_table = Table(table_data, colWidths=[76 * mm, 45 * mm, 18 * mm, 28 * mm], repeatRows=1)
        sold_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), INK),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("BOX", (0, 0), (-1, -1), 0.5, LINE),
                    ("INNERGRID", (0, 0), (-1, -1), 0.35, LINE),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LEFTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 2.5 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2.2 * mm),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 2.2 * mm),
                ]
            )
        )
        story.append(sold_table)
    else:
        story.append(Paragraph("Aucun objet n’est marqué vendu pour le moment.", styles["Small"]))

    story.extend(
        [
            Spacer(1, 5 * mm),
            Paragraph(
                "Le chiffre d’affaires déclaré correspond à la somme des prix actuellement enregistrés "
                "sur les annonces marquées vendues au moment de l’export. Si le prix réel de vente diffère, "
                "modifiez d’abord le prix de l’annonce puis regénérez ce bilan.",
                styles["Small"],
            ),
            Spacer(1, 2 * mm),
            Paragraph("BrocAI · Gaia Vector Studio · Brocante Saint‑Fiacre, Épernon", styles["Small"]),
        ]
    )

    document.build(story)
    return buffer.getvalue()


@router.get("/report")
def seller_report(
    stand_number: str = Query(min_length=1, max_length=40),
    db: Session = Depends(get_db),
) -> Response:
    stand = stand_number.strip()
    pdf = build_seller_report(db, stand)
    db.add(
        Event(
            session_id=f"seller:{stand}"[:64],
            event_name="seller_report_exported",
            properties={"stand": stand, "format": "pdf"},
        )
    )
    db.commit()
    filename = f"brocai-{_safe_filename(stand)}-bilan.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
