import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useImperativeHandle,
  memo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ThemeConfig } from "./types";
import { parseLine, renderSyntaxLine } from "./logParser";
import { parseQuery, buildHighlightRegex } from "./queryParser";

const SELECTION_BG = "rgba(137, 180, 250, 0.3)";

export interface LogPaneHandle {
  scrollToLine: (index: number) => void;
}

const LogPane = memo(function LogPane({
  lines,
  activeQuery,
  highlightLine,
  parentRef,
  theme,
  ref,
}: {
  lines: string[];
  activeQuery: string;
  highlightLine: number | null;
  parentRef: React.RefObject<HTMLDivElement | null>;
  theme: ThemeConfig;
  ref?: React.Ref<LogPaneHandle>;
}) {
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });

  // Expose scrollToLine for imperative scrolling from event handlers
  useImperativeHandle(ref, () => ({
    scrollToLine: (index: number) => {
      virtualizer.scrollToIndex(index, { align: "center" });
    },
  }), [virtualizer]);

  const regex = useMemo(() => {
    if (!activeQuery.trim()) return null;
    return buildHighlightRegex(parseQuery(activeQuery));
  }, [activeQuery]);

  const outlineShadow = useMemo(() => {
    if (theme.outlineWidth <= 0) return undefined;
    const w = theme.outlineWidth;
    const c = theme.outlineColor || "#000000";
    return `${w}px ${w}px 0 ${c}, -${w}px -${w}px 0 ${c}, ${w}px -${w}px 0 ${c}, -${w}px ${w}px 0 ${c}`;
  }, [theme.outlineColor, theme.outlineWidth]);

  // --- Custom line-level selection ---
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const isDragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selMin = selStart !== null && selEnd !== null ? Math.min(selStart, selEnd) : null;
  const selMax = selStart !== null && selEnd !== null ? Math.max(selStart, selEnd) : null;

  const getIndexFromEvent = (e: React.MouseEvent): number | null => {
    let el = e.target as HTMLElement | null;
    while (el) {
      const idx = el.getAttribute("data-index");
      if (idx !== null) return parseInt(idx);
      if (el === containerRef.current) break;
      el = el.parentElement;
    }
    return null;
  };

  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopAutoScroll = () => {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const idx = getIndexFromEvent(e);
    if (idx === null) return;
    window.getSelection()?.removeAllRanges();
    isDragging.current = true;
    setSelStart(idx);
    setSelEnd(idx);
  };

  // Update selection end from a clientY position (for auto-scroll)
  const updateSelFromY = useCallback((clientY: number) => {
    const scrollEl = parentRef.current;
    if (!scrollEl) return;
    const rect = scrollEl.getBoundingClientRect();
    const relY = clientY - rect.top + scrollEl.scrollTop;
    const LINE_HEIGHT = 20;
    const idx = Math.max(0, Math.min(lines.length - 1, Math.floor(relY / LINE_HEIGHT)));
    setSelEnd(idx);
  }, [lines.length, parentRef]);

  // Sync with external system: window mousemove/mouseup events for drag selection
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const scrollEl = parentRef.current;
      if (!scrollEl) return;

      const rect = scrollEl.getBoundingClientRect();
      const EDGE = 40;
      const SPEED = 8;

      if (e.clientY < rect.top + EDGE) {
        if (!autoScrollTimer.current) {
          autoScrollTimer.current = setInterval(() => {
            scrollEl.scrollTop -= SPEED;
            updateSelFromY(rect.top);
          }, 16);
        }
      } else if (e.clientY > rect.bottom - EDGE) {
        if (!autoScrollTimer.current) {
          autoScrollTimer.current = setInterval(() => {
            scrollEl.scrollTop += SPEED;
            updateSelFromY(rect.bottom);
          }, 16);
        }
      } else {
        stopAutoScroll();
      }

      const idx = (() => {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el) return null;
        let node: HTMLElement | null = el as HTMLElement;
        while (node) {
          const dataIdx = node.getAttribute("data-index");
          if (dataIdx !== null) return parseInt(dataIdx);
          if (node === containerRef.current) break;
          node = node.parentElement;
        }
        return null;
      })();
      if (idx !== null) setSelEnd(idx);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      stopAutoScroll();
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      stopAutoScroll();
    };
  }, [parentRef, updateSelFromY]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.ctrlKey && e.key === "a") {
      e.preventDefault();
      e.stopPropagation();
      setSelStart(0);
      setSelEnd(lines.length - 1);
    }
    if (e.ctrlKey && e.key === "c") {
      if (selMin !== null && selMax !== null) {
        e.preventDefault();
        const text = lines.slice(selMin, selMax + 1).join("\n");
        navigator.clipboard.writeText(text);
      }
    }
  }, [lines, selMin, selMax]);

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        height: `${virtualizer.getTotalSize()}px`,
        width: "100%",
        position: "relative",
        textShadow: outlineShadow,
        outline: "none",
        userSelect: "none",
        cursor: "text",
      }}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
    >
      {virtualizer.getVirtualItems().map((vRow) => {
        const line = lines[vRow.index];
        const isHighlighted = highlightLine === vRow.index;
        const isSelected = selMin !== null && selMax !== null && vRow.index >= selMin && vRow.index <= selMax;
        return (
          <div
            key={vRow.index}
            data-index={vRow.index}
            ref={virtualizer.measureElement}
            className={`px-1 whitespace-pre-wrap break-all ${
              isHighlighted ? "highlight-flash" : ""
            }`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vRow.start}px)`,
              backgroundColor: isSelected
                ? SELECTION_BG
                : isHighlighted
                ? theme.highlightBg
                : undefined,
            }}
          >
            {renderSyntaxElements(line, theme, regex)}
          </div>
        );
      })}
    </div>
  );
});

function renderSyntaxElements(
  line: string,
  theme: ThemeConfig,
  searchRegex: RegExp | null
) {
  const parsed = parseLine(line);
  const segments = renderSyntaxLine(parsed, theme);

  if (!segments.length) return line || "\u00A0";

  return segments.map((seg, i) => {
    if (searchRegex && seg.text) {
      const parts = seg.text.split(searchRegex);
      return (
        <span key={i} style={{ color: seg.color }}>
          {parts.map((part, j) =>
            searchRegex.test(part) ? (
              <mark
                key={j}
                style={{
                  backgroundColor: theme.searchMark,
                  color: theme.searchMarkText,
                  borderRadius: "2px",
                  padding: "0 1px",
                }}
              >
                {part}
              </mark>
            ) : (
              part
            )
          )}
        </span>
      );
    }
    return (
      <span key={i} style={{ color: seg.color }}>
        {seg.text}
      </span>
    );
  });
}

export default LogPane;
