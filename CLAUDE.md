# CLAUDE.md

## プロジェクト概要

**Food Manager（食品管理）** — GitHub Pages 上で動作するモバイルファーストの PWA。
冷蔵・冷凍・常温にある食品の期限と在庫を管理し、GAS のウェブアプリ経由で
Google スプレッドシートに読み書きする。

姉妹プロジェクト **NeoNoting**（PWA + GAS + Notion のタスク/メモ管理）と同じ流儀で作られている。

- フロントエンドは **単一の HTML ファイル**（インライン CSS + バニラ JS、ビルド工程なし）
- バックエンドは GAS のウェブアプリ。NeoNoting と違い、**GAS のコードもこの repo に入っている**（`gas/Code.gs`）
- 依存は CDN の Tabler Icons (`@tabler/icons-webfont`) のみ。フレームワーク・パッケージマネージャなし

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

- `place` は `冷蔵` / `冷凍` / `常温`、`kind` は `賞味期限` / `消費期限`（GAS 側の `normalize_` で検証）
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
既定では web アセットを同梱する構成で、`server.url` は書いていない
（GitHub Pages が未公開でも動くようにするため）。切り替え方は README を参照。

- **アプリ本体は必ずルートの `index.html` を直す。** `capacitor-app/www/` は生成物で、
  次の `npm run sync` に上書きされる
- **ビルド工程がないので `import` は使えない。** プラグインは `Capacitor.Plugins.App` のように
  グローバル経由で参照する
- 連携部分は `setupCapacitor()` に閉じ込める。`window.Capacitor` が無ければ即 return するので、
  同じファイルがブラウザでもそのまま動く。この前提を壊さないこと
- 現状の連携: Android の戻るボタン（モーダル → 設定画面 → 終了）と、
  アプリ復帰時の再描画・再同期（`handleResume()`）

## 実装状況

段階的に進めている。

- **完了（第 1 段階）**: 一覧表示 / 追加（モーダル）/ 保管場所タブ / 期限順ソート / 色分け・バッジ / しきい値設定
- **未着手（第 2 段階）**: 編集・削除の UI。GAS 側の `update` / `consume` / `delete` は実装済みなので、
  カードのタップで既存のモーダルを編集モードで開く形が素直
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

## デプロイ

- **フロント**: `main` ブランチへの push で `.github/workflows/pages.yml` が走り、GitHub Pages が更新される。
  Settings → Pages の Source は **GitHub Actions**（新しい repo の既定）。
  `Deploy from a branch` に切り替える場合はワークフローを削除すること（残ると毎 push 失敗する）。
  配信されるのはリポジトリ全体で、入口は `index.html`
- **GAS**: `gas/Code.gs` の変更は自動では反映されない。GAS エディタに貼り直したうえで
  「デプロイ → デプロイを管理 → 編集 → バージョン: 新バージョン → デプロイ」まで行うこと
