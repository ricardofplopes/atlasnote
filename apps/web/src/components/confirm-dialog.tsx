"use client";

import { createContext, useContext, useState, useCallback, ReactNode, useEffect, useRef } from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "info";
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}

const VARIANT_STYLES = {
  danger: {
    iconBg: "rgba(248,113,113,0.15)",
    iconColor: "#f87171",
    btnBg: "rgba(248,113,113,0.9)",
    btnHover: "rgba(248,113,113,1)",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  warning: {
    iconBg: "rgba(251,191,36,0.15)",
    iconColor: "#fbbf24",
    btnBg: "rgba(251,191,36,0.9)",
    btnHover: "rgba(251,191,36,1)",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
      </svg>
    ),
  },
  info: {
    iconBg: "rgba(122,92,255,0.15)",
    iconColor: "#a78bfa",
    btnBg: "var(--accent)",
    btnHover: "var(--accent)",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4m0-4h.01" strokeLinecap="round" />
      </svg>
    ),
  },
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((value: boolean) => void) | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setOptions(opts);
    });
  }, []);

  const handleResolve = useCallback((value: boolean) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    setOptions(null);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!options) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleResolve(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [options, handleResolve]);

  const variant = options?.variant || "danger";
  const styles = VARIANT_STYLES[variant];

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {options && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={() => handleResolve(false)}
        >
          <div
            ref={dialogRef}
            className="rounded-2xl p-6 shadow-2xl w-full max-w-sm mx-4 animate-in"
            style={{
              background: "#1e1b3a",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-4">
              <div
                className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center"
                style={{ background: styles.iconBg, color: styles.iconColor }}
              >
                {styles.icon}
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold mb-1" style={{ color: "var(--foreground)" }}>
                  {options.title}
                </h3>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {options.message}
                </p>
              </div>
            </div>
            <div className="flex gap-3 mt-6 justify-end">
              <button
                onClick={() => handleResolve(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  color: "var(--text-secondary)",
                }}
              >
                {options.cancelLabel || "Cancel"}
              </button>
              <button
                onClick={() => handleResolve(true)}
                className="px-4 py-2 text-sm font-semibold rounded-lg text-white transition-colors"
                style={{ background: styles.btnBg }}
                onMouseEnter={(e) => e.currentTarget.style.opacity = "0.9"}
                onMouseLeave={(e) => e.currentTarget.style.opacity = "1"}
              >
                {options.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
