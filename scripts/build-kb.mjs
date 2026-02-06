import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

const KB_DIR = path.resolve("kb/errors");
const OUT_FILE = path.resolve("public/errors.json");

function asArray(v) {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function validate(entry, filename) {
  const id = norm(entry.id);
  const title = norm(entry.title);
  const patterns = asArray(entry.patterns).map(norm).filter(Boolean);
  const fixSteps = asArray(entry.fixSteps).map(norm).filter(Boolean);

  if (!id) throw new Error(`Missing id in ${filename}`);
  if (!title) throw new Error(`Missing title in ${filename}`);
  if (!patterns.length) throw new Error(`Missing patterns in ${filename}`);
  if (!fixSteps.length) throw new Error(`Missing fixSteps in ${filename}`);

  const links = asArray(entry.links)
    .map((l) => ({ label: norm(l?.label || "Link"), url: norm(l?.url || "") }))
    .filter((l) => l.url);

  return {
    id,
    title,
    patterns,
    symptoms: entry.symptoms ? norm(entry.symptoms) : undefined,
    rootCause: entry.rootCause ? norm(entry.rootCause) : undefined,
    fixSteps,
    tags: asArray(entry.tags).map(norm).filter(Boolean),
    links,
  };
}

async function main() {
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });

  const files = (await fs.readdir(KB_DIR))
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();

  const items = [];
  const seen = new Set();

  for (const f of files) {
    const raw = await fs.readFile(path.join(KB_DIR, f), "utf8");
    const parsed = yaml.load(raw);

    if (!parsed || typeof parsed !== "object") throw new Error(`Invalid YAML in ${f}`);

    const item = validate(parsed, f);
    if (seen.has(item.id)) throw new Error(`Duplicate id '${item.id}' in ${f}`);
    seen.add(item.id);

    items.push(item);
  }

  await fs.writeFile(OUT_FILE, JSON.stringify(items, null, 2), "utf8");
  console.log(`Built KB: ${items.length} entries written to ${OUT_FILE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
