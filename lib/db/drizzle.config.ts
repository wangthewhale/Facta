import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  // This read-only catalog table is maintained outside Drizzle and powers
  // fallback product search. Excluding it prevents schema pushes/deploy checks
  // from treating its absence in the typed schema as permission to delete it.
  tablesFilter: ["!facta_catalog_seed"],
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
