import Link from "next/link";
import NavBar from "./components/NavBar";
import Footer from "./components/Footer";

// The three main areas of the app. We describe each one with a short blurb
// so new users understand what the platform does.
const features = [
  {
    title: "Patient Studio",
    href: "/studio",
    emoji: "🧑‍⚕️",
    description:
      "Faculty build virtual patient profiles: symptoms, history, medications, and learning objectives.",
    cta: "Open Studio",
  },
  {
    title: "Student Encounter",
    href: "/encounter",
    emoji: "💬",
    description:
      "Students practice clinical interviews and reasoning with a virtual patient in a safe space.",
    cta: "Start Encounter",
  },
  {
    title: "Feedback",
    href: "/feedback",
    emoji: "📊",
    description:
      "Review performance, strengths, and areas to improve after each practice encounter.",
    cta: "View Feedback",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-slate-50 font-sans text-slate-900">
      <NavBar />

      {/* Hero section: the big introduction at the top of the page */}
      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-800">
              Healthcare education, reimagined
            </span>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Practice medicine with{" "}
              <span className="text-teal-600">virtual patients</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              PatientVerse AI helps faculty create realistic virtual patient
              cases and lets students practice clinical skills through safe,
              repeatable encounters.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href="/studio"
                className="inline-flex h-12 w-full items-center justify-center rounded-full bg-teal-600 px-8 text-sm font-semibold text-white transition-colors hover:bg-teal-700 sm:w-auto"
              >
                Build a Patient
              </Link>
              <Link
                href="/encounter"
                className="inline-flex h-12 w-full items-center justify-center rounded-full border border-slate-300 bg-white px-8 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-50 sm:w-auto"
              >
                Try an Encounter
              </Link>
            </div>
          </div>
        </section>

        {/* Feature cards: one card per main area of the app */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {features.map((feature) => (
              <Link
                key={feature.href}
                href={feature.href}
                className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:border-teal-300 hover:shadow-md"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-teal-50 text-2xl">
                  {feature.emoji}
                </div>
                <h2 className="mt-4 text-lg font-semibold text-slate-900">
                  {feature.title}
                </h2>
                <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">
                  {feature.description}
                </p>
                <span className="mt-4 text-sm font-medium text-teal-600 group-hover:text-teal-700">
                  {feature.cta} &rarr;
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* A short "how it works" strip to make the flow clear */}
        <section className="border-y border-slate-200 bg-white">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-14 sm:grid-cols-3 sm:px-6">
            {[
              {
                step: "1",
                title: "Faculty design cases",
                text: "Create virtual patients in Patient Studio with symptoms, history, and learning goals.",
              },
              {
                step: "2",
                title: "Students practice",
                text: "Learners work through encounters and build clinical reasoning safely.",
              },
              {
                step: "3",
                title: "Everyone improves",
                text: "Feedback highlights strengths and areas to grow after each session.",
              },
            ].map((item) => (
              <div key={item.step} className="flex flex-col items-start">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600 text-sm font-bold text-white">
                  {item.step}
                </span>
                <h3 className="mt-3 text-base font-semibold text-slate-900">
                  {item.title}
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
