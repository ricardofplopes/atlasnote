"use client";

import { useAuth } from "@/lib/auth-context";
import { useConfig } from "@/lib/config-context";
import { loginWithGoogle, loginWithGitHub } from "@/lib/api";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: Record<string, unknown>) => { requestAccessToken: () => void };
        };
      };
    };
  }
}

export function LoginPage() {
  const { setToken } = useAuth();
  const config = useConfig();
  const googleBtnRef = useRef<HTMLDivElement>(null);

  const githubClientId = config.GITHUB_CLIENT_ID;
  const googleClientId = config.GOOGLE_CLIENT_ID;

  const handleGitHubLogin = () => {
    if (!githubClientId) return;
    const redirectUri = `${window.location.origin}/api/auth/github/callback`;
    window.location.href = `https://github.com/login/oauth/authorize?client_id=${githubClientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user%20user:email`;
  };

  useEffect(() => {
    if (!googleClientId) return;

    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => {
      if (!window.google) return;

      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: googleClientId,
        scope: "openid email profile",
        callback: async (response: { access_token?: string }) => {
          if (response.access_token) {
            try {
              const data = await loginWithGoogle(response.access_token);
              setToken(data.access_token);
            } catch (e) {
              console.error("Login failed:", e);
            }
          }
        },
      });

      if (googleBtnRef.current) {
        googleBtnRef.current.onclick = () => client.requestAccessToken();
      }
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, [setToken, googleClientId]);

  if (!config.loaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900">
        <div className="animate-pulse text-indigo-300 text-lg">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/4 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md mx-4">
        {/* Card */}
        <div className="bg-white/[0.03] backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-10">
          {/* Logo & branding */}
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-indigo-500/20 rounded-2xl mb-5">
              <svg className="w-8 h-8 text-indigo-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white tracking-tight">Atlas Note</h1>
            <p className="mt-2 text-sm text-indigo-200/60">
              Organize your knowledge. Search with AI.
            </p>
          </div>

          {/* Divider */}
          <div className="relative mb-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-white/10" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-3 bg-transparent text-indigo-300/50 uppercase tracking-widest">Sign in</span>
            </div>
          </div>

          {/* Auth buttons */}
          <div className="space-y-3">
            {githubClientId && (
              <button
                onClick={handleGitHubLogin}
                className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-white text-gray-900 rounded-xl font-medium shadow-lg shadow-black/20 hover:bg-gray-100 hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 cursor-pointer"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Continue with GitHub
              </button>
            )}

            {googleClientId && (
              <div
                ref={googleBtnRef}
                className="w-full flex items-center justify-center gap-3 px-5 py-3.5 bg-white/[0.07] text-white border border-white/10 rounded-xl font-medium hover:bg-white/[0.12] hover:scale-[1.02] active:scale-[0.98] transition-all duration-150 cursor-pointer"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Continue with Google
              </div>
            )}

            {!githubClientId && !googleClientId && (
              <div className="text-center py-6">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-amber-500/10 rounded-xl mb-3">
                  <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                  </svg>
                </div>
                <p className="text-sm text-amber-300/80 font-medium">Authentication not configured</p>
                <p className="text-xs text-indigo-300/40 mt-1">
                  Set NEXT_PUBLIC_GITHUB_CLIENT_ID in your .env file
                </p>
              </div>
            )}
          </div>

          {/* Features */}
          <div className="mt-10 grid grid-cols-3 gap-4">
            {[
              { icon: "🔍", label: "Semantic Search" },
              { icon: "🤖", label: "AI Chat" },
              { icon: "🔌", label: "MCP Ready" },
            ].map((feature) => (
              <div key={feature.label} className="text-center">
                <div className="text-xl mb-1">{feature.icon}</div>
                <div className="text-[10px] text-indigo-300/40 uppercase tracking-wider">{feature.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-indigo-300/30 mt-6">
          Self-hosted · Private · Open Source
        </p>
      </div>
    </div>
  );
}
