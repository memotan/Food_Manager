# CLAUDE.md

## プロジェクト概要

**Food Inv. Manager** — GitHub Pages 上で動作するモバイルファーストの PWA。
冷蔵・冷凍・常温にある食品の期限と在庫を管理し、GAS のウェブアプリ経由で
Google スプレッドシートに読み書きする。

姉妹プロジェクト **NeoNoting**（PWA + GAS + Notion のタスク/メモ管理）と同じ流儀で作られている。

- フロントエンドは **単一の HTML ファイル**（インライン CSS + バニラ JS、ビルド工程なし）
- バックエンドは GAS のウェブアプリ。NeoNoting と違い、**GAS のコードもこの repo に入っている**（`gas/Code.gs`）
- 依存は CDN の Tabler Icons (`@tabler/icons-webfont`) と Google Fonts (Doto / JetBrains Mono) のみ。
  フレームワーク・パッケージマネージャなし

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | GitHub Pages が配信するエントリポイント。アプリ本体（CSS + HTML + JS） |
| `manifest.json` | PWA マニフェスト（standalone / portrait、SVG data-URI アイコン、theme #111） |
| `gas/Code.gs` | GAS バックエンド。**編集したら GAS エディタに貼り直し、再デプロイが必要**（repo に置いてあるのは正本のコピー管理のため） |
| `gas/appsscript.json` | GAS のプロジェクト設定（Asia/Tokyo、ウェブアプリ公開設定） |
| `.github/workflows/pages.yml` | GitHub Pages へのデプロイ用ワークフロー（ビルドはせず静的ファイルをそのまま配信） |
| `capacitor-app/` | Android アプリ化（Capacitor 8）。`www/` は `npm run sync` が生成するので **git 管理しない**。アプリ本体の複製は持たない |
| `README.md` | セットアップ手順（スプレッドシート・GAS デプロイ・GitHub Pages）と API 仕様 |

NeoNoting のような `index2.html`, `index7.html` といった世代スナップショットは作らない。
履歴は git で追う。同じ理由で、NeoNoting が持っている `capacitor-app/www/index.html` の
**複製も置かない**（`capacitor-app/scripts/copy-www.mjs` がルートからコピーして生成する）。

## アーキテクチャ

```
ブラウザ (index.html)  ──POST JSON──▶  GAS ウェブアプリ  ──▶  スプレッドシート「食品」
       │                                (gas/Code.gs)          1 行 = 1 食品
       └─ localStorage: fm_gas_url, fm_warn_days
```

### GAS 通信プロトコル

すべて `gasCall(body)` 経由。`POST` で JSON を送り `{ ok, data, error }` を受け取る。`ok=false` なら `error` を throw。

**`fetch` に `Content-Type` ヘッダを付けないこと。** 付けると CORS のプリフライトが飛び、GAS が
それに応答できずに失敗する（NeoNoting と同じ理由）。

action: `list` / `create` / `update` / `consume` / `delete` / `expiring` / `ping`。詳細は README を参照。

データ形状（GAS が返すもの）:

```js
{ id, name, place, boughtDate, kind, expiryDate, quantity, consumed, updatedAt, daysLeft, status }
```

- `place` は `冷蔵` / `冷凍` / `常温`（必須）。`kind` は `賞味期限` / `消費期限`（GAS 側の `normalize_` で検証）
- **並べ替えの比較関数で、期限なしどうしには必ず `0` を返すこと。** `1` を返すと `a>b` と `b>a` が
  同時に成立する不正な比較になり、期限なしが 2 件以上あると順序が安定しない
  （フロントの `foodsIn()` と GAS の `sortByExpiry_()` の両方）。
  `sort` は安定なので、`0` を返せば期限なしどうしは登録順が保たれる
- **`category`（ジャンル）は任意。** `CATEGORIES` のいずれか。空欄や知らない値は `その他` に寄せる
  （フロントは `catOf()`、GAS は `normalize_`）。ジャンル列を足す前に登録した行は空欄なので、
  **弾かずに受け止めること**
- **`CATEGORIES` は `index.html` と `gas/Code.gs` の 2 か所にある。必ず同じ内容・同じ並びに保つこと。**
  ずれるとアプリで選んだジャンルが GAS 側で `その他` に落とされ、原因が分かりにくい
  （`test_category.js` が両ファイルを読んで突き合わせている）。
  **種類を増減したら `GAS_VERSION` と `REQUIRED_GAS_VERSION` を上げる**。
  古い GAS のままだと新しいジャンルが黙って `その他` になるため
- ジャンルの並びは**ジャンル順表示の並び**そのもの。近い性質のものを隣に置く。
  末尾の `その他` は受け皿を兼ねるので、動かさない
- **シートに列を足すときは必ず末尾に足す。** 途中に挿すと既存行の値がずれる。
  末尾なら古い行では空欄として読まれるだけで済む。読み書きは `Math.min(HEADERS.length, getMaxColumns())`
  で実際の幅に合わせ、書き戻す前には足りない列を `insertColumnsAfter` で広げる
- **`expiryDate` は任意。** 在庫の数だけ管理したい食品があるため必須にしない。
  空のときは `kind` も空に揃え（`normalize_`）、`daysLeft` は `null`、`status` は `unknown` になる。
  一覧では末尾に並び、色分け・タブの警告件数・`expiring` の対象から外れる
- 日付は **すべて `yyyy-MM-dd` の文字列**。Date 型で持たないのは、タイムゾーンによる 1 日ずれを避けるため
- `daysLeft` は期限日までの残日数（今日 = 0、超過はマイナス）。`status` は `expired`/`soon`/`ok`/`unknown`

### 状態と永続化

- `gasUrl` と `warnDays` は **設定画面でユーザーが入力**し `localStorage`（`fm_gas_url` / `fm_warn_days`）に保存
- 認証情報はブラウザに置かない。スプレッドシートへのアクセス権は GAS 側が持つ
- 追加は**楽観的更新**: 一時 ID (`tmp_…`) で先に一覧へ出す → GAS の応答で確定 → 失敗したら一覧から取り除き
  同期ドット（`.sdot`）を `err` にする
- **`status` / `daysLeft` はサーバ側の値をそのまま表示に使わない。** しきい値はユーザーが変えられるので、
  表示に使う判定は必ずフロントの `statusOf()` / `daysUntil()` で計算し直す（GAS 側の `DEFAULT_WARN_DAYS`
  はサーバ単独で動く `expiring` や通知用の既定値）

## Capacitor（Android アプリ）

`capacitor-app/` がルートの `index.html` を包む。Capacitor 8（NeoNoting は 6）。

**アプリは GitHub Pages をそのまま読む**（`capacitor.config.json` の `server.url`）。
利用者は Android アプリしか使わないため、push しただけでアプリ側にも反映される構成にしてある。
**この前提を崩さないこと**（同梱方式に戻すと、更新のたびに APK の作り直しが要る）。

- `webDir`（`www/`）は `cap sync` が要求するので残してあるが、`server.url` があるときは使われない
- **`cap sync` は `strings.xml` を書き換えない。** `capacitor.config.json` の `appName` / `appId` が
  使われるのは `cap add android` の瞬間だけで、以後は `android/` に残った値がランチャーの表示名に
  なり続ける。そのため `npm run sync` の最後に `scripts/apply-native-name.mjs` を走らせて上書きする。
  **アプリ名を変えたら、Android Studio でのビルドが要る**（web の中身と違い push では変わらない）
- **デバッグ用の署名鍵は PC ごとに自動生成される**（`%USERPROFILE%\.android\debug.keystore`）。
  別の PC でビルドした APK は署名が変わるため、上書きインストールが
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE` で拒否される。**端末から一度アンインストールして入れ直す**。
  署名鍵やパスワードを repo に置かないこと（公開 repo。`.gitignore` で弾いてある）
- WebView が古い `index.html` を抱えることがあるので、設定画面に「最新に更新」
  （`forceReload()`）を置いてある。クエリを付けて別 URL にして読み直す
- **同梱方式から切り替えたので、WebView のオリジンが `https://localhost` から
  `https://memotan.github.io` に変わっている。** localStorage はオリジンごとなので、
  切り替え後の初回は GAS URL の再入力が要る

- **アプリ本体は必ずルートの `index.html` を直す。** `capacitor-app/www/` は生成物で、
  次の `npm run sync` に上書きされる
- **ビルド工程がないので `import` は使えない。** プラグインは `Capacitor.Plugins.App` のように
  グローバル経由で参照する
- 連携部分は `setupCapacitor()` に閉じ込める。`window.Capacitor` が無ければ即 return するので、
  同じファイルがブラウザでもそのまま動く。この前提を壊さないこと
- 現状の連携: Android の戻るボタン（モーダル → 設定画面 → 終了）と、
  アプリ復帰時の再描画・再同期（`handleResume()`）

## 見た目の約束

姉妹プロジェクト **Budget Manager（`memotan/kakeibo`）** とフォントを揃えている。

- Google Fonts から `Doto` と `JetBrains Mono` を読む。CSS 変数は `--num`（Doto 優先）と `--mono`
- `.header h1` は `var(--num)` / `font-weight:900` / `letter-spacing:.09em` / `text-transform:uppercase`。
  末尾にアクセント色のドット（`.header-dot`）を置く
- **`font-size` は `clamp()` で指定すること。** タイトルは `white-space:nowrap` なので、
  固定サイズにすると幅の狭い端末で右上のアイコンを押し出す（320px まで確認済み）
- 日付（`.fdate`）は `var(--mono)` で桁を揃える

## 操作

### 一覧のタップ

`setupListTaps()` が `#foodList` で**委譲**して受ける。カードごとに `onclick` を書かないこと
（`id` を文字列に埋め込まずに済み、再描画のたびにリスナを張り直す必要もない）。
`id` は `data-id` に持たせ、`escHtml()` を通す。

- カード左の丸（`.chk`）… 消費済みにする（論理削除）。取り消せるようトーストに「元に戻す」を出す
- それ以外の場所 … 編集モーダルを開く（`openSheet(id)`）
- **スワイプ直後 400ms のクリックは無視する**（`lastSwipeAt`）。
  横に払ったあとに click が続けて発火し、編集モーダルが開いてしまうのを防ぐ

### 並びと区切り

`renderList()` が組み立てる。

- **数量 0 は「買い足す」として常に最上段**（`isRestock()`）。並び替えの指定より優先する。
  期限の色分けは付けず、専用の青（`--info`）と「切らしている」バッジにする。
  手元に無いものは傷みようがないので、**タブの期限警告の件数にも `foodsByExpiry()` にも入れない**
- `sortMode` は `'expiry'`（既定）か `'category'`。`fm_sort_mode` に保存する。
  ジャンル順では `CATEGORIES` の並びで区切り、**その中は期限順のまま**にする
  （期限順という土台を壊さないため）
- タブのバッジは期限の警告（赤）を優先し、それが無いときだけ「買い足す」の件数（青）を出す
- **赤 `--danger` と橙 `--warn` は期限の警告専用のまま。** 「買い足す」には別枠の `--info` を使う

### 数量の増減

カード右下とモーダルの `−` `＋` で変える（数値入力欄は置かない）。

- **一覧での増減は 800ms のデバウンスでまとめて 1 回だけ保存する**（`bumpCardQty` → `saveQty`）。
  画面は即座に書き換え、`renderList()` だけ呼ぶ（数量は並び順にもタブのバッジにも影響しない）
- 応答を待つ間にさらに押されることがあるので、`saveQty` は返ってきた食品に**手元の数量を上書きして**
  から差し替える
- 失敗したら値を戻すのではなく `syncFromSheet()` で取り直す。デバウンス中の変更が絡むと
  「戻すべき値」が一意に決まらないため。取り直しに成功すれば同期ドットは成功のままでよく、
  失敗はトーストで知らせる
- 0 未満にはしない。0 のとき `−` は `disabled`

### 書き込み

すべて楽観的更新。**失敗したら必ず元の値に戻すこと**（`applyUpdate` / `setConsumedFlag` は
`before` を保持し、`applyCreate` は一時 ID の要素を取り除き、`removeFromSheet` は配列ごと戻す）。

「削除」は行ごと消えて戻せないため `confirm()` で確認し、消費済みを使う道も文面で案内する。

### スワイプ

- タブのタップに加えて、一覧の**左右スワイプ**でも保管場所を移動できる（`setupSwipe()`）
- スワイプ判定は `touchstart` と `touchend` だけを見る。**`touchmove` を握らず `preventDefault` も
  しないこと**（縦スクロールを壊すため）。リスナは `{ passive: true }` で登録する
- 横移動が 60px 未満、600ms 超、または縦移動が優勢（横 < 縦 × 1.5）なら無視する
- 端では止まる（巡回しない）

## カレンダー

ヘッダのアイコンから開く全画面（`#calendarScreen`）。**期限日のある食品だけ**を期限日のマスに出す。

- `foodsByExpiry()` は `place` で絞らない。保管場所をまたいで見渡すための画面なので、
  タブの状態とは独立している
- マスの丸は件数。色は `worstStatus()`（expired > soon > ok）
- 日付セルと食品カードのタップは `setupCalendarTaps()` が**委譲**で受ける（一覧と同じ流儀）
- `renderAll()` はカレンダーが開いていれば `renderCalendar()` も呼ぶ。
  モーダルから編集したとき、裏のカレンダーが古いままにならないようにするため
- Android の戻るボタンは 設定画面と同じく `showMain()` に落とす（`setupCapacitor()`）

## 実装状況

段階的に進めている。

- **完了（第 1 段階）**: 一覧表示 / 追加（モーダル）/ 保管場所タブ / 期限順ソート / 色分け・バッジ / しきい値設定
- **完了**: 期限日の任意化（在庫のみの管理）、スワイプでのタブ移動、Budget Manager に揃えたタイトル
- **完了（第 2 段階）**: 編集・消費済み・削除の UI
- **完了**: 数量の増減（− ＋）、期限カレンダー
- **完了**: ジャンル分け（シート 10 列目）、切らしているものを最上段に出す「買い足す」
- **完了**: Capacitor による Android アプリ化（`capacitor-app/`）
- **スコープ外**: ntfy によるプッシュ通知。`gas/Code.gs` の `notifyExpiringItems()` を差し込み口として用意済み

## 開発上の注意

- ビルド・テスト・lint の仕組みはない。ブラウザ（モバイル幅 ≤480px）で直接動作確認する。
  `manifest.json` は `file://` では効かないので、PWA まわりを見るときは `npx http-server` 経由で開く
- モバイルファースト: `#app` は `max-width:480px`、`env(safe-area-inset-*)` でノッチ対応
- UI 文言・コメントは日本語、CSS 変数によるダークテーマ（`--bg:#111`）。
  **アクセントは緑 `--accent:#43a047`。赤 `--danger` と橙 `--warn` は期限の警告表示専用**なので、
  ボタンなど通常の UI に使わないこと（警告色の意味が薄れる）
- `innerHTML` に値を差し込む箇所が多い。**商品名などシート由来の値は必ず `escHtml()` を通す**
  （NeoNoting にはタスク名が未エスケープの箇所があるが、こちらでは全てエスケープしている）
- `index.html` を GAS の `doGet` から配信する構成ではない。フロントは GitHub Pages、GAS は API のみ

## バージョン

番号は 3 つ。**役割が違うので混ぜないこと。**

| 定数 | 場所 | いつ上げるか |
|---|---|---|
| `APP_VERSION` | `index.html` | フロントを直したとき。push で自動更新されるので気兼ねなく |
| `GAS_VERSION` | `gas/Code.gs` | `Code.gs` を直したとき |
| `REQUIRED_GAS_VERSION` | `index.html` | **`Code.gs` の仕様を変えたときだけ** |

現在: `APP_VERSION` 1.4.0 / `GAS_VERSION` 1.2.0 / `REQUIRED_GAS_VERSION` 1.2.0

設定画面が `ping` で GAS 側の番号を取り、`GAS_VERSION < REQUIRED_GAS_VERSION` のときだけ
再デプロイを促す警告を出す（比較は `cmpVer()`）。

- **フロントだけ直したときに `REQUIRED_GAS_VERSION` を上げないこと。**
  中身の変わっていない GAS の貼り直しを強いることになる
- GAS 側は `ping` と `doGet` の両方で番号を返す
- 番号は手で管理する。ビルド工程がないので自動では埋め込めない

## デプロイ

- **フロント**: `main` ブランチへの push で `.github/workflows/pages.yml` が走り、GitHub Pages が更新される。
  Settings → Pages の Source は **GitHub Actions**（新しい repo の既定）。
  `Deploy from a branch` に切り替える場合はワークフローを削除すること（残ると毎 push 失敗する）。
  配信されるのはリポジトリ全体で、入口は `index.html`
- **GAS**: `gas/Code.gs` の変更は自動では反映されない。`GAS_VERSION` を上げ、GAS エディタに
  貼り直したうえで「デプロイ → デプロイを管理 → 編集 → バージョン: 新バージョン → デプロイ」
  まで行うこと。反映できたかは、アプリの設定画面の表示で確かめられる
