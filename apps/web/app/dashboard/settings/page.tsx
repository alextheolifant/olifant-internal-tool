import { Suspense } from "react";
import type { Metadata } from "next";
import { SettingsView } from "../_components/SettingsView";

export const metadata: Metadata = {
  title: "Settings · Olifant Platform",
};

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsView />
    </Suspense>
  );
}
