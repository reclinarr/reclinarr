import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const webRoot = new URL("../", import.meta.url);
const dist = new URL("dist/", webRoot);
cpSync(fileURLToPath(new URL("public/", webRoot)), fileURLToPath(dist), { recursive: true });

const index = new URL("index.html", dist);
const html = readFileSync(index, "utf8").replace(
  "</head>",
  '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />\n' +
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />\n' +
  '<meta name="theme-color" content="#11141b" />\n</head>',
);
writeFileSync(index, html);
