import { useCallback, useRef } from "react";
import { computeSyncedScrollTop } from "./scrollSync";

/**
 * Locks scroll position between two scrollable panes by fraction, not pixels.
 * Guards against the sync-echo loop with a single in-flight flag — pane A's
 * programmatic scroll (caused by pane B) must not re-trigger pane B's handler.
 */
export function useScrollLock() {
  const leftRef = useRef<HTMLDivElement | null>(null);
  const rightRef = useRef<HTMLDivElement | null>(null);
  const syncing = useRef(false);

  const sync = useCallback((from: "left" | "right") => {
    if (syncing.current) return;
    const source = from === "left" ? leftRef.current : rightRef.current;
    const target = from === "left" ? rightRef.current : leftRef.current;
    if (!source || !target) return;

    syncing.current = true;
    target.scrollTop = computeSyncedScrollTop(
      source.scrollTop,
      source.scrollHeight,
      source.clientHeight,
      target.scrollHeight,
      target.clientHeight,
    );
    // release on next frame — after the browser has applied the programmatic
    // scroll and fired (and we've ignored) the resulting scroll event
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const onLeftScroll = useCallback(() => sync("left"), [sync]);
  const onRightScroll = useCallback(() => sync("right"), [sync]);

  return { leftRef, rightRef, onLeftScroll, onRightScroll };
}
