from __future__ import annotations

from io import BytesIO
import unittest

from fastapi.testclient import TestClient
from reportlab.lib.pagesizes import letter
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

from app.main import app

try:
    from PIL import Image
except ImportError:  # pragma: no cover - pdfplumber normally installs Pillow.
    Image = None


def make_pdf(lines: list[str]) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    _, height = letter
    y = height - 72
    pdf.setFont("Helvetica", 11)

    for line in lines:
        if line == "":
            y -= 20
        else:
            pdf.drawString(72, y, line)
            y -= 14

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def make_pdf_with_drawer(drawer) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    drawer(pdf)
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


def draw_segments(pdf: canvas.Canvas, x: float, y: float, segments: list[tuple[str, str, int]]) -> None:
    cursor = x
    for text, font, size in segments:
        pdf.setFont(font, size)
        pdf.drawString(cursor, y, text)
        cursor += stringWidth(text, font, size)


def draw_simple_table(pdf: canvas.Canvas, x: float, y: float) -> None:
    col_widths = [110, 110]
    row_height = 24
    rows = [["Measure", "Value"], ["Words", "120"], ["Paragraphs", "4"]]
    total_width = sum(col_widths)
    total_height = row_height * len(rows)

    for row_index in range(len(rows) + 1):
        line_y = y - row_index * row_height
        pdf.line(x, line_y, x + total_width, line_y)

    cursor_x = x
    for width in col_widths:
        pdf.line(cursor_x, y, cursor_x, y - total_height)
        cursor_x += width
    pdf.line(x + total_width, y, x + total_width, y - total_height)

    pdf.setFont("Helvetica", 10)
    for row_index, row in enumerate(rows):
        for column_index, value in enumerate(row):
            text_x = x + sum(col_widths[:column_index]) + 6
            text_y = y - row_index * row_height - 16
            pdf.drawString(text_x, text_y, value)


def draw_sample_image(pdf: canvas.Canvas, x: float, y: float) -> None:
    if Image is None:
        return

    image_buffer = BytesIO()
    image = Image.new("RGB", (80, 50), color=(218, 229, 236))
    image.save(image_buffer, format="PNG")
    image_buffer.seek(0)
    pdf.drawImage(ImageReader(image_buffer), x, y, width=120, height=75)


class PdfImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def post_pdf(self, content: bytes, filename: str = "sample.pdf"):
        return self.client.post(
            "/api/import/pdf",
            files={"file": (filename, content, "application/pdf")},
        )

    def test_a_imports_single_column_academic_draft_with_formatting(self):
        def draw(pdf: canvas.Canvas) -> None:
            _, height = letter
            pdf.setFont("Helvetica-Bold", 18)
            pdf.drawString(72, height - 72, "Supporting Reflective Writing")
            pdf.setFont("Helvetica-Bold", 14)
            pdf.drawString(72, height - 128, "Introduction")
            draw_segments(
                pdf,
                72,
                height - 154,
                [
                    ("This paragraph contains ", "Helvetica", 11),
                    ("bold", "Helvetica-Bold", 11),
                    (" and ", "Helvetica", 11),
                    ("italic", "Helvetica-Oblique", 11),
                    (" wording for import.", "Helvetica", 11),
                ],
            )
            pdf.setFont("Helvetica", 11)
            pdf.drawString(72, height - 190, "A second paragraph remains separated by vertical spacing.")

        response = self.post_pdf(make_pdf_with_drawer(draw), "draft.pdf")

        self.assertEqual(response.status_code, 200)
        blocks = response.json()["blocks"]
        self.assertEqual(blocks[0]["kind"], "heading")
        self.assertEqual(blocks[0]["text"], "Supporting Reflective Writing")
        self.assertTrue(any(block["kind"] == "heading" and block["text"] == "Introduction" for block in blocks))
        paragraphs = [block for block in blocks if block["kind"] == "paragraph"]
        self.assertGreaterEqual(len(paragraphs), 2)
        formatted = next(block for block in paragraphs if "bold" in block["text"])
        self.assertTrue(any(span.get("bold") for span in formatted["spans"]))
        self.assertTrue(any(span.get("italic") for span in formatted["spans"]))

    def test_reconstructs_wrapped_lines_as_one_paragraph(self):
        pdf_bytes = make_pdf(
            [
                "This paragraph is intentionally wrapped across multiple PDF lines",
                "so that the importer can join the lines into one editable paragraph",
                "instead of treating every visual line as a separate paragraph.",
            ]
        )

        response = self.post_pdf(pdf_bytes)

        self.assertEqual(response.status_code, 200)
        blocks = response.json()["blocks"]
        self.assertEqual(len(blocks), 1)
        self.assertEqual(blocks[0]["kind"], "paragraph")
        self.assertIn("multiple PDF lines so that the importer", blocks[0]["text"])

    def test_preserves_word_spacing_and_handles_line_end_hyphenation(self):
        pdf_bytes = make_pdf(
            [
                "This PDF keeps word spacing clear across visual line breaks,",
                "and preserves punctuation around imported text.",
                "Determin-",
                "istic processing joins a visually broken word.",
                "Well-",
                "known concepts keep legitimate hyphenated forms.",
            ]
        )

        response = self.post_pdf(pdf_bytes)

        self.assertEqual(response.status_code, 200)
        text = " ".join(block["text"] for block in response.json()["blocks"])
        self.assertIn("spacing clear across", text)
        self.assertNotIn("clearacross", text)
        self.assertIn("Deterministic processing", text)
        self.assertIn("Well-known concepts", text)

    def test_b_distinguishes_structured_single_column_non_prose_blocks(self):
        def draw(pdf: canvas.Canvas) -> None:
            _, height = letter
            pdf.setFont("Helvetica-Bold", 16)
            pdf.drawString(72, height - 72, "Results")
            pdf.setFont("Helvetica", 11)
            pdf.drawString(72, height - 110, "This structured document discusses visual patterns in prose.")
            draw_sample_image(pdf, 72, height - 220)
            pdf.setFont("Helvetica", 10)
            pdf.drawString(72, height - 235, "(a)")
            pdf.drawString(72, height - 252, "Figure 1: Overview of the prototype workspace.")
            draw_simple_table(pdf, 72, height - 310)
            pdf.drawString(72, height - 400, "Table 1: Descriptive structure summary.")

        response = self.post_pdf(make_pdf_with_drawer(draw), "structured.pdf")

        self.assertEqual(response.status_code, 200)
        blocks = response.json()["blocks"]
        kinds = [block["kind"] for block in blocks]
        self.assertIn("paragraph", kinds)
        self.assertIn("caption", kinds)
        self.assertIn("table", kinds)
        self.assertIn("figure", kinds)
        self.assertTrue(any(block.get("rows") for block in blocks if block["kind"] == "table"))

    def test_c_best_effort_publication_layout_merges_title_and_demotes_metadata(self):
        def draw(pdf: canvas.Canvas) -> None:
            _, height = letter
            pdf.setFont("Helvetica-Bold", 18)
            pdf.drawString(50, height - 54, "Supporting Sensemaking of Large Language Model Outputs at")
            pdf.drawString(50, height - 78, "Scale")
            pdf.setFont("Helvetica", 11)
            pdf.drawString(50, height - 108, "Alex Meyer, Samira Khan")
            pdf.drawString(50, height - 124, "Department of Human-Computer Interaction, Example University, Germany")
            pdf.drawString(50, height - 140, "doi:10.0000/example")

            left_x = 50
            right_x = 322
            y = height - 184
            pdf.setFont("Helvetica", 10)
            left_lines = [
                "Left column first idea starts here.",
                "Left column second idea follows.",
                "Left column third idea closes.",
            ]
            right_lines = [
                "Right column first idea starts later.",
                "Right column second idea follows.",
                "Right column third idea closes.",
            ]
            for offset, line in enumerate(left_lines):
                pdf.drawString(left_x, y - offset * 16, line)
            for offset, line in enumerate(right_lines):
                pdf.drawString(right_x, y - offset * 16, line)
            pdf.drawString(right_x, y - 66, "Figure 2: Publication-style figure caption.")

        response = self.post_pdf(make_pdf_with_drawer(draw), "publication.pdf")

        self.assertEqual(response.status_code, 200)
        blocks = response.json()["blocks"]
        self.assertEqual(blocks[0]["kind"], "heading")
        self.assertEqual(
            blocks[0]["text"],
            "Supporting Sensemaking of Large Language Model Outputs at Scale",
        )
        metadata_text = " ".join(block["text"] for block in blocks if block["kind"] == "metadata")
        self.assertIn("Alex Meyer", metadata_text)
        self.assertIn("Example University", metadata_text)
        self.assertFalse(any(block["kind"] == "heading" and "Alex Meyer" in block["text"] for block in blocks))
        paragraph_text = " ".join(block["text"] for block in blocks if block["kind"] == "paragraph")
        self.assertLess(
            paragraph_text.index("Left column first"),
            paragraph_text.index("Right column first"),
        )
        self.assertIn("Figure 2: Publication-style figure caption.", [block["text"] for block in blocks])

    def test_rejects_invalid_non_pdf_file(self):
        response = self.client.post(
            "/api/import/pdf",
            files={"file": ("not-a-pdf.pdf", b"not a pdf", "application/pdf")},
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("valid PDF", response.json()["detail"])

    def test_rejects_wrong_file_extension(self):
        response = self.client.post(
            "/api/import/pdf",
            files={"file": ("notes.txt", b"not a pdf", "text/plain")},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "Upload a valid .pdf file.")

    def test_rejects_pdf_without_usable_text(self):
        response = self.post_pdf(make_pdf([]), filename="blank.pdf")

        self.assertEqual(response.status_code, 422)
        self.assertIn("No usable text", response.json()["detail"])


if __name__ == "__main__":
    unittest.main()
