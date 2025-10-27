import { build, type InlineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import fg from "fast-glob";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import pkg from "./package.json" with { type: "json" };
import tailwindcss from "@tailwindcss/vite";

const entries = fg.sync("src/examples/**/index.{tsx,jsx}");
const outDir = "assets";

const PER_ENTRY_CSS_GLOB = "**/*.{css,pcss,scss,sass}";
const GLOBAL_CSS_LIST = [path.resolve("src/index.css")];

const builtNames: string[] = [];

function wrapEntryPlugin(
  virtualId: string,
  entryFile: string,
  cssPaths: string[]
): Plugin {
  return {
    name: `virtual-entry-wrapper:${entryFile}`,
    resolveId(id) {
      if (id === virtualId) return id;
    },
    load(id) {
      if (id !== virtualId) {
        return null;
      }

      const cssImports = cssPaths
        .map((css) => `import ${JSON.stringify(css)};`)
        .join("\n");

      return `
    ${cssImports}
    export * from ${JSON.stringify(entryFile)};

    import * as __entry from ${JSON.stringify(entryFile)};
    export default (__entry.default ?? __entry.App);

    import ${JSON.stringify(entryFile)};
  `;
    },
  };
}

fs.rmSync(outDir, { recursive: true, force: true });

for (const file of entries) {
  // Extract name from path like "src/examples/todo/index.jsx" -> "todo"
  const name = path.basename(path.dirname(file));

  const entryAbs = path.resolve(file);
  const entryDir = path.dirname(entryAbs);

  // Collect CSS for this entry
  const perEntryCss = fg.sync(PER_ENTRY_CSS_GLOB, {
    cwd: entryDir,
    absolute: true,
    dot: false,
  });

  // Global CSS
  const globalCss = GLOBAL_CSS_LIST.filter((p) => fs.existsSync(p));

  // Final CSS list (global first)
  const cssToInclude = [...globalCss, ...perEntryCss].filter((p) =>
    fs.existsSync(p)
  );

  const virtualId = `\0virtual-entry:${entryAbs}`;

  const createConfig = (): InlineConfig => ({
    plugins: [
      wrapEntryPlugin(virtualId, entryAbs, cssToInclude),
      tailwindcss(),
      react(),
      {
        name: "remove-manual-chunks",
        outputOptions(options) {
          if ("manualChunks" in options) {
            delete (options as any).manualChunks;
          }
          return options;
        },
      },
    ],
    esbuild: {
      jsx: "automatic",
      jsxImportSource: "react",
      target: "es2022",
    },
    build: {
      target: "es2022",
      outDir,
      emptyOutDir: false,
      minify: "esbuild",
      cssCodeSplit: false,
      rollupOptions: {
        input: virtualId,
        output: {
          format: "es",
          entryFileNames: `${name}.js`,
          inlineDynamicImports: true,
          assetFileNames: (info) =>
            (info.name || "").endsWith(".css")
              ? `${name}.css`
              : `[name]-[hash][extname]`,
        },
        preserveEntrySignatures: "allow-extension",
        treeshake: true,
      },
    },
  });

  console.group(`Building ${name}`);
  await build(createConfig());
  console.groupEnd();
  builtNames.push(name);
  console.log(`Built ${name}`);
}

const outputs = fs
  .readdirSync("assets")
  .filter((f) => f.endsWith(".js") || f.endsWith(".css"))
  .map((f) => path.join("assets", f))
  .filter((p) => fs.existsSync(p));

const h = crypto
  .createHash("sha256")
  .update(pkg.version, "utf8")
  .digest("hex")
  .slice(0, 4);

console.group("Hashing outputs");
for (const out of outputs) {
  const dir = path.dirname(out);
  const ext = path.extname(out);
  const base = path.basename(out, ext);
  const newName = path.join(dir, `${base}-${h}${ext}`);

  fs.renameSync(out, newName);
  console.log(`${out} -> ${newName}`);
}
console.groupEnd();

const defaultBaseUrl = "http://localhost:8000";
const baseUrlCandidate = process.env.BASE_URL?.trim() ?? "";
const baseUrlRaw = baseUrlCandidate.length > 0 ? baseUrlCandidate : defaultBaseUrl;
const normalizedBaseUrl = baseUrlRaw.replace(/\/+$/, "") || defaultBaseUrl;
console.log(`Using BASE_URL ${normalizedBaseUrl} for generated HTML`);

for (const name of builtNames) {
  const dir = outDir;
  const hashedHtmlPath = path.join(dir, `${name}-${h}.html`);
  const liveHtmlPath = path.join(dir, `${name}.html`);
  const html = `<!doctype html>
<html>
<head>
  <script type="module" src="${normalizedBaseUrl}/${name}-${h}.js"></script>
  <link rel="stylesheet" href="${normalizedBaseUrl}/${name}-${h}.css">
</head>
<body>
  <div id="${name}-root"></div>
</body>
</html>
`;
  fs.writeFileSync(hashedHtmlPath, html, { encoding: "utf8" });
  fs.writeFileSync(liveHtmlPath, html, { encoding: "utf8" });
  console.log(`${liveHtmlPath}`);
}
