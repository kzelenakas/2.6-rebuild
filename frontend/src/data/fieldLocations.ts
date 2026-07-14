/**
 * Maps a UAD field key (same keys used in Finding.field_path /
 * schemas/uad36_field_manifest.json) to its position on the rendered PDF, so
 * a finding can be highlighted directly on the document.
 *
 * The URAR/Form 1004 layout is fixed per UAD version (published by the
 * GSEs), so this is a one-time mapping built from the form template, not
 * something computed per-report. bbox is in PDF points, origin top-left of
 * the page, matching react-pdf's default page coordinate space at scale 1.
 *
 * ponytail: only a handful of fields are mapped below as a working example —
 * populate the rest from the actual Form 1004 template before shipping.
 * Missing entries just mean "no overlay for that finding," never a crash.
 */
export interface FieldLocation {
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
}

export const FIELD_LOCATIONS: Record<string, FieldLocation> = {
  Address: { page: 1, bbox: { x: 72, y: 60, width: 300, height: 14 } },
  City: { page: 1, bbox: { x: 380, y: 60, width: 100, height: 14 } },
  State: { page: 1, bbox: { x: 490, y: 60, width: 40, height: 14 } },
  Zip: { page: 1, bbox: { x: 540, y: 60, width: 60, height: 14 } },
  Borrower: { page: 1, bbox: { x: 72, y: 78, width: 250, height: 14 } },
  YearBuilt: { page: 1, bbox: { x: 72, y: 400, width: 60, height: 14 } },
  Gla: { page: 1, bbox: { x: 200, y: 400, width: 60, height: 14 } },
  Comp1Address: { page: 2, bbox: { x: 72, y: 120, width: 300, height: 14 } },
  Comp1Price: { page: 2, bbox: { x: 380, y: 120, width: 80, height: 14 } },
};

export function getFieldLocation(fieldKey: string | null | undefined): FieldLocation | null {
  if (!fieldKey) return null;
  return FIELD_LOCATIONS[fieldKey] ?? null;
}
