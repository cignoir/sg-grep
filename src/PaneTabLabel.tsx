import type { ThemeConfig } from "./types";

export default function PaneTabLabel({
  label,
  theme,
}: {
  label: string;
  theme: ThemeConfig;
}) {
  return (
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
        {label}
      </div>
    </div>
  );
}
