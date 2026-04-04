import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  startTransition,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  AppConfig,
  FolderGroup,
  FileSearchResult,
  ThemeConfig,
} from "./types";
import { DEFAULT_THEME, resolveTheme } from "./types";
import {
  parseLine,
  renderSyntaxLine,
  mergeContinuationLines,
  Anonymizer,
} from "./logParser";
import Settings from "./Settings";
import CustomScrollbar from "./CustomScrollbar";
import { parseQuery, matchesQuery, buildHighlightRegex } from "./queryParser";
import { version as appVersion } from "../package.json";

// ─── Virtualized log pane ───

const SELECTION_BG = "rgba(137, 180, 250, 0.3)";

const LogPane = memo(function LogPane({
  lines,
  activeQuery,
  highlightLine,
  parentRef,
  theme,
}: {
  lines: string[];
  activeQuery: string;
  highlightLine: number | null;
  parentRef: React.RefObject<HTMLDivElement | null>;
  theme: ThemeConfig;
}) {
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 30,
  });

  useEffect(() => {
    if (highlightLine !== null) {
      virtualizer.scrollToIndex(highlightLine, { align: "center" });
    }
  }, [highlightLine, virtualizer]);

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
    // Find which line index is at this Y position
    const relY = clientY - rect.top + scrollEl.scrollTop;
    const LINE_HEIGHT = 20;
    const idx = Math.max(0, Math.min(lines.length - 1, Math.floor(relY / LINE_HEIGHT)));
    setSelEnd(idx);
  }, [lines.length, parentRef]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const scrollEl = parentRef.current;
      if (!scrollEl) return;

      const rect = scrollEl.getBoundingClientRect();
      const EDGE = 40; // px from edge to trigger auto-scroll
      const SPEED = 8; // px per tick

      if (e.clientY < rect.top + EDGE) {
        // Mouse above viewport — scroll up
        if (!autoScrollTimer.current) {
          autoScrollTimer.current = setInterval(() => {
            scrollEl.scrollTop -= SPEED;
            updateSelFromY(rect.top);
          }, 16);
        }
      } else if (e.clientY > rect.bottom - EDGE) {
        // Mouse below viewport — scroll down
        if (!autoScrollTimer.current) {
          autoScrollTimer.current = setInterval(() => {
            scrollEl.scrollTop += SPEED;
            updateSelFromY(rect.bottom);
          }, 16);
        }
      } else {
        stopAutoScroll();
      }

      // Update selection from mouse position
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

// ─── File list sidebar ───

const FileList = memo(function FileList({
  displayMode,
  folders,
  searchResults,
  selectedFile,
  selectedHitKey,
  collapsedFolders,
  isSearching,
  theme,
  onSelectFile,
  onSelectHit,
  onToggleFolder,
}: {
  displayMode: "browse" | "search";
  folders: FolderGroup[];
  searchResults: FileSearchResult[];
  selectedFile: string | null;
  selectedHitKey: string | null;
  collapsedFolders: Set<string>;
  isSearching: boolean;
  theme: ThemeConfig;
  onSelectFile: (path: string) => void;
  onSelectHit: (path: string, line: number) => void;
  onToggleFolder: (folder: string) => void;
}) {
  const searchResultsByFolder = useMemo(() => {
    const map = new Map<string, FileSearchResult[]>();
    if (displayMode === "search") {
      for (const r of searchResults) {
        const list = map.get(r.folder) || [];
        list.push(r);
        map.set(r.folder, list);
      }
    }
    return map;
  }, [displayMode, searchResults]);

  if (displayMode === "browse") {
    return (
      <>
        {folders.map((group) => (
          <div key={group.folder}>
            <button
              onClick={() => onToggleFolder(group.folder)}
              className="w-full text-left px-3 py-1.5 text-sm font-bold hover:opacity-80 flex items-center gap-1"
              style={{ color: theme.accent }}
            >
              <span className="text-xs">
                {collapsedFolders.has(group.folder) ? "▶" : "▼"}
              </span>
              {group.folder}
            </button>
            {!collapsedFolders.has(group.folder) &&
              group.files.map((f) => (
                <button
                  key={f.path}
                  onClick={() => onSelectFile(f.path)}
                  className="w-full text-left pl-7 pr-3 py-1 text-sm truncate transition-colors"
                  style={{
                    color: selectedFile === f.path ? theme.selectedText : theme.textMuted,
                    backgroundColor: selectedFile === f.path ? theme.selected : undefined,
                  }}
                >
                  {f.name}
                </button>
              ))}
          </div>
        ))}
      </>
    );
  }

  if (searchResults.length === 0) {
    return (
      <div className="px-3 py-4 text-sm text-center" style={{ color: theme.textDimmed }}>
        {isSearching ? "検索中..." : "一致するファイルがありません"}
      </div>
    );
  }

  return (
    <>
      {Array.from(searchResultsByFolder.entries()).map(([folder, results]) => (
        <div key={folder}>
          <button
            onClick={() => onToggleFolder(folder)}
            className="w-full text-left px-3 py-1.5 text-sm font-bold hover:opacity-80 flex items-center gap-1"
            style={{ color: theme.accent }}
          >
            <span className="text-xs">
              {collapsedFolders.has(folder) ? "▶" : "▼"}
            </span>
            {folder}
          </button>
          {!collapsedFolders.has(folder) &&
            results.map((r) => (
              <div key={r.path}>
                <button
                  onClick={() => onSelectFile(r.path)}
                  className="w-full text-left pl-7 pr-3 py-1 text-sm truncate transition-colors"
                  style={{
                    color: selectedFile === r.path ? theme.selectedText : theme.textMuted,
                    backgroundColor: selectedFile === r.path ? theme.selected : undefined,
                  }}
                >
                  {r.name}
                  <span className="ml-1 text-xs" style={{ color: theme.textDimmed }}>
                    ({r.hits.length})
                  </span>
                </button>
                {r.hits.slice(0, 20).map((hit) => {
                  const hitKey = `${r.path}:${hit.line_number}`;
                  const isSelected = selectedHitKey === hitKey;
                  return (
                    <button
                      key={hitKey}
                      onClick={() => onSelectHit(r.path, hit.line_number)}
                      className="w-full text-left pl-10 pr-3 py-0.5 text-xs truncate transition-colors hover:opacity-80"
                      style={{
                        color: isSelected ? theme.selectedText : theme.textDimmed,
                        backgroundColor: isSelected ? theme.selected : undefined,
                      }}
                      title={hit.line}
                    >
                      <span style={{ color: isSelected ? theme.selectedText : theme.accent }} className="mr-1">
                        L{hit.line_number + 1}
                      </span>
                      {hit.excerpt}
                    </button>
                  );
                })}
                {r.hits.length > 20 && (
                  <div className="pl-10 pr-3 py-0.5 text-xs" style={{ color: theme.textDimmed }}>
                    ...他 {r.hits.length - 20} 件
                  </div>
                )}
              </div>
            ))}
        </div>
      ))}
    </>
  );
});

// ─── Toggle switch ───

function Toggle({
  label,
  checked,
  onChange,
  theme,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  theme: ThemeConfig;
}) {
  return (
    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs whitespace-nowrap">
      <div
        className="relative w-8 h-4 rounded-full transition-colors"
        style={{ backgroundColor: checked ? theme.accent : theme.bgTertiary }}
        onClick={() => onChange(!checked)}
      >
        <div
          className="absolute top-0.5 w-3 h-3 rounded-full transition-transform"
          style={{
            backgroundColor: theme.bg,
            transform: checked ? "translateX(17px)" : "translateX(2px)",
          }}
        />
      </div>
      <span style={{ color: theme.textMuted }}>{label}</span>
    </label>
  );
}

// ─── Menu bar ───

function MenuBar({
  theme,
  onOpenFolder,
  onOpenSettings,
  onToggleSidebar,
  onShowAbout,
  onExit,
  sidebarVisible,
  mergeCont,
  onToggleMergeCont,
  anonymize,
  onToggleAnonymize,
  syncScroll,
  onToggleSyncScroll,
  inputRef,
  onInput,
  isSearching,
}: {
  theme: ThemeConfig;
  onOpenFolder: () => void;
  onOpenSettings: () => void;
  onToggleSidebar: () => void;
  onShowAbout: () => void;
  onExit: () => void;
  sidebarVisible: boolean;
  mergeCont: boolean;
  onToggleMergeCont: () => void;
  anonymize: boolean;
  onToggleAnonymize: () => void;
  syncScroll: boolean;
  onToggleSyncScroll: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onInput: () => void;
  isSearching: boolean;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindow = getCurrentWindow();

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [appWindow]);

  const close = () => setOpenMenu(null);

  const menus: {
    label: string;
    items: { label: string; onClick: () => void; shortcut?: string; separator?: boolean }[];
  }[] = [
    {
      label: "ファイル",
      items: [
        { label: "フォルダを開く", onClick: () => { close(); onOpenFolder(); }, shortcut: "Ctrl+O" },
        { label: "設定", onClick: () => { close(); onOpenSettings(); }, shortcut: "Ctrl+," },
        { label: "", onClick: () => {}, separator: true },
        { label: "終了", onClick: () => { close(); onExit(); } },
      ],
    },
    {
      label: "表示",
      items: [
        { label: `${sidebarVisible ? "✓ " : "　"}サイドバー`, onClick: () => { close(); onToggleSidebar(); }, shortcut: "Ctrl+B" },
        { label: "", onClick: () => {}, separator: true },
        { label: `${mergeCont ? "✓ " : "　"}行結合`, onClick: () => { close(); onToggleMergeCont(); } },
        { label: `${anonymize ? "✓ " : "　"}匿名(不完全)`, onClick: () => { close(); onToggleAnonymize(); } },
        { label: `${syncScroll ? "✓ " : "　"}スクロール同期`, onClick: () => { close(); onToggleSyncScroll(); } },
      ],
    },
    {
      label: "ヘルプ",
      items: [
        { label: "About", onClick: () => { close(); onShowAbout(); } },
      ],
    },
  ];

  return (
    <div
      className="flex items-center shrink-0 select-none text-xs"
      style={{
        backgroundColor: theme.bgTitlebar,
        borderBottom: `1px solid ${theme.border}`,
        height: "32px",
      }}
    >
      {/* Menus (z-index above backdrop) */}
      {menus.map((menu) => (
        <div key={menu.label} className="relative z-50">
          <button
            className="px-3 h-8 hover:opacity-80 transition-colors"
            style={{
              color: theme.textMuted,
              backgroundColor: openMenu === menu.label ? theme.bgTertiary : undefined,
            }}
            onClick={() => setOpenMenu(openMenu === menu.label ? null : menu.label)}
            onMouseEnter={() => { if (openMenu) setOpenMenu(menu.label); }}
          >
            {menu.label}
          </button>
          {openMenu === menu.label && (
            <div
              className="absolute left-0 top-8 z-50 py-1 rounded shadow-xl min-w-[200px]"
              style={{ backgroundColor: theme.bgSecondary, border: `1px solid ${theme.border}` }}
            >
              {menu.items.map((item, i) =>
                item.separator ? (
                  <div key={i} className="my-1" style={{ borderTop: `1px solid ${theme.border}` }} />
                ) : (
                  <button
                    key={i}
                    className="w-full text-left px-4 py-1.5 text-xs flex justify-between items-center hover:opacity-80 transition-colors"
                    style={{ color: theme.text }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.bgTertiary)}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                    onClick={item.onClick}
                  >
                    <span>{item.label}</span>
                    {item.shortcut && (
                      <span style={{ color: theme.textDimmed }} className="ml-8">{item.shortcut}</span>
                    )}
                  </button>
                )
              )}
            </div>
          )}
        </div>
      ))}
      {/* Backdrop to close menus (below menu buttons) */}
      {openMenu && <div className="fixed inset-0 z-40" onClick={close} />}

      {/* Drag region + search box */}
      <div
        className="flex-1 h-full flex items-center justify-center px-4"
        onMouseDown={(e) => {
          // Only start dragging if clicking the bar itself, not the input
          if (e.target === e.currentTarget) appWindow.startDragging();
        }}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) appWindow.toggleMaximize();
        }}
      >
        <div className="relative w-full max-w-xl">
          <input
            ref={inputRef}
            type="text"
            onInput={onInput}
            placeholder="検索ワードを入力..."
            className="w-full px-3 py-1 rounded-md transition-colors focus:outline-none text-xs"
            style={{
              backgroundColor: theme.bgTertiary,
              border: `1px solid ${theme.border}`,
              color: theme.text,
              height: "24px",
            }}
          />
          {isSearching && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: theme.textDimmed }}>
              検索中...
            </div>
          )}
        </div>
      </div>

      {/* Window controls */}
      <div className="flex items-center h-full">
        <button
          className="w-12 h-full flex items-center justify-center hover:opacity-70 transition-colors"
          style={{ color: theme.textMuted }}
          onClick={() => appWindow.minimize()}
          title="最小化"
        >
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button
          className="w-12 h-full flex items-center justify-center hover:opacity-70 transition-colors"
          style={{ color: theme.textMuted }}
          onClick={() => appWindow.toggleMaximize()}
          title={isMaximized ? "元に戻す" : "最大化"}
        >
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="2" y="0" width="8" height="8" rx="1" />
              <rect x="0" y="2" width="8" height="8" rx="1" fill={theme.bgTitlebar} />
              <rect x="0" y="2" width="8" height="8" rx="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
              <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
            </svg>
          )}
        </button>
        <button
          className="h-full flex items-center justify-center transition-opacity hover:opacity-70 px-2"
          onClick={() => appWindow.close()}
          title="閉じる"
        >
          <img src="/close-btn.png" alt="閉じる" width={16} height={16} draggable={false} />
        </button>
      </div>
    </div>
  );
}

// ─── Status bar ───

function StatusBar({
  theme,
  directory,
  selectedFile,
  lines,
  searchResults,
  activeQuery,
}: {
  theme: ThemeConfig;
  directory: string | null;
  selectedFile: string | null;
  lines: string[];
  searchResults: FileSearchResult[];
  activeQuery: string;
}) {
  const totalHits = searchResults.reduce((sum, r) => sum + r.hits.length, 0);

  return (
    <div
      className="flex items-center justify-between px-3 shrink-0 text-xs select-none"
      style={{
        backgroundColor: theme.bgStatusbar,
        borderTop: `1px solid ${theme.border}`,
        color: theme.textDimmed,
        height: "24px",
      }}
    >
      <div className="flex items-center gap-4">
        {directory && (
          <span title={directory} className="truncate max-w-[300px]">
            📂 {directory.split("/").pop()}
          </span>
        )}
        {selectedFile && (
          <span>
            📄 {selectedFile.split("/").pop()} ({lines.length} 行)
          </span>
        )}
      </div>
      <div className="flex items-center gap-4">
        {activeQuery && (
          <span>
            検索: "{activeQuery}" — {searchResults.length} ファイル / {totalHits} 件
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Main App ───

function App() {
  const [directory, setDirectory] = useState<string | null>(null);
  const [folders, setFolders] = useState<FolderGroup[]>([]);
  const [activeQuery, setActiveQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FileSearchResult[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [highlightLine, setHighlightLine] = useState<number | null>(null);
  const [highlightLineFormatted, setHighlightLineFormatted] = useState<number | null>(null);
  const [selectedHitKey, setSelectedHitKey] = useState<string | null>(null);
  const [themeOverrides, setThemeOverrides] = useState<Partial<ThemeConfig>>({});
  const [mergeCont, setMergeCont] = useState(true);
  const [anonymize, setAnonymize] = useState(false);
  const [anonymizeLoading, setAnonymizeLoading] = useState(false);
  const [allNames, setAllNames] = useState<string[]>([]);
  const [syncScroll, setSyncScroll] = useState(true);
  const [filterText, setFilterText] = useState("");
  const [configLoaded, setConfigLoaded] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);

  const rawScrollRef = useRef<HTMLDivElement>(null);
  const formattedScrollRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const directoryRef = useRef<string | null>(null);
  const isSyncing = useRef(false);
  const selectHitRef = useRef<((path: string, line: number) => void) | null>(null);

  const theme = useMemo(() => resolveTheme(themeOverrides), [themeOverrides]);

  // Line mapping
  const mergedData = useMemo(() => {
    if (!mergeCont) return null;
    return mergeContinuationLines(lines);
  }, [lines, mergeCont]);

  const formattedLines = useMemo(() => {
    let result = [...lines];
    if (mergedData) result = mergedData.map((m) => m.merged);
    if (anonymize && allNames.length > 0) {
      const anon = new Anonymizer(allNames);
      result = result.map((l) => anon.anonymizeLine(l));
    }
    return result;
  }, [lines, mergedData, anonymize, allNames]);

  // Filtered lines (when filter is active, show only matching lines)
  const filterParsed = useMemo(() => parseQuery(filterText), [filterText]);

  const filteredRawLines = useMemo(() => {
    if (filterParsed.isEmpty) return lines;
    return lines.filter((l) => matchesQuery(l.toLowerCase(), filterParsed));
  }, [lines, filterParsed]);

  const filteredFormattedLines = useMemo(() => {
    if (filterParsed.isEmpty) return formattedLines;
    return formattedLines.filter((l) => matchesQuery(l.toLowerCase(), filterParsed));
  }, [formattedLines, filterParsed]);

  // Scroll sync
  useEffect(() => {
    if (!syncScroll) return;
    const rawEl = rawScrollRef.current;
    const fmtEl = formattedScrollRef.current;
    if (!rawEl || !fmtEl) return;

    const syncFrom = (source: HTMLDivElement, target: HTMLDivElement) => () => {
      if (isSyncing.current) return;
      isSyncing.current = true;
      const maxS = source.scrollHeight - source.clientHeight;
      const maxT = target.scrollHeight - target.clientHeight;
      if (maxS > 0 && maxT > 0) {
        target.scrollTop = (source.scrollTop / maxS) * maxT;
      }
      requestAnimationFrame(() => { isSyncing.current = false; });
    };

    const onRawScroll = syncFrom(rawEl, fmtEl);
    const onFmtScroll = syncFrom(fmtEl, rawEl);

    rawEl.addEventListener("scroll", onRawScroll);
    fmtEl.addEventListener("scroll", onFmtScroll);
    return () => {
      rawEl.removeEventListener("scroll", onRawScroll);
      fmtEl.removeEventListener("scroll", onFmtScroll);
    };
  }, [syncScroll, selectedFile]);

  // Load config
  useEffect(() => {
    (async () => {
      const config: AppConfig = await invoke("load_config");
      if (config.theme && typeof config.theme === "object") {
        setThemeOverrides(config.theme as Partial<ThemeConfig>);
      }
      setConfigLoaded(true);
      if (config.last_directory) {
        loadDirectory(config.last_directory);
      } else {
        closeSplashAndShowMain();
      }
    })();
  }, []);

  // Flat list of all search hits for arrow key navigation
  const allHits = useMemo(() => {
    const hits: { path: string; lineNumber: number }[] = [];
    for (const r of searchResults) {
      for (const h of r.hits) {
        hits.push({ path: r.path, lineNumber: h.line_number });
      }
    }
    return hits;
  }, [searchResults]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "o") { e.preventDefault(); handlePickFolder(); }
      if (e.ctrlKey && e.key === ",") { e.preventDefault(); setShowSettings(true); }
      if (e.ctrlKey && e.key === "b") { e.preventDefault(); setSidebarVisible((v) => !v); }

      // Navigate search hits: ↑↓ and Enter/Shift+Enter
      if (allHits.length > 0) {
        const isSearchBox = e.target === inputRef.current;
        const isArrow = e.key === "ArrowUp" || e.key === "ArrowDown";
        const isEnter = e.key === "Enter";

        // ↑↓: always work from search box, elsewhere only if not in an input
        const arrowOk = isArrow && (isSearchBox || !(e.target as HTMLElement).matches("input, textarea"));
        // Enter: only from search box
        const enterOk = isEnter && isSearchBox;

        if (arrowOk || enterOk) {
          e.preventDefault();
          const currentIdx = selectedHitKey
            ? allHits.findIndex((h) => `${h.path}:${h.lineNumber}` === selectedHitKey)
            : -1;

          const goBack = e.key === "ArrowUp" || (isEnter && e.shiftKey);
          let nextIdx: number;
          if (goBack) {
            nextIdx = currentIdx > 0 ? currentIdx - 1 : allHits.length - 1;
          } else {
            nextIdx = currentIdx < allHits.length - 1 ? currentIdx + 1 : 0;
          }

          const hit = allHits[nextIdx];
          selectHitRef.current?.(hit.path, hit.lineNumber);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [allHits, selectedHitKey]);

  const closeSplashAndShowMain = () => {
    getCurrentWindow().show();
    setTimeout(async () => {
      try {
        const splash = await WebviewWindow.getByLabel("splash");
        if (splash) await splash.close();
      } catch (_) {}
    }, 1000);
  };

  const loadDirectory = async (dir: string) => {
    try {
      const groups: FolderGroup[] = await invoke("scan_directory", { dir });
      setDirectory(dir);
      directoryRef.current = dir;
      setFolders(groups);
      setAllNames([]); // Reset; will be fetched when anonymize is toggled on
      const config: AppConfig = await invoke("load_config");
      await invoke("save_config", { config: { ...config, last_directory: dir } });
    } catch (e) {
      console.error(e);
    }
    closeSplashAndShowMain();
  };

  const handlePickFolder = async () => {
    const selected = await open({ directory: true });
    if (selected) loadDirectory(selected as string);
  };

  const handleInput = useCallback(() => {
    const q = inputRef.current?.value ?? "";
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!q.trim() || !directoryRef.current) {
      startTransition(() => { setSearchResults([]); setActiveQuery(""); setIsSearching(false); });
      return;
    }
    setIsSearching(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const results: FileSearchResult[] = await invoke("search_files", { dir: directoryRef.current, query: q.trim() });
        startTransition(() => { setSearchResults(results); setActiveQuery(q.trim()); setIsSearching(false); });
        // Auto-select first hit
        if (results.length > 0 && results[0].hits.length > 0) {
          const first = results[0];
          setTimeout(() => selectHitRef.current?.(first.path, first.hits[0].line_number), 50);
        }
      } catch (e) { console.error(e); setIsSearching(false); }
    }, 300);
  }, []);

  const handleSelectFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    setHighlightLine(null);
    setHighlightLineFormatted(null);
    try {
      const content: string = await invoke("read_file", { path });
      setLines(content.split("\n"));
    } catch (e) { console.error(e); setLines(["Failed to read file."]); }
  }, []);

  const computeFormattedLineIndex = useCallback(
    (rawLineNumber: number, sourceLines: string[]) => {
      if (!mergeCont) return rawLineNumber;
      const merged = mergeContinuationLines(sourceLines);
      const idx = merged.findIndex((m) => m.originalIndices.includes(rawLineNumber));
      return idx >= 0 ? idx : rawLineNumber;
    },
    [mergeCont]
  );

  const handleSelectHit = useCallback(
    async (path: string, lineNumber: number) => {
      setSelectedHitKey(`${path}:${lineNumber}`);
      if (selectedFile !== path) {
        setSelectedFile(path);
        setHighlightLine(null);
        setHighlightLineFormatted(null);
        try {
          const content: string = await invoke("read_file", { path });
          const newLines = content.split("\n");
          setLines(newLines);
          setTimeout(() => {
            setHighlightLine(lineNumber);
            setHighlightLineFormatted(computeFormattedLineIndex(lineNumber, newLines));
          }, 100);
        } catch (e) { console.error(e); }
      } else {
        setHighlightLine(lineNumber);
        setHighlightLineFormatted(computeFormattedLineIndex(lineNumber, lines));
      }
    },
    [selectedFile, lines, computeFormattedLineIndex]
  );

  // Keep ref in sync for keyboard navigation
  useEffect(() => { selectHitRef.current = handleSelectHit; }, [handleSelectHit]);

  const toggleFolder = useCallback((folder: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  }, []);

  const handleToggleAnonymize = useCallback(async (on: boolean) => {
    if (on && allNames.length === 0) {
      setAnonymizeLoading(true);
      const names: string[] = await invoke("collect_all_names");
      setAllNames(names);
      setAnonymize(true);
      setAnonymizeLoading(false);
    } else {
      setAnonymize(on);
    }
  }, [allNames]);

  const handleSettingsApply = async (dir: string | null, overrides: Partial<ThemeConfig>) => {
    setThemeOverrides(overrides);
    if (dir && dir !== directory) {
      await loadDirectory(dir);
    }
    setShowSettings(false);
  };

  const displayMode = activeQuery ? "search" : "browse";

  return (
    <div
      className="h-full flex flex-col relative"
      style={{
        backgroundColor: theme.bg,
        color: theme.text,
        padding: "8px",
      }}
    >
      {/* Window border overlay */}
      <div
        className="absolute inset-0 pointer-events-none z-[100]"
        style={{
          borderImage: "url(/border.png) 10 stretch",
          borderWidth: "10px",
          borderStyle: "solid",
        }}
      />
      {/* Menu bar */}
      <MenuBar
        theme={theme}
        onOpenFolder={handlePickFolder}
        onOpenSettings={() => setShowSettings(true)}
        onShowAbout={() => setShowAbout(true)}
        onExit={() => getCurrentWindow().close()}
        onToggleSidebar={() => setSidebarVisible((v) => !v)}
        sidebarVisible={sidebarVisible}
        mergeCont={mergeCont}
        onToggleMergeCont={() => setMergeCont((v) => !v)}
        anonymize={anonymize}
        onToggleAnonymize={() => handleToggleAnonymize(!anonymize)}
        syncScroll={syncScroll}
        onToggleSyncScroll={() => setSyncScroll((v) => !v)}
        inputRef={inputRef}
        onInput={handleInput}
        isSearching={isSearching}
      />

      {/* No directory */}
      {!directory && (
        <div className="flex-1 flex items-center justify-center" style={{ color: theme.textDimmed }}>
          {configLoaded ? (
            <div className="text-center">
              <p className="text-2xl mb-4">SG grep</p>
              <p className="mb-4">チャットログのフォルダを選択してください</p>
              <p className="text-xs mb-2">ファイル &gt; フォルダを開く (Ctrl+O)</p>
              <button
                onClick={handlePickFolder}
                className="px-6 py-3 rounded-lg transition-colors font-bold hover:opacity-90"
                style={{ backgroundColor: theme.accent, color: "#ffffff", textShadow: "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000" }}
              >
                フォルダを開く
              </button>
            </div>
          ) : (
            <p className="text-sm">読み込み中...</p>
          )}
        </div>
      )}

      {/* 3-column layout */}
      {directory && (
        <div className="flex-1 flex min-h-0">
          {/* Left: File list */}
          {sidebarVisible && (
            <div
              className="w-72 shrink-0 overflow-y-auto"
              style={{ backgroundColor: theme.bgSidebar, borderRight: `1px solid ${theme.border}` }}
            >
              <FileList
                displayMode={displayMode as "browse" | "search"}
                folders={folders}
                searchResults={searchResults}
                selectedFile={selectedFile}
                selectedHitKey={selectedHitKey}
                collapsedFolders={collapsedFolders}
                isSearching={isSearching}
                theme={theme}
                onSelectFile={handleSelectFile}
                onSelectHit={handleSelectHit}
                onToggleFolder={toggleFolder}
              />
            </div>
          )}

          {/* Log area */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Header bar */}
            <div
              className="px-3 py-1 text-xs shrink-0 flex items-center justify-between gap-3"
              style={{ color: theme.textDimmed, backgroundColor: theme.bgPaneHeader, borderBottom: `1px solid ${theme.border}` }}
            >
              <div className="flex items-center gap-2">
                <span style={{ color: theme.textDimmed }}>絞り込み</span>
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="フィルター..."
                  className="px-2 py-0.5 rounded text-xs focus:outline-none"
                  style={{
                    backgroundColor: theme.bgTertiary,
                    border: `1px solid ${theme.border}`,
                    color: theme.text,
                    width: "180px",
                    height: "20px",
                  }}
                />
                {filterText && (
                  <button
                    onClick={() => setFilterText("")}
                    className="hover:opacity-70"
                    style={{ color: theme.textDimmed }}
                    title="フィルタークリア"
                  >
                    ✕
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Toggle label="行結合" checked={mergeCont} onChange={setMergeCont} theme={theme} />
                <Toggle label="匿名(不完全)" checked={anonymize || anonymizeLoading} onChange={handleToggleAnonymize} theme={theme} />
                {anonymizeLoading && <span className="spinner" style={{ color: theme.accent }} />}
                <Toggle label="スクロール同期" checked={syncScroll} onChange={setSyncScroll} theme={theme} />
              </div>
            </div>

            {/* Two panes side by side */}
            <div className="flex-1 flex min-h-0">
              {/* Raw log */}
              <div className="flex-1 min-w-0 relative" style={{ borderRight: `1px solid ${theme.border}` }}>
                {/* Hanging tab label */}
                <div className="absolute right-4 z-10 pointer-events-none" style={{ top: "-1px" }}>
                  <div
                    className="px-3 pt-[2px] pb-[3px] text-xs"
                    style={{
                      color: theme.textDimmed,
                      backgroundColor: theme.bgPaneHeader,
                      borderLeft: `1px solid ${theme.border}`,
                      borderRight: `1px solid ${theme.border}`,
                      borderBottom: `1px solid ${theme.border}`,
                      borderRadius: "0 0 6px 6px",
                    }}
                  >
                    原文
                  </div>
                </div>
                <div ref={rawScrollRef} className="log-pane absolute inset-0 overflow-auto p-2 pr-[18px] font-mono text-sm">
                  {selectedFile ? (
                    <LogPane
                      lines={filteredRawLines}
                      activeQuery={filterText || activeQuery}
                      highlightLine={filterText ? null : highlightLine}
                      parentRef={rawScrollRef}
                      theme={theme}
                    />
                  ) : (
                    <div className="text-center mt-8" style={{ color: theme.textDimmed }}>
                      ファイルを選択してください
                    </div>
                  )}
                </div>
                <CustomScrollbar scrollRef={rawScrollRef} />
              </div>

              {/* Formatted log */}
              <div className="flex-1 min-w-0 relative">
                {/* Hanging tab label */}
                <div className="absolute right-4 z-10 pointer-events-none" style={{ top: "-1px" }}>
                  <div
                    className="px-3 pt-[2px] pb-[3px] text-xs"
                    style={{
                      color: theme.textDimmed,
                      backgroundColor: theme.bgPaneHeader,
                      borderLeft: `1px solid ${theme.border}`,
                      borderRight: `1px solid ${theme.border}`,
                      borderBottom: `1px solid ${theme.border}`,
                      borderRadius: "0 0 6px 6px",
                    }}
                  >
                    整形済み
                  </div>
                </div>
                <div ref={formattedScrollRef} className="log-pane absolute inset-0 overflow-auto p-2 pr-[18px] font-mono text-sm">
                  {selectedFile ? (
                    <LogPane
                      lines={filteredFormattedLines}
                      activeQuery={filterText || activeQuery}
                      highlightLine={filterText ? null : highlightLineFormatted}
                      parentRef={formattedScrollRef}
                      theme={theme}
                    />
                  ) : (
                    <div className="text-center mt-8" style={{ color: theme.textDimmed }}>
                      ファイルを選択してください
                    </div>
                  )}
                </div>
                <CustomScrollbar scrollRef={formattedScrollRef} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status bar */}
      <StatusBar
        theme={theme}
        directory={directory}
        selectedFile={selectedFile}
        lines={lines}
        searchResults={searchResults}
        activeQuery={activeQuery}
      />

      {/* Settings modal */}
      {showSettings && (
        <Settings
          theme={theme}
          currentDir={directory}
          onClose={() => setShowSettings(false)}
          onApply={handleSettingsApply}
        />
      )}

      {/* About dialog */}
      {showAbout && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowAbout(false); }}
        >
          <div
            className="rounded-lg shadow-2xl w-[420px] flex flex-col"
            style={{ backgroundColor: theme.bgSecondary, color: theme.text, border: `1px solid ${theme.border}` }}
          >
            <div
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: `1px solid ${theme.border}` }}
            >
              <span className="font-bold text-sm">About</span>
              <button
                onClick={() => setShowAbout(false)}
                className="text-lg hover:opacity-60 leading-none"
                style={{ color: theme.textDimmed }}
              >
                ×
              </button>
            </div>
            <div className="px-6 py-4 text-center">
              <img src="/splash.png" alt="SG grep" width={320} height={213} draggable={false} className="mx-auto mb-3" />
              <p className="text-lg font-bold mb-1">SG grep</p>
              <p className="text-xs mb-1" style={{ color: theme.textMuted }}>Version {appVersion}</p>
              <p className="text-xs mt-2" style={{ color: theme.textDimmed }}>STRUGARDEN チャットログビューア</p>
            </div>
            <div
              className="flex justify-center px-4 py-3"
              style={{ borderTop: `1px solid ${theme.border}` }}
            >
              <button
                onClick={() => setShowAbout(false)}
                className="px-6 py-1.5 text-sm rounded hover:opacity-90 font-bold"
                style={{ backgroundColor: theme.accent, color: "#ffffff", textShadow: "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000" }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
