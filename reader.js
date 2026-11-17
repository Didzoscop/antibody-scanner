/* Lecture de l'étiquette à plat, sur l'appareil : rien n'est envoyé ailleurs.
   - Code 2D (DataMatrix, QR…) : zxing-wasm (github.com/Sec-ant/zxing-wasm). Les codes GS1 des fabricants donnent
     référence commerciale (GTIN), lot et péremption sans erreur de lecture. Marche aussi sur iPhone, où Safari n'a pas
     de lecteur de codes intégré.
   - Texte : Tesseract.js (github.com/naptha/tesseract.js), puis des règles simples (« Cat », « Lot », « Clone »…) et
     des listes de fluorochromes et de fabricants.
   Les deux bibliothèques ne sont téléchargées (jsDelivr) qu'à la première lecture, puis gardées par le navigateur.
   La valeur du code l'emporte sur celle du texte quand les deux existent. */
(function(){
'use strict';
const ZXING = 'https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.7/dist/iife/reader/index.js';
const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

const loaded = {};
function loadScript(src){
  return loaded[src] || (loaded[src] = new Promise((ok, ko) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    s.onload = ok; s.onerror = () => { delete loaded[src]; ko(new Error('chargement impossible : ' + src)); };
    document.head.appendChild(s);
  }));
}

// image agrandie, en gris, contraste étiré : Tesseract lit mal du texte de moins de ~20 px de haut
function prepare(canvas, k){
  const w = Math.round(canvas.width * k), h = Math.round(canvas.height * k), c = document.createElement('canvas');
  c.width = w; c.height = h; const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high'; x.drawImage(canvas, 0, 0, w, h);
  const im = x.getImageData(0, 0, w, h), d = im.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4){ const g = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) | 0; d[i] = g; hist[g]++; }
  let lo = 0, hi = 255, acc = 0; const n = w * h;
  for (let v = 0; v < 256; v++){ acc += hist[v]; if (acc > n * .01){ lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--){ acc += hist[v]; if (acc > n * .01){ hi = v; break; } }
  const sc = 255 / Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4){ const g = Math.max(0, Math.min(255, (d[i] - lo) * sc)); d[i] = d[i + 1] = d[i + 2] = g; }
  x.putImageData(im, 0, 0);
  return c;
}

/* ---------- codes 2D ---------- */
async function readCode(canvas){
  await loadScript(ZXING);
  const Z = window.ZXingWASM, results = [];
  for (const k of [1, 2]){   // un petit DataMatrix se lit mieux agrandi
    const c = k === 1 ? canvas : prepare(canvas, k);
    const im = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
    const r = await Z.readBarcodes(im, { tryHarder: true, maxNumberOfSymbols: 4, textMode: 'HRI' });
    for (const b of r) if (b.isValid !== false && b.text && !results.some(o => o.text === b.text)) results.push({ text: b.text, format: b.format });
    if (results.length) break;
  }
  return results;
}
// Code lu sur une image brute du scan (pleine résolution, pendant la rotation). Sur l'étiquette à plat, le code est
// souvent coupé par la jonction ou déformé par l'assemblage ; sur une image brute il est entier. Vidéo BioLegend CD183 :
// lu sur 7 images sur 179, la 1re 2,3 s après la pose, ~4 ms par image. Renvoie { text, format } ou null.
// Pas d'attente : tant que la bibliothèque se charge, on renvoie null (le scan ne doit pas ralentir).
let zxingReady = false;
async function scanCode(imageData){
  if (!zxingReady){ loadScript(ZXING).then(() => { zxingReady = true; }).catch(() => {}); return null; }
  const r = await window.ZXingWASM.readBarcodes(imageData, { tryHarder: true, maxNumberOfSymbols: 1, textMode: 'HRI', formats: ['DataMatrix', 'QRCode', 'Aztec', 'PDF417'] });
  return r.length && r[0].text && r[0].isValid !== false ? { text: r[0].text, format: r[0].format } : null;
}
// Contenu d'un code : GS1 (BD, Invitrogen…) ou « catalogue   lot » (BioLegend : « 126528   B350197 »)
function parseCode(text){
  if (/\(\d{2,4}\)/.test(text)) return parseGS1(text);
  const tok = text.trim().split(/\s+/);
  if (tok.length === 2 && /^\d{4,8}$/.test(tok[0]) && /^[A-Z0-9-]{4,}$/i.test(tok[1])) return { ref: tok[0], lot: tok[1] };
  return {};
}
// éléments GS1 : « (01)00382906127990(10)3079093(17)251031 »
const GS1 = { '01': 'gtin', '10': 'lot', '17': 'exp', '11': 'made', '21': 'serial', '240': 'ref', '241': 'ref' };
function parseGS1(text){
  const out = {}, re = /\((\d{2,4})\)([^(]*)/g; let m;
  while ((m = re.exec(text))) if (GS1[m[1]]) out[GS1[m[1]]] = m[2].trim();
  if (out.exp && /^\d{6}$/.test(out.exp)){   // AAMMJJ ; JJ = 00 : dernier jour du mois
    const y = 2000 + +out.exp.slice(0, 2), mo = +out.exp.slice(2, 4), d = +out.exp.slice(4, 6) || new Date(y, mo, 0).getDate();
    out.exp = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return out;
}

/* ---------- texte ---------- */
let worker = null;
async function ocr(canvas){
  await loadScript(TESS);
  if (!worker){
    worker = await window.Tesseract.createWorker('eng');
    await worker.setParameters({ preserve_interword_spaces: '1' });
  }
  // Trois lectures, l'image agrandie ×2, ×3 et ×4, puis vote par champ : chaque taille se trompe ailleurs (6 lu 8,
  // chiffre perdu). 6 étiquettes des vidéos, 42 champs : 33 à 35 justes pour une seule taille (×2 à ×5), 35 votés.
  const texts = [];
  for (const k of [2, 3, 4]){ const { data } = await worker.recognize(prepare(canvas, k)); texts.push(data.text || ''); }
  return texts;
}
// valeur la plus fréquente de chaque champ ; à égalité, celle de la lecture du milieu (×3)
function vote(list){
  const out = {};
  for (const k of new Set(list.flatMap(o => Object.keys(o)))){
    const n = new Map(); list.forEach(o => { if (o[k]) n.set(o[k], (n.get(o[k]) || 0) + 1); });
    if (!n.size) continue;
    const top = Math.max(...n.values()), best = [...n].filter(([, c]) => c === top).map(([v]) => v);
    out[k] = best.length === 1 ? best[0] : (best.includes(list[1][k]) ? list[1][k] : best[0]);
  }
  return out;
}

const MAKERS = [
  [/\bBD\b|Pharmingen|BD\s*Horizon|Becton|bdbiosciences|OptiBuild/i, 'BD Biosciences'],
  [/Bio\s*Leg(end)?/i, 'BioLegend'],   // souvent coupé (« BioLeg ») sur le bord de l'image
  [/eBioscience/i, 'Invitrogen (eBioscience)'],
  [/Invitrogen|Thermo\s*Fisher/i, 'Invitrogen (Thermo Fisher)'],
  [/R\s*&\s*D\s*Systems|\bR&D\b|rndsystems/i, 'R&D Systems'],
  [/Miltenyi/i, 'Miltenyi Biotec'], [/Beckman/i, 'Beckman Coulter'], [/Tonbo/i, 'Tonbo'], [/Cell\s*Signaling/i, 'Cell Signaling'],
  [/abcam/i, 'Abcam'], [/Sony/i, 'Sony'], [/Cytek/i, 'Cytek'], [/Biotium/i, 'Biotium'], [/Novus/i, 'Novus'], [/Sino\s*Biological/i, 'Sino Biological']
];
// du plus spécifique au plus général (« APC-Cy7 » avant « APC ») ; tolère « / » ou espace à la place du tiret
const FLUOR = [
  [/Alexa\s*Fluor\W{0,3}\s*(\d{3})/i, m => 'Alexa Fluor ' + m[1]],
  [/\b(BUV|BV|BB|BYG)\s?(\d{3})\b/i, m => m[1].toUpperCase() + m[2]],
  [/Brilliant\s*(Ultra\s*)?Violet\W{0,3}\s*(\d{3})/i, m => (m[1] ? 'BUV' : 'BV') + m[2]],
  [/Super\s*Bright\s*(\d{3})/i, m => 'Super Bright ' + m[1]],
  [/e\s?Fluor\W{0,3}\s*(\d{3})/i, m => 'eFluor ' + m[1]],
  [/Spark\s*(\w+)\s*(\d{3})?/i, m => 'Spark ' + m[1] + (m[2] ? ' ' + m[2] : '')],
  [/PerCP[\s\/-]*Cy\s?5\.?5/i, () => 'PerCP-Cy5.5'], [/PerCP[\s\/-]*e\s?Fluor\s*(\d{3})/i, m => 'PerCP-eFluor ' + m[1]], [/\bPerCP\b/i, () => 'PerCP'],
  [/APC[\s\/-]*Cy\s?7/i, () => 'APC-Cy7'], [/APC[\s\/-]*H7/i, () => 'APC-H7'], [/APC[\s\/-]*Fire\s*(\d{3})/i, m => 'APC-Fire ' + m[1]], [/APC[\s\/-]*R\s?700/i, () => 'APC-R700'],
  [/PE[\s\/-]*Cy\s?7/i, () => 'PE-Cy7'], [/PE[\s\/-]*Cy\s?5\.5/i, () => 'PE-Cy5.5'], [/PE[\s\/-]*Cy\s?5/i, () => 'PE-Cy5'], [/PE[\s\/-]*CF\s?594/i, () => 'PE-CF594'],
  [/PE[\s\/-]*Dazzle\s*(\d{3})/i, m => 'PE-Dazzle ' + m[1]], [/PE[\s\/-]*Fire\s*(\d{3})/i, m => 'PE-Fire ' + m[1]], [/PE[\s\/-]*Texas\s*Red/i, () => 'PE-Texas Red'],
  [/Pacific\s*(Blue|Orange)/i, m => 'Pacific ' + m[1]], [/\bFITC\b/i, () => 'FITC'], [/\bAPC\b/i, () => 'APC'], [/\bPE\b/, () => 'PE'],
  [/\bBiotin/i, () => 'Biotin'], [/Purified/i, () => 'Purified (unconjugated)'], [/\bDAPI\b/i, () => 'DAPI'], [/7-?AAD/i, () => '7-AAD']
];

// numéros qui existent vraiment : un numéro inconnu est ramené au plus proche en tenant compte des confusions de
// lecture (6/8, 0/9, 3/8…). BUV305 lu au lieu de BUV395 sur la vidéo du socle.
const KNOWN = {
  BUV: [395, 496, 563, 615, 661, 737, 805], BV: [421, 480, 510, 570, 605, 650, 711, 750, 786], BB: [515, 630, 660, 700, 755, 790],
  'Alexa Fluor ': [350, 405, 430, 488, 500, 514, 532, 546, 555, 568, 594, 610, 633, 647, 660, 680, 700, 750, 790],
  'eFluor ': [450, 506, 660, 710, 780], 'Super Bright ': [436, 600, 645, 702, 780]
};
const LOOK = ['0689', '3859', '1774', '5869'];   // groupes de chiffres que la lecture confond
function fixNumber(name){
  for (const [p, list] of Object.entries(KNOWN)){
    if (!name.startsWith(p)) continue;
    const num = name.slice(p.length); if (!/^\d{3}$/.test(num) || list.includes(+num)) return name;
    const cost = (a, b) => [...a].reduce((s, ch, i) => s + (ch === b[i] ? 0 : LOOK.some(g => g.includes(ch) && g.includes(b[i])) ? 1 : 3), 0);
    const best = list.map(n => [n, cost(num, String(n))]).sort((x, y) => x[1] - y[1]);
    return best[0][1] <= 2 && (best.length < 2 || best[1][1] > best[0][1]) ? p + best[0][0] : name;
  }
  return name;
}
function firstMatch(text, list){ for (const [re, f] of list){ const m = text.match(re); if (m) return typeof f === 'function' ? f(m) : f; } return ''; }
const clean = s => s.replace(/[|_{}\[\]]/g, '').replace(/\s+/g, ' ').trim();

function parseText(raw){
  // ™ ® © ° glissés dans les noms (« APC-Cy™7 » lu au lieu de APC-Cy7)
  const text = raw.replace(/\r/g, '').replace(/[™®©°]/g, ''), one = text.replace(/\n/g, ' '), f = {};
  let m;
  if ((m = one.match(/\b(?:Cat(?:alog)?\.?\s*(?:No\.?|Number|#)?|REF|Ref\.?)\s*[:#.]?\s*([A-Z0-9][A-Z0-9.\-]{3,})/i))) f.cat = m[1].replace(/[.\-]$/, '');
  if ((m = one.match(/\bL[O0]T\s*[:#.]?\s*([A-Z0-9][A-Z0-9\-]{3,})/i))) f.lot = m[1];
  if ((m = one.match(/\bClone\s*[:#.]?\s*([A-Za-z0-9][A-Za-z0-9.\-\/]{1,})/i))) f.clone = m[1];
  if ((m = one.match(/\b(?:Exp(?:iry)?|EXP|Use\s*by)\.?\s*[:#.]?\s*(\d{4}[-\/.]\d{2}(?:[-\/.]\d{2})?|\d{2}[-\/.]\d{4}|\d{2}\s\d{4})/i))) f.exp = m[1].replace(/[\/.]/g, '-');
  f.maker = firstMatch(one, MAKERS);
  f.fluor = fixNumber(firstMatch(one, FLUOR));
  // Marqueur : ce qui suit « Anti-Mouse / Human / Rat… », sur la même ligne ou, si elle s'arrête là (« Alexa Fluor 647
  // anti-mouse » puis « Ly-6G/Ly-6C (Gr-1) »), sur la suivante. Une colonne de droite (lot, date) est séparée par
  // de grands blancs : on coupe là. Un nom de marqueur a une majuscule et un chiffre, ou deux majuscules (« oJ », bruit,
  // n'en est pas un).
  const lines = text.split('\n').map(l => l.split(/\s{3,}/)[0]);
  const marker = str => {
    const mk = clean(str).replace(/\s*(antibody|mAb)\b.*$/i, '').match(/^[A-Za-z0-9][A-Za-z0-9 .,+\-\/()αβγδκλ]*/);
    const v = mk ? mk[0].replace(/[\s.,\-\/(]+$/, '') : '';
    return (/[A-Z].*\d|\d.*[A-Z]|[A-Z].*[A-Z]/.test(v) && v.length >= 2) ? v : '';
  };
  for (let i = 0; i < lines.length && !f.marker; i++){
    m = lines[i].match(/\banti[\s\-]*(?:(?:mouse|human|rat|hamster|rabbit|goat|h|m|hu|ms)[\s\/&,-]*)+\s*(.*)$/i);
    if (!m) continue;
    let v = marker(m[1]);
    if (!v && lines[i + 1]) v = marker(lines[i + 1]);
    else if (v && /\b(and|&)$|[\/,]$/.test(clean(m[1])) && lines[i + 1]) v = clean(m[1]).replace(/[\s,]+$/, '') + ' ' + marker(lines[i + 1]);   // « Ly-6G and » + « Ly-6C »
    f.marker = v.trim();
  }
  // « Isotype: Armenian Hamster IgG » décrit l'isotype de l'anticorps, ce n'est pas un contrôle isotypique
  if (!f.marker && /isotype\s*(control|ctrl)/i.test(one)) f.marker = 'Isotype control';
  if (!f.marker && (m = one.match(/\bCD\s?\d{1,3}[a-z]?\b/i))) f.marker = m[0].replace(/\s/, '').toUpperCase();
  return f;
}

// Lit l'étiquette. onStep(texte) : avancement, pour l'interface. Renvoie { fields, code, text, errors }.
// extra : codes déjà lus sur les images brutes pendant le scan (prioritaires)
async function readLabel(canvas, extra = [], onStep = () => {}){
  const errors = [], fields = { marker: '', fluor: '', maker: '', cat: '', lot: '', clone: '', exp: '' };
  let code = [...extra], texts = [];
  try { onStep('code'); for (const c of await readCode(canvas)) if (!code.some(o => o.text === c.text)) code.push(c); } catch (e){ errors.push(e.message); }
  try { onStep('text'); texts = await ocr(canvas); } catch (e){ errors.push(e.message); }
  const t = texts.length ? vote(texts.map(parseText)) : {}, text = texts[1] || texts[0] || '';
  for (const k in fields) if (t[k]) fields[k] = t[k];
  for (const c of code){
    const g = parseCode(c.text);
    if (g.lot) fields.lot = g.lot;
    if (g.exp) fields.exp = g.exp;
    // une réf. de code qui ressemble à un n° de catalogue (BioLegend) l'emporte ; (240) de BD (« 0303 ») ne sert qu'à défaut
    if (g.ref && (!fields.cat || /^\d{5,8}$/.test(g.ref))) fields.cat = g.ref;
    if (g.gtin) fields.gtin = g.gtin;
  }
  // Certains fabricants (BD) mettent le n° de catalogue dans le GTIN du code : 00382906127990 → 612799. Si le catalogue
  // lu dans le texte n'en diffère que d'un ou deux chiffres (6 lu 8), et d'un seul endroit du code, on prend celui du code.
  if (fields.gtin && /^\d{4,}$/.test(fields.cat) && !fields.gtin.includes(fields.cat)){
    const L = fields.cat.length, near = [];
    for (let i = 0; i + L <= fields.gtin.length; i++){
      const sub = fields.gtin.slice(i, i + L); let d = 0; for (let k = 0; k < L; k++) if (sub[k] !== fields.cat[k]) d++;
      if (d >= 1 && d <= 2) near.push(sub);
    }
    if (near.length === 1) fields.cat = near[0];
  }
  return { fields, code, text, errors };
}

window.LabelReader = { readLabel, parseText, parseGS1, parseCode, scanCode, prepare };
})();
