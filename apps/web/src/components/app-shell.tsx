"use client";

import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "@/components/sidebar";
import { LoginPage } from "@/components/login-page";
import { ReactNode, useState, useCallback, useRef, useEffect } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("sidebar-width");
      return saved ? parseInt(saved, 10) : 260;
    }
    return 260;
  });
  const isResizing = useRef(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(Math.max(e.clientX, 200), 500);
      setSidebarWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        localStorage.setItem("sidebar-width", sidebarWidth.toString());
      }
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [sidebarWidth]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen" style={{ background: '#0d0b24' }}>
        <img src="/icon.png" alt="Atlas Note" className="w-16 h-16 animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`
          fixed lg:relative z-30 h-full shrink-0
          transition-transform duration-200 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:min-w-0 lg:overflow-hidden'}
        `}
        style={{ width: sidebarOpen ? sidebarWidth : 0 }}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} width={sidebarWidth} />
      </div>

      {/* Resize handle */}
      {sidebarOpen && (
        <div
          className="hidden lg:flex w-1 shrink-0 cursor-col-resize items-center justify-center group z-10 hover:w-1.5 transition-all"
          style={{ background: 'var(--card-border)' }}
          onMouseDown={handleMouseDown}
        >
          <div
            className="w-0.5 h-8 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: 'var(--accent)' }}
          />
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto min-w-0" style={{ background: 'var(--background)' }}>
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="fixed top-4 left-4 z-10 p-2 rounded-lg lg:hidden"
            style={{ background: 'var(--card-bg)', border: '1px solid var(--card-border)' }}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" style={{ color: 'var(--foreground)' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>
        )}
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
