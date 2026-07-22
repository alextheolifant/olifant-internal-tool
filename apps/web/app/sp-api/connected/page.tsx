import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Amazon Connection · Olifant Digital",
};

const REASON_MESSAGES: Record<string, string> = {
  missing_params:
    "Amazon didn't send back the information we needed to complete the connection.",
  connection_failed:
    "Something went wrong while connecting your account.",
};

export default async function SpApiConnectedPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; reason?: string }>;
}) {
  const { status, reason } = await searchParams;
  const success = status === "success";

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-[420px] text-center">
        <div className="mb-6 flex items-center justify-center gap-3">
          <Logomark />
          <span className="text-[15px] font-semibold text-ink tracking-[-0.01em]">
            Olifant Digital
          </span>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-8 shadow-sm">
          {success ? (
            <>
              <StatusIcon variant="success" />
              <h1 className="mt-5 text-xl font-semibold text-ink tracking-[-0.02em]">
                Account connected
              </h1>
              <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
                Your Amazon account has been successfully connected to Olifant
                Digital. You can close this window now.
              </p>
            </>
          ) : (
            <>
              <StatusIcon variant="error" />
              <h1 className="mt-5 text-xl font-semibold text-ink tracking-[-0.02em]">
                Connection failed
              </h1>
              <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
                {(reason && REASON_MESSAGES[reason]) ??
                  "Something went wrong while connecting your account."}{" "}
                Please contact Olifant Digital and we&apos;ll send you a new
                link.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusIcon({ variant }: { variant: "success" | "error" }) {
  const success = variant === "success";
  return (
    <div
      className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
        success ? "bg-green-50" : "bg-red-50"
      }`}
    >
      {success ? (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path
            d="M4 11.5 9 16.5 18 6.5"
            stroke="#2D8C04"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path
            d="M6 6l10 10M16 6 6 16"
            stroke="#E62415"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
}

function Logomark() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
        <path
          d="M14 4.5C14 3.12 12.88 2 11.5 2c-.64 0-1.22.24-1.66.63A4.49 4.49 0 0 0 9 2.5c-.67 0-1.3.15-1.87.43A2.5 2.5 0 0 0 4 5.5v.25C3.45 6.08 3 6.74 3 7.5v1C3 9.33 3.67 10 4.5 10H5v4.5a.5.5 0 0 0 1 0V13h1v1.5a.5.5 0 0 0 1 0V13h2v1.5a.5.5 0 0 0 1 0V10h.5c.83 0 1.5-.67 1.5-1.5V8c0-.38-.08-.73-.23-1.05C14.46 6.54 14 5.57 14 4.5Z"
          fill="#19130D"
        />
      </svg>
    </div>
  );
}
