import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppConfig, ThemeConfig } from "./types";
import { DEFAULT_THEME } from "./types";

// Editable theme keys grouped by category
const THEME_GROUPS: { label: string; keys: { key: keyof ThemeConfig; label: string }[] }[] = [
  {
    label: "UI",
    keys: [
      { key: "bg", label: "背景" },
      { key: "bgSecondary", label: "背景(サブ)" },
      { key: "bgTertiary", label: "背景(ボタン等)" },
      { key: "bgTitlebar", label: "タイトルバー" },
      { key: "bgSidebar", label: "サイドバー" },
      { key: "bgPaneHeader", label: "原文/整形済みヘッダー" },
      { key: "bgStatusbar", label: "ステータスバー" },
      { key: "border", label: "枠線" },
      { key: "text", label: "テキスト" },
      { key: "textMuted", label: "テキスト(やや薄)" },
      { key: "textDimmed", label: "テキスト(薄)" },
      { key: "accent", label: "アクセント" },
      { key: "selected", label: "選択背景" },
      { key: "selectedText", label: "選択テキスト" },
      { key: "highlightBg", label: "ハイライト背景" },
      { key: "searchMark", label: "検索マーク背景" },
      { key: "searchMarkText", label: "検索マーク文字" },
    ],
  },
  {
    label: "シンタックス",
    keys: [
      { key: "synTimestamp", label: "タイムスタンプ" },
      { key: "synCharName", label: "キャラ名" },
      { key: "synBody", label: "本文" },
      { key: "synNumber", label: "数値" },
      { key: "synSystem", label: "システム" },
      { key: "synWhisperFrom", label: "[FROM]" },
      { key: "synWhisperTo", label: "[TO]" },
      { key: "synParty", label: "[PT]" },
      { key: "synGuild", label: "[GL]" },
      { key: "synHeader", label: "ヘッダー" },
    ],
  },
  {
    label: "フォント縁取り",
    keys: [
      { key: "outlineColor", label: "縁取り色" },
    ],
  },
];

export default function Settings({
  theme,
  currentDir,
  onClose,
  onApply,
}: {
  theme: ThemeConfig;
  currentDir: string | null;
  onClose: () => void;
  onApply: (dir: string | null, themeOverrides: Partial<ThemeConfig>) => void;
}) {
  const [dir, setDir] = useState(currentDir || "");
  const [overrides, setOverrides] = useState<Record<string, string | number>>({});
  const [outlineWidth, setOutlineWidth] = useState(theme.outlineWidth);

  // Initialize overrides from current non-default values
  useEffect(() => {
    const o: Record<string, string | number> = {};
    for (const group of THEME_GROUPS) {
      for (const { key } of group.keys) {
        const current = theme[key];
        const def = DEFAULT_THEME[key];
        if (current !== def) {
          o[key] = current as string;
        }
      }
    }
    if (theme.outlineWidth !== DEFAULT_THEME.outlineWidth) {
      o["outlineWidth"] = theme.outlineWidth;
    }
    setOverrides(o);
    setOutlineWidth(theme.outlineWidth);
  }, [theme]);

  const handlePickDir = async () => {
    const selected = await open({ directory: true });
    if (selected) setDir(selected as string);
  };

  const handleColorChange = (key: string, value: string) => {
    if (value === ((DEFAULT_THEME as unknown) as Record<string, unknown>)[key]) {
      const next = { ...overrides };
      delete next[key];
      setOverrides(next);
    } else {
      setOverrides({ ...overrides, [key]: value });
    }
  };

  const handleSave = async () => {
    const themeObj: Partial<ThemeConfig> = {};
    for (const [k, v] of Object.entries(overrides)) {
      (themeObj as Record<string, unknown>)[k] = v;
    }
    if (outlineWidth !== DEFAULT_THEME.outlineWidth) {
      themeObj.outlineWidth = outlineWidth;
    }

    const config: AppConfig = await invoke("load_config");
    await invoke("save_config", {
      config: { ...config, last_directory: dir || null, theme: themeObj },
    });
    onApply(dir || null, themeObj);
  };

  const handleReset = () => {
    setOverrides({});
    setOutlineWidth(DEFAULT_THEME.outlineWidth);
  };

  const getColor = (key: string) =>
    (overrides[key] as string) ?? ((DEFAULT_THEME as unknown) as Record<string, unknown>)[key] as string ?? "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg shadow-2xl w-[600px] max-h-[80vh] flex flex-col"
        style={{ backgroundColor: theme.bgSecondary, color: theme.text, border: `1px solid ${theme.border}` }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: `1px solid ${theme.border}` }}
        >
          <span className="font-bold text-sm">設定</span>
          <button onClick={onClose} className="text-lg hover:opacity-60 leading-none" style={{ color: theme.textDimmed }}>×</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {/* Log folder */}
          <div>
            <label className="text-xs font-bold block mb-1" style={{ color: theme.textMuted }}>ログフォルダ</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={dir}
                onChange={(e) => setDir(e.target.value)}
                className="flex-1 px-3 py-1.5 text-sm rounded focus:outline-none"
                style={{ backgroundColor: theme.bgTertiary, border: `1px solid ${theme.border}`, color: theme.text }}
                placeholder="フォルダパスを入力..."
              />
              <button
                onClick={handlePickDir}
                className="px-3 py-1.5 text-sm rounded hover:opacity-80"
                style={{ backgroundColor: theme.bgTertiary, color: theme.text }}
              >
                参照
              </button>
            </div>
          </div>

          {/* Theme colors */}
          {THEME_GROUPS.map((group) => (
            <div key={group.label}>
              <label className="text-xs font-bold block mb-2" style={{ color: theme.textMuted }}>{group.label}</label>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                {group.keys.map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-2">
                    <input
                      type="color"
                      value={getColor(key) || "#000000"}
                      onChange={(e) => handleColorChange(key, e.target.value)}
                      className="w-6 h-6 rounded cursor-pointer border-0 p-0"
                      style={{ backgroundColor: "transparent" }}
                    />
                    <span className="text-xs flex-1" style={{ color: theme.textMuted }}>{label}</span>
                    <input
                      type="text"
                      value={getColor(key)}
                      onChange={(e) => handleColorChange(key, e.target.value)}
                      className="w-24 px-2 py-0.5 text-xs rounded font-mono focus:outline-none"
                      style={{ backgroundColor: theme.bgTertiary, border: `1px solid ${theme.border}`, color: theme.text }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Outline width */}
          <div>
            <label className="text-xs font-bold block mb-1" style={{ color: theme.textMuted }}>縁取り太さ (px)</label>
            <input
              type="number"
              min={0}
              max={5}
              step={0.5}
              value={outlineWidth}
              onChange={(e) => setOutlineWidth(parseFloat(e.target.value) || 0)}
              className="w-20 px-2 py-1 text-sm rounded focus:outline-none"
              style={{ backgroundColor: theme.bgTertiary, border: `1px solid ${theme.border}`, color: theme.text }}
            />
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderTop: `1px solid ${theme.border}` }}
        >
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs rounded hover:opacity-80"
            style={{ backgroundColor: theme.bgTertiary, color: theme.textMuted }}
          >
            デフォルトに戻す
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm rounded hover:opacity-80"
              style={{ backgroundColor: theme.bgTertiary, color: theme.text }}
            >
              キャンセル
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 text-sm rounded hover:opacity-90 font-bold"
              style={{ backgroundColor: theme.accent, color: theme.bg }}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
