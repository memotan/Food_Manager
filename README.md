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
| `manifest.json` | PWA マニフェスト（standalone / portrait、`icons/` を参照） |
| `icons/` | アプリアイコン（ドットのバナナの房）。SVG と、そこから書き出した PNG |
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

> **列を増やしたときは、再デプロイのあとに `setupSheet` をもう一度実行すること。**
> ヘッダと入力規則を引き直すだけで、既にある行のデータは消えない。
> （ジャンル列を足した ver 1.1.0 で必要）

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

- 在庫を切らしているもの（数量 0）は、**一覧の一番上に「買い足す」としてまとめて出る**。
  青い破線の枠と「切らしている」バッジが付き、期限の色分けからは外れる
  （手元に無いので傷みようがない。タブの期限警告の件数にも、カレンダーにも出ない）。
  買い直したら `＋` を押せば在庫ありへ戻る
- ジャンルは**追加時にも編集時にも選び直せる**（モーダルの 2 段目）。
  種類を増やしたい場合は `index.html` の `CATEGORIES` と `gas/Code.gs` の `CATEGORIES` を
  **同じ内容に揃えて**直し、GAS を再デプロイする
- タブの右の **「期限順 / ジャンル順」** で並びを切り替えられる。
  ジャンル順ではジャンルごとに区切って並び、その中は期限が近い順のまま。
  「買い足す」はどちらでも一番上。選んだ並びは次に開いたときも保たれる
- 上部のタブで **冷蔵 / 冷凍 / 常温** を切り替える。一覧を**左右にスワイプ**しても移動できる
  （左へ払うと次のタブ。端まで来たらそれ以上は動かない）
- 各タブ内は**期限が近い順**に並ぶ。期限を登録していないものは末尾にまとめて並ぶ
- タブの赤いバッジは、そのタブにある「期限切れ＋期限間近」の件数
- 右端の **「取込」タブ**は、Budget Manager の食費を在庫の候補として並べる場所
  （詳しくは [Budget Manager から取り込む](#budget-manager-から取り込む)）
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

## Budget Manager から取り込む

姉妹アプリ Budget Manager（`memotan/kakeibo`）に記録した**食費**を、在庫の候補として
「取込」タブに並べる。Budget Manager 側は何も変えなくてよい（読むだけで、書き込まない）。

- 候補は **品目ごと**に並ぶ。Budget Manager では 1 回の買い物が 1 件で、品目はメモに
  「、」区切りで書いてある（`牛乳、卵、豆腐`）。これを分けて、買い物ごとの見出しの下に並べる
  （「,」や「，」も区切りとして受ける）。メモが空の買い物は「（品名を入力）」の 1 件になる
- 候補をタップすると、品名と購入日が入った状態で登録モーダルが開く。**保管場所・ジャンル・
  期限・数量を入れて保存**すると、その保管場所のタブに食品として載る。
  続けて次の品目を登録できるよう、保存後も取込タブにとどまる
- 外食や、在庫にしないものは、カード左の × で**無視**する。トーストの「元に戻す」で戻せる
- 登録済み・無視した品目は、シートの **「取込履歴」**（初回に自動で作られる）に記録され、
  二度と候補に出ない。一部の品目だけ登録して閉じても、残りだけが候補に残る
- 候補になるのは、**種別が支出で、カテゴリが食費**の記録のうち、**直近 14 日**のもの。
  初回に過去の全記録が溢れないよう、日付で区切っている

### 設定（GAS 側・1 回だけ）

Budget Manager の GAS は「アクセスできるユーザー: 自分のみ」で公開されているため、
ブラウザからは直接読めない。代わりに **この GAS が Budget Manager のスプレッドシートを開いて読む**
（同じ Google アカウントなので、公開設定は変えなくてよい）。

1. Budget Manager のスプレッドシートを開き、URL の `/d/` と `/edit` の間の文字列
   （`https://docs.google.com/spreadsheets/d/`**ここ**`/edit`）をコピーする
2. この GAS のエディタで、左の **「プロジェクトの設定」→「スクリプト プロパティ」** に追加する

   | プロパティ | 値 | 必須 |
   |---|---|---|
   | `BM_SPREADSHEET_ID` | 上でコピーした ID | 必須 |
   | `BM_FOOD_CATEGORIES` | 取り込むカテゴリ。カンマ区切り。既定は `食費` | 任意 |
   | `BM_INBOX_DAYS` | 何日前までの記録を候補にするか。既定は `14` | 任意 |

3. エディタで関数 **`checkInbox`** を 1 回手動で実行する。Budget Manager のシートを
   開くための**アクセス許可を求められるので承認する**（承認しないと、デプロイしたウェブアプリから
   読めない）。「候補 N 件」と出れば接続できている
4. 「デプロイ → デプロイを管理 → 編集 → バージョン: 新バージョン → デプロイ」

ID は秘密の鍵ではないが、公開 repo には書かない（コードに直書きせず、必ずスクリプト プロパティに置く）。
未設定のあいだは、取込タブに設定の案内が出る。

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
| ジャンル | `生鮮食品` / `惣菜・おかず` / `インスタント` / `保存食` / `パスタソース` / `調味料` / `おやつ` / `飲み物` / `その他`。空欄や知らない値は `その他` として扱う |
| 期限種別 | `賞味期限` / `消費期限`。期限日が空なら空 |
| 期限日 | `yyyy-MM-dd`（文字列で保持）。**任意**。空なら期限管理の対象外 |
| 数量 | 数値 |
| 消費済み | 真偽値。論理削除に使う |
| 更新日時 | `yyyy-MM-dd HH:mm:ss` |

### シート「取込履歴」

取込タブで登録・無視した品目の記録（初回に自動で作られる）。列は `キー` / `状態`（`imported` または `skipped`）/ `更新日時`。
キーは `BM の記録の ID#品名`。同じ買い物に同じ品名が 2 つあるときだけ、2 つ目以降に `#2` が付く。
消すと、その品目が候補に戻る。

**列を足すときは必ず末尾に足すこと。** 途中に挿すと、既にある行の値がひとつずつずれてしまう。
末尾なら、古い行では空欄として読まれるだけで済む（ジャンルは 10 列目として後から足した）。

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
| `ping` | — | `{ version, today, tz }` |
| `inbox` | — | `{ configured, items }`。BM の食費の候補（品目ごと）。`configured:false` は BM の ID が未設定 |
| `inboxMark` | `{ key, status }` | `{ key, status }`。`status` は `skipped`（無視）／ `imported` ／ `''`（記録を消して候補に戻す） |

`create` に `inboxKey` を添えると、登録と同じ呼び出しの中でその候補を取り込み済みにする
（登録だけ通って記録が漏れ、同じ品目が候補に残るのを避けるため）。

`inbox` の `items` の 1 件：`{ key, txId, date, store, amount, name }`
（`store` は BM の店名、`amount` は**買い物全体**の金額で、品目ごとの金額ではない）。

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

`npm run sync` は次の 4 つを続けて行う。

1. ルートの `index.html` / `manifest.json` / `icons/` を `www/` にコピー
2. `cap sync`（プラグインとネイティブ側の同期）
3. `capacitor.config.json` の `appName` / `appId` を Android のリソースへ反映
4. `icons/android/` のアイコンを Android のリソースへ反映

> **3 と 4 が要るのは、`cap sync` が `strings.xml` もアイコンも書き換えないため。**
> これらが使われるのは `cap add android` でプロジェクトを作る瞬間だけで、
> 以後は `android/` に残った値がランチャーの表示名とアイコンになり続ける。
> 設定を直しても変わらない、という取り違えを防ぐためにここで上書きしている。
>
> **アプリ名もアイコンもネイティブのリソースなので、反映には Android Studio でのビルドが必要。**
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

### アイコンを変えるとき

図柄は `icons/gen-icon.mjs` が生成している。SVG を手で直さず、ファイル冒頭の
`CONFIG`（傾き・房の本数・開き・格子の細かさなど）を変えて作り直す。

```bash
node icons/gen-icon.mjs
```

これで `icons/icon.svg` / `icon-foreground.svg` / `icon-background.svg` が書き換わる。
図柄が Android の安全領域（192 の図面の 32〜160）をはみ出すと、異常終了して教えてくれる。

PNG はこの repo に画像ライブラリを入れない方針のため、書き出し済みのものをコミットしてある。
SVG を変えたら PNG も作り直すこと。ブラウザがあれば次のどちらでもよい。

- `icons/icon.svg` などをブラウザで開き、必要なサイズでスクリーンショットを撮って差し替える
- Android Studio の **File → New → Image Asset** に `icons/icon-foreground.svg` を
  前景として読ませ、背景色に `#2e7d32` を指定して書き出す

必要なサイズは次のとおり。

| ファイル | サイズ |
|---|---|
| `icons/icon-192.png` / `icon-512.png` | 192 / 512（角は丸めない。OS 側が丸める） |
| `icons/apple-touch-icon.png` | 180（同上） |
| `icons/android/mipmap-{m,h,x,xx,xxx}hdpi/ic_launcher.png` | 48 / 72 / 96 / 144 / 192（角丸・背景透過） |
| 同 `ic_launcher_round.png` | 同上（円・背景透過） |
| 同 `ic_launcher_foreground.png` | 108 / 162 / 216 / 324 / 432（図柄のみ・背景透過） |

アイコンの反映には **Android Studio でのビルドが必要**。push では変わらない。

### 別の PC でビルドするとインストールできない

`INSTALL_FAILED_UPDATE_INCOMPATIBLE`（署名が一致しない、といった内容）が出たら、
**端末に入っているアプリを一度アンインストールしてから入れ直す**。古い PC は要らない。

Android Studio は `%USERPROFILE%\.android\debug.keystore` の鍵でデバッグ用の APK に署名するが、
**この鍵は PC ごとに自動生成される**。Android は署名の違うアプリへの上書き更新を、
なりすまし防止のため拒否する。PC を変えたりセットアップし直したりすると必ずこうなる。

- スプレッドシートのデータは端末側に無いので**消えない**
- 消えるのは端末に保存した設定だけ。**入れ直したあと、GAS の URL を再入力する**

毎回アンインストールするのが面倒なら、自分用の署名鍵（リリース用 keystore）を作って
それで署名し続ける手もある。その場合、**鍵とパスワードは repo の外に置くこと**
（この repo は公開されている。`.gitignore` で `*.keystore` などは弾くようにしてある）。

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
