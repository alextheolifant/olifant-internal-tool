const SKELETON_ROWS = 8;

function SkeletonCell({ wide }: { wide?: boolean }) {
  return (
    <td className="px-3 py-2.5">
      <div
        className={`h-3 animate-pulse rounded-full bg-neutral-200 ${wide ? "w-28" : "w-16"}`}
      />
    </td>
  );
}

/** Loading state: skeleton rows while data is fetching */
export function TableSkeleton({ cols }: { cols: number }) {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
        <tr key={i} className="border-b border-neutral-100">
          {/* Client name — wider */}
          <td className="px-3 py-2.5">
            <div className="h-3 w-36 animate-pulse rounded-full bg-neutral-200" />
          </td>
          {Array.from({ length: cols - 1 }).map((_, j) => (
            <SkeletonCell key={j} />
          ))}
        </tr>
      ))}
    </>
  );
}
