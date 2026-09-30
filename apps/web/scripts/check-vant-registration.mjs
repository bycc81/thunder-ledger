import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url));
const mainFile = fileURLToPath(new URL('../src/main.ts', import.meta.url));

async function vueFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return vueFiles(path);
    return entry.isFile() && entry.name.endsWith('.vue') ? [path] : [];
  }));
  return nested.flat();
}

function componentName(tag) {
  return tag.slice(4).split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join('');
}

const mainSource = await readFile(mainFile, 'utf8');
const registration = mainSource.match(/\[([^\]]+)\]\.forEach\(\(component\) => app\.use\(component\)\)/s);
if (!registration) {
  console.error('无法解析 Vant 组件注册列表：apps/web/src/main.ts');
  process.exit(1);
}

const registered = new Set(registration[1].split(',').map((name) => name.trim()).filter(Boolean));
const tags = new Set();
for (const file of await vueFiles(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  for (const match of source.matchAll(/<\/?(van-[a-z0-9-]+)\b/g)) tags.add(match[1]);
}

const missing = [...tags].map((tag) => ({ tag, name: componentName(tag) })).filter(({ name }) => !registered.has(name));
if (missing.length) {
  console.error('以下 Vant 模板组件未在 apps/web/src/main.ts 注册：');
  for (const { tag, name } of missing) console.error(`- <${tag}>：请注册 ${name}`);
  process.exit(1);
}

console.log(`Vant 组件注册检查通过（${tags.size} 个模板组件）。`);
