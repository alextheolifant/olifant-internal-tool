import { AllClientsView } from "./_components/AllClientsView";

/**
 * Dashboard landing page — "All Clients" overview.
 * Auth guard is handled by the existing middleware; no auth logic here.
 */
export default function DashboardPage() {
  return <AllClientsView />;
}
