import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Document, Page, pdfjs } from "react-pdf";
import type { Finding } from "../types";
import { getFieldLocation } from "../data/fieldLocations";
import { useScrollLock } from "../lib/useScrollLock";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

const CHANGED_COLOR = "rgba(202, 138, 4, 0.35)"; // amber — distinct from severity colors
const CHANGED_BORDER = "#ca8a04";

interface RevisionCompareViewProps {
  v1PdfUrl: string;
  v2PdfUrl: string;
  v1Findings: Finding[];
  v2Findings: Finding[];
  v1Label?: string;
  v2Label?: string;
  onClose: () => void;
}

/** Field keys present in both versions whose values differ. */
function diffFieldKeys(v1: Finding[], v2: Finding[]): Set<string> {
  const v1ByField = new Map(v1.map((f) => [f.field_path, f]));
  const v2ByField = new Map(v2.map((f) => [f.field_path, f]));
  const changed = new Set<string>();
  for (const [fieldPath, f1] of v1ByField) {
    const f2 = v2ByField.get(fieldPath);
    if (!f2) continue;
    if (JSON.stringify(f1.values) !== JSON.stringify(f2.values)) {
      changed.add(fieldPath);
    }
  }
  return changed;
}

function ComparePane({
  pdfUrl,
  changedFieldKeys,
  scrollRef,
  onScroll,
  label,
}: {
  pdfUrl: string;
  changedFieldKeys: Set<string>;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  label: string;
}) {
  const [numPages, setNumPages] = useState(0);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="border-b border-neutral-300 bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-700">
        {label}
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto bg-neutral-100">
        <Document file={pdfUrl} onLoadSuccess={({ numPages: n }) => setNumPages(n)}>
          {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNumber) => (
            <div key={pageNumber} className="relative mx-auto my-3 w-fit shadow">
              <Page pageNumber={pageNumber} />
              {[...changedFieldKeys].map((fieldKey) => {
                const loc = getFieldLocation(fieldKey);
                if (!loc || loc.page !== pageNumber) return null;
                return (
                  <div
                    key={fieldKey}
                    title={`Changed: ${fieldKey}`}
                    style={{
                      position: "absolute",
                      left: loc.bbox.x,
                      top: loc.bbox.y,
                      width: loc.bbox.width,
                      height: loc.bbox.height,
                      background: CHANGED_COLOR,
                      border: `2px solid ${CHANGED_BORDER}`,
                      borderRadius: 2,
                      pointerEvents: "none",
                    }}
                  />
                );
              })}
            </div>
          ))}
        </Document>
      </div>
    </div>
  );
}

function CompareBody(props: RevisionCompareViewProps) {
  const { v1PdfUrl, v2PdfUrl, v1Findings, v2Findings, v1Label, v2Label, onClose } = props;
  const changed = useMemo(() => diffFieldKeys(v1Findings, v2Findings), [v1Findings, v2Findings]);
  const { leftRef, rightRef, onLeftScroll, onRightScroll } = useScrollLock();

  return (
    <div className="flex h-full w-full flex-col bg-white">
      <div className="flex items-center justify-between border-b border-neutral-300 px-4 py-2">
        <div className="text-sm text-neutral-600">
          <span className="mr-1 inline-block h-3 w-3 rounded-sm border border-amber-600 bg-amber-400/40 align-middle" />
          highlighted fields changed between versions · scroll is locked between both panes
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-sm text-neutral-500 hover:bg-neutral-100"
        >
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <ComparePane
          pdfUrl={v1PdfUrl}
          changedFieldKeys={changed}
          scrollRef={leftRef}
          onScroll={onLeftScroll}
          label={v1Label ?? "Original submission (v1)"}
        />
        <div className="w-px bg-neutral-300" />
        <ComparePane
          pdfUrl={v2PdfUrl}
          changedFieldKeys={changed}
          scrollRef={rightRef}
          onScroll={onRightScroll}
          label={v2Label ?? "Revised submission (v2)"}
        />
      </div>
    </div>
  );
}

/**
 * Reviewer's v1-vs-v2 revision compare. Space is tight in the main app, so
 * this renders two ways from the same component:
 *  - in-app overlay (default) — a full-viewport modal over the current page
 *  - a real separate OS window ("pop out"), via window.open + a React
 *    portal into that window's own document (copies stylesheets across so
 *    Tailwind classes still render there)
 * Scroll lock works identically in both cases since both panes always live
 * in the same document — only which window that document is in changes.
 */
export function RevisionCompareView(props: RevisionCompareViewProps) {
  const [poppedWindow, setPoppedWindow] = useState<Window | null>(null);

  const popOut = () => {
    const win = window.open("", "qc-revision-compare", "width=1400,height=900");
    if (!win) return; // popup blocked — caller falls back to the in-app modal
    win.document.title = "Revision compare";
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach((node) => {
      win.document.head.appendChild(node.cloneNode(true));
    });
    win.addEventListener("beforeunload", () => setPoppedWindow(null));
    setPoppedWindow(win);
  };

  if (poppedWindow) {
    return createPortal(
      <CompareBody {...props} onClose={() => { poppedWindow.close(); setPoppedWindow(null); }} />,
      poppedWindow.document.body,
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/40 p-6">
      <div className="flex justify-end pb-2">
        <button
          type="button"
          onClick={popOut}
          className="rounded border border-neutral-300 bg-white px-3 py-1 text-sm hover:bg-neutral-50"
        >
          Pop out to separate window
        </button>
      </div>
      <div className="min-h-0 flex-1 rounded shadow-2xl">
        <CompareBody {...props} />
      </div>
    </div>
  );
}
