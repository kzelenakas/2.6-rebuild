import fs from "fs";
import path from "path";
import libxmljs from "libxmljs2";

// Structural gate, separate from and prior to the 757 H-1 business rules:
// does this XML actually conform to the published GSE_UAD_3.6.0_v1.3 MISMO
// schema at all? A file can pass well-formedness (parser.ts's DOMParser)
// while still being schema-invalid (wrong element order, missing required
// MISMO nodes, wrong types) — that case previously just silently extracted
// whatever fields it could find instead of failing here.
const XSD_PATH = path.join(
  process.cwd(),
  "GSE_UAD_3.6.0_v1.3_schema",
  "Combined",
  "GSE_UAD_3.6.0_v1.3.xsd"
);

let xsdDoc: libxmljs.Document | null = null;
function getXsdDoc(): libxmljs.Document {
  if (!xsdDoc) {
    xsdDoc = libxmljs.parseXml(fs.readFileSync(XSD_PATH, "utf-8"), { baseUrl: XSD_PATH });
  }
  return xsdDoc;
}

export interface XsdValidationError {
  code: "XSD_VALIDATION";
  message: string;
  location: string | null;
}

export function validateAgainstSchema(xmlString: string): XsdValidationError[] {
  let xmlDoc: libxmljs.Document;
  try {
    xmlDoc = libxmljs.parseXml(xmlString);
  } catch (e: any) {
    // Already-malformed XML is parser.ts's DOMParser's job to report; this
    // function is only meaningful for well-formed documents, so treat a
    // second-parser failure here as "nothing more to say" rather than
    // duplicating the well-formedness error under a different code.
    return [];
  }

  const valid = xmlDoc.validate(getXsdDoc());
  if (valid) return [];

  return xmlDoc.validationErrors.map(err => ({
    code: "XSD_VALIDATION" as const,
    message: err.message.trim(),
    location: err.line ? `line ${err.line}` : null
  }));
}
