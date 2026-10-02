// アプリアイコンを生成する。`node icons/gen-icon.mjs` で icons/*.svg を書き出す。
//
// 図柄は「ドットで描いたバナナの房」。ドット絵の塗り方に合わせ、
// 各バナナの縦1列ごとに上から順位を取り、上端→明 / 本体 / 陰 / 最下段→縁 と
// 帯で色を割り当てる。1粒ずつ幾何から明暗を決めると、格子に落とした時点で
// 色の違う粒が散り、小さくすると濁って見えるため。
//
// 手前と奥の房は、暗い影ではなく「背景色の隙間1マス」で切り分ける。
// 小さいサイズでは、暗い色で区切るより地の色を覗かせる方が形が残る。
//
// 出力は3つ。Android のアダプティブアイコンが前景と背景を別レイヤーで要求するため。
//   icon.svg            … 地＋図柄（PWA・favicon 用）
//   icon-foreground.svg … 図柄のみ・地は透明（Android の前景レイヤー）
//   icon-background.svg … 地のみ（Android の背景レイヤー）
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Android のアダプティブアイコンは外周が削られる。192 の図面で 32〜160 の内側に収める
const SAFE_MIN = 32, SAFE_MAX = 160;

export const CONFIG = {
  k: 3,              // 房の本数
  a0: 190, a1: 330,  // バナナ1本の弧（度）
  R: 46,             // 弧の半径
  rmax: 20,          // 一番太いところの半径
  rminRatio: 0.12,   // 先端の細さ（rmax に対する比）
  taper: 1.6,        // 先端の尖り方。大きいほど尖る
  tilt: -4,          // 全体の傾き。正で転がり、負で房元が上がる
  spread: 24,        // 房の開き（度）
  pivot: 40,         // 扇の軸を、ヘタからどれだけ上に置くか
  shrink: 0.88,      // 奥の房を縮める率
  cols: 17, rows: 17,// ドットの格子
  gapCells: 1.0,     // 手前と奥のあいだに空ける背景のマス数
  bands: [0.20, 0.58, 0.86],  // 明／本体／陰／縁 の境目（列の上からの割合）
  fill: 0.86,        // マスに対する粒の大きさ
  margin: 0.06,      // 安全領域の内側に取る余白
  stemCells: 2,      // ヘタの粒の数
  bg: '#2e7d32',
  stem: '#3f2c0b',
  palette: {         // [明, 本体, 陰, 縁]
    front: ['#fff3bb', '#f7cc34', '#cf901d', '#9a660f'],
    back:  ['#e8cf8a', '#d9ab25', '#a87415', '#7a520c'],
  },
};

const rad = d => (d * Math.PI) / 180;

/** 曲線に沿って太さを変えた円の列＝バナナ1本の型 */
function centerline({ a0, a1, R, rmax, rminRatio, taper }, cx, cy, n) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const a = rad(a0 + (a1 - a0) * t);
    const r = rmax * (rminRatio + (1 - rminRatio) * Math.sin(Math.PI * t) ** taper);
    pts.push([cx + R * Math.cos(a), cy - R * Math.sin(a), r]);
  }
  return pts;
}

function rotate(pts, ox, oy, deg) {
  const a = rad(deg), ca = Math.cos(a), sa = Math.sin(a);
  return pts.map(([x, y, r]) => [
    ox + (x - ox) * ca - (y - oy) * sa,
    oy + (x - ox) * sa + (y - oy) * ca,
    r,
  ]);
}

/** 房を手前→奥の順に組む */
function armSet(cfg, cx = 96, cy = 74, n = 160) {
  const base = rotate(centerline(cfg, cx, cy, n), cx, cy, cfg.tilt);
  const ox = base[base.length - 1][0];
  const oy = base[base.length - 1][1] - cfg.pivot;
  // 中央を手前にする（手前ほど明るいパレットになる）
  const order = [...Array(cfg.k).keys()]
    .map((i, idx) => [i, Math.abs(i - (cfg.k - 1) / 2), idx])
    .sort((p, q) => p[1] - q[1] || p[2] - q[2])
    .map(p => p[0]);
  return order.map((i, depth) => {
    const sc = cfg.shrink ** depth;
    const b = rotate(
      centerline({ ...cfg, R: cfg.R * sc, rmax: cfg.rmax * sc }, cx, cy, n),
      cx, cy, cfg.tilt);
    return rotate(b, ox, oy, -cfg.spread * (cfg.k - 1) / 2 + cfg.spread * i);
  });
}

/** 型の内側なら食い込み量、外なら負（＝輪郭までの距離） */
function inside(arm, px, py) {
  let best = -Infinity;
  for (const [x, y, r] of arm) best = Math.max(best, r - Math.hypot(px - x, py - y));
  return best;
}

function build(arms, cfg) {
  const all = arms.flat();
  const loX = Math.min(...all.map(([x, , r]) => x - r));
  const hiX = Math.max(...all.map(([x, , r]) => x + r));
  const loY = Math.min(...all.map(([, y, r]) => y - r));
  const hiY = Math.max(...all.map(([, y, r]) => y + r));
  const cw = (hiX - loX) / cfg.cols, ch = (hiY - loY) / cfg.rows;
  const cell = Math.max(cw, ch);

  const owner = new Map();                 // "列,行" -> 房の番号
  for (let ri = 0; ri <= cfg.rows; ri++) {
    for (let ci = 0; ci <= cfg.cols; ci++) {
      const px = loX + (ci + 0.5) * cw, py = loY + (ri + 0.5) * ch;
      for (let ai = 0; ai < arms.length; ai++) {
        if (inside(arms[ai], px, py) <= 0) continue;
        // 奥の房は、手前の輪郭から gapCells マス空けて切り分ける
        let hidden = false;
        for (let aj = 0; aj < ai; aj++) {
          if (inside(arms[aj], px, py) > -cell * cfg.gapCells) { hidden = true; break; }
        }
        if (!hidden) owner.set(`${ci},${ri}`, ai);
        break;
      }
    }
  }

  // 縦1列ごとに、上から順位で帯を割り当てる
  const byCol = new Map();
  for (const [key, ai] of owner) {
    const [ci, ri] = key.split(',').map(Number);
    const k = `${ai},${ci}`;
    if (!byCol.has(k)) byCol.set(k, []);
    byCol.get(k).push(ri);
  }
  const dots = [];
  for (const [k, rows] of byCol) {
    const [ai, ci] = k.split(',').map(Number);
    rows.sort((a, b) => a - b);
    rows.forEach((ri, j) => {
      const u = (j + 0.5) / rows.length;
      const [b0, b1, b2] = cfg.bands;
      const lvl = u >= b2 ? 3 : u >= b1 ? 2 : u >= b0 ? 1 : 0;
      dots.push({
        x: loX + (ci + 0.5) * cw,
        y: loY + (ri + 0.5) * ch,
        tone: ai === 0 ? 'front' : 'back',
        lvl,
      });
    });
  }
  return { dots, cw, ch, loX, loY, owner };
}

/** 安全領域いっぱいに、中央へ置き直す */
function recenter(dots, d, margin) {
  const loX = Math.min(...dots.map(p => p.x)) - d / 2;
  const hiX = Math.max(...dots.map(p => p.x)) + d / 2;
  const loY = Math.min(...dots.map(p => p.y)) - d / 2;
  const hiY = Math.max(...dots.map(p => p.y)) + d / 2;
  const avail = (SAFE_MAX - SAFE_MIN) * (1 - margin);
  const k = Math.min(avail / (hiX - loX), avail / (hiY - loY));
  const ox = (loX + hiX) / 2, oy = (loY + hiY) / 2;
  return {
    dots: dots.map(p => ({ ...p, x: 96 + (p.x - ox) * k, y: 96 + (p.y - oy) * k })),
    d: d * k,
  };
}

export function generate(cfg = CONFIG) {
  const arms = armSet(cfg);
  const { dots, cw, ch, loX, loY, owner } = build(arms, cfg);

  if (cfg.stemCells) {
    // ヘタは、手前のバナナの端の「列」の一番上のマスに続けて置く。
    // 座標で近い粒を探すと列がずれて浮くので、格子の列で合わせる
    const end = arms[0][arms[0].length - 1];
    const cells = [...owner.keys()].map(k => k.split(',').map(Number));
    const cs = [...new Set(cells.map(([c]) => c))].sort((a, b) => a - b);
    const ci = cs.reduce((best, c) =>
      Math.abs(loX + (c + 0.5) * cw - end[0]) < Math.abs(loX + (best + 0.5) * cw - end[0])
        ? c : best, cs[0]);
    const top = Math.min(...cells.filter(([c]) => c === ci).map(([, r]) => r));
    for (let i = 1; i <= cfg.stemCells; i++) {
      dots.push({ x: loX + (ci + 0.5) * cw, y: loY + (top - i + 0.5) * ch, tone: 'stem' });
    }
  }

  const placed = recenter(dots, Math.min(cw, ch) * cfg.fill, cfg.margin);
  const d = placed.d;
  const body = placed.dots.map(p => {
    const c = p.tone === 'stem' ? cfg.stem : cfg.palette[p.tone][p.lvl];
    return `  <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" `
         + `r="${(d / 2).toFixed(1)}" fill="${c}"/>`;
  }).join('\n');

  const head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" '
             + 'width="192" height="192">';
  const ground = `  <rect width="192" height="192" fill="${cfg.bg}"/>`;

  const bounds = {
    lo: Math.min(...placed.dots.flatMap(p => [p.x, p.y])) - d / 2,
    hi: Math.max(...placed.dots.flatMap(p => [p.x, p.y])) + d / 2,
  };
  return {
    icon: `${head}\n${ground}\n${body}\n</svg>\n`,
    foreground: `${head}\n${body}\n</svg>\n`,
    background: `${head}\n${ground}\n</svg>\n`,
    bounds,
    count: placed.dots.length,
  };
}

const isMain = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const here = dirname(fileURLToPath(import.meta.url));
  const out = generate();
  if (out.bounds.lo < SAFE_MIN || out.bounds.hi > SAFE_MAX) {
    console.error(`  安全領域からはみ出しています: `
      + `${out.bounds.lo.toFixed(1)}〜${out.bounds.hi.toFixed(1)} `
      + `(許容 ${SAFE_MIN}〜${SAFE_MAX})`);
    process.exit(1);
  }
  for (const [name, svg] of Object.entries({
    'icon.svg': out.icon,
    'icon-foreground.svg': out.foreground,
    'icon-background.svg': out.background,
  })) {
    writeFileSync(join(here, name), svg);
    console.log(`  ${name}`);
  }
  console.log(`  粒 ${out.count} / 範囲 `
    + `${out.bounds.lo.toFixed(1)}〜${out.bounds.hi.toFixed(1)}`);
}
