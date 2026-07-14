import { useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { Finding, Severity } from "../types";
import { getFieldLocation } from "../data/fieldLocations";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const SEVERITY_COLOR: Record<Severity, string> = {
  HardStop: "rgba(220, 38, 38, 0.35)",
  Warning: "rgba(217, 119, 6, 0.35)",
  Advisory: "rgba(37, 99, 235, 0.30)",
};
const SEVERITY_BORDER: Record<Severity, string> = {
  HardStop: "#dc2626",
  Warning: "#d97706",
  Advisory: "#2563eb",
};

interface ReportPreviewPaneProps {
  /** Signed URL to the report PDF — never a public bucket path. */
  pdfUrl: string;
  findings: Finding[];
  activeFindingId: number | null;
  onSelectFinding: (id: number) => void;
}

/**
 * Single-document preview for the appraiser view and initial reviewer pass:
 * renders the actual submitted PDF (not a mock) with rule-triggered fields
 * highlighted, two-way linked to the finding list.
 */
export function ReportPreviewPane({
  pdfUrl,
  findings,
  activeFindingId,
  onSelectFinding,
}: ReportPreviewPaneProps) {
  const [numPages, setNumPages] = useState(0);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const overlaysByPage = new Map<number, { finding: Finding; loc: NonNullable<ReturnType<typeof getFieldLocation>> }[]>();
  for (const finding of findings) {
    const loc = getFieldLocation(finding.field_path);
    if (!loc) continue;
    const list = overlaysByPage.get(loc.page) ?? [];
    list.push({ finding, loc });
    overlaysByPage.set(loc.page, list);
  }

  useEffect(() => {
    if (activeFindingId == null) return;
    const active = findings.find((f) => f.id === activeFindingId);
    const loc = active ? getFieldLocation(active.field_path) : null;
    if (!loc) return;
    pageRefs.current[loc.page]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeFindingId, findings]);

  return (
    <div className="h-full overflow-y-auto bg-neutral-100" aria-label="Report preview">
      <Document
        file={pdfUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={<p className="p-4 text-sm text-neutral-500">Loading report…</p>}
        error={<p className="p-4 text-sm text-red-600">Could not load the report PDF.</p>}
      >
        {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
          <div
            key={pageNumber}
            ref={(el) => {
              pageRefs.current[pageNumber] = el;
            }}
            className="relative mx-auto my-3 w-fit shadow"
          >
            <Page pageNumber={pageNumber} />
            {(overlaysByPage.get(pageNumber) ?? []).map(({ finding, loc }) => (
              <button
                key={finding.id}
                type="button"
                onClick={() => onSelectFinding(finding.id)}
                title={finding.message_reviewer}
                aria-label={`${finding.severity} finding: ${finding.message_reviewer}`}
                style={{
                  position: "absolute",
                  left: loc.bbox.x,
                  top: loc.bbox.y,
                  width: loc.bbox.width,
                  height: loc.bbox.height,
                  background: SEVERITY_COLOR[finding.severity],
                  border: `2px solid ${
                    finding.id === activeFindingId ? "#111827" : SEVERITY_BORDER[finding.severity]
                  }`,
                  borderRadius: 2,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        ))}
      </Document>
    </div>
  );
}
