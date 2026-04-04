import type { FileSearchResult, ThemeConfig } from "./types";

export default function StatusBar({
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
