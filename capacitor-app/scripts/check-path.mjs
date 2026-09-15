// このプロジェクトの置き場所が Android のビルドに耐えるかを確かめる。
//
// Gradle はパスに ASCII 以外の文字（日本語など）が含まれていると失敗する。
// あとで意味の分かりにくいビルドエラーになるより、ここで理由を示して止めたほうが早い。
// setup.bat の最初と `npm run check` から呼ばれる。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = join(dirname(fileURLToPath(import.meta.url)), '..');

// 日本語などは確実に失敗するので中断する
if (/[^\x20-\x7E]/.test(projectDir)) {
  console.error(`
  エラー: プロジェクトの場所に日本語などの文字が含まれています。

    ${projectDir}

  Android のビルド（Gradle）はこの状態だと失敗します。
  半角英数字だけの場所に置き直してください。例:

    cd C:\\
    mkdir dev
    cd dev
    git clone https://github.com/memotan/Food_Manager.git
    cd Food_Manager\\capacitor-app
    .\\setup.bat

  OneDrive をお使いの場合、エクスプローラで「ドキュメント」と表示されていても、
  実際のパスは ...\\OneDrive\\ドキュメント\\... と日本語になっていることがあります。
`);
  process.exit(1);
}

// 空白は多くの場合そのまま動くが、古いツールでつまずくことがあるので注意だけ促す
if (/\s/.test(projectDir)) {
  console.warn(`
  注意: プロジェクトの場所に空白が含まれています。

    ${projectDir}

  たいていはそのまま動きますが、ビルドで不可解なエラーが出た場合は
  C:\\dev\\Food_Manager のような空白のない場所を試してください。
`);
}

console.log(`  パスの確認 OK: ${projectDir}`);
