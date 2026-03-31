"use client";

import { AuthProvider } from "@/lib/auth-context";
import { ConfigProvider } from "@/lib/config-context";
import { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <AuthProvider>{children}</AuthProvider>
    </ConfigProvider>
  );
}
