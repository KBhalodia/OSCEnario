import type { Metadata } from "next";
import "./globals.css";

// System fonts on purpose: no network fetch at build/demo time.
export const metadata: Metadata = {
  title: "Twinverse",
  description: "Virtual patient encounters for health-professions education.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
