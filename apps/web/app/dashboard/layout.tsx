"use client";

import { useAuth } from "@/context/auth-context";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand">
            <span className="text-xs font-bold text-ink leading-none">O</span>
          </div>
          <span className="text-[13px] font-semibold text-ink">Olifant</span>
        </div>
        <div className="flex items-center gap-5">
          {user && (
            <span className="text-[13px] text-neutral-500">{user.email}</span>
          )}
          <button
            onClick={logout}
            className="cursor-pointer text-[13px] font-medium text-neutral-600 hover:text-ink transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
