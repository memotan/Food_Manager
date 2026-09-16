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
var GAS_VERSION = '1.0.0';

var SHEET_NAME = '食品';

/** 列の並び。変更したら COL も合わせること */
var HEADERS = ['ID', '商品名', '保管場所', '購入日', '期限種別', '期限日', '数量', '消費済み', '更新日時'];

/** 列番号（1 始まり） */
var COL = {
  ID: 1, NAME: 2, PLACE: 3, BOUGHT: 4, KIND: 5,
  EXPIRY: 6, QTY: 7, CONSUMED: 8, UPDATED: 9
};

var PLACES = ['冷蔵', '冷凍', '常温'];
var KINDS = ['賞味期限', '消費期限'];

/** 期限間近とみなす既定のしきい値（日）。フロント側の設定が優先される */
var DEFAULT_WARN_DAYS = 3;


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
  ['name', 'place', 'boughtDate', 'kind', 'expiryDate', 'quantity', 'consumed'].forEach(function (k) {
    if (food[k] !== undefined) cur[k] = food[k];
  });

  var rec = normalize_(cur);
  rec.id = cur.id;
  rec.consumed = cur.consumed === true;
  rec.updatedAt = nowStr_();

  sheet_().getRange(found.rowIndex, 1, 1, HEADERS.length).setValues([toRow_(rec)]);
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
 */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);

  sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
  sh.setFrozenRows(1);

  // 入力規則（手でシートを触るとき用）
  sh.getRange(2, COL.PLACE, sh.getMaxRows() - 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PLACES, true).build());
  sh.getRange(2, COL.KIND, sh.getMaxRows() - 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(KINDS, true).build());

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

  var values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
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
      var row = sh.getRange(rowIndex, 1, 1, HEADERS.length).getValues()[0];
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
    updatedAt:  dateTimeStr_(r[COL.UPDATED - 1])
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

  return {
    name: name,
    place: place,
    boughtDate: normDate_(f.boughtDate) || '',
    kind: kind,
    expiryDate: expiry,
    quantity: qty
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
