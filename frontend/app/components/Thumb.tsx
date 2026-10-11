"use client";

import { useState } from "react";
import { fileUrl } from "@/lib/api";

// Round portrait, or initials when the patient has no photo (never another patient's face).
export default function Thumb({ name, portrait, size = 48 }: { name: string; portrait: string | null; size?: number }) {
  const [ok, setOk] = useState(true);
  const src = fileUrl(portrait);
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#e8eaed] font-medium text-ink-2"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
    >
      {src && ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" onError={() => setOk(false)} />
      ) : (
        initials
      )}
    </span>
  );
}
