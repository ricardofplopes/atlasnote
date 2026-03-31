"use client";

import { useAuth } from "@/lib/auth-context";
import { Sidebar } from "@/components/sidebar";
import { LoginPage } from "@/components/login-page";
import { ReactNode } from "react";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#141130]">
        <img src="/logo.svg" alt="Atlas Note" className="w-16 h-16 animate-pulse" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
