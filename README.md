# 食品管理（Food Manager）

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

1. GitHub の repo → **Settings → Pages**
2. Source を **Deploy from a branch**、ブランチを `main` / フォルダを `/ (root)` にして保存
3. 数十秒後に `https://<ユーザー名>.github.io/Food_Manager/` で開けるようになる

### 4. アプリ側の設定

1. 公開された URL をスマホ（または PC）のブラウザで開く
2. 右上の歯車 → **GAS ウェブアプリURL** に手順 2 で控えた URL を貼る
3. **期限間近とみなす日数**（既定 3 日）を必要に応じて変更する
4. 「保存して同期」を押す

設定はそのデバイスの localStorage に保存される。別の端末で使うときは、その端末でも同じ URL を入力する。

ホーム画面に追加すると、アドレスバーなしのアプリとして起動する（Android: メニュー →「アプリをインストール」/ iOS: 共有 →「ホーム画面に追加」）。

---

## 使い方

- 上部のタブで **冷蔵 / 冷凍 / 常温** を切り替える。各タブ内は**期限が近い順**に並ぶ
- タブの赤いバッジは、そのタブにある「期限切れ＋期限間近」の件数
- カードの左端の色と右のバッジで状態が分かる
  - 赤 … 期限切れ（`N日超過`）
  - 橙 … 期限間近（しきい値以内。`今日まで` / `あとN日`）
  - 無色 … まだ余裕あり
- 下の「食品を追加」からモーダルで登録する

---

## データ構造

スプレッドシート「食品」シート、1 行 = 1 食品。

| 列 | 内容 |
|---|---|
| ID | GAS が採番する UUID。行を特定するために使う |
| 商品名 | テキスト |
| 保管場所 | `冷蔵` / `冷凍` / `常温` |
| 購入日 | `yyyy-MM-dd`（文字列で保持） |
| 期限種別 | `賞味期限` / `消費期限` |
| 期限日 | `yyyy-MM-dd`（文字列で保持） |
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
| `consume` | `{ id, consumed?: boolean }` | 更新後の食品（論理削除） |
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

`daysLeft` は期限日までの残日数（今日なら 0、過ぎていればマイナス）。
`status` は `expired` / `soon` / `ok` / `unknown`。

---

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
