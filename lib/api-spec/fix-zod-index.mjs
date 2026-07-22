import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.resolve(here, "..", "api-zod", "src", "index.ts");

// Orval emits both runtime Zod schemas and TypeScript response models with a
// few colliding names (for example GetProductEvaluationParams). The API server
// only consumes runtime validators from this package; client response types
// come from @workspace/api-client-react.
await writeFile(indexPath, [
  'export * from "./generated/api";',
  "// Runtime validation schemas are the public surface of this package. Response",
  "// and client data types are exported by @workspace/api-client-react.",
  "",
].join("\n"));
