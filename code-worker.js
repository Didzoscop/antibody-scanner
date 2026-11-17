/* Lecture des codes 2D (zxing-wasm) dans un fil à part : pendant le scan, le suivi de la rotation ne doit jamais
   attendre. Lire le code sur le fil principal (v0.16) ralentissait le traitement des images sur téléphone, et le suivi
   décrochait (panorama haché, morceaux répétés). Reçoit { bitmap } (ImageBitmap transféré), répond { text, format } ou
   { text: null }. */
let ready = null;
function load(){
  return ready || (ready = new Promise((ok, ko) => {
    try { importScripts('https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.7/dist/iife/reader/index.js'); ok(); } catch (e){ ready = null; ko(e); }
  }));
}
let canvas = null;
self.onmessage = async e => {
  const { bitmap } = e.data;
  try {
    await load();
    if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const x = canvas.getContext('2d', { willReadFrequently: true });
    x.drawImage(bitmap, 0, 0); bitmap.close();
    const im = x.getImageData(0, 0, canvas.width, canvas.height);
    const r = await self.ZXingWASM.readBarcodes(im, { tryHarder: true, maxNumberOfSymbols: 1, textMode: 'HRI', formats: ['DataMatrix', 'QRCode', 'Aztec', 'PDF417'] });
    const b = r.find(o => o.text && o.isValid !== false);
    self.postMessage(b ? { text: b.text, format: b.format } : { text: null });
  } catch (err){ try { bitmap.close(); } catch (_){} self.postMessage({ text: null, error: String(err) }); }
};
