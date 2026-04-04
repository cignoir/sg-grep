import { useEffect, useRef, useCallback, useState } from "react";

const SCROLLBAR_WIDTH = 16;
const TRACK_CAP_HEIGHT = 16;
const THUMB_CAP_HEIGHT = 4;
const MIN_THUMB_HEIGHT = THUMB_CAP_HEIGHT * 2 + 8;

interface Props {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

export default function CustomScrollbar({ scrollRef }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumbState, setThumbState] = useState({ top: 0, height: 0, visible: false });
  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartScroll = useRef(0);

  const update = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollHeight <= clientHeight) {
      setThumbState({ top: 0, height: 0, visible: false });
      return;
    }

    // Usable track area (between top and bottom caps)
    const trackHeight = clientHeight - TRACK_CAP_HEIGHT * 2;
    const thumbHeight = Math.max(MIN_THUMB_HEIGHT, (clientHeight / scrollHeight) * trackHeight);
    const scrollable = scrollHeight - clientHeight;
    const thumbTravel = trackHeight - thumbHeight;
    const thumbTop = TRACK_CAP_HEIGHT + (scrollTop / scrollable) * thumbTravel;

    setThumbState({ top: thumbTop, height: thumbHeight, visible: true });
  }, [scrollRef]);

  // Sync with external system: DOM scroll events and ResizeObserver on the scroll container
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    // Also observe content size changes
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    update();
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [scrollRef, update]);

  const handleTrackClick = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;

    const rect = track.getBoundingClientRect();
    const clickY = e.clientY - rect.top;
    const trackHeight = el.clientHeight - TRACK_CAP_HEIGHT * 2;
    const ratio = (clickY - TRACK_CAP_HEIGHT) / trackHeight;
    el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
  };

  const handleThumbMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragging.current = true;
    dragStartY.current = e.clientY;
    dragStartScroll.current = scrollRef.current?.scrollTop ?? 0;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const el = scrollRef.current;
      if (!el) return;
      const delta = ev.clientY - dragStartY.current;
      const trackHeight = el.clientHeight - TRACK_CAP_HEIGHT * 2;
      const thumbHeight = Math.max(MIN_THUMB_HEIGHT, (el.clientHeight / el.scrollHeight) * trackHeight);
      const thumbTravel = trackHeight - thumbHeight;
      const scrollable = el.scrollHeight - el.clientHeight;
      if (thumbTravel > 0) {
        el.scrollTop = dragStartScroll.current + (delta / thumbTravel) * scrollable;
      }
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  if (!thumbState.visible) return null;

  const containerHeight = scrollRef.current?.clientHeight ?? 0;

  return (
    <div
      ref={trackRef}
      className="absolute right-0 top-0 z-10"
      style={{
        width: SCROLLBAR_WIDTH,
        height: containerHeight,
        cursor: "pointer",
      }}
      onClick={handleTrackClick}
    >
      {/* Track top cap */}
      <div
        style={{
          width: SCROLLBAR_WIDTH,
          height: TRACK_CAP_HEIGHT,
          backgroundImage: "url(/scrollbar/track-top.png)",
          backgroundSize: "100% 100%",
        }}
      />

      {/* Track bar (repeating middle) */}
      <div
        style={{
          width: SCROLLBAR_WIDTH,
          height: containerHeight - TRACK_CAP_HEIGHT * 2,
          backgroundImage: "url(/scrollbar/track-bar.png)",
          backgroundRepeat: "repeat-y",
          backgroundSize: `${SCROLLBAR_WIDTH}px auto`,
        }}
      />

      {/* Track bottom cap */}
      <div
        style={{
          width: SCROLLBAR_WIDTH,
          height: TRACK_CAP_HEIGHT,
          backgroundImage: "url(/scrollbar/track-bottom.png)",
          backgroundSize: "100% 100%",
        }}
      />

      {/* Thumb */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: thumbState.top,
          width: SCROLLBAR_WIDTH,
          height: thumbState.height,
          display: "flex",
          flexDirection: "column",
        }}
        onMouseDown={handleThumbMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Thumb top cap */}
        <div
          style={{
            width: SCROLLBAR_WIDTH,
            height: THUMB_CAP_HEIGHT,
            backgroundImage: "url(/scrollbar/thumb-top.png)",
            backgroundSize: "100% 100%",
            flexShrink: 0,
          }}
        />
        {/* Thumb middle (stretches) */}
        <div
          style={{
            width: SCROLLBAR_WIDTH,
            flex: 1,
            backgroundImage: "url(/scrollbar/thumb-middle.png)",
            backgroundRepeat: "repeat-y",
            backgroundSize: `${SCROLLBAR_WIDTH}px auto`,
          }}
        />
        {/* Thumb bottom cap */}
        <div
          style={{
            width: SCROLLBAR_WIDTH,
            height: THUMB_CAP_HEIGHT,
            backgroundImage: "url(/scrollbar/thumb-bottom.png)",
            backgroundSize: "100% 100%",
            flexShrink: 0,
          }}
        />
      </div>
    </div>
  );
}
