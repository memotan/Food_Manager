// リポジトリのルートにある index.html / manifest.json を www/ にコピーする。
//
// www/ は生成物なので git では管理しない。アプリ本体を capacitor-app/www/ にも
// 置いてしまうと二重管理になり、片方だけ直して気づかない事故が起きるため。
// `npm run sync` から自動で呼ばれる。
import { mkdirSync, copyFileSync, existsSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const wwwDir = join(here, '..', 'www');

const FILES = ['index.html', 'manifest.json'];
// manifest.json と index.html がアイコンを icons/ 配下から参照している。
// android/ 以下の PNG と生成器は web からは使わないので持っていかない
const DIRS = ['icons'];
const SKIP = /(^|[\\/])(android([\\/]|$)|.*\.mjs$)/;

mkdirSync(wwwDir, { recursive: true });

for (const name of FILES) {
  const src = join(repoRoot, name);
  if (!existsSync(src)) {
    console.error(`エラー: ${src} が見つかりません`);
    process.exit(1);
  }
  copyFileSync(src, join(wwwDir, name));
  console.log(`  copied  ${name}`);
}

for (const name of DIRS) {
  const src = join(repoRoot, name);
  if (!existsSync(src)) {
    console.error(`エラー: ${src} が見つかりません`);
    process.exit(1);
  }
  cpSync(src, join(wwwDir, name), {
    recursive: true,
    filter: (from) => !SKIP.test(from.slice(src.length)),
  });
  console.log(`  copied  ${name}/`);
}

console.log('www/ を更新しました');
