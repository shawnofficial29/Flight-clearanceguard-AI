"""Generate docs/ClearanceGuard_AI_Handoff.docx from CLAUDE_HANDOFF.md."""

from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn
from docx.oxml import OxmlElement
from docx.shared import Inches, Pt, RGBColor

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "CLAUDE_HANDOFF.md"
OUTPUT = ROOT / "docs" / "ClearanceGuard_AI_Handoff.docx"

NAVY = RGBColor(0x0B, 0x1F, 0x3A)
SLATE = RGBColor(0x1F, 0x2A, 0x37)
MUTED = RGBColor(0x4B, 0x55, 0x63)
CODE_BG = "F4F6F8"
TABLE_HEADER_BG = "0B1F3A"


def set_run_font(run, name="Calibri", size=11, bold=False, italic=False, color=SLATE, mono=False):
    run.font.name = "Consolas" if mono else name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), run.font.name)
    run.font.size = Pt(size)
    run.bold = bold
    run.italic = italic
    run.font.color.rgb = color


def shade_cell(cell, fill: str, color: str = "FFFFFF"):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    shd.set(qn("w:color"), color)
    shd.set(qn("w:val"), "clear")
    tc_pr.append(shd)


def set_cell_borders(cell):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    borders = OxmlElement("w:tcBorders")
    for edge in ("top", "left", "bottom", "right"):
        element = OxmlElement(f"w:{edge}")
        element.set(qn("w:val"), "single")
        element.set(qn("w:sz"), "4")
        element.set(qn("w:space"), "0")
        element.set(qn("w:color"), "D0D7DE")
        borders.append(element)
    tc_pr.append(borders)


def add_bottom_border(paragraph, color="1F4E79"):
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "12")
    bottom.set(qn("w:space"), "4")
    bottom.set(qn("w:color"), color)
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


def shade_paragraph(paragraph, fill: str):
    p_pr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    shd.set(qn("w:val"), "clear")
    p_pr.append(shd)


def add_formatted_runs(paragraph, text: str, *, size=11, color=SLATE, mono=False):
    parts = text.split("`")
    for index, part in enumerate(parts):
        if not part:
            continue
        run = paragraph.add_run(part)
        in_code = index % 2 == 1
        set_run_font(
            run,
            size=size,
            color=NAVY if in_code else color,
            mono=mono or in_code,
            italic=False,
        )


def parse_markdown(markdown: str) -> list[tuple]:
    lines = markdown.replace("\r\n", "\n").split("\n")
    blocks: list[tuple] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        if stripped == "":
            i += 1
            continue

        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            i += 1
            code_lines: list[str] = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1
            blocks.append(("code", lang, "\n".join(code_lines)))
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and set(lines[i + 1].replace("|", "").strip()) <= set("-: "):
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                cells = [cell.strip() for cell in lines[i].strip().strip("|").split("|")]
                rows.append(cells)
                i += 1
            header = rows[0]
            body = rows[2:]
            blocks.append(("table", header, body))
            continue

        if stripped == "---":
            blocks.append(("hr",))
            i += 1
            continue

        if stripped.startswith("# "):
            blocks.append(("h1", stripped[2:].strip()))
            i += 1
            continue
        if stripped.startswith("## "):
            blocks.append(("h2", stripped[3:].strip()))
            i += 1
            continue
        if stripped.startswith("### "):
            blocks.append(("h3", stripped[4:].strip()))
            i += 1
            continue

        if stripped.startswith("- "):
            items: list[str] = []
            while i < len(lines) and lines[i].strip().startswith("- "):
                items.append(lines[i].strip()[2:].strip())
                i += 1
            blocks.append(("ul", items))
            continue

        if stripped[0].isdigit() and ". " in stripped[:4]:
            items = []
            while i < len(lines):
                current = lines[i].strip()
                if current and current[0].isdigit() and ". " in current[:4]:
                    items.append(current.split(". ", 1)[1].strip())
                    i += 1
                    continue
                break
            blocks.append(("ol", items))
            continue

        if stripped.startswith("**") and stripped.endswith("**") is False and ":**" in stripped:
            key, value = stripped.split(":**", 1)
            blocks.append(("kv", key.strip("* ").strip(), value.strip()))
            i += 1
            continue

        paragraph_lines = [stripped]
        i += 1
        while i < len(lines):
            nxt = lines[i]
            nxt_stripped = nxt.strip()
            if (
                nxt_stripped == ""
                or nxt_stripped.startswith("#")
                or nxt_stripped.startswith("```")
                or nxt_stripped.startswith("|")
                or nxt_stripped.startswith("- ")
                or nxt_stripped == "---"
                or (nxt_stripped[:1].isdigit() and ". " in nxt_stripped[:4])
            ):
                break
            paragraph_lines.append(nxt_stripped)
            i += 1
        blocks.append(("p", " ".join(paragraph_lines)))

    return blocks


def build_document(blocks: list[tuple]) -> Document:
    document = Document()
    section = document.sections[0]
    section.top_margin = Inches(0.85)
    section.bottom_margin = Inches(0.85)
    section.left_margin = Inches(1.0)
    section.right_margin = Inches(1.0)
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)

    styles = document.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(11)
    normal.font.color.rgb = SLATE
    normal.paragraph_format.space_after = Pt(8)
    normal.paragraph_format.line_spacing_rule = WD_LINE_SPACING.SINGLE

    for block in blocks:
        kind = block[0]

        if kind == "h1":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_before = Pt(0)
            paragraph.paragraph_format.space_after = Pt(6)
            run = paragraph.add_run(block[1])
            set_run_font(run, size=26, bold=True, color=NAVY)
            add_bottom_border(paragraph)
            continue

        if kind == "h2":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_before = Pt(18)
            paragraph.paragraph_format.space_after = Pt(8)
            run = paragraph.add_run(block[1])
            set_run_font(run, size=16, bold=True, color=NAVY)
            add_bottom_border(paragraph, "C5CDD6")
            continue

        if kind == "h3":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_before = Pt(12)
            paragraph.paragraph_format.space_after = Pt(6)
            run = paragraph.add_run(block[1])
            set_run_font(run, size=13, bold=True, color=NAVY)
            continue

        if kind == "p":
            text = block[1]
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_after = Pt(8)
            if text.startswith("**") and "**" in text[2:]:
                end = text.find("**", 2)
                label = text[2:end]
                remainder = text[end + 2 :].lstrip(" :")
                run = paragraph.add_run(label)
                set_run_font(run, size=11, bold=True, color=NAVY)
                if remainder:
                    colon = paragraph.add_run(": ")
                    set_run_font(colon, size=11, bold=True, color=NAVY)
                    add_formatted_runs(paragraph, remainder)
                continue
            if text.startswith(">"):
                quote = text.lstrip("> ").strip()
                paragraph.paragraph_format.left_indent = Inches(0.25)
                run = paragraph.add_run(quote)
                set_run_font(run, size=12, italic=True, color=NAVY)
                continue
            add_formatted_runs(paragraph, text)
            continue

        if kind == "kv":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_after = Pt(4)
            run = paragraph.add_run(f"{block[1]}: ")
            set_run_font(run, size=11, bold=True, color=NAVY)
            add_formatted_runs(paragraph, block[2])
            continue

        if kind == "ul":
            for item in block[1]:
                paragraph = document.add_paragraph(style="List Bullet")
                paragraph.paragraph_format.space_after = Pt(3)
                add_formatted_runs(paragraph, item)
            continue

        if kind == "ol":
            for item in block[1]:
                paragraph = document.add_paragraph(style="List Number")
                paragraph.paragraph_format.space_after = Pt(3)
                add_formatted_runs(paragraph, item)
            continue

        if kind == "code":
            for line in (block[2] or " ").split("\n"):
                paragraph = document.add_paragraph()
                paragraph.paragraph_format.space_before = Pt(0)
                paragraph.paragraph_format.space_after = Pt(0)
                paragraph.paragraph_format.left_indent = Inches(0.15)
                shade_paragraph(paragraph, CODE_BG)
                run = paragraph.add_run(line if line else " ")
                set_run_font(run, size=9, mono=True, color=NAVY)
            spacer = document.add_paragraph()
            spacer.paragraph_format.space_after = Pt(8)
            continue

        if kind == "table":
            header, body = block[1], block[2]
            table = document.add_table(rows=1 + len(body), cols=len(header))
            table.alignment = WD_TABLE_ALIGNMENT.CENTER
            table.autofit = True
            for col_index, heading in enumerate(header):
                cell = table.rows[0].cells[col_index]
                cell.text = ""
                paragraph = cell.paragraphs[0]
                paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
                run = paragraph.add_run(heading)
                set_run_font(run, size=10, bold=True, color=RGBColor(255, 255, 255))
                shade_cell(cell, TABLE_HEADER_BG)
                set_cell_borders(cell)
            for row_index, row in enumerate(body):
                for col_index, value in enumerate(row):
                    cell = table.rows[row_index + 1].cells[col_index]
                    cell.text = ""
                    paragraph = cell.paragraphs[0]
                    add_formatted_runs(paragraph, value, size=10)
                    if row_index % 2 == 1:
                        shade_cell(cell, "F7F8FA")
                    set_cell_borders(cell)
            spacer = document.add_paragraph()
            spacer.paragraph_format.space_after = Pt(8)
            continue

        if kind == "hr":
            paragraph = document.add_paragraph()
            paragraph.paragraph_format.space_before = Pt(6)
            paragraph.paragraph_format.space_after = Pt(6)
            add_bottom_border(paragraph, "C5CDD6")
            continue

    header = section.header
    header_paragraph = header.paragraphs[0]
    header_paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run = header_paragraph.add_run("ClearanceGuard AI — Claude continuation handoff")
    set_run_font(run, size=9, color=MUTED)

    footer = section.footer
    footer_paragraph = footer.paragraphs[0]
    footer_paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT
    run = footer_paragraph.add_run("Simulation / advisory only. No secrets. Public repo: github.com/shawnofficial29/Flight-clearanceguard-AI")
    set_run_font(run, size=8, color=MUTED)

    return document


def main() -> None:
    markdown = SOURCE.read_text(encoding="utf-8")
    blocks = parse_markdown(markdown)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = build_document(blocks)
    document.save(OUTPUT)
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes, {len(blocks)} blocks)")


if __name__ == "__main__":
    main()
