import Link from "next/link";

export default function BriefingsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-lg p-6">
      <Link href="/" className="text-sm font-medium text-oko-green underline">
        ← Back to Farm Advisor
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-oko-green">Morning briefings</h1>
      <div className="mt-4 rounded-lg border border-oko-soil/20 bg-oko-maize/20 p-4">
        <p className="text-base font-semibold text-oko-soil">Planned — not built yet</p>
        <p className="mt-1 text-sm text-oko-soil/80">
          Overnight autonomous briefings and replanning jobs are scheduled for a future release.
        </p>
      </div>
    </main>
  );
}
