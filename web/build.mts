/**
 * Build script that bundles React components into standalone assets.
 * Finds all components in src/components/, bundles them with Vite, and generates
 * HTML/CSS/JS files in the dist/ directory for use by the MCP server.
 */
import { build, type InlineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fg from "fast-glob";
import path from "path";
import fs from "fs";
import tailwindcss from "@tailwindcss/vite";

// Find all component entry points
const entries = fg.sync("src/components/**/index.{tsx,jsx}");
const outDir = "dist";

if (!entries.length) {
  console.log("No components found in src/components/");
  process.exit(0);
}

fs.rmSync(outDir, { recursive: true, force: true });

for (const file of entries) {
  // Extract component name from path like "src/components/todo/index.jsx" -> "todo"
  const componentName = path.basename(path.dirname(file));
  const entryAbs = path.resolve(file);
  const entryDir = path.dirname(entryAbs);
  
  // Find CSS files in the component directory
  const cssFiles = fg.sync("**/*.css", {
    cwd: entryDir,
    absolute: true,
  });
  
  // Global CSS
  const globalCss = path.resolve("src/index.css");
  const cssToInclude = [globalCss, ...cssFiles].filter((p) => fs.existsSync(p));

  // Create a virtual entry that imports CSS
  const cssImports = cssToInclude
    .map((css) => {
      // Convert absolute path to relative path from project root, ensuring it starts with ./
      const relativePath = path.relative(process.cwd(), css).replace(/\\/g, "/");
      const normalizedPath = relativePath.startsWith("./") ? relativePath : `./${relativePath}`;
      return `import ${JSON.stringify(normalizedPath)};`;
    })
    .join("\n");
  
  const virtualEntry = `
${cssImports}
export * from ${JSON.stringify(entryAbs)};
import * as __entry from ${JSON.stringify(entryAbs)};
export default (__entry.default ?? __entry.App ?? __entry);
import ${JSON.stringify(entryAbs)};
`;

  const createConfig = (): InlineConfig => ({
    plugins: [
      {
        name: "virtual-entry",
        resolveId(id) {
          if (id === "\0virtual-entry") return id;
        },
        load(id) {
          if (id === "\0virtual-entry") return virtualEntry;
        },
      },
      tailwindcss(),
      react(),
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
        input: "\0virtual-entry",
        output: {
          format: "es",
          entryFileNames: `${componentName}.js`,
          inlineDynamicImports: true,
          assetFileNames: (info) =>
            (info.name || "").endsWith(".css")
              ? `${componentName}.css`
              : `[name][extname]`,
        },
      },
    },
  });

  console.log(`Building ${componentName}...`);
  await build(createConfig());
  
  // Generate HTML file for the component
  const htmlPath = path.join(outDir, `${componentName}.html`);
  const defaultBaseUrl = process.env.BASE_URL?.trim() || "http://localhost:8000";
  const baseUrl = defaultBaseUrl.replace(/\/+$/, "");
  
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script type="module" src="${baseUrl}/${componentName}.js"></script>
  <link rel="stylesheet" href="${baseUrl}/${componentName}.css">
</head>
<body>
  <div id="${componentName}-root"></div>
</body>
</html>`;
  
  fs.writeFileSync(htmlPath, html, { encoding: "utf8" });
  console.log(`  ✓ ${htmlPath}`);
}

console.log(`\n✅ Build complete! Output in ${outDir}/`);

