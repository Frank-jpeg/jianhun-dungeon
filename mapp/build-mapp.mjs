#!/usr/bin/env node
/*
 * 把仓库根目录的单文件 index.html 拆成微应用要求的五个基础文件，打成 app.zip。
 * 拆分是纯字符串切分，不改游戏代码一行；单文件版仍然双击就能玩。
 *
 *   node mapp/build-mapp.mjs
 *   MINI_APP_VERSION=1.0.1 node mapp/build-mapp.mjs
 *
 * 只用到 linux-do/mapp-developer-guide 里 sdk/pack.mjs 的 ZIP 打包（零依赖，纯 node）。
 * 默认从 ../_mapp-sdk/sdk 找，也可用 MAPP_SDK_DIR 指定。
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const SRC_HTML = join(REPO, 'index.html');
const OUT_WEB = join(HERE, 'dist', 'web');
const OUT_PKG = join(HERE, 'dist', 'package');

const SDK_DIR = process.env.MAPP_SDK_DIR
  ? resolve(process.env.MAPP_SDK_DIR)
  : resolve(REPO, '..', '_mapp-sdk', 'sdk');

let pack;
try {
  ({ pack } = await import(pathToFileURL(join(SDK_DIR, 'pack.mjs')).href));
} catch {
  console.error(`[x] 找不到 pack.mjs：${join(SDK_DIR, 'pack.mjs')}`);
  console.error('    克隆一份就行：');
  console.error('    git clone --depth 1 https://github.com/linux-do/mapp-developer-guide.git ../_mapp-sdk');
  process.exit(1);
}

const html = await readFile(SRC_HTML, 'utf8');

function slice(re, label) {
  const m = html.match(re);
  if (!m) throw new Error(`index.html 里找不到 ${label} —— 结构变了，先看下文件头尾`);
  return m[1];
}

const css = slice(/<style>([\s\S]*?)<\/style>/, '<style> 块').trim();
const script = slice(/<script>([\s\S]*?)<\/script>/, '<script> 块').trim();
const body = slice(/<body>([\s\S]*?)<\/body>/, '<body> 块');

// body 里只有一块 <script>，剥掉后剩下的才是平台要的正文片段
const fragment = body.replace(/<script>[\s\S]*?<\/script>/g, '').trim();

/* ---- 平台会拒的东西，本地先拦一遍 ---- */
const bad = [
  [/<script/i, '片段里还有 <script>'],
  [/<style/i, '片段里还有 <style>'],
  [/\son[a-z]+\s*=/i, '片段里有内联事件属性（onclick 这类）'],
  [/\sstyle\s*=\s*"/i, '片段里有内联 style 属性'],
  [/<html|<head|<body/i, '片段里带了文档级标签'],
  [/<iframe|<object/i, '片段里有 iframe/object'],
];
for (const [re, msg] of bad) if (re.test(fragment)) throw new Error(msg);

/* ---- manifest ---- */
const manifest = JSON.parse(await readFile(join(HERE, 'manifest.json'), 'utf8'));
if (process.env.MINI_APP_VERSION) manifest.version = process.env.MINI_APP_VERSION;
if (process.env.MINI_APP_ID) manifest.id = process.env.MINI_APP_ID;
const placeholderId = /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(manifest.id);

await rm(join(HERE, 'dist'), { recursive: true, force: true });
await mkdir(OUT_WEB, { recursive: true });
await writeFile(join(OUT_WEB, 'index.html'), fragment + '\n');
await writeFile(join(OUT_WEB, 'app.js'), script + '\n');
await writeFile(join(OUT_WEB, 'app.css'), css + '\n');
await writeFile(join(OUT_WEB, 'strings.json'), await readFile(join(HERE, 'strings.json'), 'utf8'));

const files = {};
for (const name of ['index.html', 'app.js', 'app.css', 'strings.json']) {
  files[name] = await readFile(join(OUT_WEB, name));
}

const result = await pack({ manifest, files, outputDirectory: OUT_PKG });

const kb = (n) => `${(n / 1024).toFixed(1)} KiB`;
console.log(`[ok] ${result.file}  ${kb(result.size)}`);
console.log(`     app ${manifest.name || '(未命名)'}  id ${manifest.id}  v${manifest.version}`);
console.log(`     权限 ${manifest.permissions.join(', ')}`);
console.log(`     拆出来：index.html ${kb(files['index.html'].length)} · app.js ${kb(files['app.js'].length)} · app.css ${kb(files['app.css'].length)}`);
console.log(`     sha256 ${result.zipSha256}`);
if (placeholderId) {
  console.log('');
  console.log('[!] manifest.json 里的 id 还是占位符。');
  console.log('    去 linux.do 个人资料 → 微应用 → 创建应用，把分配到的 ID 填进 mapp/manifest.json 再打一次。');
}
