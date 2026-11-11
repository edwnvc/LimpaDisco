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
  const T = timer(tempos, res), beats = [];
  const pickTrack = names => { for (const n of names) if (sec[n] && sec[n].some(([, v]) => v.startsWith('N'))) return sec[n] };
  let drums = true, tr = pickTrack(['HardDrums', 'ExpertDrums', 'MediumDrums', 'EasyDrums']);
  if (!tr) { drums = false; tr = pickTrack(['HardSingle', 'ExpertSingle', 'MediumSingle', 'EasySingle']) }
  if (!tr) return null;
  const expert = tr === sec.ExpertDrums || tr === sec.ExpertSingle;
  const cym = new Set(), notes = [];
  for (const [k, v] of tr) { const p = v.split(/\s+/); if (p[0] === 'N' && drums && +p[1] >= 66 && +p[1] <= 68) cym.add(k + ':' + (+p[1] - 64)) }   // marcas de prato (pro drums)
  for (const [k, v] of tr) {
    const p = v.split(/\s+/); if (p[0] !== 'N') continue; const n = +p[1], t = T(+k);
    if (drums) { if (n === 0) notes.push({ t, lane: -1 }); else if (n >= 1 && n <= 4) notes.push({ t, lane: n - 1, cym: cym.has(k + ':' + n) }) }
    else if (n <= 4) notes.push({ t, lane: n });
  }
  const last = notes.length ? Math.max(...notes.map(n => n.t)) : 0;
  for (let k = 0, t = 0; t < last + 4; k += res) beats.push(t = T(k));
  return { notes, beats, drums, offset: +(song.Offset || 0), expert, name: song.Name, artist: song.Artist, charter: song.Charter };
}
function parseMidi(buf) {   // formato .mid (Rock Band / Clone Hero)
  const d = new DataView(buf); let p = 0;
  const u32 = () => (p += 4, d.getUint32(p - 4)), u16 = () => (p += 2, d.getUint16(p - 2)), u8 = () => d.getUint8(p++);
  const vlq = () => { let v = 0, b; do { b = u8(); v = (v << 7) | (b & 127) } while (b & 128); return v };
  if (u32() !== 0x4d546864) return null; u32(); u16(); const ntr = u16(), res = u16();
  const tracks = [], tempos = [];
  for (let i = 0; i < ntr; i++) {
    if (u32() !== 0x4d54726b) return null; const len = u32(), end = p + len; let tick = 0, run = 0, name = ''; const ev = [];
    while (p < end) {
      tick += vlq(); let st = u8();
      if (st === 0xff) { const ty = u8(), l = vlq(), s = p; if (ty === 3) name = new TextDecoder().decode(new Uint8Array(buf, s, l)); if (ty === 0x51) tempos.push([tick, (d.getUint8(s) << 16) | (d.getUint8(s + 1) << 8) | d.getUint8(s + 2)]); p = s + l; continue }
      if (st === 0xf0 || st === 0xf7) { p += vlq(); continue }
      if (st < 0x80) { st = run; p-- } else run = st;
      const hi = st & 0xf0, a = u8(), b = hi === 0xc0 || hi === 0xd0 ? 0 : u8();
      if (hi === 0x90 && b > 0) ev.push([tick, a]);
    }
    p = end; tracks.push({ name, ev });
  }
  const T = timer(tempos, res), find = n => tracks.find(t => t.name === n), beats = [];
  let drums = true, tr = find('PART DRUMS'); if (!tr) { drums = false; tr = find('PART GUITAR') }
  if (!tr) return null;
  const base = [84, 96, 72, 60].find(b => tr.ev.some(([, n]) => n >= b && n <= b + 4));   // difícil, expert, médio, fácil
  if (base === undefined) return null;
  const toms = tr.ev.filter(([, n]) => n >= 110 && n <= 112).map(([k, n]) => k + ':' + (n - 108));   // marcas de tambor (sem elas, amarelo/azul/verde são pratos)
  const notes = [];
  for (const [k, n] of tr.ev) {
    if (n < base || n > base + 4) continue; const t = T(k), i = n - base;
    if (drums) notes.push(i === 0 ? { t, lane: -1 } : { t, lane: i - 1, cym: i >= 2 && !toms.includes(k + ':' + i) });
    else notes.push({ t, lane: i });
  }
  const last = notes.length ? Math.max(...notes.map(n => n.t)) : 0;
  for (let k = 0, t = 0; t < last + 4; k += res) beats.push(t = T(k));
  return { notes, beats, drums, offset: 0, expert: base === 96 };
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
  if (chart.expert) {   // só tem Expert: tira notas coladas demais (acordes ficam), para dar para tocar no teclado
    chart.notes.sort((a, b) => a.t - b.t); let last = -1;
    chart.notes = chart.notes.filter(n => { if (n.t - last < .002) return true; if (n.t - last < .16) return false; last = n.t; return true });
  }
  const ini = files.find(f => /\/song\.ini$/i.test(f)), info = {};
  if (ini) for (const l of (await (await get(ini)).text()).split(/\r?\n/)) { const m = l.match(/^\s*([\w_]+)\s*=\s*(.*)$/); if (m) info[m[1].toLowerCase()] = m[2].trim() }
  const stems = files.filter(f => /\.(ogg|opus|mp3|wav)$/i.test(f) && !/\/(preview|crowd)[^/]*$/i.test(f));
  const bufs = (await Promise.all(stems.map(f => get(f).then(r => r.arrayBuffer()).then(b => ac().decodeAudioData(b)).catch(() => null)))).filter(Boolean);
  return { ...chart, bufs, name: info.name || chart.name || dir.split('/').pop(), artist: info.artist || chart.artist || '', charter: info.charter || info.frets || chart.charter || '',
    delay: chart.offset + (+(info.delay || 0)) / 1000 };
}

/* ---------------- perspectiva da pista ---------------- */
const CX = 248, YH = 300, YV = -52, BW = 330, ZTOP = 1.7;   // centro, linha de batida, ponto de fuga, largura na linha, fundo da pista
const sOf = z => 1 / (1 + z), yOf = z => YV + (YH - YV) * sOf(z), xOf = (u, z) => CX + u * BW * sOf(z);   // u: -0.5 (borda esq.) a 0.5
function quad(u0, u1, z0, z1) { ctx.beginPath(); ctx.moveTo(xOf(u0, z0), yOf(z0)); ctx.lineTo(xOf(u1, z0), yOf(z0)); ctx.lineTo(xOf(u1, z1), yOf(z1)); ctx.lineTo(xOf(u0, z1), yOf(z1)); ctx.closePath() }
const laneU = i => -0.5 + (i + .5) / S.lanes.length * .92 + .04;

/* ---------------- desenho ---------------- */
function draw() {
  const now = songTime();
  const g = ctx.createRadialGradient(W * .42, -40, 20, W * .45, H * .4, W * .8);
  g.addColorStop(0, '#2a86c8'); g.addColorStop(.55, '#17435f'); g.addColorStop(1, '#1b1d33'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // pista
  const bg = ctx.createLinearGradient(0, yOf(ZTOP), 0, H); bg.addColorStop(0, '#24262c'); bg.addColorStop(1, '#0f1013');
  quad(-.5, .5, -.32, ZTOP); ctx.fillStyle = bg; ctx.fill();
  ctx.save(); quad(-.5, .5, -.32, ZTOP); ctx.clip();   // ornamento discreto no fundo da pista
  ctx.strokeStyle = 'rgba(255,255,255,.035)'; ctx.lineWidth = 6;
  for (let k = 0; k < 6; k++) { const z = ((k * .45 - now * 1.4) % 2.7 + 2.7) % 2.7 - .3; ctx.beginPath(); ctx.moveTo(xOf(-.3, z), yOf(z)); ctx.quadraticCurveTo(xOf(0, z + .25), yOf(z + .25), xOf(.3, z), yOf(z)); ctx.stroke() }
  ctx.restore();
  for (const [u0, u1] of [[-.535, -.5], [.5, .535]]) { quad(u0, u1, -.32, ZTOP); const m = ctx.createLinearGradient(xOf(u0, 0), 0, xOf(u1, 0), 0); m.addColorStop(0, '#5b5f68'); m.addColorStop(.5, '#d6d9de'); m.addColorStop(1, '#4a4d55'); ctx.fillStyle = m; ctx.fill() }   // trilhos de metal
  ctx.globalAlpha = .55; for (let i = 1; i < S.lanes.length; i++) { const u = -0.5 + i / S.lanes.length * .92 + .04; ctx.strokeStyle = '#3a3d44'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(xOf(u, 0), yOf(0)); ctx.lineTo(xOf(u, ZTOP), yOf(ZTOP)); ctx.stroke() } ctx.globalAlpha = 1;
  // medidor de rock no trilho esquerdo e especial no direito
  const segs = 10; for (let i = 0; i < segs; i++) {
    const z0 = .1 + i * .11, z1 = z0 + .08, on = S.rock * segs > i, c = i < 3 ? '#e8323c' : i < 6 ? '#f2c21a' : '#3cc04a';
    quad(-.56, -.53, z0, z1); ctx.fillStyle = on ? c : 'rgba(255,255,255,.08)'; ctx.fill();
    quad(.53, .56, z0, z1); ctx.fillStyle = S.streak / 40 * segs > i ? '#4ff0ff' : 'rgba(255,255,255,.08)'; ctx.fill();
  }
  // linhas de compasso
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
  for (const b of S.beats) { const z = (b - now) / LOOK * ZTOP; if (z < -.05 || z > ZTOP) continue; ctx.beginPath(); ctx.moveTo(xOf(-.5, z), yOf(z)); ctx.lineTo(xOf(.5, z), yOf(z)); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(xOf(-.5, 0), yOf(0)); ctx.lineTo(xOf(.5, 0), yOf(0)); ctx.stroke();
  // anéis
  S.lanes.forEach(([c], i) => ring(xOf(laneU(i), 0), yOf(0), BW / S.lanes.length * .4, c, S.press[i] > 0));
  // notas (de trás para a frente)
  for (let k = S.notes.length - 1; k >= 0; k--) {
    const n = S.notes[k]; if (n.done) continue; const z = (n.t - now) / LOOK * ZTOP; if (z > ZTOP || z < -.3) continue;
    if (n.lane < 0) { quad(-.47, .47, z - .025, z + .025); ctx.fillStyle = '#f08a1a'; ctx.fill(); quad(-.47, .47, z - .006, z + .006); ctx.fillStyle = '#ffd08a'; ctx.fill() }   // bumbo: barra laranja
    else gem(xOf(laneU(n.lane), z), yOf(z), BW / S.lanes.length * .38 * sOf(z), S.lanes[n.lane][0], n.cym);
  }
  // chamas dos acertos
  for (const f of S.fx) { const k = f.t / .28, x = xOf(laneU(f.lane), 0), y = yOf(0), s = BW / S.lanes.length * .45;
    for (let j = 0; j < 3; j++) { const gg = ctx.createRadialGradient(x, y - s * (.6 + j * .25) * (1 + k), 1, x, y - s * .8, s * 1.1); gg.addColorStop(0, `rgba(255,240,170,${.9 * (1 - k)})`); gg.addColorStop(.5, `rgba(255,140,30,${.7 * (1 - k)})`); gg.addColorStop(1, 'rgba(255,80,0,0)');
      ctx.fillStyle = gg; ctx.beginPath(); ctx.ellipse(x + rnd(-2, 2), y - s * (.7 + k * .6), s * (.75 - j * .15), s * (1.1 + k * .5), 0, 0, 7); ctx.fill() } }
  hud(now);
}
function ring(x, y, r, c, lit) {   // anel colorido com aro prateado e centro escuro (aceso quando a tecla está apertada)
  ctx.save(); ctx.translate(x, y); ctx.scale(1, .42);
  ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r * 1.18, 0, 7); ctx.fill();
  const m = ctx.createLinearGradient(0, -r, 0, r); m.addColorStop(0, '#f4f6f8'); m.addColorStop(1, '#8a8f98'); ctx.fillStyle = m; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
  ctx.fillStyle = lit ? c : '#1d1f24'; ctx.beginPath(); ctx.arc(0, 0, r * .72, 0, 7); ctx.fill();
  if (lit) { ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.beginPath(); ctx.arc(0, -r * .2, r * .4, 0, 7); ctx.fill() }
  ctx.restore();
}
function gem(x, y, r, c, cym) {
  ctx.save(); ctx.translate(x, y); ctx.scale(1, .45);
  if (cym) {   // prato: disco metálico com sulcos na cor da pista
    ctx.fillStyle = '#7a6420'; ctx.beginPath(); ctx.arc(0, r * .25, r * 1.12, 0, 7); ctx.fill();
    const m = ctx.createRadialGradient(0, -r * .3, 1, 0, 0, r * 1.1); m.addColorStop(0, '#fff6c8'); m.addColorStop(.5, c); m.addColorStop(1, '#5a4a10'); ctx.fillStyle = m; ctx.beginPath(); ctx.arc(0, 0, r * 1.1, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(40,30,0,.55)'; ctx.lineWidth = 1.2; for (const k of [.45, .75]) { ctx.beginPath(); ctx.arc(0, 0, r * k, 0, 7); ctx.stroke() }
    ctx.fillStyle = '#2a2208'; ctx.beginPath(); ctx.arc(0, -r * .1, r * .18, 0, 7); ctx.fill();
  } else {
    ctx.fillStyle = '#0a0a0c'; ctx.beginPath(); ctx.arc(0, r * .3, r * 1.05, 0, 7); ctx.fill();
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(0, 0, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#f4f6f8'; ctx.beginPath(); ctx.arc(0, 0, r * .62, 0, 7); ctx.fill();
    ctx.fillStyle = '#26282d'; ctx.beginPath(); ctx.arc(0, 0, r * .42, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function panel(x, y, w, h) { ctx.fillStyle = 'rgba(10,12,16,.85)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 4); ctx.fill(); ctx.strokeStyle = '#7d828c'; ctx.lineWidth = 1.5; ctx.stroke() }
function hud(now) {
  // multiplicador
  const mx = xOf(.62, .75), my = yOf(.75); ctx.fillStyle = '#121418'; ctx.beginPath(); ctx.arc(mx, my, 17, 0, 7); ctx.fill();
  ctx.strokeStyle = ['#9aa0aa', '#f2c21a', '#3cc04a', '#c04ae0'][S.mult - 1]; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = `800 9px ${FONT}`; ctx.fillText('x', mx - 7, my + 6); ctx.font = `800 20px ${FONT}`; ctx.fillText(S.mult, mx + 3, my + 7);
  // pontos, estrelas e sequência
  const px = 462, py = 196, stars = Math.min(5, Math.floor(S.score / Math.max(1, S.maxScore) * 6));
  panel(px, py, 128, 10); ctx.fillStyle = '#5b8de8'; ctx.fillRect(px + 3, py + 3, 122 * clamp(now / S.len, 0, 1), 4);   // andamento da música
  panel(px, py + 14, 128, 22); ctx.font = `700 15px ${FONT}`; ctx.fillStyle = '#e8eaee'; ctx.textAlign = 'right'; ctx.fillText(S.score.toLocaleString('en-US'), px + 120, py + 31);
  panel(px, py + 40, 128, 8); ctx.fillStyle = '#f2c21a'; ctx.fillRect(px + 3, py + 42, 122 * (S.score / Math.max(1, S.maxScore) * 6 % 1), 4);   // até a próxima estrela
  panel(px + 30, py + 52, 92, 20); ctx.fillStyle = '#ffb02e'; ctx.font = `800 14px ${FONT}`; ctx.fillText(S.streak, px + 114, py + 67);
  star(px + 146, py + 26, 19, stars);
  ctx.textAlign = 'left';
  // o arquivo (inimigo) com a vida dele
  const ex = 560, ey = 92; Batalha.draw(ctx, ex, ey + (S.ehit > 0 ? rnd(-3, 3) : 0), { kind: S.type, boss: S.boss, t: S.t, scale: .75, flash: S.ehit > 0 && Math.floor(S.t * 30) % 2 });
  panel(ex - 52, ey + 50, 104, 9); ctx.fillStyle = '#e8323c'; ctx.fillRect(ex - 49, ey + 53, 98 * clamp(S.ehp / S.emax, 0, 1), 3);
  ctx.font = `600 10px ${FONT}`; ctx.fillStyle = '#e8eaee'; ctx.textAlign = 'center'; ctx.fillText(S.fname, ex, ey + 72); ctx.textAlign = 'left';
  // nome da música no começo
  if (now < 3.5 && S.title) { const a = clamp(Math.min(now + 2, 3.5 - now), 0, 1); ctx.globalAlpha = a; panel(16, 18, 250, 46); ctx.fillStyle = '#fff'; ctx.font = `800 15px ${FONT}`; ctx.fillText(S.title, 28, 38); ctx.font = `500 11px ${FONT}`; ctx.fillStyle = '#b8bcc6'; ctx.fillText(S.sub, 28, 54); ctx.globalAlpha = 1 }
  if (now < 0) { ctx.font = `800 40px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(Math.ceil(-now), CX, 170); ctx.textAlign = 'left' }   // contagem
  // dicas de teclas embaixo dos anéis
  ctx.font = `700 10px ${FONT}`; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.textAlign = 'center';
  S.lanes.forEach(([, k], i) => ctx.fillText(k.toUpperCase(), xOf(laneU(i), 0), yOf(0) + 4)); if (S.drums) { ctx.font = `700 9px ${FONT}`; ctx.fillText('ESPAÇO = bumbo', CX, yOf(0) + 24) }   // letra da tecla no meio de cada anel
  ctx.textAlign = 'left';
  if (S.msg) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(0, 0, W, H); ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.font = `800 26px ${FONT}`; ctx.fillText(S.msg[0], W / 2, 150); ctx.font = `500 14px ${FONT}`; ctx.fillStyle = '#d8dbe2'; S.msg.slice(1).forEach((l, i) => ctx.fillText(l, W / 2, 182 + i * 22)); ctx.textAlign = 'left' }
}
function star(x, y, r, n) {
  ctx.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * .48 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) } ctx.closePath();
  const g = ctx.createLinearGradient(0, y - r, 0, y + r); g.addColorStop(0, '#ffe680'); g.addColorStop(1, '#c48a10'); ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = '#5a3f05'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = '#3a2802'; ctx.font = `800 14px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(n, x, y + 5);
}

/* ---------------- jogo ---------------- */
function songTime() { return S.startAt ? ac().currentTime - S.startAt - S.delay : -3 }
function hit(lane) {
  const now = songTime(); let best = null;
  for (const n of S.notes) { if (n.done || n.lane !== lane) continue; const dt = n.t - now; if (dt > WIN) break; if (Math.abs(dt) <= WIN && (!best || Math.abs(dt) < Math.abs(best.t - now))) best = n }
  if (!best) { if (S.streak) S.streak = 0, S.mult = 1; return }   // batida no vazio quebra a sequência
  best.done = true; S.streak++; S.mult = Math.min(4, 1 + Math.floor(S.streak / 10));
  S.score += 50 * S.mult; S.rock = Math.min(1, S.rock + .025); S.ehp -= S.mult; S.ehit = .12;
  if (lane >= 0) S.fx.push({ lane, t: 0 });
  if (S.ehp <= 0 && !S.end) finish(true);
}
function frame() {
  if (!S) return;
  const now = performance.now(), dt = Math.min(.05, (now - (S.last || now)) / 1000); S.last = now; S.t += dt; S.ehit = Math.max(0, S.ehit - dt);
  for (const k in S.press) S.press[k] = Math.max(0, S.press[k] - dt);
  S.fx.forEach(f => f.t += dt); S.fx = S.fx.filter(f => f.t < .28);
  const st = songTime();
  if (!S.end && S.startAt) {
    for (const n of S.notes) { if (n.t > st - WIN) break; if (!n.done) { n.done = true; n.miss = true; S.streak = 0; S.mult = 1; S.rock -= .04; tone(110, .08, 'sawtooth', .04) } }   // passou sem acertar
    if (S.rock <= 0) finish(false); else if (st > S.len + 1.5) finish(true);
  }
  draw(); raf = requestAnimationFrame(frame);
}
async function finish(won) {
  S.end = true; const a = ac(), t = a.currentTime;
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
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.type === 'keyup') return; if (e.repeat) return;
  if (S.end) { if (S.won && (k === 'z' || k === 'Enter')) close(true); else if (!S.won && (k === 'z' || k === 'Enter')) restart(); else if (!S.won && k === 'Escape') close(false); return }
  if (k === 'Escape') { S.end = true; S.won = false; for (const { src } of S.play || []) try { src.stop() } catch {} return close(false) }
  if (k === ' ' && S.drums) { hit(-1); return }
  const i = S.lanes.findIndex(([, key]) => key === k); if (i >= 0) { S.press[i] = .12; hit(i) }
}
function restart() { for (const { src } of S.play) try { src.stop() } catch {} Object.assign(S, fresh(S.song)); startAudio() }
function fresh(song) {
  return { notes: song.notes.map(n => ({ ...n })), rock: .5, score: 0, streak: 0, mult: 1, fx: [], press: {}, end: false, won: false, msg: null, ehp: S.emax };
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
    onEnd = end;
    root = document.createElement('div'); root.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#0b0c12';
    cv = document.createElement('canvas'); root.appendChild(cv); document.body.appendChild(root); ctx = cv.getContext('2d'); fit();
    const lv = Math.log2(1 + info.total / 1048576), boss = info.total >= 1024 ** 3;
    song.notes.sort((a, b) => a.t - b.t);
    const len = song.notes[song.notes.length - 1].t, hits = song.notes.length;
    const emax = Math.round(clamp(hits * .45, 40, 200) * (boss ? 1.4 : 1) * clamp(.8 + lv * .06, .8, 1.4));   // dá para vencer antes do fim da música
    S = { info, song, t: 0, lanes: song.drums ? DRUM : GUIT, drums: song.drums, beats: song.beats, len, delay: song.delay, emax, boss,
      maxScore: hits * 50 * 3.4, title: song.name, sub: [song.artist, song.charter && 'mapa: ' + song.charter].filter(Boolean).join(' · '),
      type: info.count > 1 ? (info.kind === 'dir' ? 'dir' : 'doc') : Batalha.typeOf(info.file || info.name, info.kind), fname: info.name.length > 20 ? info.name.slice(0, 19) + '…' : info.name };
    Object.assign(S, fresh(song));
    addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true); addEventListener('resize', fit);
    startAudio(); raf = requestAnimationFrame(frame);
    return true;
  },
};
})();
