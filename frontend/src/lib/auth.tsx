import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSupabase } from "./supabase";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /** True inntil vi vet om det finnes en sesjon. Unngår at innlogget UI blinker. */
  loading: boolean;
  signInWithGitHub: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  /**
   * Uten autoconfirm gir GoTrue ingen sesjon før e-posten er bekreftet, så
   * kalleren må vente på innboksen i stedet for å navigere til dashbordet.
   */
  signUpWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  /** Sender gjenopprettingslenke. Virker også for kontoer opprettet via OAuth. */
  requestPasswordReset: (email: string) => Promise<void>;
  /** Setter nytt passord. Krever en aktiv recovery-sesjon fra lenken i e-posten. */
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const getProductionOrigin = () => {
  if (typeof window === "undefined") return "https://snoat.com";
  if (window.location.origin.includes("localhost")) {
    return "https://snoat.com";
  }
  return window.location.origin;
};

const callbackUrl = () => `${getProductionOrigin()}/auth/callback`;

const resetUrl = () => `${getProductionOrigin()}/reset-password`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getSupabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setLoading(false);
      });

    const { data: subscription } = getSupabase().auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,

      signInWithGitHub: async () => {
        const { error } = await getSupabase().auth.signInWithOAuth({
          provider: "github",
          options: { redirectTo: callbackUrl() },
        });
        if (error) throw error;
      },

      signInWithPassword: async (email, password) => {
        const { error } = await getSupabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
      },

      signUpWithPassword: async (email, password) => {
        const { data, error } = await getSupabase().auth.signUp({
          email,
          password,
          options: { emailRedirectTo: callbackUrl() },
        });
        if (error) throw error;
        return { needsEmailConfirmation: data.session === null };
      },

      requestPasswordReset: async (email) => {
        const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
          redirectTo: resetUrl(),
        });
        if (error) throw error;
      },

      updatePassword: async (password) => {
        const { error } = await getSupabase().auth.updateUser({ password });
        if (error) throw error;
      },

      signOut: async () => {
        const { error } = await getSupabase().auth.signOut();
        if (error) throw error;
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth må brukes innenfor <AuthProvider>");
  return context;
}

/** Navn og avatar hentes fra GitHub-profilen GoTrue lagrer på brukeren. */
export function displayName(user: User | null): string {
  if (!user) return "";
  const meta = user.user_metadata as Record<string, unknown>;
  return (
    (meta.full_name as string) ||
    (meta.name as string) ||
    (meta.user_name as string) ||
    user.email ||
    "Bruker"
  );
}

export function avatarUrl(user: User | null): string | null {
  if (!user) return null;
  const meta = user.user_metadata as Record<string, unknown>;
  return (meta.avatar_url as string) || null;
}
