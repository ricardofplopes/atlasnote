"use client";

import { AuthProvider } from "@/lib/auth-context";
import { ConfigProvider } from "@/lib/config-context";
import { AppShell } from "@/components/app-shell";
import { ToastProvider } from "@/components/toast";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { CommandPaletteProvider } from "@/components/command-palette";
import { ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <AuthProvider>
        <ToastProvider>
          <ConfirmProvider>
            <CommandPaletteProvider>
              <AppShell>{children}</AppShell>
            </CommandPaletteProvider>
          </ConfirmProvider>
        </ToastProvider>
      </AuthProvider>
    </ConfigProvider>
  );
}
