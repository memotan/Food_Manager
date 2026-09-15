// リポジトリのルートにある index.html / manifest.json を www/ にコピーする。
//
// www/ は生成物なので git では管理しない。アプリ本体を capacitor-app/www/ にも
// 置いてしまうと二重管理になり、片方だけ直して気づかない事故が起きるため。
// `npm run sync` から自動で呼ばれる。
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const wwwDir = join(here, '..', 'www');

const FILES = ['index.html', 'manifest.json'];

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

console.log('www/ を更新しました');
