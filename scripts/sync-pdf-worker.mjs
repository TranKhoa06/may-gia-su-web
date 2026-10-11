import { createRequire } from "node:module";
import { readFile, mkdir, copyFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const packagePath = require.resolve("pdfjs-dist/package.json");
const { version } = JSON.parse(await readFile(packagePath, "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Unsupported PDF.js version.");
const workerDirectory = resolve("public", "pdf-worker");
await mkdir(workerDirectory, { recursive: true });
await copyFile(join(dirname(packagePath), "build", "pdf.worker.min.mjs"), join(workerDirectory, `pdf.worker-${version}.min.mjs`));
