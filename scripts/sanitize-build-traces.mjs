import fs from "node:fs";
import path from "node:path";

// Next 15 constructs absolute exclusion globs with Windows separators. In that
// environment picomatch can treat backslashes as escapes and miss private data.
// Normalize resolved paths explicitly before a deployment consumes NFT manifests.
const project = process.cwd();
const build = path.join(project, ".next");
const privateRoots = [".data", "storage", "docs", "detali-identidade"].map(name => path.resolve(project, name).toLowerCase());
function privateFile(file) {
  const absolute = path.resolve(file).toLowerCase();
  return privateRoots.some(root => absolute === root || absolute.startsWith(root + path.sep)) ||
    path.dirname(absolute) === project.toLowerCase() && /^\.env(?:\.|$)/i.test(path.basename(absolute));
}
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : entry.isFile() && entry.name.endsWith(".nft.json") ? [file] : [];
  });
}
if (!fs.existsSync(build)) throw new Error("Compile o sistema antes de verificar os manifestos.");
const manifests = walk(build);
let removed = 0;
for (const file of manifests) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(manifest.files)) throw new Error("Formato de manifesto de compilação inesperado.");
  const files = manifest.files.filter(item => !privateFile(path.resolve(path.dirname(file), item)));
  removed += manifest.files.length - files.length;
  if (files.length !== manifest.files.length) fs.writeFileSync(file, JSON.stringify({ ...manifest, files }));
}
for (const file of manifests) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.files.some(item => privateFile(path.resolve(path.dirname(file), item)))) throw new Error("Um manifesto ainda referencia dados persistentes.");
}
console.log(`Manifestos verificados: ${manifests.length}. Referências privadas removidas: ${removed}. Dados e arquivos originais preservados.`);
