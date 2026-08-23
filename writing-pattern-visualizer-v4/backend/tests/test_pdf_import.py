from __future__ import annotations

from io import BytesIO
import unittest

from fastapi.testclient import TestClient
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

from app.main import app


def make_pdf(lines: list[str]) -> bytes:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    width, height = letter
    text = pdf.beginText(72, height - 72)
    text.setFont("Helvetica", 11)

    for line in lines:
        if line == "":
            text.moveCursor(0, 14)
        else:
            text.textLine(line)

    pdf.drawText(text)
    pdf.showPage()
    pdf.save()
    return buffer.getvalue()


class PdfImportTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(app)

    def post_pdf(self, content: bytes, filename: str = "sample.pdf"):
        return self.client.post(
            "/api/import/pdf",
            files={"file": (filename, content, "application/pdf")},
        )

    def test_imports_normal_multi_paragraph_pdf(self):
        pdf_bytes = make_pdf(
            [
                "Introduction",
                "",
                "This paragraph introduces the academic text and its central concern.",
                "",
                "This second paragraph provides additional context for the writing task.",
            ]
        )

        response = self.post_pdf(pdf_bytes)

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["page_count"], 1)
        self.assertEqual(
            data["blocks"][0],
            {
                "kind": "heading",
                "text": "Introduction",
                "heading_level": 1,
            },
        )
        self.assertEqual([block["kind"] for block in data["blocks"]].count("paragraph"), 2)

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
