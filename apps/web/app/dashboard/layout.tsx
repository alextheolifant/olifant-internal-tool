import Sidebar from "./_components/sidebar";
import Header from "./_components/header";
import { MarketplaceProvider } from "./_lib/marketplace-context";
import { DateRangeProvider } from "./_lib/date-range-context";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DateRangeProvider>
      <MarketplaceProvider>
        <div className="flex h-screen bg-canvas">
          <Sidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <Header />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </MarketplaceProvider>
    </DateRangeProvider>
  );
}
