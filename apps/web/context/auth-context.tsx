"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import {
  clearSession,
  getAccessToken,
  parseAccessToken,
  type JwtUser,
} from "@/lib/auth";

interface AuthContextValue {
  user: JwtUser | null;
  initialized: boolean;
  login: (accessToken: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  initialized: false,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<JwtUser | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    const token = getAccessToken();
    if (token) setUser(parseAccessToken(token));
    setInitialized(true);
  }, []);

  const login = useCallback((accessToken: string) => {
    setUser(parseAccessToken(accessToken));
  }, []);

  const logout = useCallback(() => {
    clearSession();
    setUser(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, initialized, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
