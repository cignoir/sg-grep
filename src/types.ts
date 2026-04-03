export interface AppConfig {
  last_directory: string | null;
  theme: Partial<ThemeConfig>;
}

export interface FileEntry {
  path: string;
  name: string;
}

export interface FolderGroup {
  folder: string;
  files: FileEntry[];
}

export interface SearchHit {
  line_number: number;
  line: string;
  excerpt: string;
}

export interface FileSearchResult {
  path: string;
  name: string;
  folder: string;
  hits: SearchHit[];
}

// Full theme config: colors + font outline
export interface ThemeConfig {
  // UI colors
  bg: string;
  bgSecondary: string;
  bgTertiary: string;
  bgTitlebar: string;
  bgSidebar: string;
  bgPaneHeader: string;
  bgStatusbar: string;
  border: string;
  text: string;
  textMuted: string;
  textDimmed: string;
  accent: string;
  accentHover: string;
  selected: string;
  selectedText: string;
  highlightBg: string;
  searchMark: string;
  searchMarkText: string;
  // Syntax colors
  synTimestamp: string;
  synCharName: string;
  synBody: string;
  synNumber: string;
  synSystem: string;
  synWhisperFrom: string;
  synWhisperTo: string;
  synParty: string;
  synGuild: string;
  synHeader: string;
  // Font outline
  outlineColor: string;
  outlineWidth: number;
}

export const DEFAULT_THEME: ThemeConfig = {
  bg: "#896839",
  bgSecondary: "#44341c",
  bgTertiary: "#544236",
  bgTitlebar: "#44341d",
  bgSidebar: "#694622",
  bgPaneHeader: "#403e29",
  bgStatusbar: "#403e29",
  border: "#e9dda9",
  text: "#ffffff",
  textMuted: "#ffffff",
  textDimmed: "#ffffff",
  accent: "#3cf2f0",
  accentHover: "#74c7ec",
  selected: "#a47f4c",
  selectedText: "#f9e2af",
  highlightBg: "rgba(249, 226, 175, 0.12)",
  searchMark: "#896839",
  searchMarkText: "#f4f250",
  synTimestamp: "#cad6d8",
  synCharName: "#f9f062",
  synBody: "#ffffff",
  synNumber: "#ffffff",
  synSystem: "#ffffff",
  synWhisperFrom: "#cba6f7",
  synWhisperTo: "#f38ba8",
  synParty: "#a6e3a1",
  synGuild: "#f9e2af",
  synHeader: "#ffffff",
  outlineColor: "#000000",
  outlineWidth: 1,
};

export function resolveTheme(overrides: Partial<ThemeConfig> | undefined): ThemeConfig {
  if (!overrides) return { ...DEFAULT_THEME };
  return { ...DEFAULT_THEME, ...overrides };
}
