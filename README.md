# Food Inv. Manager

冷蔵・冷凍・常温にある食品の**期限と在庫**を管理する個人用 PWA。
GitHub Pages で配信し、Google Apps Script (GAS) 経由で Google スプレッドシートに読み書きする。

```
ブラウザ (index.html)  ──POST JSON──▶  GAS ウェブアプリ  ──▶  Google スプレッドシート
       │                                (Code.gs)              1 行 = 1 食品
       └─ localStorage: fm_gas_url, fm_warn_days
```

- フロントエンドは **単一の HTML ファイル**（インライン CSS + バニラ JS、ビルド工程なし）
- 依存は CDN の Tabler Icons のみ。フレームワーク・パッケージマネージャなし
- 認証情報はブラウザに置かない。スプレッドシートへのアクセス権は GAS 側が持つ

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | GitHub Pages が配信するエントリポイント。アプリ本体 |
| `manifest.json` | PWA マニフェスト（standalone / portrait、SVG data-URI アイコン） |
| `gas/Code.gs` | GAS バックエンド。スプレッドシートの CRUD と期限判定 |
| `gas/appsscript.json` | GAS のプロジェクト設定（タイムゾーン Asia/Tokyo、ウェブアプリ公開設定） |
| `.github/workflows/pages.yml` | GitHub Pages へのデプロイ（Source が「GitHub Actions」のとき使われる） |
| `capacitor-app/` | Capacitor による Android アプリ化。ルートの `index.html` を包むだけで、アプリ本体の複製は持たない |

---

## セットアップ

### 1. スプレッドシートと GAS を用意する

1. Google ドライブで新しいスプレッドシートを作成する（名前は何でもよい）
2. メニューの **拡張機能 → Apps Script** を開く
3. 既定の `コード.gs` の中身をすべて消し、この repo の `gas/Code.gs` を貼り付けて保存する
4. エディタ上部の関数選択で **`setupSheet`** を選び、**実行**する
   - 初回は Google の認可ダイアログが出る。「詳細」→「（プロジェクト名）に移動」→「許可」で進む
   - スプレッドシートに「食品」シートとヘッダ行ができれば成功

### 2. ウェブアプリとしてデプロイする

1. Apps Script エディタ右上の **デプロイ → 新しいデプロイ**
2. 種類の選択（歯車アイコン）→ **ウェブアプリ**
3. 設定：
   - 次のユーザーとして実行： **自分**
   - アクセスできるユーザー： **全員**
     （`Googleアカウントを持つ全員` ではなく `全員`。前者はログインを要求するため、
     ブラウザからの匿名 POST が弾かれる。`gas/appsscript.json` の `ANYONE_ANONYMOUS` に対応）
4. **デプロイ** を押し、表示された `https://script.google.com/macros/s/.../exec` という URL を控える

> 「全員」にするのは、ブラウザから認証なしで POST するため。
> URL を知らなければアクセスできないが、URL 自体が鍵になる点は理解しておくこと。
> ブラウザでこの URL を直接開くと `{"ok":true,...}` が返れば疎通 OK。

**コードを修正したら、毎回「デプロイ → デプロイを管理 → 編集（鉛筆）→ バージョン: 新バージョン → デプロイ」が必要。** これを忘れると古いコードが動き続ける。

（デプロイ手順の出典: [Web Apps | Apps Script](https://developers.google.com/apps-script/guides/web) /
[Web apps and API executables manifest resource](https://developers.google.com/apps-script/manifest/web-app-api-executable)）

### 3. GitHub Pages で公開する

> **前提: リポジトリが「公開（public）」であること。**
> 無料プランの GitHub Pages は公開リポジトリでしか使えない。非公開のままだと
> Settings → Pages に通常の設定項目が出ず、アップグレードを促す表示になる。
> 非公開のまま使いたい場合は GitHub Pro 以上が必要（ただし Pro でも
> *公開されたサイト自体*は誰でも見られる。サイトにアクセス制限をかける機能は
> GitHub Enterprise Cloud 限定）。
>
> このリポジトリにトークン等の秘密情報は含まれていない。GAS のウェブアプリ URL は
> アプリの設定画面で入力し、その端末の localStorage にだけ保存されるので、
> 公開リポジトリにしても URL が漏れることはない。
>
> 出典: [GitHub's plans — GitHub Docs](https://docs.github.com/get-started/learning-about-github/githubs-products)

公開方法は 2 通りある。**この repo には `.github/workflows/pages.yml` を用意してあるので、
Source が「GitHub Actions」のままで動く**（GitHub の新しい repo は既定でこちらになっている）。

#### A. GitHub Actions で公開する（この repo の既定）

1. GitHub の repo → **Settings → Pages**
2. **Source** を `GitHub Actions` にして確定する
   - **この操作が Pages サイトの作成そのものを兼ねている。一度もやっていないと、
     ワークフローは `Get Pages site failed` で必ず失敗する**
   - ワークフロー側から自動で有効化することはできない。`configure-pages` の
     `enablement: true` はサイト作成に `administration:write` を要求するが、
     既定の `GITHUB_TOKEN` にはその権限を付与できないため必ず失敗する
     （[actions/configure-pages#40](https://github.com/actions/configure-pages/issues/40)）
3. `main` ブランチに push すると `Deploy to GitHub Pages` ワークフローが走る
   - 進捗は repo の **Actions** タブで見られる
   - 過去に失敗した実行は **Re-run jobs** で再実行できる
4. 緑のチェックが付いたら `https://<ユーザー名>.github.io/Food_Manager/` で開ける

ワークフローは静的ファイルをそのまま上げるだけで、ビルド工程はない。

#### B. ブランチから直接公開する（`.github/workflows/pages.yml` は不要）

1. **Settings → Pages** の **Source** を `Deploy from a branch` に変える
2. ブランチを `main` / フォルダを `/ (root)` にして **Save**
3. 数十秒後に同じ URL で開ける

B を選ぶ場合は `.github/workflows/pages.yml` を削除しておくとよい
（残っていると push のたびにワークフローが走って失敗し、通知がうるさい）。

> **`main` ブランチが無いと、どちらの方法も動かない。**
> Pages の画面にブランチが出てこない・ワークフローが走らないときは、
> repo のブランチ一覧に `main` があるかをまず確認すること。

### 4. アプリ側の設定

1. 公開された URL をスマホ（または PC）のブラウザで開く
2. 右上の歯車 → **GAS ウェブアプリURL** に手順 2 で控えた URL を貼る
3. **期限間近とみなす日数**（既定 3 日）を必要に応じて変更する
4. 「保存して同期」を押す

設定はそのデバイスの localStorage に保存される。別の端末で使うときは、その端末でも同じ URL を入力する。

ホーム画面に追加すると、アドレスバーなしのアプリとして起動する（Android: メニュー →「アプリをインストール」/ iOS: 共有 →「ホーム画面に追加」）。

---

## 使い方

- 上部のタブで **冷蔵 / 冷凍 / 常温** を切り替える。一覧を**左右にスワイプ**しても移動できる
  （左へ払うと次のタブ。端まで来たらそれ以上は動かない）
- 各タブ内は**期限が近い順**に並ぶ。期限を登録していないものは末尾にまとめて並ぶ
- タブの赤いバッジは、そのタブにある「期限切れ＋期限間近」の件数
- カードの左端の色と右のバッジで状態が分かる
  - 赤 … 期限切れ（`N日超過`）
  - 橙 … 期限間近（しきい値以内。`今日まで` / `あとN日`）
  - 無色 … まだ余裕あり
- 下の「食品を追加」からモーダルで登録する
- **カードをタップすると編集**できる。商品名・保管場所・期限・数量を直して「保存」
- **カード左の丸をタップすると消費済み**になり、一覧から消える。
  押し間違えても、下に出るトーストの「元に戻す」で戻せる
- **数量は カード右下の − ＋ で増減する。** 消費したら −、買い足したら ＋。
  連打してもまとめて 1 回だけ保存する。0 より下がらない
  （0 は「切らしている」状態。一覧からは消えないので、要らなくなったら消費済みか削除にする）
- 完全に消したいときは、編集モーダルの「削除」。こちらは行ごと消えるので**取り消せない**。
  食べ終えただけなら「消費済みにする」を使えば、シートに記録が残る
- **期限日は任意。** 在庫の数だけ管理したい食品（調味料、ラップなど）は空のままでよい。
  その場合バッジは「期限なし」になり、色分けや警告の対象から外れる
  （期限日を空にすると、期限種別の選択も自動で伏せられる）

---

## カレンダー

ヘッダのカレンダーのアイコンから開く。**期限日を登録している食品**を、その期限日のマスに出す。

- マスの丸は件数。色はその日で一番差し迫っている状態（赤＝期限切れ／橙＝期限間近／緑＝余裕あり）
- 日をタップすると、下にその日の食品が並ぶ。**保管場所は問わない**ので、冷蔵・冷凍・常温を
  またいで見渡せる
- 並んだ食品をタップすると、そのまま編集できる
- `‹` `›` で月を移動、「今日」で今日の月へ戻る
- 期限を登録していない食品と、消費済みの食品は出ない

## データ構造

スプレッドシート「食品」シート、1 行 = 1 食品。

| 列 | 内容 |
|---|---|
| ID | GAS が採番する UUID。行を特定するために使う |
| 商品名 | テキスト |
| 保管場所 | `冷蔵` / `冷凍` / `常温` |
| 購入日 | `yyyy-MM-dd`（文字列で保持） |
| 期限種別 | `賞味期限` / `消費期限`。期限日が空なら空 |
| 期限日 | `yyyy-MM-dd`（文字列で保持）。**任意**。空なら期限管理の対象外 |
| 数量 | 数値 |
| 消費済み | 真偽値。論理削除に使う |
| 更新日時 | `yyyy-MM-dd HH:mm:ss` |

日付を文字列で持つのは、タイムゾーンによる 1 日ずれを避けるため。
シートを手で編集する場合も `2026-09-14` の形式で入れること（`setupSheet` が入力規則と書式を設定済み）。

---

## GAS の API

すべて `POST` で JSON を送り、`{ ok: boolean, data, error }` を受け取る。

| action | ボディ | 返り値 |
|---|---|---|
| `list` | `{ includeConsumed?: boolean }` | 食品の配列（期限日の昇順） |
| `create` | `{ food: {...} }` | 追加された食品（ID 付き） |
| `update` | `{ food: { id, ...更新する項目 } }` | 更新後の食品（部分更新） |
| `consume` | `{ id, consumed?: boolean }` | 更新後の食品（論理削除。`consumed:false` で戻せる） |
| `delete` | `{ id }` | `{ id, deleted: true }`（物理削除） |
| `expiring` | `{ days?: number }` | 残日数が `days` 以下の食品の配列 |
| `ping` | — | `{ today, tz }` |

返る食品オブジェクト：

```json
{
  "id": "…", "name": "牛乳", "place": "冷蔵",
  "boughtDate": "2026-09-12", "kind": "消費期限", "expiryDate": "2026-09-16",
  "quantity": 1, "consumed": false, "updatedAt": "2026-09-14 08:00:00",
  "daysLeft": 2, "status": "soon"
}
```

`daysLeft` は期限日までの残日数（今日なら 0、過ぎていればマイナス）。期限日が空なら `null`。
`status` は `expired` / `soon` / `ok` / `unknown`（期限日が空なら `unknown`）。

---

## Android アプリにする（Capacitor）

`capacitor-app/` で、同じ `index.html` を Android アプリとして包める。
ブラウザで使う場合はこのディレクトリを無視してよい。

### 必要なもの（Capacitor 8）

| | バージョン |
|---|---|
| Node.js | 22 以上 |
| JDK | 17 以上 |
| Android Studio | Otter (2025.2.1) 以上 |

生成される Android プロジェクトは `minSdkVersion 24` / `targetSdkVersion 36`。

### 置き場所に注意

**リポジトリは、パスに日本語が入らない場所に置くこと。** Android のビルド（Gradle）は
パスに日本語が含まれていると失敗する。

特に OneDrive を使っていると、エクスプローラ上は「ドキュメント」と見えていても、
実際のパスが `C:\Users\<ユーザー名>\OneDrive\ドキュメント\...` と日本語になっていることがある。
Windows のユーザー名自体が日本語の場合も同様。

`C:\dev\Food_Manager` のような場所が無難:

```powershell
cd C:\
mkdir dev
cd dev
git clone https://github.com/memotan/Food_Manager.git
```

現在地のパスは PowerShell で `pwd` を打てば確認できる。
`setup.bat` は最初にこれを検査し、日本語が含まれていればその場で止まる
（`npm run check` でも単独で確認できる）。

### 手順（Windows 11）

```powershell
cd C:\dev\Food_Manager\capacitor-app
.\setup.bat
```

`setup.bat` がパスの検査 → npm install → web アセットのコピー → `cap add android` → `cap sync` まで行う。
終わったら Android Studio で開く:

```powershell
npm run open
```

Android Studio 上で実機・エミュレータへ実行する。APK が欲しい場合は
**Build → Build Bundle(s) / APK(s) → Build APK(s)**。

### `index.html` を直したあと

`server.url` で GitHub Pages を読んでいるので、**アプリ側は何もしなくても更新される**。
`npm run sync` が要るのは、`capacitor.config.json` やプラグインを変えたときだけ。

```powershell
cd capacitor-app
npm run sync
```

`npm run sync` は次の 3 つを続けて行う。

1. ルートの `index.html` / `manifest.json` を `www/` にコピー
2. `cap sync`（プラグインとネイティブ側の同期）
3. `capacitor.config.json` の `appName` / `appId` を Android のリソースへ反映

> **3 が要るのは、`cap sync` が `strings.xml` を書き換えないため。**
> `appName` が使われるのは `cap add android` でプロジェクトを作る瞬間だけで、
> 以後は `android/` に残った値がランチャーの表示名になり続ける。
> 設定を直しても名前が変わらない、という取り違えを防ぐためにここで上書きしている。
>
> **アプリ名はネイティブのリソースなので、反映には Android Studio でのビルドが必要。**
> web の中身と違って、push だけでは変わらない。

> **`capacitor-app/www/` は生成物なので git で管理していない。** 手で編集しても
> 次の `npm run sync` で上書きされる。直すのは必ずルートの `index.html`。
> （NeoNoting は `capacitor-app/www/index.html` にアプリ本体の複製を持っているが、
> 二重管理で片方だけ直す事故が起きるため、この repo では複製しない方針にした）

### 構成

**アプリは GitHub Pages をそのまま読みに行く**（`capacitor.config.json` の `server.url`）。
NeoNoting と同じ方式。

```json
  "server": {
    "url": "https://memotan.github.io/Food_Manager/",
    "androidScheme": "https"
  }
```

- `index.html` を直して push すれば、**APK を作り直さなくてもアプリ側に反映される**
- 起動のたびに通信が必要。Pages が落ちているとアプリも開けない
  （そもそも GAS との通信が要るので、圏外では使えない）
- **更新が見えないときは、設定画面の「最新に更新」を押す。**
  WebView が古い `index.html` を抱えていることがあるため、クエリを付けて読み直す

APK を作り直す必要があるのは、`capacitor.config.json` やプラグインを変えたときだけ。

> `webDir`（`www/`）は `cap sync` が要求するので残してある。`server.url` があるときは
> 実際には使われない。

### 実装されている連携

`index.html` の `setupCapacitor()` が担当する。`window.Capacitor` が無いブラウザでは
まるごと何もしないので、同じファイルが両方で動く。

- **戻るボタン**: モーダル → 設定画面 → アプリ終了 の順に閉じる
- **アプリ復帰時**: 残日数を計算し直す。最後の同期から 60 秒以上空いていればシートも取り直す

ビルド工程がないため、プラグインは `import` ではなく `Capacitor.Plugins.App` のように参照している。

### うまくいかないとき

GAS への通信が CORS で弾かれる場合は、`capacitor.config.json` に
`"plugins": { "CapacitorHttp": { "enabled": true } }` を足すと、`fetch` がネイティブ側の
HTTP 実装に差し替わり CORS の制約を受けなくなる。
（既定では WebView の `fetch` をそのまま使うので、ブラウザと同じ挙動になる）

---

## バージョン

設定画面の一番下に、**アプリ側と GAS 側のバージョン**が並んで出る。
その下の「最新に更新」で、キャッシュを避けて読み込み直せる。

```
アプリ        ver 1.1.0
GAS          ver 1.0.0
       [ 最新に更新 ]
```

フロント（`index.html`）は push で自動更新されるが、**GAS は手で貼り直して再デプロイしないと
古いまま**。GAS が必要な版を下回っていると、この画面が手順つきで警告を出す。
「保存できない」「エラーが出る」といったときは、まずここを見ると切り分けが早い。

番号は 3 か所にある。

| 場所 | 定数 | いつ上げるか |
|---|---|---|
| `index.html` | `APP_VERSION` | フロントを直したとき（気兼ねなく） |
| `gas/Code.gs` | `GAS_VERSION` | `Code.gs` を直したとき |
| `index.html` | `REQUIRED_GAS_VERSION` | **`Code.gs` の仕様を変えたときだけ** |

警告が出るのは `GAS_VERSION < REQUIRED_GAS_VERSION` のときだけ。フロントだけ直したときに
中身の変わっていない GAS の貼り直しを強いないよう、こう分けてある。

GAS 側は `ping` と `doGet` で番号を返す。ブラウザで GAS の URL を直接開いても確認できる。

## 通知（将来の拡張）

`gas/Code.gs` の **`notifyExpiringItems()`** が差し込み口として用意してある（現時点では未実装で、ログ出力のみ）。

ntfy などに繋ぐときは:

1. Apps Script の **プロジェクトの設定 → スクリプト プロパティ** に `NTFY_TOPIC`、必要なら `NOTIFY_THRESHOLD_DAYS` を登録する（コードに直書きしない）
2. `notifyExpiringItems()` 内の TODO コメントを `UrlFetchApp.fetch` に置き換える
3. エディタ左の **トリガー** → 時間主導型（例：毎日 8 時）に `notifyExpiringItems` を割り当てる

---

## 開発

ビルド・lint・テストの仕組みはない。`index.html` をブラウザで直接開いて動作確認する。

Windows 11 でローカル確認する場合（PWA マニフェストは `file://` では効かないため、簡易サーバ経由が確実）:

```powershell
cd C:\path\to\Food_Manager
npx http-server -p 8080
# → http://localhost:8080 を開く
```

- モバイルファースト。`#app` は `max-width:480px`、`env(safe-area-inset-*)` でノッチ対応
- UI 文言・コメントは日本語。CSS 変数によるダークテーマ（`--bg:#111`、アクセントは緑 `--accent:#43a047`）
- 一覧に差し込む値は `escHtml()` でエスケープしてから `innerHTML` に渡すこと
