// The Twinverse main dashboard.
//
// This page is intentionally thin: it just renders the DashboardShell, which
// is a Client Component (it owns the interactive Professor/Student role toggle
// and reads the saved role from localStorage).
import DashboardShell from "./dashboard/DashboardShell";

export default function Home() {
  return <DashboardShell />;
}
