"use client";

import { useEffect, useRef, useState } from "react";
import { useDateRange } from "../_lib/date-range-context";

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const PRESETS = [
  { key: "today", label: "Today", anchor: 0, days: 1 },
  { key: "yesterday", label: "Yesterday", anchor: 1, days: 1 },
  { key: "last7", label: "Last 7 Days", anchor: 0, days: 7 },
  { key: "last14", label: "Last 14 Days", anchor: 0, days: 14 },
  { key: "last30", label: "Last 30 Days", anchor: 0, days: 30 },
] as const;

type PresetKey = (typeof PRESETS)[number]["key"];
type Selection =
  | { type: "preset"; key: PresetKey }
  | { type: "month"; month: string; year: number }
  | { type: "year"; year: number };

type CompareKey = "period" | "month" | "year";

function daysAgo(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

function shiftDate(d: Date, monthDelta: number, yearDelta: number): Date {
  const nd = new Date(d);
  nd.setFullYear(nd.getFullYear() + yearDelta);
  nd.setMonth(nd.getMonth() + monthDelta);
  return nd;
}

function fmtDate(d: Date, withYear = false): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" as const } : {}),
  });
}

function fmtRange(start: Date, end: Date, withYear = false): string {
  if (start.getTime() === end.getTime()) return fmtDate(end, true);
  return `${fmtDate(start)} – ${fmtDate(end)}${withYear ? `, ${end.getFullYear()}` : ""}`;
}

function presetSub(key: PresetKey): string {
  const { anchor, days } = PRESETS.find((p) => p.key === key)!;
  return fmtRange(daysAgo(anchor + days - 1), daysAgo(anchor));
}

function fmtDateWeekday(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function buttonRange(key: PresetKey): string {
  const { anchor, days } = PRESETS.find((p) => p.key === key)!;
  if (days <= 1) return fmtDateWeekday(daysAgo(anchor));
  return `${fmtDate(daysAgo(anchor + days - 1))} – ${fmtDate(daysAgo(anchor))}`;
}

function compareOptionsFor(sel: Selection): { key: CompareKey; label: string }[] {
  if (sel.type === "year") return [{ key: "year", label: "Previous year" }];
  if (sel.type === "month")
    return [
      { key: "month", label: "Previous month" },
      { key: "year", label: "Previous year" },
    ];
  return [
    { key: "period", label: "Previous period" },
    { key: "month", label: "Previous month" },
    { key: "year", label: "Previous year" },
  ];
}

function compareLabel(sel: Selection, key: CompareKey): string {
  if (sel.type === "year") return String(sel.year - 1);

  if (sel.type === "month") {
    const idx = MONTH_NAMES.indexOf(sel.month);
    if (key === "year") return `${sel.month} ${sel.year - 1}`;
    const d = shiftDate(new Date(sel.year, idx, 1), -1, 0);
    return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
  }

  const { anchor, days } = PRESETS.find((p) => p.key === sel.key)!;
  if (key === "period") {
    const offset = anchor + days;
    return fmtRange(daysAgo(offset + days - 1), daysAgo(offset));
  }
  if (key === "month") {
    const end = shiftDate(daysAgo(anchor), -1, 0);
    const start = shiftDate(daysAgo(anchor + days - 1), -1, 0);
    return fmtRange(start, end);
  }
  const end = shiftDate(daysAgo(anchor), 0, -1);
  const start = shiftDate(daysAgo(anchor + days - 1), 0, -1);
  return fmtRange(start, end, true);
}

export default function DateFilter() {
  const { setRange } = useDateRange();
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>({ type: "preset", key: "last7" });
  const [pickerYear, setPickerYear] = useState(() => new Date().getFullYear());
  const [compare, setCompare] = useState(false);
  const [compareMode, setCompareMode] = useState<CompareKey>("period");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Push resolved from/to into context whenever selection changes
  useEffect(() => {
    const isoDate = (d: Date) => d.toISOString().slice(0, 10);
    let from: Date, to: Date, label: string;

    if (selection.type === "preset") {
      const p = PRESETS.find((pr) => pr.key === selection.key)!;
      to   = daysAgo(p.anchor);
      from = daysAgo(p.anchor + p.days - 1);
      label = p.label;
    } else if (selection.type === "month") {
      const idx = MONTH_NAMES.indexOf(selection.month);
      from = new Date(selection.year, idx, 1);
      const lastDay = new Date(selection.year, idx + 1, 0);
      const today = new Date(); today.setHours(0,0,0,0);
      to = lastDay < today ? lastDay : today;
      label = `${selection.month} ${selection.year}`;
    } else {
      from = new Date(selection.year, 0, 1);
      const lastDay = new Date(selection.year, 11, 31);
      const today = new Date(); today.setHours(0,0,0,0);
      to = lastDay < today ? lastDay : today;
      label = `${selection.year}`;
    }

    setRange({ from: isoDate(from), to: isoDate(to), label });
  }, [selection, setRange]);

  const now = new Date();
  const isFutureMonth = (monthIdx: number, year: number) =>
    year > now.getFullYear() || (year === now.getFullYear() && monthIdx > now.getMonth());
  const yearIsFuture = pickerYear > now.getFullYear();

  const compareOpts = compareOptionsFor(selection);
  const effectiveCompareMode = compareOpts.some((o) => o.key === compareMode)
    ? compareMode
    : compareOpts[0].key;

  const buttonPrefix = selection.type === "preset" ? PRESETS.find((p) => p.key === selection.key)!.label : null;
  const buttonValue =
    selection.type === "preset"
      ? buttonRange(selection.key)
      : selection.type === "month"
        ? `${selection.month} ${selection.year}`
        : `${selection.year} · Full Year`;

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {compare && (
        <div className="flex items-center gap-1.5 rounded-md border border-green-200 bg-green-50 px-2.5 py-1.5 text-[11px] font-medium text-green-700">
          <span className="h-1.75 w-1.75 rounded-full bg-green-500" />
          vs {compareLabel(selection, effectiveCompareMode)}
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex cursor-pointer items-center gap-1.5 rounded-[7px] border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-ink shadow-sm"
      >
        <IconCalendar className="h-3.5 w-3.5 text-neutral-400" />
        {buttonPrefix && <span className="font-normal text-neutral-400">{buttonPrefix}:</span>}
        <span>{buttonValue}</span>
        {compare && (
          <span className="ml-0.5 rounded-[4px] bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
            Compare
          </span>
        )}
        <span className="ml-0.5 text-[10px] text-neutral-400">▾</span>
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-72 overflow-hidden rounded-[10px] border border-neutral-200 bg-white shadow-lg">
          <div className="px-3.5 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
            Date Range
          </div>
          {PRESETS.map((p) => {
            const isSelected = selection.type === "preset" && selection.key === p.key;
            return (
              <button
                key={p.key}
                onClick={() => {
                  setSelection({ type: "preset", key: p.key });
                  setOpen(false);
                }}
                className={`flex w-full cursor-pointer items-center gap-2.5 px-3.5 py-1.5 text-left transition-colors ${
                  isSelected ? "bg-brand/10" : "hover:bg-neutral-50"
                }`}
              >
                <span
                  className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border-2 ${
                    isSelected ? "border-amber-500" : "border-neutral-300"
                  }`}
                >
                  {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-brand" />}
                </span>
                <span>
                  <span className={`block text-[13px] ${isSelected ? "font-semibold text-ink" : "font-normal text-neutral-700"}`}>
                    {p.label}
                  </span>
                  <span className="block text-[10px] text-neutral-400">{presetSub(p.key)}</span>
                </span>
              </button>
            );
          })}

          <div className="border-t border-neutral-100 px-3.5 pb-2.5 pt-2">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPickerYear((y) => y - 1)}
                  className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[5px] border border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                >
                  ‹
                </button>
                <span className="min-w-[38px] text-center text-[13px] font-bold">{pickerYear}</span>
                <button
                  onClick={() => setPickerYear((y) => y + 1)}
                  className="flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-[5px] border border-neutral-200 text-neutral-500 hover:bg-neutral-50"
                >
                  ›
                </button>
              </div>
              <button
                disabled={yearIsFuture}
                onClick={() => {
                  setSelection({ type: "year", year: pickerYear });
                  setOpen(false);
                }}
                className={`rounded-[5px] border px-2.5 py-1 text-[11.5px] font-medium ${
                  yearIsFuture
                    ? "cursor-not-allowed border-neutral-100 text-neutral-300"
                    : selection.type === "year" && selection.year === pickerYear
                      ? "cursor-pointer border-brand bg-brand/10 font-bold text-ink"
                      : "cursor-pointer border-neutral-200 text-ink hover:bg-neutral-50"
                }`}
              >
                Full Year
              </button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {MONTH_NAMES.map((mn, idx) => {
                const isSelected =
                  selection.type === "month" && selection.month === mn && selection.year === pickerYear;
                const disabled = isFutureMonth(idx, pickerYear);
                return (
                  <button
                    key={mn}
                    disabled={disabled}
                    onClick={() => {
                      setSelection({ type: "month", month: mn, year: pickerYear });
                      setOpen(false);
                    }}
                    className={`rounded-[5px] border py-1 text-[11.5px] ${
                      disabled
                        ? "cursor-not-allowed border-neutral-100 text-neutral-300"
                        : isSelected
                          ? "cursor-pointer border-brand bg-brand/10 font-bold text-ink"
                          : "cursor-pointer border-neutral-100 font-normal text-neutral-600 hover:bg-neutral-50"
                    }`}
                  >
                    {mn}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-neutral-100 bg-neutral-50">
            <div className="flex items-center justify-between px-3.5 py-2.5">
              <div>
                <div className="text-[12.5px] font-semibold text-ink">Compare</div>
                <div className="mt-0.5 text-[10px] text-neutral-400">
                  {compare ? `vs ${compareLabel(selection, effectiveCompareMode)}` : "off"}
                </div>
              </div>
              <button
                onClick={() => setCompare((v) => !v)}
                className={`relative h-[22px] w-10 shrink-0 cursor-pointer rounded-full transition-colors ${
                  compare ? "bg-green-500" : "bg-neutral-300"
                }`}
              >
                <span
                  className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${
                    compare ? "left-[21px]" : "left-[3px]"
                  }`}
                />
              </button>
            </div>

            {compare && (
              <div className="px-3.5 pb-3">
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-neutral-400">
                  Compare to
                </div>
                {compareOpts.map((o) => {
                  const isSelected = effectiveCompareMode === o.key;
                  return (
                    <button
                      key={o.key}
                      onClick={() => setCompareMode(o.key)}
                      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-[6px] px-2 py-1.5 text-left ${
                        isSelected ? "border border-green-200 bg-white" : "border border-transparent"
                      }`}
                    >
                      <span
                        className={`flex h-3 w-3 shrink-0 items-center justify-center rounded-full border-2 ${
                          isSelected ? "border-green-500" : "border-neutral-300"
                        }`}
                      >
                        {isSelected && <span className="h-1 w-1 rounded-full bg-green-500" />}
                      </span>
                      <span>
                        <span className={`block text-[12px] ${isSelected ? "font-semibold text-ink" : "font-normal text-neutral-700"}`}>
                          {o.label}
                        </span>
                        <span className="block text-[10px] text-neutral-400">
                          {compareLabel(selection, o.key)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
      <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 5.5h11" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4 1.5v2M10 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}
