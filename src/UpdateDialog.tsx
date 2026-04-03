import { useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import type { ThemeConfig } from "./types";

type UpdateState =
  | { status: "checking" }
  | { status: "available"; version: string; body: string }
  | { status: "downloading"; progress: number }
  | { status: "ready" }
  | { status: "error"; message: string }
  | { status: "none" };

export function useUpdateChecker() {
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);

  const checkForUpdate = async () => {
    setUpdateState({ status: "checking" });
    try {
      const update = await check();
      if (update) {
        setUpdateState({
          status: "available",
          version: update.version,
          body: update.body ?? "",
        });
      } else {
        setUpdateState({ status: "none" });
        // Auto-hide after 2s
        setTimeout(() => setUpdateState(null), 2000);
      }
    } catch (e) {
      setUpdateState({ status: "error", message: String(e) });
    }
  };

  const startDownload = async () => {
    setUpdateState({ status: "downloading", progress: 0 });
    try {
      const update = await check();
      if (!update) return;

      let totalBytes = 0;
      let downloadedBytes = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          totalBytes = event.data.contentLength;
        }
        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          const pct = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
          setUpdateState({ status: "downloading", progress: pct });
        }
        if (event.event === "Finished") {
          setUpdateState({ status: "ready" });
        }
      });

      setUpdateState({ status: "ready" });
    } catch (e) {
      setUpdateState({ status: "error", message: String(e) });
    }
  };

  const doRelaunch = async () => {
    await relaunch();
  };

  return { updateState, setUpdateState, checkForUpdate, startDownload, doRelaunch };
}

export default function UpdateDialog({
  state,
  theme,
  onClose,
  onDownload,
  onRelaunch,
}: {
  state: UpdateState;
  theme: ThemeConfig;
  onClose: () => void;
  onDownload: () => void;
  onRelaunch: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget && state.status !== "downloading") onClose();
      }}
    >
      <div
        className="rounded-lg shadow-2xl w-[400px] flex flex-col"
        style={{
          backgroundColor: theme.bgSecondary,
          color: theme.text,
          border: `1px solid ${theme.border}`,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderBottom: `1px solid ${theme.border}` }}
        >
          <span className="font-bold text-sm">アップデート</span>
          {state.status !== "downloading" && (
            <button
              onClick={onClose}
              className="text-lg hover:opacity-60 leading-none"
              style={{ color: theme.textDimmed }}
            >
              ×
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {state.status === "checking" && (
            <p className="text-sm text-center" style={{ color: theme.textMuted }}>
              アップデートを確認中...
            </p>
          )}

          {state.status === "none" && (
            <p className="text-sm text-center" style={{ color: theme.textMuted }}>
              最新バージョンです。
            </p>
          )}

          {state.status === "available" && (
            <div>
              <p className="text-sm mb-2">
                新しいバージョン{" "}
                <span className="font-bold" style={{ color: theme.accent }}>
                  v{state.version}
                </span>{" "}
                が利用可能です。
              </p>
              {state.body && (
                <div
                  className="text-xs mt-2 p-2 rounded max-h-32 overflow-y-auto"
                  style={{
                    backgroundColor: theme.bgTertiary,
                    color: theme.textMuted,
                  }}
                >
                  {state.body}
                </div>
              )}
            </div>
          )}

          {state.status === "downloading" && (
            <div>
              <p className="text-sm mb-3" style={{ color: theme.textMuted }}>
                ダウンロード中...
              </p>
              <div
                className="w-full h-2 rounded-full overflow-hidden"
                style={{ backgroundColor: theme.bgTertiary }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${state.progress}%`,
                    backgroundColor: theme.accent,
                  }}
                />
              </div>
              <p
                className="text-xs mt-1 text-right"
                style={{ color: theme.textDimmed }}
              >
                {state.progress}%
              </p>
            </div>
          )}

          {state.status === "ready" && (
            <p className="text-sm text-center" style={{ color: theme.textMuted }}>
              アップデートの準備ができました。再起動しますか？
            </p>
          )}

          {state.status === "error" && (
            <p className="text-sm" style={{ color: "#f38ba8" }}>
              エラー: {state.message}
            </p>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex justify-end gap-2 px-4 py-3"
          style={{ borderTop: `1px solid ${theme.border}` }}
        >
          {state.status === "available" && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-sm rounded hover:opacity-80"
                style={{ backgroundColor: theme.bgTertiary, color: theme.text }}
              >
                後で
              </button>
              <button
                onClick={onDownload}
                className="px-4 py-1.5 text-sm rounded hover:opacity-90 font-bold"
                style={{ backgroundColor: theme.accent, color: theme.bg }}
              >
                アップデート
              </button>
            </>
          )}

          {state.status === "ready" && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-sm rounded hover:opacity-80"
                style={{ backgroundColor: theme.bgTertiary, color: theme.text }}
              >
                後で再起動
              </button>
              <button
                onClick={onRelaunch}
                className="px-4 py-1.5 text-sm rounded hover:opacity-90 font-bold"
                style={{ backgroundColor: theme.accent, color: theme.bg }}
              >
                今すぐ再起動
              </button>
            </>
          )}

          {(state.status === "none" || state.status === "error") && (
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm rounded hover:opacity-90 font-bold"
              style={{ backgroundColor: theme.accent, color: theme.bg }}
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
