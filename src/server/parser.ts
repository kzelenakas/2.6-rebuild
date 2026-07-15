import fs from "fs";
import path from "path";
import { DOMParser } from "@xmldom/xmldom";
import { validateAgainstSchema } from "./schemaValidation";

export interface NormalizedField {
  value: string | null;
  xpath: string;
  label: string;
  section: string;
}

export interface NormalizedReport {
  schema_version: string;
  fields: Record<string, NormalizedField>;
  xmlString?: string;
  // True when the XML could not be parsed at all (every field resolves null);
  // callers should skip rule evaluation to avoid a flood of false "missing" findings.
  parse_failed?: boolean;
}

export interface StructuralError {
  code: string;
  message: string;
  location: string | null;
}

let fieldManifest: any[] = [];

export function initParser() {
  const manifestPath = path.join(process.cwd(), "schemas", "uad36_field_manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      fieldManifest = manifest.fields || [];
      console.log(`Loaded ${fieldManifest.length} fields from manifest.`);
    } catch (e) {
      console.error("Failed to load field manifest", e);
    }
  } else {
    console.warn("Field manifest not found at", manifestPath);
  }
}

export function getFieldManifest(): any[] {
  return fieldManifest;
}

function findChildChain(node: any, steps: string[]): any {
  let current = node;
  for (const step of steps) {
    if (!current) return null;
    let nextNode = null;
    let child = current.firstChild;
    while (child) {
      if (child.nodeType === 1 && (child.localName === step || child.nodeName === step)) {
        nextNode = child;
        break;
      }
      child = child.nextSibling;
    }
    current = nextNode;
  }
  return current;
}

function findDescendantChain(node: any, steps: string[]): any {
  if (steps.length === 0) return node;
  const firstStep = steps[0];

  const matches: any[] = [];
  function collect(curr: any) {
    if (!curr) return;
    if (curr.nodeType === 1 && (curr.localName === firstStep || curr.nodeName === firstStep)) {
      matches.push(curr);
    }
    let child = curr.firstChild;
    while (child) {
      collect(child);
      child = child.nextSibling;
    }
  }
  collect(node);

  for (const m of matches) {
    const found = findChildChain(m, steps.slice(1));
    if (found) return found;
  }
  return null;
}

function splitAttribute(steps: string[]): [string[], string | null] {
  const nodeSteps: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step === "@") {
      return [nodeSteps, i + 1 < steps.length ? steps[i + 1] : null];
    }
    if (step.startsWith("@")) {
      return [nodeSteps, step.slice(1)];
    }
    nodeSteps.push(step);
  }
  return [nodeSteps, null];
}

function localSteps(pathStr: string): string[] {
  return pathStr.split("/").filter((s) => s);
}

function getSubjectNode(doc: any): any {
  // subject property is the FIRST <PROPERTY> under VALUATION_ANALYSIS/PROPERTIES in document order
  const propertiesNode = doc.getElementsByTagName("PROPERTIES")[0];
  if (!propertiesNode) return null;

  let parent = propertiesNode.parentNode;
  while (parent && parent.nodeType === 1) {
    const name = parent.localName || parent.nodeName;
    if (name === "VALUATION_ANALYSIS") {
      let child = propertiesNode.firstChild;
      while (child) {
        if (child.nodeType === 1 && (child.localName === "PROPERTY" || child.nodeName === "PROPERTY")) {
          return child;
        }
        child = child.nextSibling;
      }
    }
    parent = parent.parentNode;
  }
  return null;
}

function resolveValue(doc: any, subject: any, entry: any): string | null {
  const steps = [...localSteps(entry.xpath_dir), entry.element];
  const [nodeSteps, attribute] = splitAttribute(steps);

  let node: any = null;
  if (entry.scope === "subject" && nodeSteps.includes("PROPERTY")) {
    if (!subject) return null;
    const propertyIdx = nodeSteps.indexOf("PROPERTY");
    const rel = nodeSteps.slice(propertyIdx + 1);
    node = findChildChain(subject, rel);
  } else if (nodeSteps.length > 0) {
    node = findDescendantChain(doc, nodeSteps);
    if (!node && doc.documentElement) {
      const rootName = doc.documentElement.localName || doc.documentElement.nodeName;
      if (rootName === nodeSteps[0]) {
        node = nodeSteps.length > 1 ? findChildChain(doc.documentElement, nodeSteps.slice(1)) : doc.documentElement;
      }
    }
  } else {
    node = doc;
  }

  if (!node) return null;
  if (attribute) {
    return node.getAttribute ? node.getAttribute(attribute) : null;
  }
  return node.textContent || null;
}

export function parseAndNormalizeXML(xmlString: string, filename: string): {
  normalized: NormalizedReport;
  structural_errors: StructuralError[];
} {
  const structural_errors: StructuralError[] = [];
  let doc: any = null;

  try {
    doc = new DOMParser({
      // @xmldom/xmldom 0.9's error API: a single onError(level, msg) callback
      // replacing the old errorHandler: {error, fatalError} object (which
      // this version silently ignores, so parsing "succeeded" with no doc
      // and every upload reported parse_failed=true regardless of how well-
      // formed the XML actually was). fatalError still throws from inside
      // the library itself after calling onError, so only record non-fatal
      // levels here -- the catch block below handles fatalError once.
      onError: (level: string, msg: string) => {
        if (level !== "fatalError") {
          structural_errors.push({ code: "XML_PARSE", message: msg, location: level });
        }
      }
    } as any).parseFromString(xmlString, "text/xml");
  } catch (e: any) {
    structural_errors.push({
      code: "XML_PARSE",
      message: e.message || String(e),
      location: "line 1"
    });
  }

  // Only meaningful once the document is at least well-formed -- a schema
  // validation pass over unparseable XML would just be noise on top of the
  // XML_PARSE error already recorded above.
  if (doc) {
    structural_errors.push(...validateAgainstSchema(xmlString));
  }

  const subject = doc ? getSubjectNode(doc) : null;
  const fields: Record<string, NormalizedField> = {};

  for (const entry of fieldManifest) {
    let value: string | null = null;
    if (doc) {
      try {
        value = resolveValue(doc, subject, entry);
      } catch (err) {
        // Suppress extraction errors per-field
      }
    }
    fields[entry.key] = {
      value,
      xpath: `${entry.xpath_dir}${entry.element}`,
      label: entry.label,
      section: entry.section
    };
  }

  return {
    normalized: {
      schema_version: "GSE_UAD_3.6.0_v1.3",
      fields,
      xmlString,
      parse_failed: !doc
    },
    structural_errors
  };
}
