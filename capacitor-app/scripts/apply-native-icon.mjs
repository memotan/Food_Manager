// icons/ で作ったアプリアイコンを Android のリソースへ反映する。
//
// cap sync はアイコンを差し替えない（`cap add android` のときに置かれた
// 既定のアイコンが android/ に残り続ける）。アプリ名と同じ事情なので、
// npm run sync のたびにここで上書きする。
//
// PNG は icons/android/ に書き出し済みのものをコピーするだけにしてある。
// ここでラスタライズすると、この repo に無い画像ライブラリが要るため。
// 図柄を変えるときは `node icons/gen-icon.mjs` で SVG を作り直したうえで、
// PNG も作り直す必要がある（手順は README）。
//
// ネイティブのリソースなので、反映には Android Studio でのビルドが必要。
import { readdirSync, copyFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../../icons/gen-icon.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const res = join(root, 'android', 'app', 'src', 'main', 'res');
const src = join(root, '..', 'icons', 'android');

if (!existsSync(res)) {
  console.log('  android/ がまだ無いので、アイコンの反映は省略します');
  process.exit(0);
}
if (!existsSync(src)) {
  console.error('  icons/android/ が見当たりません');
  process.exit(1);
}

let copied = 0;
for (const dir of readdirSync(src)) {
  const from = join(src, dir);
  const to = join(res, dir);
  mkdirSync(to, { recursive: true });
  for (const file of readdirSync(from)) {
    copyFileSync(join(from, file), join(to, file));
    copied++;
  }
}

// アダプティブアイコンは前景と背景の2層。背景は単色なので色リソースで持つ
const xml = (body) => '<?xml version="1.0" encoding="utf-8"?>\n' + body;
const adaptive = xml(
  '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
+ '    <background android:drawable="@color/ic_launcher_background"/>\n'
+ '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
+ '</adaptive-icon>\n');

const anydpi = join(res, 'mipmap-anydpi-v26');
mkdirSync(anydpi, { recursive: true });
writeFileSync(join(anydpi, 'ic_launcher.xml'), adaptive);
writeFileSync(join(anydpi, 'ic_launcher_round.xml'), adaptive);

mkdirSync(join(res, 'values'), { recursive: true });
writeFileSync(join(res, 'values', 'ic_launcher_background.xml'), xml(
  '<resources>\n'
+ `    <color name="ic_launcher_background">${CONFIG.bg}</color>\n`
+ '</resources>\n'));

console.log(`  アイコンを更新しました（PNG ${copied} 件 + アダプティブ定義）`);
console.log('  ※ ネイティブのリソースなので、反映には Android Studio でのビルドが要ります');
