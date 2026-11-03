from pathlib import Path
from docx import Document

root = Path(__file__).resolve().parents[1]
md = root / "CLAUDE_HANDOFF.md"
docx_path = root / "docs" / "ClearanceGuard_AI_Handoff.docx"
doc = Document(docx_path)
texts = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
print("MD bytes:", md.stat().st_size)
print("DOCX bytes:", docx_path.stat().st_size)
print("DOCX paragraphs:", len(texts))
print("DOCX tables:", len(doc.tables))
print("--- first 8 ---")
for item in texts[:8]:
    print(item[:160])
print("--- headings ---")
wanted = [
    "Immediate continuation prompt",
    "What this product is",
    "Hackathon constraints",
    "Current git state",
    "Architecture",
    "Meta models",
    "Backend capabilities",
    "Backend API",
    "Frontend",
    "File map",
    "How to run",
    "Tests and verified results",
    "Safety and legal limits",
    "Remaining work",
    "3-minute demo script",
    "Environment names only",
]
for item in wanted:
    print(("OK" if item in texts else "MISSING"), item)
joined = "\n".join(texts)
for table in doc.tables:
    for row in table.rows:
        joined += "\n" + " | ".join(cell.text for cell in row.cells)
needles = [
    "MODEL_API_KEY",
    "VITE_CARTO_BASEMAP_KEY",
    "SIMULATION",
    "muse-spark-1.3",
    "COORD-SMOKE-PASS",
    "376bb3e",
]
for needle in needles:
    print(("FOUND" if needle in joined else "MISSING"), needle)
