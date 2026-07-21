import { describe, expect, it } from "vitest";
import {
  extractDocumentText,
  extensionFromFilename,
  resolveUploadDocumentBody,
  supportedDocumentExtension,
} from "../../src/documentExtract.js";

describe("documentExtract", () => {
  it("detects supported extensions", () => {
    expect(supportedDocumentExtension("memo.pdf")).toBe(true);
    expect(supportedDocumentExtension("report.docx")).toBe(true);
    expect(supportedDocumentExtension("notes.txt")).toBe(true);
    expect(supportedDocumentExtension("slides.pptx")).toBe(false);
  });

  it("extracts plain text from utf8 files", async () => {
    const text = await extractDocumentText(
      "note.txt",
      Buffer.from("Hello Acme", "utf8"),
    );
    expect(text).toBe("Hello Acme");
  });

  it("resolves inline body without base64", async () => {
    const body = await resolveUploadDocumentBody(
      { body: "Inline memo" },
      "Memo",
    );
    expect(body).toBe("Inline memo");
  });

  it("rejects unknown binary formats", async () => {
    await expect(
      extractDocumentText("deck.pptx", Buffer.from("fake", "utf8")),
    ).rejects.toThrow("unsupported_format:pptx");
    expect(extensionFromFilename("a.b.c.pdf")).toBe("pdf");
  });
});
