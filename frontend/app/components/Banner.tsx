"use client";

// Patient banners: a soft, muted colour per patient (stable from the id) with a
// quiet heart-rhythm line across it. Used on library cards, assignment cards and
// the patient page header, so a patient keeps the same colour everywhere.

import Link from "next/link";
import type { ReactNode } from "react";
import Thumb from "./Thumb";

const PALETTE = ["#4d6a87", "#3f7268", "#6b5b8e", "#4f6b4a", "#5c6670", "#6a5f4b", "#3f6680", "#7a5468"];

export function bannerColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** A heart-rhythm trace; the spike lands at a different spot per patient. */
function Trace({ seed }: { seed: number }) {
  const x = 140 + (seed % 5) * 28;
  const d = `M0 70 H${x} l8 -6 l6 6 l6 0 l7 -38 l8 64 l6 -26 l5 0 l8 -8 l8 8 H420`;
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 420 120" preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx="372" cy="-20" r="90" fill="#fff" fillOpacity="0.06" />
      <circle cx="420" cy="120" r="70" fill="#000" fillOpacity="0.06" />
    </svg>
  );
}

function seedOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 7)) >>> 0;
  return h;
}

export function Banner({ id, title, subtitle, tall = false, children }: { id: string; title: string; subtitle?: string; tall?: boolean; children?: ReactNode }) {
  return (
    <div
      className={"relative overflow-hidden rounded-xl text-white " + (tall ? "min-h-[180px] p-6 sm:p-8" : "h-[100px] px-5 py-4")}
      style={{ background: bannerColor(id) }}
    >
      <Trace seed={seedOf(id)} />
      <div className="relative">
        <p className={(tall ? "text-[34px] leading-tight" : "text-[22px] leading-7") + " truncate"}>{title}</p>
        {subtitle && <p className={(tall ? "mt-1 text-[17px]" : "text-sm") + " truncate text-white/90"}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** Library / assignment card: banner on top, portrait overlapping it, a footer row. */
export function PatientCard({
  id,
  href,
  title,
  subtitle,
  portrait,
  name,
  body,
  footer,
}: {
  id: string;
  href: string;
  title: string;
  subtitle?: string;
  portrait: string | null;
  name: string;
  body?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface transition-shadow hover:shadow-[0_1px_3px_rgba(60,64,67,.3),0_4px_8px_3px_rgba(60,64,67,.15)]">
      <Link href={href} className="relative block">
        <div className="relative h-[100px] overflow-hidden px-4 py-3.5 text-white" style={{ background: bannerColor(id) }}>
          <Trace seed={seedOf(id)} />
          <p className="relative truncate pr-16 text-[22px] leading-7 hover:underline">{title}</p>
          {subtitle && <p className="relative truncate pr-16 text-sm text-white/90">{subtitle}</p>}
        </div>
        <span className="absolute -bottom-9 right-4 rounded-full ring-4 ring-white">
          <Thumb name={name} portrait={portrait} size={72} />
        </span>
      </Link>
      <div className="min-h-[96px] flex-1 px-4 pb-3 pt-4 pr-24 text-sm leading-5 text-ink-2">{body}</div>
      {footer && <div className="flex min-h-[52px] items-center gap-1 border-t border-line px-3">{footer}</div>}
    </div>
  );
}

