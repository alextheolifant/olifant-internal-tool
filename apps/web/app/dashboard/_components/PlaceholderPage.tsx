export function PlaceholderPage({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center text-neutral-400 text-sm">
      {label} — coming soon
    </div>
  );
}
