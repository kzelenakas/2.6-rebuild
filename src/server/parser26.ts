import fs from "fs";
import path from "path";
import { DOMParser } from "@xmldom/xmldom";
import { validateAgainstSchema26 } from "./schemaValidation26";

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
  parse_failed?: boolean;
  images?: Record<string, Buffer>;
}

export interface StructuralError {
  code: string;
  message: string;
  location: string | null;
}

let fieldManifest26: any[] = [];

export function initParser26() {
  const manifestPath = path.join(process.cwd(), "schemas", "uad26_field_manifest.json");
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      fieldManifest26 = manifest.fields || [];
      console.log(`Loaded ${fieldManifest26.length} fields from UAD 2.6 manifest.`);
    } catch (e) {
      console.error("Failed to load UAD 2.6 field manifest", e);
    }
  } else {
    console.warn("UAD 2.6 field manifest not found at", manifestPath);
  }
}

export function getFieldManifest26(): any[] {
  return fieldManifest26;
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

function getSubjectNode26(doc: any): any {
  // In UAD 2.6, subject property is the first PROPERTY under VALUATION_RESPONSE
  // (PropertySequenceIdentifier is implicit - first PROPERTY = subject)
  const properties = doc.getElementsByTagName("PROPERTY");
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i];
    // Check if this is the subject (no PropertySequenceIdentifier or it's the first one)
    // In UAD 2.6, subject is always the first PROPERTY element
    const seqId = prop.getAttribute?.("_SequenceIdentifier") || prop.getAttribute?.("PropertySequenceIdentifier");
    if (!seqId || seqId === "0" || seqId === "1") {
      return prop;
    }
  }
  // Fallback: return first PROPERTY
  return properties.length > 0 ? properties[0] : null;
}

function getComparableSaleNodes26(doc: any): any[] {
  // In UAD 2.6, comparables are under VALUATION_METHODS/SALES_COMPARISON/COMPARABLE_SALE
  const salesComparison = doc.getElementsByTagName("SALES_COMPARISON")[0];
  if (!salesComparison) return [];

  const comps: any[] = [];
  let child = salesComparison.firstChild;
  while (child) {
    if (child.nodeType === 1 && (child.localName === "COMPARABLE_SALE" || child.nodeName === "COMPARABLE_SALE")) {
      comps.push(child);
    }
    child = child.nextSibling;
  }
  return comps;
}

function resolveValue26(doc: any, subject: any, comps: any[], entry: any): string | null {
  // Detect if this field is an attribute (key contains @)
  const isAttribute = entry.key.includes("@");
  const attributeName = isAttribute ? entry.element : null;

  // For attributes, we need to find the PARENT element (xpath_dir), not the attribute itself
  const parentSteps = localSteps(entry.xpath_dir);
  const [nodeSteps] = splitAttribute(parentSteps);

  let node: any = null;

  // Determine scope from key
  const scope = entry.scope;

  if (scope === "subject") {
    if (!subject) return null;
    // Remove leading VALUATION_RESPONSE/PROPERTY/ from path for subject-relative resolution
    let relSteps = [...nodeSteps];
    if (relSteps[0] === "VALUATION_RESPONSE") relSteps.shift();
    if (relSteps[0] === "PROPERTY") relSteps.shift();
    node = findChildChain(subject, relSteps);
  } else if (scope === "comp1" || scope.startsWith("comp")) {
    // For comps, use the appropriate comparable sale node
    let compIndex = 0;
    if (scope === "comp1") compIndex = 0;
    else if (scope === "comp2") compIndex = 1;
    else if (scope === "comp3") compIndex = 2;
    else if (scope === "comp4") compIndex = 3;
    else if (scope === "comp5") compIndex = 4;

    if (compIndex < comps.length) {
      // Remove VALUATION_RESPONSE/VALUATION_METHODS/SALES_COMPARISON/COMPARABLE_SALE from path
      let relSteps = [...nodeSteps];
      while (relSteps.length > 0 && relSteps[0] !== "COMPARABLE_SALE") {
        relSteps.shift();
      }
      if (relSteps[0] === "COMPARABLE_SALE") relSteps.shift();
      node = findChildChain(comps[compIndex], relSteps);
    }
  } else if (scope === "listing") {
    // Listing - find LISTING_HISTORY under PROPERTY
    if (subject) {
      node = findDescendantChain(subject, nodeSteps);
    }
  } else if (scope === "doc") {
    // Document-level - resolve from document root
    if (nodeSteps.length > 0) {
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
  } else {
    // Default: try from document root
    if (nodeSteps.length > 0) {
      node = findDescendantChain(doc, nodeSteps);
    }
  }

  if (!node) return null;
  if (attributeName) {
    return node.getAttribute ? node.getAttribute(attributeName) : null;
  }
  return node.textContent || null;
}

export function parseAndNormalizeXML26(xmlString: string, filename: string): {
  normalized: NormalizedReport;
  structural_errors: StructuralError[];
} {
  const structural_errors: StructuralError[] = [];
  let doc: any = null;

  try {
    doc = new DOMParser({
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

  // Schema validation only if well-formed
  if (doc) {
    structural_errors.push(...validateAgainstSchema26(xmlString));
  }

  const subject = doc ? getSubjectNode26(doc) : null;
  const comps = doc ? getComparableSaleNodes26(doc) : [];
  const fields: Record<string, NormalizedField> = {};

  for (const entry of fieldManifest26) {
    let value: string | null = null;
    if (doc) {
      try {
        value = resolveValue26(doc, subject, comps, entry);
      } catch (err) {
        // Suppress per-field extraction errors
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
      schema_version: "UAD_2.6_GSE_v1.0",
      fields,
      xmlString,
      parse_failed: !doc
    },
    structural_errors
  };
}