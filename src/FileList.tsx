import { useMemo, memo } from "react";
import type { FolderGroup, FileSearchResult, ThemeConfig } from "./types";

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

export default FileList;
