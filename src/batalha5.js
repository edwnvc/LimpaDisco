// Quinta batalha: ritmo. Pista em perspectiva com as notas descendo, anéis coloridos na linha de batida,
// chamas a cada acerto, multiplicador, pontuação, estrelas e medidor de rock. Toca músicas do Clone Hero
// (notes.chart ou notes.mid + áudios .ogg/.opus/.mp3 + song.ini) embutidas em assets/ritmo/<pasta>/.
// Cada acerto tira vida do arquivo; errar demais esvazia o medidor e você perde.
(() => {
'use strict';
const W = 640, H = 360, FONT = 'Manrope, sans-serif';
const DRUM = [['#e8323c', 'd'], ['#f2c21a', 'f'], ['#2f7fe0', 'j'], ['#3cc04a', 'k']];                 // bateria: vermelho, amarelo, azul, verde (+ bumbo no espaço)
const GUIT = [['#3cc04a', 'd'], ['#e8323c', 'f'], ['#f2c21a', 'j'], ['#2f7fe0', 'k'], ['#f08a1a', 'l']];   // guitarra: verde, vermelho, amarelo, azul, laranja
const LOOK = 1.25, WIN = .1;   // segundos de antecedência em que a nota aparece; janela de acerto (±)
let cv, ctx, root, S = null, raf = 0, actx = null, onEnd = null;
let NOTAS = null, PISTA = null;   // imagens da pista e das notas (embutidas); sem elas, vale o desenho próprio
const img = n => fetch(n).then(r => r.ok ? r.blob() : null).then(b => b && createImageBitmap(b)).catch(() => null);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), rnd = (a, b) => a + Math.random() * (b - a);
const fmt = b => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++ } return (i ? b.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : b) + ' ' + u[i] };
function ac() { return actx || (actx = new AudioContext()) }
function tone(f, d = .06, type = 'square', v = .05, f2 = 0) {
  const a = ac(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(1e-4, t + d); o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + .02);
}

/* ---------------- leitura das músicas ---------------- */
// Tempo: lista de [tick, microssegundos por semínima]; converte tick em segundos.
function timer(tempos, res) {
  tempos.sort((a, b) => a[0] - b[0]); if (!tempos.length || tempos[0][0] > 0) tempos.unshift([0, 500000]);
  const acc = [0]; for (let i = 1; i < tempos.length; i++) acc[i] = acc[i - 1] + (tempos[i][0] - tempos[i - 1][0]) * tempos[i - 1][1] / res / 1e6;
  return tick => { let i = tempos.length - 1; while (i > 0 && tempos[i][0] > tick) i--; return acc[i] + (tick - tempos[i][0]) * tempos[i][1] / res / 1e6 };
}
const beatsOf = (T, res, last) => { const b = []; for (let k = 0, t = 0; t < last + 4; k += res) b.push(t = T(k)); return b };
// Guitarra: junta as notas do mesmo tick em acordes e aplica as regras do Guitar Hero III:
// hammer-on/pull-off (HOPO) quando a nota vem a até 170/480 de tempo da anterior, é nota única e muda de casa;
// marcas do mapa podem inverter (.chart) ou forçar (.mid) isso; tapping vale como HOPO. Notas longas viram sustain.
// items: {tick, lane: 0-4 | 'flip' | 'on' | 'off' | 'tap', len}; phrases: [[tick, len]] de Star Power.
function guitar(items, phrases, res, T, expert) {
  const by = new Map();
  for (const it of items) {
    let c = by.get(it.tick); if (!c) by.set(it.tick, c = { tick: it.tick, lanes: [], len: 0, mark: {} });
    if (typeof it.lane === 'string') c.mark[it.lane] = true; else if (!c.lanes.includes(it.lane)) { c.lanes.push(it.lane); c.len = Math.max(c.len, it.len) }
  }
  let ch = [...by.values()].filter(c => c.lanes.length).sort((a, b) => a.tick - b.tick);
  for (const c of ch) { c.lanes.sort((a, b) => a - b); c.t = T(c.tick); c.end = c.len > res / 3 ? T(c.tick + c.len) : 0 }
  if (expert) { let last = -1; ch = ch.filter(c => c.t - last >= .16 ? (last = c.t, true) : false) }   // só tem Expert: espaça as notas para dar no teclado
  const thr = res * 170 / 480 + 1;
  ch.forEach((c, i) => {
    const p = ch[i - 1];
    let h = !!p && c.lanes.length === 1 && c.tick - p.tick <= thr && !(p.lanes.length === 1 && p.lanes[0] === c.lanes[0]);
    if (c.mark.flip) h = !h; if (c.mark.on) h = true; if (c.mark.off) h = false;
    c.hopo = h || !!c.mark.tap; c.sp = phrases.findIndex(([s, l]) => c.tick >= s && c.tick < s + l);
  });
  return ch;
}
function parseChart(txt) {   // formato .chart (texto)
  const sec = {}; let cur = null;
  for (const raw of txt.split(/\r?\n/)) {
    const l = raw.trim(); const m = l.match(/^\[(.+)\]$/);
    if (m) { cur = sec[m[1]] = []; continue }
    if (cur && l.includes('=')) { const [k, v] = l.split('=').map(s => s.trim()); cur.push([k, v]) }
  }
  const song = Object.fromEntries((sec.Song || []).map(([k, v]) => [k, v.replace(/^"|"$/g, '')]));
  const res = +song.Resolution || 192, tempos = [];
  for (const [k, v] of sec.SyncTrack || []) { const p = v.split(/\s+/); if (p[0] === 'B') tempos.push([+k, 6e10 / +p[1]]) }
  const T = timer(tempos, res), meta = { offset: +(song.Offset || 0), name: song.Name, artist: song.Artist, charter: song.Charter };
  const pickTrack = names => { for (const n of names) if (sec[n] && sec[n].some(([, v]) => v.startsWith('N'))) return [n, sec[n]] };
  const drum = pickTrack(['HardDrums', 'ExpertDrums', 'MediumDrums', 'EasyDrums']);
  if (drum) {
    const [name, tr] = drum, cym = new Set(), notes = [];
    for (const [k, v] of tr) { const p = v.split(/\s+/); if (p[0] === 'N' && +p[1] >= 66 && +p[1] <= 68) cym.add(k + ':' + (+p[1] - 64)) }   // marcas de prato (pro drums)
    for (const [k, v] of tr) { const p = v.split(/\s+/); if (p[0] !== 'N') continue; const n = +p[1], t = T(+k); if (n === 0) notes.push({ t, lane: -1 }); else if (n >= 1 && n <= 4) notes.push({ t, lane: n - 1, cym: cym.has(k + ':' + n) }) }
    return { ...meta, notes, drums: true, expert: name === 'ExpertDrums', beats: beatsOf(T, res, Math.max(0, ...notes.map(n => n.t))) };
  }
  const gtr = pickTrack(['HardSingle', 'ExpertSingle', 'MediumSingle', 'EasySingle']); if (!gtr) return null;
  const items = [], phrases = [];
  for (const [k, v] of gtr[1]) {
    const p = v.split(/\s+/), n = +p[1];
    if (p[0] === 'S' && n === 2) phrases.push([+k, +p[2]]);
    if (p[0] !== 'N') continue;
    items.push({ tick: +k, lane: n <= 4 ? n : n === 5 ? 'flip' : n === 6 ? 'tap' : 'x', len: +p[2] || 0 });
  }
  const notes = guitar(items.filter(i => i.lane !== 'x'), phrases, res, T, gtr[0] === 'ExpertSingle');
  return { ...meta, notes, drums: false, beats: beatsOf(T, res, Math.max(0, ...notes.map(n => n.end || n.t))) };
}
function parseMidi(buf) {   // formato .mid (Rock Band / Clone Hero)
  const d = new DataView(buf); let p = 0;
  const u32 = () => (p += 4, d.getUint32(p - 4)), u16 = () => (p += 2, d.getUint16(p - 2)), u8 = () => d.getUint8(p++);
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 127) } while (b & 128); return v };
  if (u32() !== 0x4d546864) return null; u32(); u16(); const ntr = u16(), res = u16();
  const tracks = [], tempos = [];
  for (let i = 0; i < ntr; i++) {
    if (u32() !== 0x4d54726b) return null; const len = u32(), end = p + len; let tick = 0, run = 0, name = ''; const ev = [], open = {};
    while (p < end) {
      tick += vlq(); let st = u8();
      if (st === 0xff) { const ty = u8(), l = vlq(), s = p; if (ty === 3) name = new TextDecoder().decode(new Uint8Array(buf, s, l)); if (ty === 0x51) tempos.push([tick, (d.getUint8(s) << 16) | (d.getUint8(s + 1) << 8) | d.getUint8(s + 2)]); p = s + l; continue }
      if (st === 0xf0 || st === 0xf7) { p += vlq(); continue }
      if (st < 0x80) { st = run; p-- } else run = st;
      const hi = st & 0xf0, a = u8(), b = hi === 0xc0 || hi === 0xd0 ? 0 : u8();
      if (hi === 0x90 && b > 0) open[a] = tick;                                                                                 // nota começa
      else if ((hi === 0x80 || hi === 0x90) && open[a] !== undefined) { ev.push([open[a], a, tick - open[a]]); delete open[a] }   // nota termina: guarda a duração
    }
    p = end; ev.sort((x, y) => x[0] - y[0]); tracks.push({ name, ev });
  }
  const T = timer(tempos, res), find = n => tracks.find(t => t.name === n);
  const dr = find('PART DRUMS');
  if (dr) {
    const base = [84, 96, 72, 60].find(b => dr.ev.some(([, n]) => n >= b && n <= b + 4)); if (base === undefined) return null;   // difícil, expert, médio, fácil
    const toms = dr.ev.filter(([, n]) => n >= 110 && n <= 112).map(([k, n]) => k + ':' + (n - 108));   // marcas de tambor (sem elas, amarelo/azul/verde são pratos)
    const notes = [];
    for (const [k, n] of dr.ev) { if (n < base || n > base + 4) continue; const t = T(k), i = n - base; notes.push(i === 0 ? { t, lane: -1 } : { t, lane: i - 1, cym: i >= 2 && !toms.includes(k + ':' + i) }) }
    return { notes, drums: true, offset: 0, expert: base === 96, beats: beatsOf(T, res, Math.max(0, ...notes.map(n => n.t))) };
  }
  const gt = find('PART GUITAR'); if (!gt) return null;
  const base = [84, 96, 72, 60].find(b => gt.ev.some(([, n]) => n >= b && n <= b + 4)); if (base === undefined) return null;
  const items = [], phrases = gt.ev.filter(([, n]) => n === 116).map(([k, , l]) => [k, l]);   // 116: trecho de Star Power
  for (const [k, n, l] of gt.ev) { const i = n - base; if (i >= 0 && i <= 4) items.push({ tick: k, lane: i, len: l }); else if (i === 5) items.push({ tick: k, lane: 'on' }); else if (i === 6) items.push({ tick: k, lane: 'off' }) }
  const notes = guitar(items, phrases, res, T, base === 96);
  return { notes, drums: false, offset: 0, beats: beatsOf(T, res, Math.max(0, ...notes.map(n => n.end || n.t))) };
}
async function loadSong() {
  const r = await fetch('ritmo-lista'); if (!r.ok) return null;
  const all = (await r.text()).split('\n').filter(Boolean), dirs = {};
  for (const f of all) { const i = f.lastIndexOf('/'); (dirs[f.slice(0, i)] ||= []).push(f) }
  const names = Object.keys(dirs); if (!names.length) return null;
  const dir = names[Math.floor(Math.random() * names.length)], files = dirs[dir], get = f => fetch(f).then(r => r.ok ? r : Promise.reject());
  const chartF = files.find(f => /\/notes\.chart$/i.test(f)), midF = files.find(f => /\/notes\.mid$/i.test(f));
  const chart = chartF ? parseChart(await (await get(chartF)).text()) : midF ? parseMidi(await (await get(midF)).arrayBuffer()) : null;
  if (!chart || !chart.notes.length) return null;
  chart.notes.sort((a, b) => a.t - b.t);
  if (chart.drums && chart.expert) { let last = -1; chart.notes = chart.notes.filter(n => { if (n.t - last < .002) return true; if (n.t - last < .16) return false; last = n.t; return true }) }
  const ini = files.find(f => /\/song\.ini$/i.test(f)), info = {};
  if (ini) for (const l of (await (await get(ini)).text()).split(/\r?\n/)) { const m = l.match(/^\s*([\w_]+)\s*=\s*(.*)$/); if (m) info[m[1].toLowerCase()] = m[2].trim() }
  const stems = files.filter(f => /\.(ogg|opus|mp3|wav)$/i.test(f) && !/\/(preview|crowd)[^/]*$/i.test(f));
  const bufs = (await Promise.all(stems.map(f => get(f).then(r => r.arrayBuffer()).then(b => ac().decodeAudioData(b)).catch(() => null)))).filter(Boolean);
  return { ...chart, bufs, name: info.name || chart.name || dir.split('/').pop(), artist: info.artist || chart.artist || '', charter: info.charter || info.frets || chart.charter || '',
    delay: (chart.offset || 0) + (+(info.delay || 0)) / 1000 };
}

/* ---------------- perspectiva da pista ---------------- */
const CX = 320, YH = 316, YV = -87, BW = 380, ZTOP = 1.78;   // centro, linha de batida, ponto de fuga, largura na linha, fundo da pista
const sOf = z => 1 / (1 + z), yOf = z => YV + (YH - YV) * sOf(z), xOf = (u, z) => CX + u * BW * sOf(z);   // u: -0.5 (borda esq.) a 0.5
const zOfY = y => (YH - YV) / (y - YV) - 1;
function quad(u0, u1, z0, z1) { ctx.beginPath(); ctx.moveTo(xOf(u0, z0), yOf(z0)); ctx.lineTo(xOf(u1, z0), yOf(z0)); ctx.lineTo(xOf(u1, z1), yOf(z1)); ctx.lineTo(xOf(u0, z1), yOf(z1)); ctx.closePath() }
const laneU = i => -0.5 + (i + .5) / S.lanes.length * .9 + .05;
const SPEED = ZTOP / LOOK;   // unidades de pista por segundo

/* ---------------- texturas desenhadas uma vez ---------------- */
function mk(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d'), w, h); return c }
// Pista: couro marrom escuro com fileiras de rebites e placas de metal gastas (arte própria). Repete na vertical.
const BOARD = mk(256, 256, (g, w, h) => {
  g.fillStyle = '#3a2418'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${Math.random() < .5 ? '0,0,0' : '255,220,180'},${Math.random() * .06})`; g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 6, 1 + Math.random() * 3) }
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) {   // placas com cantos parafusados
    const x = c * 52 + (r % 2) * 26 - 10, y = r * 64 + 8;
    g.fillStyle = 'rgba(20,10,6,.55)'; g.beginPath(); g.roundRect(x + 2, y + 3, 44, 50, 6); g.fill();
    const m = g.createLinearGradient(x, y, x + 44, y + 50); m.addColorStop(0, '#6b4a34'); m.addColorStop(1, '#2c1a10'); g.fillStyle = m; g.beginPath(); g.roundRect(x, y, 44, 50, 6); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = 'rgba(255,200,150,.12)'; g.beginPath(); g.moveTo(x + 8, y + 25); g.lineTo(x + 22, y + 10); g.lineTo(x + 36, y + 25); g.lineTo(x + 22, y + 40); g.closePath(); g.stroke();
    for (const [px, py] of [[6, 6], [38, 6], [6, 44], [38, 44]]) { const b = g.createRadialGradient(x + px - 1, y + py - 1, 0, x + px, y + py, 3.5); b.addColorStop(0, '#e8d0b0'); b.addColorStop(1, '#4a3020'); g.fillStyle = b; g.beginPath(); g.arc(x + px, y + py, 3, 0, 7); g.fill() }
  }
});
// Palco: parede de tijolos avermelhada, piso de tábuas, caixas de som e torres de luz.
const STAGE = mk(W, H, (g) => {
  const wall = g.createLinearGradient(0, 0, 0, 200); wall.addColorStop(0, '#3a1a14'); wall.addColorStop(1, '#5a2a1c'); g.fillStyle = wall; g.fillRect(0, 0, W, 200);
  for (let y = 0; y < 200; y += 12) for (let x = (y / 12 % 2) * 14; x < W; x += 28) { g.fillStyle = `rgba(${120 + Math.random() * 40},${50 + Math.random() * 20},40,.35)`; g.fillRect(x + 1, y + 1, 26, 10) }
  const fl = g.createLinearGradient(0, 180, 0, H); fl.addColorStop(0, '#4a2c1c'); fl.addColorStop(1, '#2a160c'); g.fillStyle = fl; g.fillRect(0, 180, W, H - 180);
  g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1;
  for (let i = -30; i <= 30; i++) { g.beginPath(); g.moveTo(CX + i * 14, 180); g.lineTo(CX + i * 60, H); g.stroke() }   // tábuas em perspectiva
  for (const y of [195, 215, 245, 290, 345]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
  const amp = (x, y, w, h) => {   // caixa de som
    g.fillStyle = '#121014'; g.fillRect(x, y, w, h); g.strokeStyle = '#2c2830'; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    const r = Math.min(w, h / 2) * .32; for (const [cx, cy] of [[x + w * .3, y + h * .28], [x + w * .7, y + h * .28], [x + w * .3, y + h * .72], [x + w * .7, y + h * .72]]) {
      g.fillStyle = '#26222a'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.fill(); g.fillStyle = '#0a090c'; g.beginPath(); g.arc(cx, cy, r * .55, 0, 7); g.fill() }
  };
  amp(20, 110, 60, 80); amp(88, 128, 46, 62); amp(560, 104, 64, 86); amp(506, 130, 46, 60);
  g.strokeStyle = '#8a8d94'; g.lineWidth = 1;   // treliças das luzes
  for (const x of [150, 480]) { for (let y = 10; y < 190; y += 12) { g.beginPath(); g.moveTo(x, y); g.lineTo(x + 12, y + 12); g.moveTo(x + 12, y); g.lineTo(x, y + 12); g.stroke() } g.strokeRect(x, 10, 12, 180) }
  const v = g.createRadialGradient(CX, 120, 60, CX, 180, 420); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.6)'); g.fillStyle = v; g.fillRect(0, 0, W, H);
});

/* ---------------- desenho ---------------- */
function draw() {
  const now = songTime(), N = S.lanes.length;
  ctx.drawImage(STAGE, 0, 0);
  for (const x of [190, 450]) { const l = ctx.createRadialGradient(x, 0, 0, x, 0, 260); l.addColorStop(0, `rgba(255,220,160,${.14 + .05 * Math.sin(S.t * 3 + x)})`); l.addColorStop(1, 'rgba(255,220,160,0)'); ctx.fillStyle = l; ctx.fillRect(0, 0, W, H) }   // holofotes
  // a pista sobe do pé da tela na entrada e dá um tranco quando o multiplicador cai
  const rise = H * Math.pow(1 - clamp(S.t / 1.1, 0, 1), 3), k = S.jolt ? S.jolt.t / .05 : 9;
  const jolt = S.jolt && k < 5 ? S.jolt.p * [1, -.7, .4, -.3, .2, 0].reduce((v, w, i, a) => i === Math.floor(k) ? w + (a[i + 1] - w) * (k - i) : v, 0) : 0;
  ctx.save(); ctx.translate(S.jolt && k < 5 ? S.jolt.x : 0, rise + jolt);
  // pista: a textura é desenhada linha a linha na perspectiva e rola junto com as notas
  const top = Math.ceil(yOf(ZTOP)), scroll = now * SPEED * 140;
  for (let y = top; y < H; y++) {
    const z = zOfY(y + .5), x0 = xOf(-.5, z), w = BW * sOf(z), v = ((z * 140 + scroll) % 256 + 256) % 256;
    if (PISTA) ctx.drawImage(PISTA, 0, (((z + now * SPEED) * 640) % 1024 + 1024) % 1024, 512, 1, x0, y, w, 1.2);   // uma imagem a cada 1,6 de pista
    else ctx.drawImage(BOARD, 0, v, 256, 1, x0, y, w, 1.2);
  }
  quad(-.5, .5, -.12, ZTOP); ctx.fillStyle = PISTA ? 'rgba(0,0,0,.1)' : 'rgba(0,0,0,.28)'; ctx.fill();   // escurece a textura: as notas se destacam
  const fog = ctx.createLinearGradient(0, top, 0, top + 90); fog.addColorStop(0, 'rgba(0,0,0,.75)'); fog.addColorStop(1, 'rgba(0,0,0,0)');
  quad(-.5, .5, -.12, ZTOP); ctx.fillStyle = fog; ctx.fill();
  if (S.spOn || S.spFlash > 0) { quad(-.5, .5, -.12, ZTOP); ctx.fillStyle = `rgba(70,180,255,${S.spOn ? .1 + .04 * Math.sin(S.t * 8) : 0})`; ctx.fill(); if (S.spFlash > 0) { ctx.fillStyle = `rgba(200,240,255,${S.spFlash * .3})`; ctx.fill() } }   // Star Power: pista azul
  // trilhos de metal azulado nas bordas
  for (const [u0, u1] of [[-.54, -.5], [.5, .54]]) {
    quad(u0, u1, -.12, ZTOP); const m = ctx.createLinearGradient(xOf(u0, 0), 0, xOf(u1, 0), 0);
    m.addColorStop(0, '#3a5560'); m.addColorStop(.45, '#cdeff6'); m.addColorStop(.6, '#7fb3c2'); m.addColorStop(1, '#2a3c44'); ctx.fillStyle = m; ctx.fill();
  }
  // trastes prateados a cada tempo
  for (const b of S.beats) {
    const z = (b - now) * SPEED; if (z < -.1 || z > ZTOP) continue; const y = yOf(z), t = Math.max(1, 3.2 * sOf(z));
    const m = ctx.createLinearGradient(0, y - t, 0, y + t); m.addColorStop(0, '#7a7d84'); m.addColorStop(.5, '#f4f6f8'); m.addColorStop(1, '#5a5d64');
    ctx.fillStyle = m; ctx.fillRect(xOf(-.52, z), y - t / 2, BW * 1.04 * sOf(z), t);
  }
  // cordas: fios escuros trançados de cada pista até o alvo
  for (let i = 0; i < N; i++) {
    const u = laneU(i);
    for (let z = ZTOP; z > .06; z -= .06) { const z2 = Math.max(.06, z - .06), w = Math.max(1, 3 * sOf(z)); ctx.strokeStyle = ((z * 40 + now * SPEED * 40) | 0) % 2 ? '#1a1a1c' : '#4a4a50'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(xOf(u, z), yOf(z)); ctx.lineTo(xOf(u, z2), yOf(z2)); ctx.stroke() }
    const x = xOf(u, .07), y = yOf(.07); ctx.fillStyle = '#16161a'; ctx.beginPath(); ctx.moveTo(x, y - 8); ctx.lineTo(x - 7, y + 4); ctx.lineTo(x + 7, y + 4); ctx.fill();   // ponteira da corda
  }
  // linha de batida e alvos
  ctx.fillStyle = 'rgba(230,236,240,.8)'; ctx.fillRect(xOf(-.5, -.02), yOf(-.02), BW * sOf(-.02), 2);
  for (let i = 0; i < N; i++) target(xOf(laneU(i), 0), yOf(0), BW / N * .33, S.lanes[i][0], S.press[i] > 0 || S.held[i], S.spring[i].p);   // casa segurada fica acesa e o botão sobe
  // caudas das notas longas: acesas enquanto seguradas, cinzas se soltou antes
  if (!S.drums) for (const n of S.notes) {
    if (n.t - now > LOOK) break; if (!n.end || n.miss || (n.done && S.sus !== n && !n.dropped)) continue;
    const z0 = Math.max(0, (n.t - now) * SPEED), z1 = Math.min(ZTOP, (n.end - now) * SPEED); if (z1 > z0) for (const l of n.lanes) tail(laneU(l), z0, z1, S.spOn ? '#5ad8ff' : S.lanes[l][0], S.sus === n, n.dropped);
  }
  // notas (de trás para a frente)
  for (let k = S.notes.length - 1; k >= 0; k--) {
    const n = S.notes[k]; if (n.done) continue; const z = (n.t - now) * SPEED; if (z > ZTOP || z < -.12) continue;
    if (n.lanes) { const star = n.sp >= 0 && !S.spBroken.has(n.sp); for (const l of n.lanes) puck(xOf(laneU(l), z), yOf(z), BW / N * .36 * sOf(z), S.spOn ? '#5ad8ff' : S.lanes[l][0], false, n.hopo, star, l); continue }   // guitarra: acorde
    if (n.lane < 0) { quad(-.48, .48, z - .02, z + .02); ctx.fillStyle = '#f08a1a'; ctx.fill(); quad(-.48, .48, z - .005, z + .005); ctx.fillStyle = '#ffe0b0'; ctx.fill() }   // bumbo
    else puck(xOf(laneU(n.lane), z), yOf(z), BW / N * .36 * sOf(z), S.lanes[n.lane][0], n.cym, false, false, [1, 2, 3, 0][n.lane]);   // bateria: vermelho, amarelo, azul, verde
  }
  // chamas dos acertos
  for (const f of S.fx) flame(xOf(laneU(f.lane), 0), yOf(0), BW / N * .42, f.t / .32);
  ctx.font = `800 10px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.textAlign = 'center'; S.lanes.forEach(([, k], i) => ctx.fillText(k.toUpperCase(), xOf(laneU(i), 0), yOf(0) + 4)); ctx.textAlign = 'left';   // letras das teclas sobem e tremem junto com a pista
  ctx.restore();
  hud(now);
}
function target(x, y, r, c, lit, lift = 0) {   // alvo: aro colorido, bisel prateado e centro escuro; lift: quanto o botão saiu do aro (mola)
  ctx.save(); ctx.translate(x, y); ctx.scale(1, .36);
  ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.arc(0, r * .35, r * 1.2, 0, 7); ctx.fill();
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r * 1.15, 0, 7); ctx.fill();
  const m = ctx.createLinearGradient(0, -r, 0, r); m.addColorStop(0, '#ffffff'); m.addColorStop(.5, '#b8bcc4'); m.addColorStop(1, '#6a6e76'); ctx.fillStyle = m; ctx.beginPath(); ctx.arc(0, 0, r * .98, 0, 7); ctx.fill();
  ctx.fillStyle = lit ? c : '#2a2c30'; ctx.beginPath(); ctx.arc(0, 0, r * .74, 0, 7); ctx.fill();
  ctx.fillStyle = lit ? 'rgba(255,255,255,.6)' : '#141518'; ctx.beginPath(); ctx.arc(0, -r * .1, r * .48, 0, 7); ctx.fill();
  if (lift > .02) {   // botão saindo do aro: lateral colorida e tampa com brilho
    const L = lift * r * 1.6, br = r * .7, side = ctx.createLinearGradient(-br, 0, br, 0);
    side.addColorStop(0, shade(c, -.45)); side.addColorStop(.5, c); side.addColorStop(1, shade(c, -.45));
    ctx.fillStyle = side; ctx.fillRect(-br, -L, br * 2, L); ctx.beginPath(); ctx.arc(0, 0, br, 0, Math.PI); ctx.fill();
    ctx.fillStyle = shade(c, .25); ctx.beginPath(); ctx.arc(0, -L, br, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.beginPath(); ctx.arc(0, -L - br * .08, br * .55, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function puck(x, y, r, c, cym, hopo, star, col) {   // nota: botão com borda branca e tampa branca; hammer-on: mais baixo, tampa maior brilhando; Star Power: estrela
  if (NOTAS && col !== undefined && !cym) {   // folha de notas: linhas normal, hammer-on, estrela, estrela hammer-on e Star Power ligado
    const row = S.spOn ? 4 : (star ? 2 : 0) + (hopo ? 1 : 0), cx = S.spOn ? (hopo ? 1 : 0) : col, w = r * 2.25, h = w * 100 / 160;   // mesma largura do aro do alvo
    ctx.drawImage(NOTAS, cx * 160, row * 100, 160, 100, x - w / 2, y - h * .6, w, h); return;
  }
  ctx.save(); ctx.translate(x, y); ctx.scale(1, .42);
  ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.ellipse(0, r * .7, r * 1.1, r * .9, 0, 0, 7); ctx.fill();
  const h = r * (hopo ? .3 : .55);   // altura do botão
  ctx.fillStyle = '#d8dce2'; ctx.beginPath(); ctx.arc(0, h, r * 1.08, 0, 7); ctx.fill();   // borda de baixo
  const side = ctx.createLinearGradient(-r, 0, r, 0); side.addColorStop(0, shade(c, -.35)); side.addColorStop(.5, c); side.addColorStop(1, shade(c, -.35));
  ctx.fillStyle = side; ctx.fillRect(-r, 0, r * 2, h); ctx.beginPath(); ctx.arc(0, h, r, 0, Math.PI); ctx.fill();
  ctx.fillStyle = cym ? '#ffe9a0' : c; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.fillStyle = '#f4f6f8'; ctx.beginPath(); ctx.arc(0, -r * .05, r * .62, 0, 7); ctx.fill();   // tampa branca
  const g = ctx.createRadialGradient(-r * .2, -r * .3, 0, 0, 0, r * .62); g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(200,205,215,.6)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -r * .05, r * .55, 0, 7); ctx.fill();
  if (hopo) { ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.beginPath(); ctx.arc(0, -r * .05, r * .8, 0, 7); ctx.fill(); ctx.strokeStyle = c; ctx.lineWidth = r * .12; ctx.stroke() }
  if (star) { ctx.fillStyle = '#ffffff'; ctx.strokeStyle = c; ctx.lineWidth = r * .14; ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .45 : r * 1.05; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr - r * .05) } ctx.closePath(); ctx.fill(); ctx.stroke() }
  ctx.restore();
}
function tail(u, z0, z1, c, on, dropped) {   // cauda da nota longa (ondula quando está sendo segurada)
  const w = BW / S.lanes.length * .09, L = [], R = [];
  for (let z = z0; z <= z1 + .001; z += .04) { const zz = Math.min(z, z1), s = sOf(zz), wob = on ? Math.sin(zz * 40 - S.t * 30) * w * .35 : 0; L.push([xOf(u, zz) - (w + wob) * s, yOf(zz)]); R.push([xOf(u, zz) + (w - wob) * s, yOf(zz)]) }
  ctx.beginPath(); L.forEach(([x, y]) => ctx.lineTo(x, y)); R.reverse().forEach(([x, y]) => ctx.lineTo(x, y)); ctx.closePath();
  ctx.fillStyle = dropped ? '#4a4c52' : c; if (on) { ctx.shadowColor = c; ctx.shadowBlur = 10 } ctx.fill(); ctx.shadowBlur = 0;
}
function shade(hex, k) { const n = parseInt(hex.slice(1), 16), f = v => clamp(Math.round(v * (1 + k)), 0, 255); return `rgb(${f(n >> 16)},${f(n >> 8 & 255)},${f(n & 255)})` }
function flame(x, y, r, k) {   // chama subindo do alvo
  for (let j = 0; j < 4; j++) {
    const a = 1 - k, w = r * (.9 - j * .18), hgt = r * (2.2 + j * .4) * (.6 + k), sx = x + Math.sin(S.t * 30 + j) * 2;
    const g = ctx.createLinearGradient(0, y, 0, y - hgt); g.addColorStop(0, `rgba(255,250,200,${a})`); g.addColorStop(.35, `rgba(255,170,40,${a * .9})`); g.addColorStop(1, 'rgba(200,40,0,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(sx - w, y); ctx.quadraticCurveTo(sx - w * .8, y - hgt * .6, sx + Math.sin(S.t * 20 + j) * w * .4, y - hgt); ctx.quadraticCurveTo(sx + w * .8, y - hgt * .6, sx + w, y); ctx.fill();
  }
}
function hud(now) {
  // painel de pontos e multiplicador (canto esquerdo), com luzes da sequência
  const px = 22, py = 196;
  ctx.fillStyle = '#0c0d10'; ctx.beginPath(); ctx.roundRect(px, py, 92, 104, 6); ctx.fill();
  ctx.strokeStyle = '#8a7a50'; ctx.lineWidth = 3; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);   // borda quadriculada
  ctx.fillStyle = '#0a1a0c'; ctx.fillRect(px + 8, py + 8, 76, 22);
  ctx.font = `800 18px ui-monospace, Consolas, monospace`; ctx.textAlign = 'right'; ctx.shadowColor = '#5cff7a'; ctx.shadowBlur = 8; ctx.fillStyle = '#9dff8a'; ctx.fillText(S.score, px + 80, py + 26); ctx.shadowBlur = 0;
  const mx = px + 46, my = py + 66, ring = ctx.createLinearGradient(0, my - 26, 0, my + 26); ring.addColorStop(0, '#f2f4f6'); ring.addColorStop(1, '#6a6e76');
  ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(mx, my, 26, 0, 7); ctx.fill(); ctx.fillStyle = '#0e2a14'; ctx.beginPath(); ctx.arc(mx, my, 21, 0, 7); ctx.fill();
  ctx.textAlign = 'center'; ctx.font = `800 30px ${FONT}`; ctx.shadowColor = '#5cff7a'; ctx.shadowBlur = 10; ctx.fillStyle = '#7dff6a'; ctx.fillText(S.mult, mx + 4, my + 11); ctx.shadowBlur = 0;
  ctx.font = `900 16px ${FONT}`; ctx.fillStyle = '#e8eaee'; ctx.fillText('x', mx - 15, my + 6);
  for (let i = 0; i < 5; i++) { const on = S.mult === 4 || (S.streak % 10) / 2 >= 5 - i; ctx.fillStyle = on ? '#6aff6a' : '#1a2a1c'; if (on) { ctx.shadowColor = '#6aff6a'; ctx.shadowBlur = 6 } ctx.beginPath(); ctx.roundRect(px - 12, py + 10 + i * 18, 8, 13, 3); ctx.fill(); ctx.shadowBlur = 0 }
  // medidor de rock (canto direito): arco vermelho/amarelo/verde com ponteiro
  const rx = 572, ry = 296;
  ctx.fillStyle = '#0c0d10'; ctx.beginPath(); ctx.roundRect(rx - 46, ry - 44, 92, 56, 6); ctx.fill(); ctx.strokeStyle = '#8a7a50'; ctx.lineWidth = 2; ctx.stroke();
  [['#e8323c', Math.PI, Math.PI * 1.33], ['#f2c21a', Math.PI * 1.33, Math.PI * 1.67], ['#3cc04a', Math.PI * 1.67, Math.PI * 2]].forEach(([c, a0, a1]) => { ctx.strokeStyle = c; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(rx, ry, 32, a0, a1); ctx.stroke() });
  const na = Math.PI * (1 + clamp(S.rock, 0, 1)); ctx.strokeStyle = '#f4f6f8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx + Math.cos(na) * 30, ry + Math.sin(na) * 30); ctx.stroke();
  ctx.fillStyle = '#c8ccd4'; ctx.beginPath(); ctx.arc(rx, ry, 4, 0, 7); ctx.fill();
  // o arquivo (inimigo) no palco, com a vida
  const ex = 566, ey = 118; Batalha.draw(ctx, ex, ey + (S.ehit > 0 ? rnd(-3, 3) : 0), { kind: S.type, boss: S.boss, t: S.t, scale: .7, flash: S.ehit > 0 && Math.floor(S.t * 30) % 2 });
  ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(ex - 44, ey + 46, 88, 8); ctx.fillStyle = '#e8323c'; ctx.fillRect(ex - 42, ey + 48, 84 * clamp(S.ehp / S.emax, 0, 1), 4);
  ctx.font = `700 10px ${FONT}`; ctx.fillStyle = '#f0e6dc'; ctx.fillText(S.fname, ex, ey + 68);
  // nome da música, contagem e teclas
  ctx.textAlign = 'left';
  if (now < 3.5 && S.title) { const a = clamp(Math.min(now + 2, 3.5 - now), 0, 1); ctx.globalAlpha = a; ctx.fillStyle = 'rgba(10,8,6,.85)'; ctx.beginPath(); ctx.roundRect(16, 16, 240, 44, 5); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = `800 15px ${FONT}`; ctx.fillText(S.title, 28, 36); ctx.font = `500 11px ${FONT}`; ctx.fillStyle = '#d8c8b8'; ctx.fillText(S.sub, 28, 52); ctx.globalAlpha = 1 }
  ctx.textAlign = 'center';
  if (now < 0) { ctx.font = `900 46px ${FONT}`; ctx.fillStyle = '#fff'; ctx.shadowColor = '#000'; ctx.shadowBlur = 10; ctx.fillText(Math.ceil(-now), CX, 170); ctx.shadowBlur = 0 }
  ctx.shadowColor = '#000'; ctx.shadowBlur = 4; ctx.fillText(S.drums ? 'ESPAÇO = bumbo' : 'SHIFT: Star Power', CX, H - 6); ctx.shadowBlur = 0;
  // barra de Star Power (4 partes) em cima do painel de pontos
  for (let i = 0; i < 4; i++) { const f = clamp(S.sp * 4 - i, 0, 1); ctx.fillStyle = '#0c0d10'; ctx.fillRect(22 + i * 23, 180, 21, 10); ctx.fillStyle = S.spOn ? '#9ae8ff' : '#3aa8ff'; ctx.fillRect(23 + i * 23, 181, 19 * f, 8) }
  if (S.sp >= .5 && !S.spOn && Math.floor(S.t * 3) % 2) { ctx.font = `900 10px ${FONT}`; ctx.fillStyle = '#9ae8ff'; ctx.fillText('SHIFT: STAR POWER!', 68, 175) }
  if (S.msg) { ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.font = `900 28px ${FONT}`; ctx.fillText(S.msg[0], W / 2, 150); ctx.font = `500 14px ${FONT}`; ctx.fillStyle = '#e0d8d0'; S.msg.slice(1).forEach((l, i) => ctx.fillText(l, W / 2, 182 + i * 22)) }
  ctx.textAlign = 'left';
}

/* ---------------- jogo ---------------- */
// Guitarra: aperte a casa na hora da nota (acorde: todas as casas dele apertadas); não tem palhetada.
// Notas longas: segure para ganhar pontos. Trechos de Star Power completos enchem a barra;
// com Shift ela é ativada: multiplicador dobra e o medidor de rock sobe mais rápido. Bateria: cada pista é uma tecla.
function songTime() { return S.startAt ? ac().currentTime - S.startAt - S.delay : -3 }
function scoreHit(lanes, n) {
  S.streak++; S.mult = Math.min(4, 1 + Math.floor(S.streak / 10));
  const m = S.mult * (S.spOn ? 2 : 1);
  S.score += 50 * lanes.length * m; S.rock = Math.min(1, S.rock + (S.spOn ? .05 : .025)); S.ehp -= m; S.ehit = .12;
  for (const lane of lanes) if (lane >= 0) { S.fx.push({ lane, t: 0 }); S.spring[lane].v += 7 }   // acerto: o botão dá um pulinho
  if (n && n.sp >= 0 && S.spLast[n.sp] === n && !S.spBroken.has(n.sp)) { S.sp = Math.min(1, S.sp + .25); S.spFlash = .6; [880, 1175, 1568].forEach((f, i) => setTimeout(() => tone(f, .1, 'triangle', .05), i * 60)) }   // completou um trecho de Star Power
  if (S.ehp <= 0 && !S.end) finish(true);
}
function breakStreak(rock = 0) {
  const p = S.spOn ? 7.5 : { 2: 1.5, 3: 2, 4: 5 }[S.mult];   // força do tranco: maior quanto mais alto o multiplicador perdido
  if (p) S.jolt = { p, t: 0, x: rnd(-1.5, 1.5) };
  S.streak = 0; S.mult = 1; S.rock -= rock;
}
function hitDrum(lane) {
  const now = songTime(); let best = null;
  for (const n of S.notes) { if (n.done || n.lane !== lane) continue; const dt = n.t - now; if (dt > WIN) break; if (Math.abs(dt) <= WIN && (!best || Math.abs(dt) < Math.abs(best.t - now))) best = n }
  if (!best) return breakStreak();   // batida no vazio quebra a sequência
  best.done = true; scoreHit([lane]);
}
function nextChord(now) { for (const c of S.notes) if (!c.done && c.t >= now - WIN) return c.t - now <= WIN ? c : null; return null }
function fretsOk(c) {   // acorde: exatamente essas casas; nota única: ela é a casa mais alta apertada (as de baixo podem ficar)
  const held = S.held.map((h, i) => h ? i : -1).filter(i => i >= 0);
  if (c.lanes.length > 1) return held.length === c.lanes.length && c.lanes.every(l => S.held[l]);
  return held.length > 0 && held[held.length - 1] === c.lanes[0];
}
function hitChord(c) {
  c.done = true; S.chain = true; S.lastHitAt = songTime();
  if (c.end) S.sus = c;   // nota longa: começa a contar enquanto as casas ficam apertadas
  scoreHit(c.lanes, c);
}
function press() {   // apertou uma casa: acerta se a próxima nota bate; no vazio, quebra a sequência; acorde pela metade espera o resto
  const now = songTime(), c = nextChord(now);
  if (c && fretsOk(c)) return hitChord(c);
  if (!c && now - S.lastHitAt > .06) breakStreak();
}
function missed(n) {
  n.done = true; n.miss = true; S.chain = false; breakStreak(.04); tone(110, .08, 'sawtooth', .04);
  if (n.sp >= 0) S.spBroken.add(n.sp);
  if (S.sus === n) S.sus = null;
}
function beatLen(now) { const b = S.beats; let i = S.bi || 0; while (i < b.length - 2 && b[i + 1] < now) i++; S.bi = i; return Math.max(.2, (b[i + 1] - b[i]) || .5) }
function frame() {
  if (!S) return;
  const now = performance.now(), dt = Math.min(.05, (now - (S.last || now)) / 1000); S.last = now; S.t += dt; S.ehit = Math.max(0, S.ehit - dt); S.spFlash = Math.max(0, S.spFlash - dt); if (S.jolt) S.jolt.t += dt;
  for (const k in S.press) S.press[k] = Math.max(0, S.press[k] - dt);
  S.spring.forEach((m, i) => { const goal = S.held[i] || S.press[i] > 0 ? 1 : 0, a = 420 * (goal - m.p) - 18 * m.v; m.v += a * dt; m.p += m.v * dt; if (m.p < 0) { m.p = 0; m.v *= -.3 } });   // mola dos botões (quica ao voltar para o aro)
  S.fx.forEach(f => f.t += dt); S.fx = S.fx.filter(f => f.t < .32);
  const st = songTime();
  if (!S.end && S.startAt) {
    for (const n of S.notes) { if (n.t > st - WIN) break; if (!n.done) missed(n) }   // passou sem acertar
    const c = S.sus;
    if (c) {   // nota longa: pontos por tempo enquanto as casas estiverem apertadas
      if (st >= c.end) S.sus = null;
      else if (c.lanes.every(l => S.held[l])) { S.score += Math.round(dt / beatLen(st) * 25 * S.mult * (S.spOn ? 2 : 1)); for (const l of c.lanes) if (Math.random() < .3) S.fx.push({ lane: l, t: .15 }) }
      else { c.dropped = true; S.sus = null }
    }
    if (S.spOn) { S.sp -= dt / (beatLen(st) * 32); if (S.sp <= 0) { S.sp = 0; S.spOn = false } }   // a barra cheia dura 32 tempos
    if (S.rock <= 0) finish(false); else if (st > S.len + 1.5) finish(true);
  }
  draw(); raf = requestAnimationFrame(frame);
}
async function finish(won) {
  S.end = true; S.sus = null; const a = ac(), t = a.currentTime;
  for (const { src, g } of S.play) { if (won) g.gain.setTargetAtTime(0, t, .4); else { src.playbackRate.setValueAtTime(1, t); src.playbackRate.linearRampToValueAtTime(.25, t + 1.4); g.gain.setTargetAtTime(0, t + .6, .3) } }   // perdeu: a música "desafina" e para
  if (won) { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .14, 'square', .05), 400 + i * 110)); S.msg = ['ARQUIVO DESTRUÍDO!', `${S.fname} foi para a Lixeira.`, `${fmt(S.info.total)} liberados · ${S.score.toLocaleString('en-US')} pontos`, 'Z para continuar'] }
  else S.msg = ['VOCÊ FALHOU', `${S.fname} continua no seu disco.`, 'Z tentar de novo    ESC desistir'];
  S.won = won;
}
function startAudio() {
  const a = ac(); if (a.state === 'suspended') a.resume();
  S.startAt = a.currentTime + 3;   // 3 s de contagem antes da música
  S.play = S.song.bufs.map(b => { const src = a.createBufferSource(), g = a.createGain(); src.buffer = b; g.gain.value = .14; src.connect(g).connect(a.destination); src.start(S.startAt + Math.max(0, S.delay)); return { src, g } });
}
function onKey(e) {
  if (!S) return; e.preventDefault(); e.stopPropagation();
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, up = e.type === 'keyup';
  const fret = S.lanes.findIndex(([, key]) => key === k);
  if (!S.drums && fret >= 0) {   // casas da guitarra
    if (S.held[fret] === !up) return; S.held[fret] = !up;
    if (!up) { S.press[fret] = .12; if (!S.end && S.startAt) press() } return;
  }
  if (up || e.repeat) return;
  if (S.end) { if (S.won && (k === 'z' || k === 'Enter')) close(true); else if (!S.won && (k === 'z' || k === 'Enter')) restart(); else if (!S.won && k === 'Escape') close(false); return }
  if (k === 'Escape') { S.end = true; S.won = false; for (const { src } of S.play || []) try { src.stop() } catch {} return close(false) }
  if (k === 'Shift' && S.sp >= .5 && !S.spOn) { S.spOn = true; S.spFlash = 1; [523, 784, 1046, 1568].forEach((f, i) => setTimeout(() => tone(f, .15, 'sawtooth', .04), i * 50)); return }   // ativa Star Power
  if (S.drums) { if (k === ' ') hitDrum(-1); else if (fret >= 0) { S.press[fret] = .12; hitDrum(fret) } }
}
function restart() { for (const { src } of S.play) try { src.stop() } catch {} Object.assign(S, fresh(S.song)); startAudio() }
function fresh(song) {
  const notes = song.notes.map(n => ({ ...n })), spLast = {};
  for (const n of notes) if (n.sp >= 0) spLast[n.sp] = n;   // última nota de cada trecho de Star Power
  return { notes, spLast, spBroken: new Set(), sp: 0, spOn: false, spFlash: 0, sus: null, chain: false, lastHitAt: -9, held: [false, false, false, false, false], spring: [0, 1, 2, 3, 4].map(() => ({ p: 0, v: 0 })), bi: 0,
    rock: .5, score: 0, streak: 0, mult: 1, fx: [], press: {}, end: false, won: false, msg: null, ehp: S.emax };
}
function fit() { const s = Math.min(innerWidth / W, innerHeight / H), dpr = devicePixelRatio || 1; cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px'; cv.width = Math.round(W * s * dpr); cv.height = Math.round(H * s * dpr); ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0) }
function close(won) {
  for (const { src } of (S && S.play) || []) try { src.stop() } catch {}
  cancelAnimationFrame(raf); S = null; removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKey, true); removeEventListener('resize', fit);
  root.remove(); onEnd && onEnd(won);
}

// Mesma assinatura das outras batalhas. Devolve false (sem abrir nada) se não houver música de ritmo embutida.
window.Batalha5 = {
  async start(info, rect, end) {
    if (S) return true;
    const song = await loadSong().catch(() => null); if (!song) return false;
    [NOTAS, PISTA] = await Promise.all([NOTAS || img('guitarra-notas'), PISTA || img('guitarra-pista')]);
    onEnd = end;
    root = document.createElement('div'); root.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#0b0c12';
    cv = document.createElement('canvas'); root.appendChild(cv); document.body.appendChild(root); ctx = cv.getContext('2d'); fit();
    const lv = Math.log2(1 + info.total / 1048576), boss = info.total >= 1024 ** 3;
    const len = Math.max(...song.notes.map(n => n.end || n.t)), hits = song.notes.length;
    const emax = Math.round(clamp(hits * .45, 40, 200) * (boss ? 1.4 : 1) * clamp(.8 + lv * .06, .8, 1.4));   // dá para vencer antes do fim da música
    S = { info, song, t: 0, lanes: song.drums ? DRUM : GUIT, drums: song.drums, beats: song.beats, len, delay: song.delay, emax, boss,
      title: song.name, sub: [song.artist, song.charter && 'mapa: ' + song.charter].filter(Boolean).join(' · '),
      type: info.count > 1 ? (info.kind === 'dir' ? 'dir' : 'doc') : Batalha.typeOf(info.file || info.name, info.kind), fname: info.name.length > 20 ? info.name.slice(0, 19) + '…' : info.name };
    Object.assign(S, fresh(song));
    addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true); addEventListener('resize', fit);
    startAudio(); raf = requestAnimationFrame(frame);
    return true;
  },
};
// Testes rápidos das regras (rodam só se pedirem: Batalha5._teste()).
window.Batalha5._teste = () => {
  const T = t => t / 480 / 2, ch = guitar([{ tick: 0, lane: 0, len: 0 }, { tick: 120, lane: 1, len: 0 }, { tick: 240, lane: 1, len: 0 }, { tick: 960, lane: 2, len: 960 }, { tick: 1080, lane: 3, len: 0 }, { tick: 1080, lane: 4, len: 0 }, { tick: 1440, lane: 'flip' }, { tick: 1440, lane: 0, len: 0 }], [[0, 300]], 480, T, false);
  const ok = [ch[0].hopo === false, ch[1].hopo === true, ch[2].hopo === false, ch[3].hopo === false && ch[3].end > 0, ch[4].lanes.length === 2 && !ch[4].hopo, ch[5].hopo === true, ch[0].sp === 0 && ch[3].sp === -1];
  return ok.every(Boolean) || ok;
};
})();
