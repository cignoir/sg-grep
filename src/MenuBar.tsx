import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ThemeConfig } from "./types";

export default function MenuBar({
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
  hasResults,
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
  hasResults: boolean;
}) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const appWindowRef = useRef(getCurrentWindow());

  // Sync with external system: Tauri window resize events to track maximized state
  useEffect(() => {
    const appWindow = appWindowRef.current;
    appWindow.isMaximized().then(setIsMaximized);
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

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
          if (e.target === e.currentTarget) appWindowRef.current.startDragging();
        }}
        onDoubleClick={(e) => {
          if (e.target === e.currentTarget) appWindowRef.current.toggleMaximize();
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
          {isSearching ? (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: theme.textDimmed }}>
              検索中...
            </div>
          ) : hasResults ? (
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: theme.textDimmed }}>
              Enter/↑↓ で移動
            </div>
          ) : null}
        </div>
      </div>

      {/* Window controls */}
      <div className="flex items-center h-full">
        <button
          className="w-12 h-full flex items-center justify-center hover:opacity-70 transition-colors"
          style={{ color: theme.textMuted }}
          onClick={() => appWindowRef.current.minimize()}
          title="最小化"
        >
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button
          className="w-12 h-full flex items-center justify-center hover:opacity-70 transition-colors"
          style={{ color: theme.textMuted }}
          onClick={() => appWindowRef.current.toggleMaximize()}
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
          onClick={() => appWindowRef.current.close()}
          title="閉じる"
        >
          <img src="/close-btn.png" alt="閉じる" width={16} height={16} draggable={false} />
        </button>
      </div>
    </div>
  );
}
