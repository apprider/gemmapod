import { loader } from "fumadocs-core/source";
import { docs } from "@/.source";

// Bridge a fumadocs-mdx <-> fumadocs-core ABI mismatch. In
// fumadocs-mdx@11.10 `toFumadocsSource()` returns `{ files: () => [...] }`
// (lazy), while fumadocs-core@15.8's loader expects `files` to be a
// resolved array. The declared TS types still claim `files` is the array,
// but at runtime it's the function — so cast through `unknown` and resolve
// once at module-eval time.
const rawSource = docs.toFumadocsSource() as unknown as {
  files: unknown[] | (() => unknown[]);
  [k: string]: unknown;
};
const resolvedFiles =
  typeof rawSource.files === "function" ? rawSource.files() : rawSource.files;

export const source = loader({
  baseUrl: "/docs",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  source: { ...rawSource, files: resolvedFiles } as any,
});
