import esbuild from "esbuild";
import builtins from "builtin-modules";
import { copyFile, mkdir } from "fs/promises";

const prod = process.argv[2] === "production";

// Ensure dist/ exists
await mkdir("./dist", { recursive: true });

// Copy static assets (always, before watch starts)
async function copyAssets() {
  await copyFile("./manifest.json", "./dist/manifest.json");
  await copyFile("./styles.css", "./dist/styles.css");
}
await copyAssets();

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", ...builtins],
  format: "cjs",
  target: "es2020",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js",
  minify: prod,
  logLevel: "info",
  // Re-copy assets on every rebuild (watch mode)
  plugins: [
    {
      name: "copy-assets-on-rebuild",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length === 0) {
            await copyAssets();
            if (!prod) console.log("[Tacit] Rebuilt → dist/");
          }
        });
      },
    },
  ],
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
  console.log("✓ Production build complete → dist/");
  process.exit(0);
} else {
  await ctx.watch();
  console.log("Watching for changes... (output: dist/)");
}
