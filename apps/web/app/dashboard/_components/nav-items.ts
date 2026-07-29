export type PpcBadgeKey = "today" | "queue" | "ideas";

export interface SubNavItem {
  label: string;
  href: string;
  badgeKey?: PpcBadgeKey;
}

export interface NavItem {
  label: string;
  href: string;
  children?: SubNavItem[];
}

export const PPC_NAV_ITEMS: SubNavItem[] = [
  { label: "Today", href: "/dashboard/ppc/today", badgeKey: "today" },
  { label: "Task Queue", href: "/dashboard/ppc/queue", badgeKey: "queue" },
  { label: "Observe", href: "/dashboard/ppc/observe" },
  { label: "Organic (SQP)", href: "/dashboard/ppc/organic" },
  { label: "Ideas", href: "/dashboard/ppc/ideas", badgeKey: "ideas" },
  { label: "History", href: "/dashboard/ppc/history" },
  { label: "Clients", href: "/dashboard/ppc/clients" },
  { label: "Config", href: "/dashboard/ppc/config" },
];

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Chat", href: "/dashboard/chat" },
  { label: "PPC", href: "/dashboard/ppc", children: PPC_NAV_ITEMS },
  { label: "SQP", href: "/dashboard/sqp" },
  { label: "Audit", href: "/dashboard/audit" },
  { label: "Settings", href: "/dashboard/settings" },
];
