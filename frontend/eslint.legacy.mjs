// Files that were over the size and complexity limits when the factory gates
// arrived (2026-11-07). They are exempt from "complexity" and "max-lines" so the
// gate could ship without a rewrite; every other file must stay under them.
//
// Shrink only. When you split or simplify one of these, delete its line.
// Never add a file here: split it instead.

/** Paths are relative to this package; glob characters in them are escaped below. */
const files = [
  "src/app/(app)/billing/page.tsx",
  "src/app/(app)/compliance/page.tsx",
  "src/app/(app)/dashboard/page.tsx",
  "src/app/(app)/deployments/page.tsx",
  "src/app/(app)/layout.tsx",
  "src/app/(app)/projects/[id]/page.tsx",
  "src/app/(app)/projects/page.tsx",
  "src/app/(app)/pulse/page.tsx",
  "src/app/(app)/queues/page.tsx",
  "src/app/(app)/settings/page.tsx",
  "src/app/(app)/team/page.tsx",
  "src/app/page.tsx",
  "src/components/generative/AgentReasoningTerminal.tsx",
  "src/components/generative/DeploymentStatusCard.tsx",
  "src/components/generative/GenerativeMessageRenderer.tsx",
  "src/components/generative/PullRequestCard.tsx",
  "src/components/generative/ValidationContractCard.tsx",
  "src/lib/api.ts",
  "src/lib/queries.ts",
  "src/lib/types.ts",
  "src/lib/useAgentStream.ts",
];

/** ESLint `files` entries are globs: escape Next.js route segments like (app) and [id]. */
export const LEGACY_OVERSIZED = files.map((path) => path.replace(/[()[\]{}*?!+@]/g, "\\$&"));
