import { defineConfig } from "vitest/config";

// Minimal Vitest setup for unit-testing pure logic (e.g. the chat engine).
// We run in a Node environment (no DOM needed) and only pick up our own test
// files, ignoring Next.js build output and dependencies.
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts"],
    exclude: ["node_modules", ".next"],
  },
});
