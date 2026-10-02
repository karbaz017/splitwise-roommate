// Dependency-free lint: syntax-check every JavaScript file.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['server.js', 'src', 'public/js', 'test', 'scripts'];
const files = [];
const walk = (p) => {
  if (!fs.existsSync(p)) return;
  if (fs.statSync(p).isDirectory()) fs.readdirSync(p).forEach((f) => walk(path.join(p, f)));
  else if (/\.(m?js)$/.test(p)) files.push(p);
};
roots.forEach(walk);
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error(`✖ ${f}\n${e.stderr}`); }
}
console.log(bad ? `${bad} file(s) failed` : `✔ ${files.length} files OK`);
process.exit(bad ? 1 : 0);
