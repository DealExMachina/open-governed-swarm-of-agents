/**
 * Extract plain text from uploaded business documents (txt, md, pdf, docx).
 */
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

const SUPPORTED_EXTENSIONS = new Set(["txt", "md", "pdf", "docx"]);

export function supportedDocumentExtension(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXTENSIONS.has(ext);
}

export function extensionFromFilename(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export async function extractDocumentText(
  filename: string,
  data: Buffer,
): Promise<string> {
  const ext = extensionFromFilename(filename);
  if (!SUPPORTED_EXTENSIONS.has(ext)) {
    throw new Error(`unsupported_format:${ext || "unknown"}`);
  }
  if (ext === "txt" || ext === "md") {
    return data.toString("utf8");
  }
  if (ext === "docx") {
    const result = await mammoth.extractRawText({ buffer: data });
    return result.value.trim();
  }
  const parser = new PDFParse({ data });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

/** Resolve document body from JSON upload fields (plain text or base64 binary). */
export async function resolveUploadDocumentBody(
  row: Record<string, unknown>,
  title: string,
): Promise<string> {
  const plain =
    typeof row.body === "string"
      ? row.body
      : typeof row.text === "string"
        ? row.text
        : "";
  if (plain.trim()) return plain;

  const b64 =
    typeof row.content_base64 === "string" ? row.content_base64.trim() : "";
  if (!b64) return "";

  const filename =
    typeof row.filename === "string" && row.filename.trim()
      ? row.filename.trim()
      : `${title}.${typeof row.format === "string" ? row.format : "txt"}`;
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) return "";
  return extractDocumentText(filename, buf);
}
