"use client";

import { createContext, useContext, useState, useCallback, ReactNode, useEffect } from "react";

type ToastType = "success" | "error" | "info" | "warning";

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType, duration?: number) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

const ICONS: Record<ToastType, string> = {
  success: "✓",
  error: "✕",
  info: "ℹ",
  warning: "⚠",
};

const COLORS: Record<ToastType, { bg: string; border: string; icon: string }> = {
  success: { bg: "rgba(74,222,128,0.12)", border: "rgba(74,222,128,0.3)", icon: "#4ade80" },
  error: { bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.3)", icon: "#f87171" },
  info: { bg: "rgba(122,92,255,0.12)", border: "rgba(122,92,255,0.3)", icon: "#a78bfa" },
  warning: { bg: "rgba(251,191,36,0.12)", border: "rgba(251,191,36,0.3)", icon: "#fbbf24" },
};

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);
  const colors = COLORS[toast.type];

  useEffect(() => {
    const exitTimer = setTimeout(() => setExiting(true), toast.duration - 300);
    const removeTimer = setTimeout(() => onRemove(toast.id), toast.duration);
    return () => { clearTimeout(exitTimer); clearTimeout(removeTimer); };
  }, [toast.id, toast.duration, onRemove]);

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg backdrop-blur-sm transition-all duration-300"
      style={{
        background: colors.bg,
        border: `1px solid ${colors.border}`,
        opacity: exiting ? 0 : 1,
        transform: exiting ? "translateX(20px)" : "translateX(0)",
        minWidth: "280px",
        maxWidth: "420px",
      }}
    >
      <span className="text-base font-bold shrink-0" style={{ color: colors.icon }}>
        {ICONS[toast.type]}
      </span>
      <span className="text-sm flex-1" style={{ color: "var(--foreground)" }}>
        {toast.message}
      </span>
      <button
        onClick={() => onRemove(toast.id)}
        className="shrink-0 p-0.5 rounded transition-colors"
        style={{ color: "var(--text-muted)" }}
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M3 3l8 8M11 3l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = "info", duration = 3500) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, type, duration }]);
  }, []);

  const value: ToastContextValue = {
    toast: addToast,
    success: useCallback((msg: string) => addToast(msg, "success"), [addToast]),
    error: useCallback((msg: string) => addToast(msg, "error", 5000), [addToast]),
    info: useCallback((msg: string) => addToast(msg, "info"), [addToast]),
    warning: useCallback((msg: string) => addToast(msg, "warning", 4500), [addToast]),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container — fixed bottom-right */}
      <div
        className="fixed z-50 flex flex-col gap-2 pointer-events-none"
        style={{ bottom: "24px", right: "24px" }}
      >
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
