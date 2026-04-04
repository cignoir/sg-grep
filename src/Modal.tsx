import type { ThemeConfig } from "./types";

export default function Modal({
  theme,
  width,
  onClose,
  title,
  children,
  footer,
}: {
  theme: ThemeConfig;
  width?: string;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="rounded-lg shadow-2xl flex flex-col"
        style={{
          width: width ?? "420px",
          backgroundColor: theme.bgSecondary,
          color: theme.text,
          border: `1px solid ${theme.border}`,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: `1px solid ${theme.border}` }}
        >
          <span className="font-bold text-sm">{title}</span>
          <button
            onClick={onClose}
            className="text-lg hover:opacity-60 leading-none"
            style={{ color: theme.textDimmed }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        {children}

        {/* Footer */}
        {footer && (
          <div
            className="flex justify-end gap-2 px-4 py-3 shrink-0"
            style={{ borderTop: `1px solid ${theme.border}` }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
