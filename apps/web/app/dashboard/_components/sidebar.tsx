"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";

const ICONS: Record<string, (props: { className?: string }) => React.ReactElement> = {
  "/dashboard": IconGrid,
  "/dashboard/chat": IconSparkle,
  "/dashboard/sqp": IconSearch,
  "/dashboard/audit": IconCheck,
};

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-19 shrink-0 flex-col items-center gap-1 bg-ink py-3.5">
      <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-lg bg-brand">
        <Logomark />
      </div>

      <nav className="flex w-full flex-col items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === item.href
              : pathname.startsWith(item.href);
          const Icon = ICONS[item.href];

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex w-15 flex-col items-center gap-1 rounded-[10px] py-2.5 transition-colors ${
                isActive
                  ? "bg-brand/15 text-brand"
                  : "text-neutral-500 hover:bg-white/5 hover:text-neutral-200"
              }`}
            >
              <Icon className="h-4.25 w-4.25" />
              <span className="text-[9.5px] font-semibold leading-none">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function Logomark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M14 4.5C14 3.12 12.88 2 11.5 2c-.64 0-1.22.24-1.66.63A4.49 4.49 0 0 0 9 2.5c-.67 0-1.3.15-1.87.43A2.5 2.5 0 0 0 4 5.5v.25C3.45 6.08 3 6.74 3 7.5v1C3 9.33 3.67 10 4.5 10H5v4.5a.5.5 0 0 0 1 0V13h1v1.5a.5.5 0 0 0 1 0V13h2v1.5a.5.5 0 0 0 1 0V10h.5c.83 0 1.5-.67 1.5-1.5V8c0-.38-.08-.73-.23-1.05C14.46 6.54 14 5.57 14 4.5Z"
        fill="#19130D"
      />
    </svg>
  );
}

function IconGrid({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconSparkle({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M8 2.5 9.1 6 12.5 7.2 9.1 8.4 8 12 6.9 8.4 3.5 7.2 6.9 6 8 2.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconSearch({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M10.3 10.3 13.5 13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.5 8.2 7.2 9.9 10.5 6.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
