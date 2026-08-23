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


def draw_wrapped_lines(
    pdf: canvas.Canvas,
    x: float,
    y: float,
    width: float,
    text: str,
    font: str = "Helvetica",
    size: int = 9,
    leading: int = 11,
) -> float:
    words = text.split()
    line = ""
    pdf.setFont(font, size)

    for word in words:
        candidate = f"{line} {word}".strip()
        if stringWidth(candidate, font, size) <= width:
            line = candidate
        else:
            pdf.drawString(x, y, line)
            y -= leading
            line = word

    if line:
        pdf.drawString(x, y, line)
        y -= leading

    return y


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

    def test_c_layout_aware_publication_regression_preserves_logical_order(self):
        def draw(pdf: canvas.Canvas) -> None:
            _, height = letter
            pdf.setFont("Helvetica", 6)
            pdf.drawString(62, height - 18, "Permission to make digital or hard copies of all or part of this work")
            pdf.drawString(62, 20, "tionalLicense.")

            pdf.setFont("Helvetica-Bold", 18)
            pdf.drawString(50, height - 54, "Supporting Sensemaking of Large Language Model Outputs at")
            pdf.drawString(50, height - 78, "Scale")
            pdf.setFont("Helvetica", 10)
            pdf.drawCentredString(306, height - 108, "Mohammed Hamid")
            pdf.drawCentredString(306, height - 123, "LMU Munich")
            pdf.drawCentredString(306, height - 138, "Munich, Germany")
            pdf.drawCentredString(306, height - 153, "m.hamid@campus.lmu.de")

            left_x = 50
            right_x = 322
            column_width = 220

            pdf.setFont("Helvetica-Bold", 9)
            pdf.drawString(left_x, height - 185, "ABSTRACT")
            y = draw_wrapped_lines(
                pdf,
                left_x,
                height - 202,
                column_width,
                "Large language model outputs require interfaces that support inspection, comparison, and reflection. "
                "This abstract describes a layout-aware prototype for academic writing support and includes citations [3, 9, 12]. "
                "Its usage is generally associated with careful inspection.",
            )
            pdf.setFont("Helvetica-Bold", 9)
            pdf.drawString(left_x, y - 7, "CCS CONCEPTS")
            y = draw_wrapped_lines(
                pdf,
                left_x,
                y - 24,
                column_width,
                "Human-centered computing -> Visualization; Human-centered computing -> Interactive systems and tools.",
                size=8,
            )
            pdf.setFont("Helvetica-Bold", 9)
            pdf.drawString(left_x, y - 7, "KEYWORDS")
            y = draw_wrapped_lines(
                pdf,
                left_x,
                y - 24,
                column_width,
                "writing analytics, sensemaking, academic reflection",
                size=8,
            )
            pdf.setFont("Helvetica-Bold", 10)
            pdf.drawString(left_x, y - 10, "1 INTRODUCTION")
            y = draw_wrapped_lines(
                pdf,
                left_x,
                y - 28,
                column_width,
                "Students often need to understand how their academic texts are structured before they can reflect on writing patterns. "
                "Existing dashboards may expose counts but can detach those counts from the source text.",
            )
            pdf.setFont("Helvetica", 9)
            pdf.drawRightString(left_x + column_width, y + 4, "[16].")

            y_right = height - 185
            y_right = draw_wrapped_lines(
                pdf,
                right_x,
                y_right,
                column_width,
                "The continuation of the introduction explains why logical reading order matters in two-column documents. "
                "It should appear before the methodology heading because the argument still belongs to the first section.",
            )
            pdf.setFont("Helvetica-Bold", 10)
            pdf.drawString(right_x, y_right - 8, "2 METHODOLOGY")
            draw_wrapped_lines(
                pdf,
                right_x,
                y_right - 26,
                column_width,
                "We implement a deterministic pipeline that segments pages into layout regions before creating editable blocks. "
                "The method reviews conference proceedings without treating that prose as metadata.",
            )

        response = self.post_pdf(make_pdf_with_drawer(draw), "publication.pdf")

        self.assertEqual(response.status_code, 200)
        blocks = response.json()["blocks"]
        self.assertEqual(blocks[0]["kind"], "heading")
        self.assertEqual(
            blocks[0]["text"],
            "Supporting Sensemaking of Large Language Model Outputs at Scale",
        )
        metadata_text = " ".join(block["text"] for block in blocks if block["kind"] == "metadata")
        self.assertIn("Mohammed Hamid", metadata_text)
        self.assertIn("LMU Munich", metadata_text)
        self.assertIn("Munich, Germany", metadata_text)
        self.assertIn("m.hamid@campus.lmu.de", metadata_text)
        self.assertFalse(any(block["kind"] == "heading" and "Mohammed Hamid" in block["text"] for block in blocks))

        combined = "\n".join(block["text"] for block in blocks)
        self.assert_ordered(
            combined,
            [
                "Supporting Sensemaking of Large Language Model Outputs at Scale",
                "Mohammed Hamid",
                "LMU Munich",
                "Munich, Germany",
                "m.hamid@campus.lmu.de",
                "ABSTRACT",
                "Large language model outputs require interfaces",
                "academic writing support and includes citations [3, 9, 12].",
                "usage is generally associated with careful inspection",
                "CCS CONCEPTS",
                "Human-centered computing -> Visualization",
                "KEYWORDS",
                "writing analytics, sensemaking, academic reflection",
                "1 INTRODUCTION",
                "Students often need to understand how their academic texts are structured",
                "The continuation of the introduction explains why logical reading order matters",
                "2 METHODOLOGY",
                "We implement a deterministic pipeline",
                "conference proceedings without treating that prose as metadata",
            ],
        )
        self.assertNotIn("tionalLicense", combined)
        self.assertNotIn("Permission to make digital", combined)
        self.assertEqual(combined.count("Mohammed Hamid"), 1)
        self.assertEqual(combined.count("Large language model outputs"), 1)
        self.assertEqual(combined.count("[3, 9, 12]."), 1)
        self.assertEqual(combined.count("[16]."), 1)
        self.assertFalse(any(block["kind"] == "paragraph" and block["text"].strip() == "[16]." for block in blocks))
        self.assertFalse(any(block["kind"] == "metadata" and "usage is generally" in block["text"] for block in blocks))
        self.assertFalse(any(block["kind"] == "metadata" and "conference proceedings" in block["text"] for block in blocks))
        self.assertTrue(any(block["kind"] == "heading" and block["text"] == "CCS CONCEPTS" for block in blocks))
        self.assertTrue(any(block["kind"] == "heading" and block["text"] == "2 METHODOLOGY" for block in blocks))

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

    def assert_ordered(self, text: str, fragments: list[str]) -> None:
        cursor = -1
        for fragment in fragments:
            next_position = text.find(fragment)
            self.assertGreater(next_position, cursor, f"{fragment!r} did not appear in the expected order")
            cursor = next_position


if __name__ == "__main__":
    unittest.main()
