// Dumps every text item's page number + top-left bbox (matching react-pdf's
// canvas coordinate space at scale 1) from a PDF, one JSON array per page.
// Built to backfill frontend/src/data/fieldLocations.ts once a real sample
// report PDF exists (none is in this repo yet — see that file's header
// comment for why the field-code style-guide PDF in
// GSE_UAD_3.6.0_v1.3_schema/ can't be used for this).
//
// Usage: node scripts/extract-pdf-text.mjs <input.pdf> <output.json>
import { getDocument } from "../frontend/node_modules/pdfjs-dist/legacy/build/pdf.mjs";
import fs from "fs";

const [pdfPath, outPath] = process.argv.slice(2);
if (!pdfPath || !outPath) {
  console.error("Usage: node scripts/extract-pdf-text.mjs <input.pdf> <output.json>");
  process.exit(1);
}

// item.transform is in PDF space (origin bottom-left); compose it with the
// page viewport transform to get the same top-left, scale-1 pixel space
// react-pdf renders into, so bbox values here can be pasted straight into
// fieldLocations.ts.
function toViewportBox(item, viewport) {
  const [a, b, c, d, e, f] = item.transform;
  const [ta, tb, tc, td, te, tf] = viewport.transform;
  const x = ta * e + tc * f + te;
  const y = tb * e + td * f + tf;
  return { x, y: y - item.height, width: item.width, height: item.height };
}

const data = new Uint8Array(fs.readFileSync(pdfPath));
const doc = await getDocument({ data, useSystemFonts: true, disableFontFace: true }).promise;
console.error(`pages: ${doc.numPages}`);

const pages = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items
    .filter((it) => "str" in it && it.str.trim().length > 0)
    .map((it) => ({ str: it.str, ...toViewportBox(it, viewport) }));
  pages.push({ page: p, width: viewport.width, height: viewport.height, items });
}

fs.writeFileSync(outPath, JSON.stringify(pages, null, 2), "utf-8");
console.error(`wrote ${outPath}`);
