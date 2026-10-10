import Link from "next/link";

// A simple, shared navigation bar used across pages.
// `Link` comes from Next.js and handles client-side navigation
// (it works like an <a> tag but is faster between pages).

// We keep the list of links in an array so it's easy to add/remove items.
const navLinks = [
  { label: "Patient Studio", href: "/studio" },
  { label: "Student Encounter", href: "/encounter" },
  { label: "Feedback", href: "/feedback" },
];

export default function NavBar() {
  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
        {/* Logo / brand links back to the homepage */}
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-600 text-sm font-bold text-white">
            PV
          </span>
          <span className="text-lg font-semibold text-slate-900">
            PatientVerse <span className="text-teal-600">AI</span>
          </span>
        </Link>

        {/* Navigation links */}
        <ul className="flex items-center gap-1 sm:gap-2">
          {navLinks.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="rounded-md px-2 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-teal-700 sm:px-3"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
