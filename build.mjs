import esbuild from "esbuild";

const opts = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "bundle.js",
  format: "iife",
  target: "es2020",
  sourcemap: true,
  loader: { ".glb": "file" },
  logLevel: "info",
};

if (process.argv.includes("--watch")) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(opts);
}
