import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: projectRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/**": ["./drizzle/**/*.sql"],
    "/admin": ["./drizzle/**/*.sql"],
    "/api/import/batchwise": ["./data/source/Batchwise.pdf"],
    "/api/import/catalog": ["./course catalogs/computer science.pdf"],
  },
};

export default nextConfig;
