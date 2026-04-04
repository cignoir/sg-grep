import type { ThemeConfig } from "./types";

export default function Toggle({
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
