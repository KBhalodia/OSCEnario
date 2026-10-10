// A small footer shown at the bottom of pages.
// It reminds users that this is a demo built for a hackathon
// and that no real patient data is used.
export default function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-slate-500 sm:px-6">
        <p className="font-medium text-slate-600">
          Twinverse &middot; Rutgers Health Hack demo
        </p>
        <p className="mt-1">
          Prototype only. All patient information shown is synthetic example
          data. Nothing here is medical advice.
        </p>
      </div>
    </footer>
  );
}
