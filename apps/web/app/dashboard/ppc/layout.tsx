import { PpcClientFilterProvider } from "./_lib/ppc-client-filter-context";
import PpcTopBar from "./_components/PpcTopBar";

export default function PpcLayout({ children }: { children: React.ReactNode }) {
  return (
    <PpcClientFilterProvider>
      <div className="flex h-full flex-col overflow-hidden bg-canvas">
        <PpcTopBar />
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </PpcClientFilterProvider>
  );
}
