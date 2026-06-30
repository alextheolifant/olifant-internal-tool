"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/auth-context";

export default function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-2 rounded-[7px] border border-neutral-200 px-3 py-1.5 shadow-sm"
      >
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-700">
          {user.email.charAt(0).toUpperCase()}
        </div>
        <span className="text-[12.5px] font-medium text-neutral-700">{user.email}</span>
        <span className="text-[10px] text-neutral-400">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-48 overflow-hidden rounded-[10px] border border-neutral-200 bg-white shadow-lg">
          <div className="border-b border-neutral-100 px-3.5 py-2.5">
            <div className="truncate text-[12.5px] font-semibold text-ink">{user.email}</div>
            <div className="text-[11px] capitalize text-neutral-400">{user.role}</div>
          </div>
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="block w-full cursor-pointer px-3.5 py-2.5 text-left text-[13px] font-medium text-neutral-600 transition-colors hover:bg-neutral-50 hover:text-ink"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
