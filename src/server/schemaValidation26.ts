import fs from "fs";
import path from "path";
import libxmljs from "libxmljs2";

const XSD_PATH_26 = path.join(
  process.cwd(),
  "schemas",
  "REAL_ESTATE_PROPERTY_INFORMATION_VALUATION_RESPONSE_v2_6_Errata_1.xsd"
);

let xsdDoc26: libxmljs.Document | null = null;

function getXsdDoc26(): libxmljs.Document {
  if (!xsdDoc26) {
    xsdDoc26 = libxmljs.parseXml(fs.readFileSync(XSD_PATH_26, "utf-8"), { baseUrl: XSD_PATH_26 });
  }
  return xsdDoc26;
}

export interface XsdValidationError {
  code: "XSD_VALIDATION";
  message: string;
  location: string | null;
}

export function validateAgainstSchema26(xmlString: string): XsdValidationError[] {
  let xmlDoc: libxmljs.Document;
  try {
    xmlDoc = libxmljs.parseXml(xmlString);
  } catch (e: any) {
    return [];
  }

  const valid = xmlDoc.validate(getXsdDoc26());
  if (valid) return [];

  return xmlDoc.validationErrors.map(err => ({
    code: "XSD_VALIDATION" as const,
    message: err.message.trim(),
    location: err.line ? `line ${err.line}` : null
  }));
}