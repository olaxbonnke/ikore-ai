import Link from "next/link";

export default function BriefingsPage() {
  return (
    <main className="mx-auto min-h-screen max-w-lg p-6">
      <Link href="/" className="text-sm text-oko-green underline">
        ← Back
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-oko-green">Morning briefings</h1>
      <p className="mt-2 text-oko-soil/90">Overnight replanning runs here after Day 5.</p>
    </main>
  );
}
