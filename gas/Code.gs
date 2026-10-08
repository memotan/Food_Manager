/**
 * 食品期限管理アプリ — GAS バックエンド
 *
 * Google スプレッドシート 1 行 = 1 食品。
 * フロントエンド（index.html）から JSON を POST で受け取り、
 * { ok: boolean, data, error } を返す。
 *
 * デプロイ手順は README.md を参照。
 */

// ========== 定数 ==========

/**
 * このファイルのバージョン。index.html の APP_VERSION と揃えること。
 * ping で返しており、揃っていないとアプリの設定画面が警告を出す。
 * Code.gs を直したら、ここを上げたうえで GAS エディタに貼り直し、再デプロイすること。
 */
var GAS_VERSION = '1.3.0';

var SHEET_NAME = '食品';

/**
 * 列の並び。変更したら COL も合わせること。
 *
 * 列を足すときは**必ず末尾に足す**。途中に挿すと、既にあるシートの値が
 * ひとつずつずれてしまう。末尾なら、古いシートでは空欄として読まれるだけで済む
 * （ジャンルは 10 列目として後から足した）。
 */
var HEADERS = ['ID', '商品名', '保管場所', '購入日', '期限種別', '期限日', '数量', '消費済み', '更新日時', 'ジャンル'];

/** 列番号（1 始まり） */
var COL = {
  ID: 1, NAME: 2, PLACE: 3, BOUGHT: 4, KIND: 5,
  EXPIRY: 6, QTY: 7, CONSUMED: 8, UPDATED: 9, CATEGORY: 10
};

var PLACES = ['冷蔵', '冷凍', '常温'];
var KINDS = ['賞味期限', '消費期限'];

/** ジャンル。末尾の「その他」は、未設定のときの受け皿も兼ねる */
var CATEGORIES = ['生鮮食品', '惣菜・おかず', 'インスタント', '保存食', 'パスタソース', '調味料', 'おやつ', '飲み物', 'その他'];
var DEFAULT_CATEGORY = 'その他';

/** 期限間近とみなす既定のしきい値（日）。フロント側の設定が優先される */
var DEFAULT_WARN_DAYS = 3;

// --- Budget Manager（kakeibo）からの取り込み ---
// BM のスプレッドシートは読むだけで、BM 側には何も書かない。
// スプレッドシート ID などはスクリプトプロパティに置く（公開 repo に書かない）。
//   BM_SPREADSHEET_ID  … 必須。BM のスプレッドシートの ID
//   BM_FOOD_CATEGORIES … 任意。取り込む BM のカテゴリ（カンマ区切り）。既定は「食費」
//   BM_INBOX_DAYS      … 任意。何日前までの記録を候補にするか。既定は 14
var BM_TX_SHEET = 'Transactions';
var DEFAULT_BM_CATEGORIES = '食費';
var DEFAULT_INBOX_DAYS = 14;

/** 取り込み済み・無視した品目の記録。無ければ最初の書き込みで作る */
var HISTORY_SHEET = '取込履歴';
var HISTORY_HEADERS = ['キー', '状態', '更新日時'];
var INBOX_IMPORTED = 'imported';
var INBOX_SKIPPED = 'skipped';


// ========== エントリポイント ==========

/**
 * フロントエンドからの POST を受ける。
 * body 例: { action: 'list', includeConsumed: false }
 */
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    return json_({ ok: true, data: dispatch_(body) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/** ブラウザで URL を直接開いたときの疎通確認用 */
function doGet() {
  return json_({ ok: true, data: {
    service: 'Food Inv. Manager GAS',
    version: GAS_VERSION,
    sheet: SHEET_NAME,
    today: todayStr_()
  } });
}

function dispatch_(body) {
  var action = body.action;
  switch (action) {
    case 'ping':    return { version: GAS_VERSION, today: todayStr_(), tz: tz_() };
    case 'list':    return listFoods(body.includeConsumed === true);
    case 'create':  return addFood(body.food || {});
    case 'update':  return updateFood(body.food || {});
    case 'consume': return setConsumed(body.id, body.consumed !== false);
    case 'delete':  return deleteFood(body.id);
    case 'expiring':return expiringFoods(body.days);
    case 'inbox':     return listInbox();
    case 'inboxMark': return markInbox(body.key, body.status);
    default: throw new Error('不明な action: ' + action);
  }
}


// ========== 公開 API（CRUD） ==========

/**
 * 一覧取得。
 * @param {boolean} includeConsumed true なら消費済みも含める（既定は除外）
 * @return {Array<Object>} 期限日の昇順（期限日を登録していないものは末尾）
 */
function listFoods(includeConsumed) {
  var rows = readAll_();
  if (!includeConsumed) {
    rows = rows.filter(function (f) { return !f.consumed; });
  }
  return sortByExpiry_(rows);
}

/**
 * 新規追加。ID と更新日時はサーバ側で採番する。
 * expiryDate は任意（空なら kind も空になり、status は 'unknown' になる）。
 * @param {Object} food { name, place, boughtDate, kind, expiryDate, quantity }
 * @return {Object} 追加された食品（ID 付き）
 */
function addFood(food) {
  var rec = normalize_(food);
  rec.id = Utilities.getUuid();
  rec.consumed = false;
  rec.updatedAt = nowStr_();

  sheet_().appendRow(toRow_(rec));

  // 取込待ちから登録したときは、同じ呼び出しの中で取り込み済みにする。
  // 別の呼び出しに分けると、登録だけ通って記録が漏れ、同じ品目が候補に残ってしまう
  if (food.inboxKey) writeHistory_(String(food.inboxKey), INBOX_IMPORTED);
  return decorate_(rec);
}

/**
 * 編集・更新。id で行を特定し、渡されたフィールドのみ上書きする。
 * @param {Object} food { id, ...更新したいフィールド }
 * @return {Object} 更新後の食品
 */
function updateFood(food) {
  if (!food || !food.id) throw new Error('id が指定されていません');

  var found = findRow_(food.id);
  var cur = found.record;

  // 渡されたキーだけを上書き（部分更新）
  ['name', 'place', 'boughtDate', 'kind', 'expiryDate', 'quantity', 'category', 'consumed'].forEach(function (k) {
    if (food[k] !== undefined) cur[k] = food[k];
  });

  var rec = normalize_(cur);
  rec.id = cur.id;
  rec.consumed = cur.consumed === true;
  rec.updatedAt = nowStr_();

  var sh = sheet_();
  // 書き戻す前に、列が足りていることを確かめる（ジャンル列を足す前のシート対策）
  if (sh.getMaxColumns() < HEADERS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  }
  sh.getRange(found.rowIndex, 1, 1, HEADERS.length).setValues([toRow_(rec)]);
  return decorate_(rec);
}

/**
 * 論理削除。消費済みフラグを立てる（既定）／下ろす。
 * @param {string} id
 * @param {boolean} consumed
 * @return {Object} 更新後の食品
 */
function setConsumed(id, consumed) {
  return updateFood({ id: id, consumed: consumed === true });
}

/**
 * 物理削除。行ごと消す。履歴を残したい場合は setConsumed を使うこと。
 * @param {string} id
 * @return {Object} { id, deleted: true }
 */
function deleteFood(id) {
  if (!id) throw new Error('id が指定されていません');
  var found = findRow_(id);
  sheet_().deleteRow(found.rowIndex);
  return { id: id, deleted: true };
}

/**
 * 期限切れ・期限間近の判定。
 * 残日数 daysLeft が days 以下（期限切れのマイナスを含む）のものを返す。
 * 期限日を登録していない食品は対象外。
 * @param {number=} days しきい値。省略時は DEFAULT_WARN_DAYS
 * @return {Array<Object>} 期限日の昇順
 */
function expiringFoods(days) {
  var limit = (days === undefined || days === null || days === '') ? DEFAULT_WARN_DAYS : Number(days);
  return listFoods(false).filter(function (f) {
    return f.daysLeft !== null && f.daysLeft <= limit;
  });
}


// ========== 取込待ち（Budget Manager の食費を候補にする） ==========

/**
 * BM の食費の支出を、品目ごとの候補にして返す。
 *
 * BM では 1 回の買い物が 1 件で、品目はメモに「、」区切りで書かれている。
 * そのため 1 件を品目に分け、品目ごとに取り込み済みかを判定する
 * （一部だけ登録して閉じても、残りだけが候補に残る）。
 *
 * @return {{configured: boolean, items: Array<Object>}}
 *   items は新しい日付順。BM のスプレッドシート ID が未設定なら configured=false
 */
function listInbox() {
  var txs = readBmFoodTransactions_();
  if (txs === null) return { configured: false, items: [] };

  var handled = readHistoryKeys_();
  var items = [];
  txs.forEach(function (tx) {
    splitMemo_(tx.memo).forEach(function (part) {
      var key = tx.id + '#' + part.key;
      if (handled[key]) return;
      items.push({
        key: key, txId: tx.id, date: tx.date, store: tx.store,
        amount: tx.amount, name: part.name
      });
    });
  });
  return { configured: true, items: items };
}

/**
 * 候補の状態を記録する。
 * @param {string} key 候補のキー
 * @param {string} status 'skipped'（無視）／ 'imported' ／ ''（記録を消して候補に戻す）
 */
function markInbox(key, status) {
  key = String(key || '');
  if (!key) throw new Error('key が指定されていません');
  status = String(status || '');
  if (status && status !== INBOX_SKIPPED && status !== INBOX_IMPORTED) {
    throw new Error('不明な status: ' + status);
  }
  if (status) writeHistory_(key, status);
  else clearHistory_(key);
  return { key: key, status: status };
}

/**
 * BM の Transactions から、直近の食費の支出を新しい順に返す。
 * @return {?Array<Object>} BM_SPREADSHEET_ID が未設定なら null
 */
function readBmFoodTransactions_() {
  var props = PropertiesService.getScriptProperties();
  var id = String(props.getProperty('BM_SPREADSHEET_ID') || '').trim();
  if (!id) return null;

  var cats = String(props.getProperty('BM_FOOD_CATEGORIES') || DEFAULT_BM_CATEGORIES)
    .split(',').map(function (c) { return c.trim(); }).filter(Boolean);
  var days = Number(props.getProperty('BM_INBOX_DAYS'));
  if (!isFinite(days) || days <= 0) days = DEFAULT_INBOX_DAYS;

  var sh = SpreadsheetApp.openById(id).getSheetByName(BM_TX_SHEET);
  if (!sh) throw new Error('BM のスプレッドシートに「' + BM_TX_SHEET + '」シートがありません');
  if (sh.getLastRow() < 2) return [];

  var values = sh.getDataRange().getValues();
  var col = {};
  values[0].forEach(function (h, i) { col[String(h).trim()] = i; });
  ['id', 'date', 'type', 'category', 'amount', 'place', 'memo'].forEach(function (h) {
    if (col[h] === undefined) throw new Error('BM の「' + BM_TX_SHEET + '」に「' + h + '」列がありません');
  });

  // 初回に過去の全記録が候補に溢れないよう、日付で区切る
  var cutoff = Utilities.formatDate(new Date(Date.now() - days * 86400000), tz_(), 'yyyy-MM-dd');

  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var txId = String(r[col.id]).trim();
    if (!txId) continue;
    if (String(r[col.type]).trim() !== 'expense') continue;
    if (cats.indexOf(String(r[col.category]).trim()) < 0) continue;

    var date = dateStr_(r[col.date]);
    if (!date || date < cutoff) continue;

    out.push({
      id: txId,
      date: date,
      store: String(r[col.place] || '').trim(),
      amount: Number(r[col.amount]) || 0,
      memo: String(r[col.memo] || ''),
      _order: i
    });
  }

  // 新しい日付が先。同じ日は BM のシートの並びが後のもの（後から記録したもの）を先に
  out.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return b._order - a._order;
  });
  return out;
}

/**
 * メモを品目に分ける。区切りは「、」（「,」「，」も受ける）。
 *
 * key は品目ごとの識別子で、候補の取り込み済み判定に使う。
 * 位置ではなく名前で持つので、メモの並び替えや追記で他の品目が候補に戻らない。
 * 同じ名前が 2 つ以上あるときだけ、2 つ目以降に連番を付ける。
 * メモが空の買い物は、名前の無い品目 1 つとして扱う（登録時に品名を入れてもらう）。
 */
function splitMemo_(memo) {
  var names = String(memo || '').split(/[、,，]/)
    .map(function (n) { return n.trim(); })
    .filter(Boolean);
  if (!names.length) return [{ name: '', key: '' }];

  var seen = {};
  return names.map(function (n) {
    seen[n] = (seen[n] || 0) + 1;
    return { name: n, key: seen[n] === 1 ? n : n + '#' + seen[n] };
  });
}

function historySheet_(create) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(HISTORY_SHEET);
  if (!sh && create) {
    sh = ss.insertSheet(HISTORY_SHEET);
    sh.getRange(1, 1, 1, HISTORY_HEADERS.length).setValues([HISTORY_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // キーは文字列のまま持つ（数字だけの ID が数値に化けないように）
    sh.getRange(2, 1, sh.getMaxRows() - 1).setNumberFormat('@');
  }
  return sh;
}

/** 記録済みのキーの集合 */
function readHistoryKeys_() {
  var sh = historySheet_(false);
  var set = {};
  if (!sh || sh.getLastRow() < 2) return set;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var k = String(r[0]);
    if (k) set[k] = true;
  });
  return set;
}

/** キーの状態を書く。既にあれば上書き、無ければ追記 */
function writeHistory_(key, status) {
  var sh = historySheet_(true);
  var row = findHistoryRow_(sh, key);
  var values = [[key, status, nowStr_()]];
  if (row > 0) sh.getRange(row, 1, 1, HISTORY_HEADERS.length).setValues(values);
  else sh.getRange(sh.getLastRow() + 1, 1, 1, HISTORY_HEADERS.length).setValues(values);
}

function clearHistory_(key) {
  var sh = historySheet_(false);
  if (!sh) return;
  var row = findHistoryRow_(sh, key);
  if (row > 0) sh.deleteRow(row);
}

function findHistoryRow_(sh, key) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var keys = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) {
    if (String(keys[i][0]) === key) return i + 2;
  }
  return -1;
}

/**
 * 取り込みの確認用。GAS エディタから 1 回手動で実行する。
 * BM のスプレッドシートへのアクセス許可を求められるので、承認すること
 * （承認しないと、デプロイしたウェブアプリからは BM のシートを開けない）。
 */
function checkInbox() {
  var r = listInbox();
  if (!r.configured) return 'BM_SPREADSHEET_ID が未設定です（プロジェクトの設定 → スクリプト プロパティ）';
  return '候補 ' + r.items.length + ' 件';
}


// ========== 通知フック（将来の ntfy 連携用・現時点では未実装） ==========

/**
 * 期限が近い食品を通知する。
 *
 * 実装スコープ外だが、差し込み口としてここを用意してある。
 * 使うときは GAS エディタで「トリガー」→ 時間主導型（例：毎日 8 時）に
 * この関数を割り当て、下の TODO を ntfy への UrlFetchApp.fetch に置き換える。
 * トピック名などの秘密情報は PropertiesService に入れ、コードに直書きしない。
 */
function notifyExpiringItems() {
  var props = PropertiesService.getScriptProperties();
  var days = Number(props.getProperty('NOTIFY_THRESHOLD_DAYS') || DEFAULT_WARN_DAYS);
  var items = expiringFoods(days);
  if (!items.length) return;

  var message = items.map(function (f) {
    return f.name + '（' + f.place + '）' + expiryLabel_(f.daysLeft);
  }).join('\n');

  // TODO: ntfy 連携をここに追加する。例：
  // var topic = props.getProperty('NTFY_TOPIC');
  // UrlFetchApp.fetch('https://ntfy.sh/' + topic, {
  //   method: 'post',
  //   payload: message,
  //   headers: { Title: '食品の期限が近づいています', Priority: 'default' }
  // });

  Logger.log(message);
}


// ========== セットアップ ==========

/**
 * シートとヘッダ行を用意する。初回に GAS エディタから 1 回だけ手動実行する。
 *
 * **列を足したあとにも、もう一度実行すること。** 既にある行は触らず、
 * ヘッダと入力規則だけを引き直すので、データはそのまま残る。
 */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  // 列を足したあとに実行されることがあるので、足りなければ広げる
  if (sh.getMaxColumns() < HEADERS.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), HEADERS.length - sh.getMaxColumns());
  }

  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);

  // 入力規則（手でシートを触るとき用）
  sh.getRange(2, COL.PLACE, sh.getMaxRows() - 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PLACES, true).build());
  sh.getRange(2, COL.KIND, sh.getMaxRows() - 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(KINDS, true).build());
  sh.getRange(2, COL.CATEGORY, sh.getMaxRows() - 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(CATEGORIES, true).build());

  // 日付列は文字列（yyyy-MM-dd）で保持するため、書式ずれを避けてプレーンテキストにする
  sh.getRange(2, COL.BOUGHT, sh.getMaxRows() - 1).setNumberFormat('@');
  sh.getRange(2, COL.EXPIRY, sh.getMaxRows() - 1).setNumberFormat('@');

  sh.setColumnWidth(COL.ID, 240);
  sh.setColumnWidth(COL.NAME, 200);
  return 'セットアップ完了: ' + SHEET_NAME;
}


// ========== 内部ヘルパ ==========

function sheet_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('シート「' + SHEET_NAME + '」がありません。setupSheet を一度実行してください');
  return sh;
}

/** 全行をオブジェクト配列で読む（残日数などを付与済み） */
function readAll_() {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];

  // 列を足す前のシートを読むこともあるので、実際にある幅までにとどめる
  var width = Math.min(HEADERS.length, sh.getMaxColumns());
  var values = sh.getRange(2, 1, last - 1, width).getValues();
  return values
    .filter(function (r) { return String(r[COL.ID - 1]).trim() !== ''; })
    .map(function (r) { return decorate_(fromRow_(r)); });
}

function findRow_(id) {
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last < 2) throw new Error('該当する食品が見つかりません: ' + id);

  var ids = sh.getRange(2, COL.ID, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) {
      var rowIndex = i + 2;
      var width = Math.min(HEADERS.length, sh.getMaxColumns());
      var row = sh.getRange(rowIndex, 1, 1, width).getValues()[0];
      return { rowIndex: rowIndex, record: fromRow_(row) };
    }
  }
  throw new Error('該当する食品が見つかりません: ' + id);
}

/** シートの 1 行 → オブジェクト */
function fromRow_(r) {
  return {
    id:         String(r[COL.ID - 1]),
    name:       String(r[COL.NAME - 1]),
    place:      String(r[COL.PLACE - 1]),
    boughtDate: dateStr_(r[COL.BOUGHT - 1]),
    kind:       String(r[COL.KIND - 1]),
    expiryDate: dateStr_(r[COL.EXPIRY - 1]),
    quantity:   Number(r[COL.QTY - 1]) || 0,
    consumed:   r[COL.CONSUMED - 1] === true || String(r[COL.CONSUMED - 1]).toUpperCase() === 'TRUE',
    updatedAt:  dateTimeStr_(r[COL.UPDATED - 1]),
    category:   String(r[COL.CATEGORY - 1] || '')
  };
}

/** オブジェクト → シートの 1 行 */
function toRow_(f) {
  var row = [];
  row[COL.ID - 1]       = f.id;
  row[COL.NAME - 1]     = f.name;
  row[COL.PLACE - 1]    = f.place;
  row[COL.BOUGHT - 1]   = f.boughtDate || '';
  row[COL.KIND - 1]     = f.kind;
  row[COL.EXPIRY - 1]   = f.expiryDate || '';
  row[COL.QTY - 1]      = f.quantity;
  row[COL.CONSUMED - 1] = f.consumed === true;
  row[COL.UPDATED - 1]  = f.updatedAt || nowStr_();
  row[COL.CATEGORY - 1] = f.category || DEFAULT_CATEGORY;
  return row;
}

/** 入力値の検証と正規化 */
function normalize_(f) {
  var name = String(f.name || '').trim();
  if (!name) throw new Error('商品名は必須です');

  var place = String(f.place || '').trim();
  if (PLACES.indexOf(place) < 0) throw new Error('保管場所は ' + PLACES.join('／') + ' のいずれかです');

  // 期限日は任意。在庫の数だけを管理したい食品もあるため必須にしない
  var expiry = normDate_(f.expiryDate);

  // 期限が無ければ種別も持たせない。期限があるなら種別は必須
  var kind = String(f.kind || '').trim();
  if (!expiry) {
    kind = '';
  } else if (KINDS.indexOf(kind) < 0) {
    throw new Error('期限種別は ' + KINDS.join('／') + ' のいずれかです');
  }

  var qty = Number(f.quantity);
  if (!isFinite(qty) || qty < 0) qty = 1;

  // ジャンルは任意。知らない値や空欄は「その他」に寄せる
  // （列を足す前に登録した食品は空欄のままなので、弾かずに受け止める）
  var category = String(f.category || '').trim();
  if (CATEGORIES.indexOf(category) < 0) category = DEFAULT_CATEGORY;

  return {
    name: name,
    place: place,
    boughtDate: normDate_(f.boughtDate) || '',
    kind: kind,
    expiryDate: expiry,
    quantity: qty,
    category: category
  };
}

/** 残日数・状態を付与する */
function decorate_(f) {
  var d = daysUntil_(f.expiryDate);
  f.daysLeft = d;
  f.status = (d === null) ? 'unknown' : (d < 0 ? 'expired' : (d <= DEFAULT_WARN_DAYS ? 'soon' : 'ok'));
  return f;
}

/**
 * 期限日の昇順に並べる（期限日を登録していないものは末尾）。
 *
 * 期限なしどうしは 0 を返すこと。1 を返すと a>b と b>a が同時に成立する
 * 不正な比較になり、期限なしが2件以上あると順序が安定しない。
 */
function sortByExpiry_(list) {
  return list.slice().sort(function (a, b) {
    var ax = a.expiryDate || '';
    var bx = b.expiryDate || '';
    if (!ax && !bx) return 0;
    if (!ax) return 1;
    if (!bx) return -1;
    return ax < bx ? -1 : (ax > bx ? 1 : 0);
  });
}

/**
 * 期限日までの残日数。今日なら 0、過ぎていればマイナス。
 * @return {?number} 期限日が空なら null
 */
function daysUntil_(dateStr) {
  if (!dateStr) return null;
  var a = Date.parse(dateStr + 'T00:00:00Z');
  var b = Date.parse(todayStr_() + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}

function expiryLabel_(d) {
  if (d === null) return '';
  if (d < 0) return (-d) + '日超過';
  if (d === 0) return '今日まで';
  return 'あと' + d + '日';
}

function tz_() { return Session.getScriptTimeZone() || 'Asia/Tokyo'; }
function todayStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }
function nowStr_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'); }

/** セルの値（Date でも文字列でも）を yyyy-MM-dd に揃える */
function dateStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  return normDate_(v) || '';
}

function dateTimeStr_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss');
  return String(v || '');
}

/** 'yyyy-MM-dd' / 'yyyy/MM/dd' を 'yyyy-MM-dd' に正規化。不正なら '' */
function normDate_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  var s = String(v).trim().replace(/\//g, '-');
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
}

function pad2_(n) { return ('0' + n).slice(-2); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
