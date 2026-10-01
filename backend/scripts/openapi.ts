// Writes the API spec to a file without starting the server or the queue
// workers (which would pick up the dev queue's jobs). The frontend's types
// come from it:
//   bun run openapi ../frontend/openapi.json
//   cd ../frontend && bunx openapi-typescript openapi.json -o src/lib/api-schema.d.ts
import { app } from "../src/app";

const out = process.argv[2] ?? "openapi.json";
const response = await app.request("/openapi.json");
if (!response.ok) throw new Error(`openapi.json: HTTP ${response.status}`);
await Bun.write(out, await response.text());
console.log(`wrote ${out}`);
// Route modules open Redis connections for their queues.
process.exit(0);
