/**
 * Pure scroll-sync math for the v1/v2 side-by-side compare view.
 *
 * The two panes are almost never the same height (a revision can add/remove
 * pages or content), so syncing by raw scrollTop pixels drifts. Sync by
 * scroll *fraction* instead: how far down the scrollable range each pane is.
 */
export function computeSyncedScrollTop(
  sourceScrollTop: number,
  sourceScrollHeight: number,
  sourceClientHeight: number,
  targetScrollHeight: number,
  targetClientHeight: number,
): number {
  const sourceRange = sourceScrollHeight - sourceClientHeight;
  const targetRange = targetScrollHeight - targetClientHeight;
  if (sourceRange <= 0 || targetRange <= 0) return 0;
  const fraction = sourceScrollTop / sourceRange;
  return fraction * targetRange;
}
