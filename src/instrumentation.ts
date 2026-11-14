// Runs once when the Next.js server starts: warm the opportunities cache so the first visitor
// doesn't pay the ~20 s cold fan-out. Not awaited — register() must not block server readiness.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmOpportunities } = await import("./lib/aggregate");
    warmOpportunities();
  }
}
