import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  startTransition,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type {
  AppConfig,
  FolderGroup,
  FileSearchResult,
  ThemeConfig,
} from "./types";
import { resolveTheme } from "./types";
import { parseLine, mergeContinuationLines, Anonymizer } from "./logParser";
import { parseQuery, matchesQuery } from "./queryParser";
import { version as appVersion } from "../package.json";
import LogPane from "./LogPane";
import type { LogPaneHandle } from "./LogPane";
import FileList from "./FileList";
import MenuBar from "./MenuBar";
import StatusBar from "./StatusBar";
import Toggle from "./Toggle";
import Settings from "./Settings";
import CustomScrollbar from "./CustomScrollbar";
import Modal from "./Modal";
import PaneTabLabel from "./PaneTabLabel";

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
  const [prefixFilters, setPrefixFilters] = useState({
    party: true,
    guild: true,
    whisperFrom: true,
    whisperTo: true,
  });
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
  const rawLogPaneRef = useRef<LogPaneHandle>(null);
  const formattedLogPaneRef = useRef<LogPaneHandle>(null);

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

  const allPrefixesOn = prefixFilters.party && prefixFilters.guild && prefixFilters.whisperFrom && prefixFilters.whisperTo;

  const hiddenTypes = useMemo(() => {
    const set = new Set<string>();
    if (!prefixFilters.party) set.add("party");
    if (!prefixFilters.guild) set.add("guild");
    if (!prefixFilters.whisperFrom) set.add("whisper_from");
    if (!prefixFilters.whisperTo) set.add("whisper_to");
    return set;
  }, [prefixFilters]);

  const applyLineFilters = useCallback((lineList: string[]) => {
    let result = lineList;
    if (!allPrefixesOn) {
      result = result.filter((l) => !hiddenTypes.has(parseLine(l).type));
    }
    if (!filterParsed.isEmpty) {
      result = result.filter((l) => matchesQuery(l.toLowerCase(), filterParsed));
    }
    return result;
  }, [allPrefixesOn, hiddenTypes, filterParsed]);

  const filteredRawLines = useMemo(() => applyLineFilters(lines), [lines, applyLineFilters]);
  const filteredFormattedLines = useMemo(() => applyLineFilters(formattedLines), [formattedLines, applyLineFilters]);

  // Sync with external system: DOM scroll events for dual-pane scroll synchronization
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

  // Sync with external system: Tauri IPC — load persisted config from disk on mount
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Ref holding latest handler values — updated during render, no useEffect needed.
  // Initialized with null!, assigned after handlePickFolder/handleSelectHit are defined below.
  const keyboardStateRef = useRef<{
    allHits: typeof allHits;
    selectedHitKey: string | null;
    handlePickFolder: () => void;
    handleSelectHit: (path: string, lineNumber: number) => void;
  }>(null!);

  // Sync with external system: window keydown events for global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { allHits, selectedHitKey, handlePickFolder, handleSelectHit } = keyboardStateRef.current;

      if (e.ctrlKey && e.key === "o") { e.preventDefault(); handlePickFolder(); }
      if (e.ctrlKey && e.key === ",") { e.preventDefault(); setShowSettings(true); }
      if (e.ctrlKey && e.key === "b") { e.preventDefault(); setSidebarVisible((v) => !v); }

      // Navigate search hits: ↑↓ and Enter/Shift+Enter
      if (allHits.length > 0) {
        const isSearchBox = e.target === inputRef.current;
        const isArrow = e.key === "ArrowUp" || e.key === "ArrowDown";
        const isEnter = e.key === "Enter";

        const arrowOk = isArrow && (isSearchBox || !(e.target as HTMLElement).matches("input, textarea"));
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
          handleSelectHit(hit.path, hit.lineNumber);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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
        const results: FileSearchResult[] = await invoke("search_files", { query: q.trim() });
        startTransition(() => { setSearchResults(results); setActiveQuery(q.trim()); setIsSearching(false); });
        // Auto-select first hit
        if (results.length > 0 && results[0].hits.length > 0) {
          const first = results[0];
          setTimeout(() => keyboardStateRef.current.handleSelectHit(first.path, first.hits[0].line_number), 50);
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

  const findMergedIndex = (rawLineNumber: number, merged: ReturnType<typeof mergeContinuationLines>) => {
    const idx = merged.findIndex((m) => m.originalIndices.includes(rawLineNumber));
    return idx >= 0 ? idx : rawLineNumber;
  };

  const computeFormattedLineIndex = useCallback(
    (rawLineNumber: number) => {
      if (!mergeCont || !mergedData) return rawLineNumber;
      return findMergedIndex(rawLineNumber, mergedData);
    },
    [mergeCont, mergedData]
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
          // Wait for virtualizer to render new data, then scroll + highlight
          setTimeout(() => {
            const fmtIdx = mergeCont
              ? findMergedIndex(lineNumber, mergeContinuationLines(newLines))
              : lineNumber;
            setHighlightLine(lineNumber);
            setHighlightLineFormatted(fmtIdx);
            rawLogPaneRef.current?.scrollToLine(lineNumber);
            formattedLogPaneRef.current?.scrollToLine(fmtIdx);
          }, 100);
        } catch (e) { console.error(e); }
      } else {
        const fmtIdx = computeFormattedLineIndex(lineNumber);
        setHighlightLine(lineNumber);
        setHighlightLineFormatted(fmtIdx);
        rawLogPaneRef.current?.scrollToLine(lineNumber);
        formattedLogPaneRef.current?.scrollToLine(fmtIdx);
      }
    },
    [selectedFile, lines, mergeCont, computeFormattedLineIndex]
  );

  // Keep keyboard ref in sync with latest handlers (render-phase assignment, not an effect)
  keyboardStateRef.current = { allHits, selectedHitKey, handlePickFolder, handleSelectHit };

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
        hasResults={searchResults.length > 0}
      />

      {/* No directory */}
      {!directory && (
        <div className="flex-1 flex items-center justify-center" style={{ color: theme.textDimmed }}>
          {configLoaded ? (
            <div className="text-center">
              <p className="text-2xl mb-4">SG GREP!</p>
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
                <span className="mx-1" style={{ color: theme.border }}>|</span>
                <Toggle label="PT" checked={prefixFilters.party} onChange={(v) => setPrefixFilters((p) => ({ ...p, party: v }))} theme={theme} />
                <Toggle label="GL" checked={prefixFilters.guild} onChange={(v) => setPrefixFilters((p) => ({ ...p, guild: v }))} theme={theme} />
                <Toggle label="FROM" checked={prefixFilters.whisperFrom} onChange={(v) => setPrefixFilters((p) => ({ ...p, whisperFrom: v }))} theme={theme} />
                <Toggle label="TO" checked={prefixFilters.whisperTo} onChange={(v) => setPrefixFilters((p) => ({ ...p, whisperTo: v }))} theme={theme} />
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
                <PaneTabLabel label="原文" theme={theme} />
                <div ref={rawScrollRef} className="log-pane absolute inset-0 overflow-auto p-2 pr-[18px] font-mono text-sm">
                  {selectedFile ? (
                    <LogPane
                      ref={rawLogPaneRef}
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
                <PaneTabLabel label="整形済み" theme={theme} />
                <div ref={formattedScrollRef} className="log-pane absolute inset-0 overflow-auto p-2 pr-[18px] font-mono text-sm">
                  {selectedFile ? (
                    <LogPane
                      ref={formattedLogPaneRef}
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
        <Modal
          theme={theme}
          title="About"
          onClose={() => setShowAbout(false)}
          footer={
            <button
              onClick={() => setShowAbout(false)}
              className="px-6 py-1.5 text-sm rounded hover:opacity-90 font-bold"
              style={{ backgroundColor: theme.accent, color: "#ffffff", textShadow: "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000" }}
            >
              OK
            </button>
          }
        >
          <div className="px-6 py-4 text-center">
            <img src="/splash.png" alt="SG GREP!" width={320} height={213} draggable={false} className="mx-auto mb-3" />
            <p className="text-lg font-bold mb-1">SG GREP!</p>
            <p className="text-xs mb-1" style={{ color: theme.textMuted }}>Version {appVersion}</p>
            <p className="text-xs mt-2" style={{ color: theme.textDimmed }}>STRUGARDEN チャットログビューア</p>
          </div>
        </Modal>
      )}

    </div>
  );
}

export default App;
