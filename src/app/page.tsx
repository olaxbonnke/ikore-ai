import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 p-6">
      <div>
        <p className="text-sm font-medium uppercase tracking-wide text-oko-green">Ikore AI · Ìkórè</p>
        <h1 className="mt-2 text-3xl font-semibold text-oko-green">Farm decision advisor</h1>
        <p className="mt-3 text-base leading-relaxed text-oko-soil/90">
          Chat, evidence panel, and morning briefings for maize farmers in Oyo State. Powered by
          meterless memory and live federated climate & market data.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <span className="rounded-full bg-oko-maize/30 px-3 py-1 text-sm text-oko-green">
          Meterless H-MEM
        </span>
        <span className="rounded-full bg-oko-maize/30 px-3 py-1 text-sm text-oko-green">
          Zetaris Live Data
        </span>
      </div>
      <Link
        href="/briefings"
        className="inline-flex min-h-11 items-center justify-center rounded-lg bg-oko-green px-4 text-base font-medium text-white"
      >
        Morning briefings (placeholder)
      </Link>
    </main>
  );
}
