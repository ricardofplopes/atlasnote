"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { getMe } from "@/lib/api";

interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  setToken: (token: string | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  loading: true,
  setToken: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const setToken = (t: string | null) => {
    setTokenState(t);
    if (t) {
      localStorage.setItem("token", t);
    } else {
      localStorage.removeItem("token");
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
  };

  // Clear auth state when any API call returns 401
  useEffect(() => {
    const handleLogout = () => {
      setTokenState(null);
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("auth:logout", handleLogout);
    return () => window.removeEventListener("auth:logout", handleLogout);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem("token");
    const params = new URLSearchParams(window.location.search);
    const hasOAuthCode = params.has("github_code");

    // Skip getMe() if an OAuth callback is in progress — the callback
    // handler will authenticate and call setToken, which triggers the
    // second useEffect below.
    if (hasOAuthCode) {
      if (stored) localStorage.removeItem("token");
      setLoading(false);
      return;
    }

    if (stored) {
      setTokenState(stored);
      getMe()
        .then(setUser)
        .catch(() => {
          localStorage.removeItem("token");
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token && !user) {
      setLoading(true);
      getMe()
        .then(setUser)
        .catch(() => setToken(null))
        .finally(() => setLoading(false));
    }
  }, [token]);

  return (
    <AuthContext.Provider value={{ user, token, loading, setToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
