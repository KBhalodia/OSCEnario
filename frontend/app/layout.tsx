import type { Metadata } from "next";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "./globals.css";

// Roboto is bundled from npm (no network fetch at build or demo time).
export const metadata: Metadata = {
  title: "OSCEnario",
  description: "Practice the patient-encounter stations of your OSCE.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
