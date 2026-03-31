"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

interface AppConfig {
  GITHUB_CLIENT_ID: string;
  GOOGLE_CLIENT_ID: string;
  API_URL: string;
  loaded: boolean;
}

const defaultConfig: AppConfig = {
  GITHUB_CLIENT_ID: "",
  GOOGLE_CLIENT_ID: "",
  API_URL: "http://localhost:8000",
  loaded: false,
};

const ConfigContext = createContext<AppConfig>(defaultConfig);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(defaultConfig);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => setConfig({ ...data, loaded: true }))
      .catch(() => setConfig((c) => ({ ...c, loaded: true })));
  }, []);

  return (
    <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>
  );
}

export function useConfig() {
  return useContext(ConfigContext);
}
