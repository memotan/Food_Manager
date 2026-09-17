// capacitor.config.json の appName / appId を Android のリソースへ反映する。
//
// cap sync は strings.xml を書き換えない。appName が使われるのは `cap add android` で
// プロジェクトを作る瞬間だけで、以後は android/ に残った値がランチャーの表示名になる。
// 「設定を直したのに名前が変わらない」を防ぐため、npm run sync のたびにここで上書きする。
//
// ネイティブのリソースなので、反映には Android Studio でのビルドが必要。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stringsPath = join(root, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');

if (!existsSync(stringsPath)) {
  console.log('  android/ がまだ無いので、名前の反映は省略します');
  process.exit(0);
}

const cfg = JSON.parse(readFileSync(join(root, 'capacitor.config.json'), 'utf8'));

const escXml = v => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const wanted = {
  app_name: cfg.appName,
  title_activity_main: cfg.appName,
  package_name: cfg.appId,
  custom_url_scheme: cfg.appId
};

let xml = readFileSync(stringsPath, 'utf8');
const changed = [];

for (const [key, value] of Object.entries(wanted)) {
  if (value === undefined) continue;

  const re = new RegExp(`(<string name="${key}">)([\\s\\S]*?)(</string>)`);
  const found = xml.match(re);
  if (!found) {
    console.warn(`  strings.xml に ${key} が見当たりません`);
    continue;
  }
  if (found[2] === escXml(value)) continue;

  // 置換文字列に $ が混ざっても壊れないよう、関数で差し替える
  xml = xml.replace(re, (_, open, old, close) => open + escXml(value) + close);
  changed.push(`${key}: ${found[2]} → ${value}`);
}

if (!changed.length) {
  console.log('  アプリ名は最新です');
  process.exit(0);
}

writeFileSync(stringsPath, xml);
console.log('  strings.xml を更新しました');
changed.forEach(c => console.log('    ' + c));
console.log('  ※ ネイティブのリソースなので、反映には Android Studio でのビルドが要ります');
