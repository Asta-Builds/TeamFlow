// Files that were over the size and complexity limits when the factory gates
// arrived (2026-11-07). They are exempt from "complexity" and "max-lines" so the
// gate could ship without a rewrite; every other file must stay under them.
//
// Shrink only. When you split or simplify one of these, delete its line.
// Never add a file here: split it instead.

/** Paths are relative to this package; glob characters in them are escaped below. */
const files = [
  "src/agents/agents.service.ts",
  "src/auth/auth.service.ts",
  "src/auth/clerk.service.ts",
  "src/auth/keycloak.service.ts",
  "src/mcp/mcp.service.ts",
  "src/organizations/organizations.service.ts",
  "src/projects/projects.service.ts",
  "src/pulse/pulse.service.ts",
  "src/seo/seo.service.ts",
  "src/tasks/tasks.service.ts",
  "src/users/users.service.ts",
];

/** ESLint `files` entries are globs: escape Next.js route segments like (app) and [id]. */
export const LEGACY_OVERSIZED = files.map((path) => path.replace(/[()[\]{}*?!+@]/g, "\\$&"));
