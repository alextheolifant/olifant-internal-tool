import type { Metadata } from "next";
import LoginForm from "./_components/login-form";

export const metadata: Metadata = {
  title: "Sign In · Olifant Platform",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen">
      {/* Brand panel — visible on large screens only */}
      <div className="hidden lg:flex w-[420px] xl:w-[480px] shrink-0 flex-col justify-between bg-ink p-10">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Logomark />
          <span className="text-[15px] font-semibold text-neutral-50 tracking-[-0.01em]">
            Olifant Digital
          </span>
        </div>

        {/* Tagline */}
        <div className="space-y-4">
          <p className="text-[28px] font-semibold leading-snug text-neutral-50 tracking-[-0.02em]">
            Amazon PPC intelligence,{" "}
            <span className="text-brand">built for agencies.</span>
          </p>
          <p className="text-[15px] leading-relaxed text-neutral-500">
            Multi-client analytics, AI copilot, and automated reporting —
            all in one internal workspace.
          </p>
        </div>

        {/* Beta badge */}
        <div className="flex items-center gap-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-pine-200" />
          <span className="text-xs font-medium uppercase tracking-widest text-neutral-600">
           
          </span>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 flex-col items-center justify-center bg-canvas px-6 py-12">
        {/* Mobile logo — hidden on large screens */}
        <div className="mb-10 flex items-center gap-3 lg:hidden">
          <Logomark />
          <span className="text-[15px] font-semibold text-ink tracking-[-0.01em]">
            Olifant Digital
          </span>
        </div>

        <div className="w-full max-w-[360px]">
          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-ink tracking-[-0.02em]">
              Welcome back
            </h1>
            <p className="mt-1.5 text-[15px] text-neutral-500">
              Sign in to your account
            </p>
          </div>

          <LoginForm />
        </div>
      </div>
    </div>
  );
}

function Logomark() {
  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand">
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        fill="none"
        aria-hidden="true"
      >
        {/* Elephant silhouette — stylised, simplified */}
        <path
          d="M14 4.5C14 3.12 12.88 2 11.5 2c-.64 0-1.22.24-1.66.63A4.49 4.49 0 0 0 9 2.5c-.67 0-1.3.15-1.87.43A2.5 2.5 0 0 0 4 5.5v.25C3.45 6.08 3 6.74 3 7.5v1C3 9.33 3.67 10 4.5 10H5v4.5a.5.5 0 0 0 1 0V13h1v1.5a.5.5 0 0 0 1 0V13h2v1.5a.5.5 0 0 0 1 0V10h.5c.83 0 1.5-.67 1.5-1.5V8c0-.38-.08-.73-.23-1.05C14.46 6.54 14 5.57 14 4.5Z"
          fill="#19130D"
        />
      </svg>
    </div>
  );
}
