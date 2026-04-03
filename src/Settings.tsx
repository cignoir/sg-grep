import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { AppConfig, ThemeConfig } from "./types";

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

  const handlePickDir = async () => {
    const selected = await open({ directory: true });
    if (selected) setDir(selected as string);
  };

  const handleSave = async () => {
    const config: AppConfig = await invoke("load_config");
    await invoke("save_config", {
      config: { ...config, last_directory: dir || null },
    });
    onApply(dir || null, config.theme as Partial<ThemeConfig> ?? {});
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg shadow-2xl w-[480px] flex flex-col"
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
        <div className="px-4 py-4">
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

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-4 py-3 shrink-0"
          style={{ borderTop: `1px solid ${theme.border}` }}
        >
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
  );
}
