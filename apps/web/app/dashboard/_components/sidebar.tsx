"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { NAV_ITEMS, type PpcBadgeKey } from "./nav-items";
import { usePpcBadgeCounts, usePpcSyncStatus } from "../_lib/ppc-status";

const ICONS: Record<string, (props: { className?: string }) => React.ReactElement> = {
  "/dashboard": IconGrid,
  "/dashboard/chat": IconSparkle,
  "/dashboard/ppc": IconBolt,
  "/dashboard/sqp": IconSearch,
  "/dashboard/audit": IconCheck,
  "/dashboard/settings": IconGear,
};

const SUB_ICONS: Record<string, (props: { className?: string }) => React.ReactElement> = {
  "/dashboard/ppc/today": IconToday,
  "/dashboard/ppc/queue": IconQueue,
  "/dashboard/ppc/observe": IconObserve,
  "/dashboard/ppc/organic": IconLeaf,
  "/dashboard/ppc/ideas": IconIdea,
  "/dashboard/ppc/history": IconHistory,
  "/dashboard/ppc/clients": IconClients,
  "/dashboard/ppc/config": IconGear,
};

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
}

export default function Sidebar() {
  const pathname = usePathname();
  const [manualOpen, setManualOpen] = useState(false);
  const badges = usePpcBadgeCounts();
  const sync = usePpcSyncStatus();

  const badgeCount = (key?: PpcBadgeKey) => (key ? badges[key] : undefined);

  return (
    <aside className="flex h-screen w-55 shrink-0 flex-col bg-ink py-4">
      <div className="mb-3 flex items-center gap-2.5 px-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand">
          <Logomark />
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-bold text-neutral-50">Olifant Digital</div>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5">
        {NAV_ITEMS.map((item) => {
          const Icon = ICONS[item.href];
          const hasChildren = !!item.children?.length;
          const childActive = hasChildren && isActive(pathname, item.href);
          const expanded = childActive || (hasChildren && manualOpen);
          const parentBadge = hasChildren
            ? item.children!.reduce((sum, c) => sum + (badgeCount(c.badgeKey) ?? 0), 0)
            : 0;

          if (!hasChildren) {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13px] font-semibold transition-colors ${
                  active
                    ? "bg-brand/15 text-brand"
                    : "text-neutral-400 hover:bg-white/5 hover:text-neutral-100"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          }

          return (
            <div key={item.href}>
              <button
                type="button"
                onClick={() => setManualOpen((v) => (childActive ? true : !v))}
                aria-expanded={expanded}
                className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13px] font-semibold transition-colors ${
                  childActive
                    ? "bg-brand/15 text-brand"
                    : "text-neutral-400 hover:bg-white/5 hover:text-neutral-100"
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate text-left">{item.label}</span>
                {parentBadge > 0 && (
                  <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[9.5px] font-bold leading-none text-white">
                    {parentBadge}
                  </span>
                )}
                <IconChevron className={`h-2.5 w-2.5 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
              </button>

              {expanded && (
                <div className="mt-0.5 flex flex-col gap-0.5 border-l border-white/10 pl-2.5">
                  {item.children!.map((child) => {
                    const active = isActive(pathname, child.href);
                    const SubIcon = SUB_ICONS[child.href];
                    const count = badgeCount(child.badgeKey);
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                          active
                            ? "bg-brand/15 text-brand"
                            : "text-neutral-400 hover:bg-white/5 hover:text-neutral-100"
                        }`}
                      >
                        <SubIcon className="h-3.5 w-3.5 shrink-0" />
                        <span className="flex-1 truncate">{child.label}</span>
                        {count !== undefined && count > 0 && (
                          <span
                            className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold leading-none ${
                              child.badgeKey === "today" ? "bg-red-600 text-white" : "bg-white/10 text-neutral-300"
                            }`}
                          >
                            {count}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div className="mt-2 border-t border-white/10 px-4 pt-3 text-[11px] text-neutral-500">
        <span className={sync.isStale ? "text-red-600" : ""}>{sync.label}</span>
      </div>
    </aside>
  );
}

function Logomark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
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

function IconGear({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <circle cx="8" cy="8" r="2.3" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8 2.2v1.6M8 12.2v1.6M13.8 8h-1.6M3.8 8H2.2M11.9 4.1l-1.1 1.1M5.2 10.7l-1.1 1.1M11.9 11.9l-1.1-1.1M5.2 5.3 4.1 4.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconBolt({ className }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path d="M8.7 1.5 3 9.2h3.4L6.2 14.5 12.5 6.4H9.1L8.7 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

function IconChevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" fill="none" className={className} aria-hidden="true">
      <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconToday({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path d="M7 1.5 12.5 11h-11L7 1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M7 5.8v2.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="7" cy="9.6" r="0.6" fill="currentColor" />
    </svg>
  );
}

function IconQueue({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path d="M2 3.5h10M2 7h10M2 10.5h6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function IconObserve({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path d="M1.2 7S3.4 3 7 3s5.8 4 5.8 4-2.2 4-5.8 4-5.8-4-5.8-4Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <circle cx="7" cy="7" r="1.7" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconLeaf({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path d="M12 2C6 2 2 6 2 12c6 0 10-4 10-10Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M3 11 8 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconIdea({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path d="M7 1.8c-2.1 0-3.7 1.6-3.7 3.6 0 1.3.6 2.2 1.5 3 .5.4.7.9.7 1.4v.4h3v-.4c0-.5.2-1 .7-1.4.9-.8 1.5-1.7 1.5-3 0-2-1.6-3.6-3.7-3.6Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5.5 12.2h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconHistory({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <path d="M2.2 7a4.8 4.8 0 1 0 1.5-3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.6 2v2.1h2.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 4.5v2.7l1.9 1.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClients({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <circle cx="5.2" cy="4.8" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 12c0-2 1.7-3.2 3.7-3.2S9 10 9 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="10.2" cy="5.2" r="1.6" stroke="currentColor" strokeWidth="1.1" />
      <path d="M9.6 8.9c1.7.1 2.9 1.2 2.9 3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}
