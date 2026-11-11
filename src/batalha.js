// Batalha por turnos para excluir arquivos: vença (ou poupe) o arquivo e ele vai para a Lixeira.
// Mecânicas do gênero (menu de ações, barra de timing, coração desviando de tiros, TP, piedade);
// personagens, desenhos e sons são originais deste app.
(() => {
'use strict';
const W = 640, H = 480, FONT = '"Pixelify Sans", monospace';
const BOX0 = { x: 240, y: 128, w: 160, h: 160 }, BOX = { ...BOX0 };   // caixa onde o coração desvia (alguns ataques a apertam)
const HERO_AT = { x: 96, y: 150 }, ENEMY_AT = { x: 512, y: 196 };
let cv, ctx, root, st = null, raf = 0, last = 0, keys = {}, actx = null, music = null, musicGain = null, ACC = '#ff7a1a', ACC2 = '#ffb02e';

/* ---------------- som: efeitos sintetizados + música do arquivo escolhido ---------------- */
function ac() { return actx || (actx = new AudioContext()) }
function tone(f, d = .05, type = 'square', v = .06, f2 = 0) {
  const a = ac(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(1e-4, t + d);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + .02);
}
function noise(d = .3, v = .15, from = 2000, to = 200) {
  const a = ac(), t = a.currentTime, b = a.createBuffer(1, a.sampleRate * d, a.sampleRate), ch = b.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const n = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  n.buffer = b; f.type = 'bandpass'; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(1e-4, t + d);
  n.connect(f).connect(g).connect(a.destination); n.start(t);
}
const seq = (notes, gap, d = .08) => notes.forEach((f, i) => setTimeout(() => tone(f, d, 'square', .05), i * gap));
const SFX = {
  blip: () => tone(560, .025, 'square', .03), move: () => tone(700, .035, 'square', .045),
  ok: () => tone(880, .06, 'square', .05, 1320), back: () => tone(440, .06, 'square', .045, 300),
  hurt: () => { tone(200, .22, 'sawtooth', .1, 60); noise(.18, .1, 900, 200) },
  hit: () => { noise(.22, .18, 3000, 300); tone(320, .18, 'square', .07, 80) },
  crit: () => { noise(.3, .22, 5000, 300); seq([1046, 1318], 50, .06) },
  heal: () => seq([523, 659, 784, 1046], 60), graze: () => tone(1700, .025, 'triangle', .04),
  whoosh: () => noise(.45, .22, 300, 5000), alert: () => seq([988, 1318], 70, .07),
  win: () => seq([523, 659, 784, 1046, 1318], 95, .12), shatter: () => { tone(500, .1, 'square', .08, 200); setTimeout(() => noise(.6, .2, 2500, 100), 160) },
  spare: () => seq([784, 988, 1175, 1568], 80, .1),
};
async function startMusic() {
  try {
    const r = await fetch(st.boss ? 'musica5' : 'musica', { cache: 'no-store' }); if (!r.ok || !st) return;   // chefão tem música própria
    const buf = await ac().decodeAudioData(await r.arrayBuffer()); if (!st) return;
    if (ac().state === 'suspended') await ac().resume();
    music = ac().createBufferSource(); music.buffer = buf; music.loop = true;
    musicGain = ac().createGain(); musicGain.gain.value = .12;   // música baixinha, por baixo dos efeitos
    music.connect(musicGain).connect(ac().destination); music.start();
  } catch {
    window.toast && toast('Não consegui tocar a música da batalha.', true);
  }
}
function stopMusic() {
  if (!music) return;
  const m = music; musicGain.gain.setTargetAtTime(0, ac().currentTime, .15); setTimeout(() => { try { m.stop() } catch {} }, 900); music = null;
}

/* ---------------- desenhos em pixel ---------------- */
const HEART = ['.xx.xx.', 'xxxxxxx', 'xxxxxxx', '.xxxxx.', '..xxx..', '...x...'];
function pix(map, pal, x, y, s, only) {
  for (let r = 0; r < map.length; r++) for (let c = 0; c < map[r].length; c++) {
    const ch = map[r][c]; if (ch === '.') continue;
    ctx.fillStyle = only || pal[ch]; ctx.fillRect(x + c * s, y + r * s, s + .5, s + .5);
  }
}
/* ---------------- herói: boneco articulado, desenhado em baixa resolução e ampliado (sprite estilo 32 bits) ---------------- */
// Personagem original: boné, franja cobrindo os olhos, cachecol, camiseta listrada, mochila, tênis e a vassoura.
// Cada parte é um "osso" com ângulo (0 = para baixo, positivo = para a frente). A pose de cada momento é calculada
// e a pose desenhada corre atrás dela suavemente, então idle, ataque, defesa e as trocas entre eles ficam fluidos.
const HC = document.createElement('canvas'); HC.width = 104; HC.height = 92;
const HT = document.createElement('canvas'); HT.width = 104; HT.height = 92;
const hx = HC.getContext('2d', { willReadFrequently: true }), ht = HT.getContext('2d');
const HS = 3, GROUND = 86, MID = 52;   // HS: cada ponto do sprite vira 3x3 na tela; GROUND: linha dos pés no sprite
const HP = {
  skin: '#f2d0b0', skinD: '#d39d78', hair: '#3b2219', hairL: '#62402c', cap: '#2f45a0', capL: '#5068cc', capD: '#1e2c6a',
  shA: '#2a9a8e', shB: '#ecc94b', shD: '#1d6e66', pants: '#2b2a4c', pantsD: '#1c1b34', shoe: '#cf3a44', sole: '#f2eee6',
  scarf: '#d8407e', scarfD: '#a02a5c', pack: '#c0503a', packD: '#8c3426', wood: '#b9773f', woodD: '#86522a', straw: '#f2b84b', strawD: '#c98a2a',
};
const POSE_KEYS = ['dx', 'dy', 'lean', 'tilt', 'lbt', 'lbs', 'lft', 'lfs', 'abu', 'abf', 'afu', 'aff', 'broom', 'bo', 'cup', 'wind'];
const mixPose = (a, b, k) => { const o = {}; for (const key of POSE_KEYS) o[key] = a[key] + (b[key] - a[key]) * k; return o };
function limb(x, y, a, len, w, c, cd) {   // membro reto saindo da junta; devolve a ponta
  hx.save(); hx.translate(x, y); hx.rotate(-a);
  hx.fillStyle = c; hx.beginPath(); hx.roundRect(-w / 2, -w / 2, w, len + w, w / 2); hx.fill();
  if (cd) { hx.fillStyle = cd; hx.fillRect(w / 2 - 1, 0, 1, len) }
  hx.restore();
  return [x + Math.sin(a) * len, y + Math.cos(a) * len];
}
function leg(x, y, t, s, front) {
  const c = front ? HP.pants : HP.pantsD, k = limb(x, y, t, 6, 4, c, front && HP.pantsD), f = limb(k[0], k[1], s, 5, 4, c, front && HP.pantsD);
  hx.fillStyle = front ? HP.shoe : '#9c2a33'; hx.beginPath(); hx.roundRect(f[0] - 2, f[1] - 1, 6, 3, 1); hx.fill();   // tênis
  hx.fillStyle = HP.sole; hx.fillRect(f[0] - 2, f[1] + 1, 6, 1);
}
function arm(x, y, u, f, front) {
  const c = front ? HP.shA : HP.shD, e = limb(x, y, u, 5, 3, c), h = limb(e[0], e[1], f, 4, 3, c);
  hx.fillStyle = front ? HP.skin : HP.skinD; hx.beginPath(); hx.arc(h[0], h[1], 1.8, 0, 7); hx.fill();
  return h;
}
function broom(x, y, a, bo) {   // vassoura saindo da mão; devolve a ponta das cerdas (para o rastro do golpe)
  hx.save(); hx.translate(x, y); hx.rotate(-a);
  hx.fillStyle = HP.wood; hx.fillRect(-1, bo, 2, 21); hx.fillStyle = HP.woodD; hx.fillRect(0, bo, 1, 21);
  const e = bo + 21;
  hx.fillStyle = HP.scarf; hx.fillRect(-2, e - 1, 4, 2);
  hx.fillStyle = HP.straw; hx.beginPath(); hx.moveTo(-2, e); hx.lineTo(2, e); hx.lineTo(5, e + 8); hx.lineTo(-5, e + 8); hx.fill();
  hx.fillStyle = HP.strawD; for (let i = -3; i <= 3; i += 2) hx.fillRect(i, e + 3, 1, 5);
  hx.restore();
  return [x + Math.sin(a) * (e + 7), y + Math.cos(a) * (e + 7)];
}
function torso() {   // coordenadas do tronco: y negativo para cima, x positivo para a frente
  hx.fillStyle = HP.packD; hx.beginPath(); hx.roundRect(-11, -11, 7, 10, 2); hx.fill();   // mochila
  hx.fillStyle = HP.pack; hx.beginPath(); hx.roundRect(-11, -11, 6, 9, 2); hx.fill(); hx.fillStyle = HP.packD; hx.fillRect(-10, -8, 5, 1);
  hx.save(); hx.beginPath(); hx.roundRect(-5, -11, 10, 12, 2); hx.clip();
  for (let y = -11; y < 1; y++) { hx.fillStyle = ((y + 20) >> 1) % 2 ? HP.shA : HP.shB; hx.fillRect(-5, y, 10, 1) }   // camiseta listrada
  hx.fillStyle = 'rgba(0,0,0,.18)'; hx.fillRect(-5, -11, 2, 12);
  hx.restore();
  hx.fillStyle = HP.packD; hx.fillRect(-2, -11, 1, 9);   // alça da mochila
  hx.fillStyle = HP.pants; hx.fillRect(-5, -1, 10, 2);
}
function head(t) {
  const sw = Math.round(Math.sin(t * 3.1) * .7);
  hx.fillStyle = HP.skin; hx.beginPath(); hx.roundRect(-5, -10, 11, 10, 3); hx.fill();
  hx.fillStyle = HP.hair; hx.beginPath(); hx.roundRect(-6, -11, 9, 8, 3); hx.fill();
  hx.beginPath(); hx.moveTo(-6, -5); hx.lineTo(-8 + sw, -1); hx.lineTo(-3, -3); hx.fill();                                          // mecha da nuca
  hx.beginPath(); hx.moveTo(0, -9); hx.lineTo(7, -8); hx.lineTo(6, -4 + sw); hx.lineTo(4.5, -5.5); hx.lineTo(3, -3 + sw); hx.lineTo(1.5, -5.5); hx.lineTo(0, -4); hx.fill();   // franja tapando os olhos
  hx.fillStyle = HP.hairL; hx.fillRect(1, -8, 4, 1);
  hx.fillStyle = HP.skinD; hx.fillRect(3, -1, 2, 1);
  hx.fillStyle = HP.cap; hx.beginPath(); hx.roundRect(-6, -14, 11, 6, [4, 4, 1, 1]); hx.fill();                                  // boné
  hx.fillStyle = HP.capL; hx.fillRect(-3, -13, 4, 1);
  hx.fillStyle = HP.capD; hx.beginPath(); hx.roundRect(3, -9, 7, 2, 1); hx.fill();
  hx.fillStyle = HP.scarf; hx.fillRect(-1, -15, 2, 1);
}
function scarfTail(x, y, t, wind) {
  for (let i = 0; i < 6; i++) {
    const a = -1.7 - wind * .6 + Math.sin(t * 7 - i * .8) * (.2 + wind * .25) * (i + 1) / 6, x2 = x + Math.sin(a) * 2.7, y2 = y + Math.cos(a) * 2.7;
    hx.lineCap = 'round'; hx.lineWidth = 3.3 - i * .35; hx.strokeStyle = i % 2 ? HP.scarfD : HP.scarf;
    hx.beginPath(); hx.moveTo(x, y); hx.lineTo(x2, y2); hx.stroke(); x = x2; y = y2;
  }
}
function outline() {   // pontos meio transparentes viram cheios e o boneco ganha contorno escuro de 1 ponto
  const SW = HC.width, SH = HC.height, d = hx.getImageData(0, 0, SW, SH), p = d.data, on = new Uint8Array(SW * SH);
  for (let i = 0; i < on.length; i++) { on[i] = p[i * 4 + 3] > 100 ? 1 : 0; p[i * 4 + 3] = on[i] * 255 }
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const i = y * SW + x; if (on[i]) continue;
    if ((x > 0 && on[i - 1]) || (x < SW - 1 && on[i + 1]) || (y > 0 && on[i - SW]) || (y < SH - 1 && on[i + SW])) { p[i * 4] = 22; p[i * 4 + 1] = 14; p[i * 4 + 2] = 30; p[i * 4 + 3] = 255 }
  }
  hx.putImageData(d, 0, 0);
}
function renderHero(P, t) {
  hx.clearRect(0, 0, HC.width, HC.height);
  const lv = (a, b) => 6 * Math.cos(a) + 5 * Math.cos(b);
  const hipX = MID + P.dx, hipY = GROUND - 1 - Math.max(lv(P.lbt, P.lbs), lv(P.lft, P.lfs)) + P.dy;   // o pé mais baixo encosta no chão
  const T = (px, py) => [hipX + px * Math.cos(P.lean) - py * Math.sin(P.lean), hipY + px * Math.sin(P.lean) + py * Math.cos(P.lean)];
  const shB = T(-2, -10), shF = T(2, -10), neck = T(0, -11);
  const hb = arm(shB[0], shB[1], P.abu, P.abf, false);
  leg(hipX - 1, hipY, P.lbt, P.lbs, false);
  scarfTail(neck[0] - 2, neck[1] + 1, t, P.wind);
  hx.save(); hx.translate(hipX, hipY); hx.rotate(P.lean); torso(); hx.restore();
  leg(hipX + 1, hipY, P.lft, P.lfs, true);
  hx.fillStyle = HP.scarf; hx.save(); hx.translate(...neck); hx.rotate(P.lean); hx.beginPath(); hx.roundRect(-4, -1, 8, 3, 1); hx.fill(); hx.restore();   // cachecol no pescoço
  hx.save(); hx.translate(...neck); hx.rotate(P.lean + P.tilt); head(t); hx.restore();
  if (P.cup > .5) {   // caneca de café erguida, com fumacinha
    hx.fillStyle = '#ecedf2'; hx.fillRect(hb[0] - 3, hb[1] - 6, 6, 6); hx.fillRect(hb[0] + 3, hb[1] - 5, 2, 3);
    hx.fillStyle = '#6b3b1c'; hx.fillRect(hb[0] - 2, hb[1] - 5, 4, 1);
    hx.fillStyle = 'rgba(236,237,242,.8)'; const w = Math.round(Math.sin(t * 6)); hx.fillRect(hb[0] - 1 + w, hb[1] - 9, 1, 2); hx.fillRect(hb[0] + 1 - w, hb[1] - 11, 1, 2);
  }
  const hf = arm(shF[0], shF[1], P.afu, P.aff, true);
  const tip = broom(hf[0], hf[1], P.broom, P.bo);
  hx.fillStyle = HP.skin; hx.beginPath(); hx.arc(hf[0], hf[1], 1.8, 0, 7); hx.fill();   // mão por cima do cabo
  outline();
  return tip;
}
function drawHero(x, y, only) {   // x, y: canto do quadro antigo de 48x72; os pés ficam em (x+24, y+72). only: silhueta numa cor só
  let src = HC;
  if (only) { ht.clearRect(0, 0, HT.width, HT.height); ht.globalCompositeOperation = 'source-over'; ht.drawImage(HC, 0, 0); ht.globalCompositeOperation = 'source-in'; ht.fillStyle = only; ht.fillRect(0, 0, HT.width, HT.height); src = HT }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, Math.round(x + 24 - MID * HS), Math.round(y + 72 - GROUND * HS), HC.width * HS, HC.height * HS);
}
// Pose de cada momento. As funções de tempo deixam o corpo sempre vivo (respiração, cachecol, cabelo).
function poseTarget() {
  const t = st.t, b = Math.sin(t * 2.3);
  const P = { dx: 0, dy: 0, lean: .06 + b * .015, tilt: b * .03, lbt: -.02 + b * .03, lbs: -.26 - b * .03, lft: .3 + b * .03, lfs: .02 - b * .03,
    abu: -.12 + b * .05, abf: -.02 + b * .07, afu: .3 + b * .03, aff: .95 + b * .04, broom: .42 + b * .025, bo: -5, cup: 0, wind: .15 + Math.sin(t * 1.3) * .1 };
  if (st.phase === 'intro' && st.ph > .3 && st.ph < 1.1) {   // entrada: corre até a posição de batalha
    const c = t * 18, s = Math.sin(c);
    return { ...P, lean: .32, dy: -Math.abs(Math.cos(c)) * 2, lbt: s * .7, lbs: s * .7 - .5 - Math.max(0, Math.cos(c)) * .7, lft: -s * .7, lfs: -s * .7 - .5 - Math.max(0, -Math.cos(c)) * .7,
      abu: -s * .9, abf: -s * .9 + 1, afu: s * .5 + .4, aff: 1.3, broom: -1.5, bo: -12, wind: 1 };
  }
  if (st.swing > 0) {   // golpe: prepara (vassoura para trás), desce num arco por cima da cabeça e volta
    const p = 1 - st.swing;
    const W1 = { ...P, lean: -.2, dx: -3, tilt: -.1, afu: 3.5, aff: 3.3, broom: 3.65, abu: -.7, abf: -.3, lft: .5, lfs: .1, wind: .3 };
    const W2 = { ...P, lean: .45, dx: 13, tilt: .18, afu: 1.0, aff: .85, broom: .5, abu: -1.1, abf: -.7, lft: .95, lfs: .15, lbt: -.6, lbs: -.65, wind: 1 };
    return p < .3 ? mixPose(P, W1, ease(p / .3)) : p < .5 ? mixPose(W1, W2, (p - .3) / .2) : mixPose(W2, P, ease((p - .5) / .5));
  }
  if (st.victory) {   // vitória: pula girando a vassoura no alto
    const h = Math.abs(Math.sin(t * 6));
    return { ...P, dy: -h * 14, lean: 0, afu: 2.9, aff: 3.1, broom: 3.1 + Math.sin(t * 12) * .3, abu: -.6 + Math.sin(t * 6) * .5, abf: -.2, lbt: .35 * h, lbs: -.7 * h, lft: .6 * h, lfs: -.5 * h, wind: .7 };
  }
  if (st.dance) {   // poupou: dancinha
    const s = Math.sin(t * 7);
    return { ...P, lean: s * .18, tilt: -s * .15, dy: -Math.abs(s) * 4, abu: 1.6 + s, abf: 2.2 + s, afu: 1.6 - s, aff: 2.2 - s, broom: 2.7 - s * .6, lbt: -.2 + s * .3, lft: .3 - s * .3, wind: .5 };
  }
  if (st.hurtT > 0) return mixPose(P, { ...P, lean: -.42, tilt: -.25, dx: -6, abu: -.9, abf: -.5, afu: -.1, aff: .3, broom: .1, wind: .9 }, st.hurtT / .4);   // levou dano: tranco para trás
  if (st.defend && (st.phase === 'dodge' || st.phase === 'bubble'))   // defesa: agachado, vassoura na horizontal à frente
    return { ...P, lean: .22, tilt: .1, lbt: .25, lbs: -.85, lft: .85, lfs: -.3, abu: 1.0, abf: 1.6, afu: 1.25, aff: 1.6, broom: 1.62 + Math.sin(t * 20) * .02, bo: -12, wind: .45 + b * .1 };
  if (st.pose === 'act' && st.poseT > 0) {   // AGIR: pulinhos acenando
    const h = Math.abs(Math.sin(st.poseT * 9));
    return { ...P, dy: -h * 10, abu: 2.7, abf: 3 + Math.sin(t * 14) * .3, afu: 2.5, aff: 2.9, broom: 3, lbt: .3 * h, lbs: -.6 * h, lft: .5 * h, lfs: -.4 * h, wind: .5 };
  }
  if (st.pose === 'item' && st.poseT > 0) return { ...P, abu: 2.8, abf: 3.05, cup: 1, tilt: -.12, lean: -.05 };   // ITEM: ergue a caneca
  return P;
}
function drawHeart(x, y, s, color) { pix(HEART, {}, x - 3.5 * s, y - 3 * s, s, color) }
function drawEnemy(cx, cy, o) {   // o: {kind, t, flash, alpha, scale, calm}
  const s = 4 * (o.scale || 1), bob = Math.sin(o.t * 2.4) * 4, breathe = 1 + Math.sin(o.t * 3.1) * .025;
  ctx.save(); ctx.globalAlpha = o.alpha ?? 1;
  ctx.translate(cx, cy + bob); ctx.scale(s, s * breathe); ctx.translate(-11, -14);
  const P = (x, y, w, h, c) => { ctx.fillStyle = o.flash ? '#fff' : c; ctx.fillRect(x, y, w, h) };
  const K = '#121214';
  let ey = 9;                                                  // altura dos olhos
  if (o.kind === 'dir') {      // pasta
    P(0, 3, 9, 3, K); P(1, 4, 7, 2, '#d39a2a');
    P(0, 5, 22, 22, K); P(1, 6, 20, 20, '#f2b84b'); P(1, 6, 20, 3, '#ffd27a'); ey = 12;
  } else if (o.kind === 'zip') {   // caixa com zíper no meio
    P(0, 2, 22, 26, K); P(1, 3, 20, 24, '#e0a43a'); P(1, 3, 20, 2, '#f2c26a');
    for (let y = 3; y < 27; y++) P(10, y, 2, 1, y % 2 ? '#6b6b75' : '#c8c8d0');
    P(9, 22 - Math.round(Math.sin(o.t * 4) * 2), 4, 4, '#c8c8d0'); P(10, 23 - Math.round(Math.sin(o.t * 4) * 2), 2, 2, K);   // puxador balançando
  } else if (o.kind === 'exe') {   // janela de programa com barra de progresso
    P(0, 2, 22, 24, K); P(1, 3, 20, 4, ACC); P(14, 4, 2, 2, '#fff'); P(17, 4, 2, 2, '#ff5d5d');
    P(1, 7, 20, 18, '#ecedf2');
    P(3, 21, 16, 3, K); P(4, 22, Math.round(7 + Math.sin(o.t * 1.7) * 6), 1, ACC2);
    P(6, 26, 3, 2, K); P(13, 26, 3, 2, K); ey = 10;              // perninhas
  } else if (o.kind === 'media') { // rolo de filme
    P(0, 2, 22, 25, K); P(1, 3, 20, 23, '#3b6fa8');
    for (let y = 4; y < 25; y += 3) { P(2, y, 2, 2, K); P(18, y, 2, 2, K) }
    P(9, 20, 1, 4, '#fff'); P(10, 21, 1, 2, '#fff'); P(11, 22, 1, 1, '#fff'); ey = 9;   // "play" na barriga
  } else {                     // documento com a ponta dobrada
    P(0, 0, 17, 28, K); P(16, 6, 6, 22, K);                    // contorno sem o canto de cima
    for (let i = 0; i <= 6; i++) P(16 + i, i, 1, 1, K);        // diagonal da dobra
    P(1, 1, 15, 26, '#ecedf2'); P(16, 7, 5, 20, '#ecedf2');
    for (let i = 1; i <= 5; i++) P(16, i, i, 1, '#b6b8c6');    // aba dobrada
    for (let i = 0; i < 4; i++) P(4, 19 + i * 2, i === 3 ? 8 : 13, 1, '#b6b8c6');
  }
  const ex1 = o.kind === 'zip' ? 3 : 5, ex2 = o.kind === 'zip' ? 15 : 13;   // no .zip os olhos ficam dos lados do zíper
  P(ex1, ey, 4, 4, K); P(ex2, ey, 4, 4, K);
  P(ex1 + 1, ey + 1, 2, 2, o.calm ? K : o.boss ? '#ff5d5d' : ACC); P(ex2 + 1, ey + 1, 2, 2, o.calm ? K : o.boss ? '#ff5d5d' : ACC);
  if (o.calm) { P(8, ey + 6, 6, 1, K); P(7, ey + 5, 1, 1, K); P(14, ey + 5, 1, 1, K) }
  else {
    P(ex1 - 1, ey - 2, 2, 1, K); P(ex1 + 1, ey - 1, 3, 1, K); P(ex2, ey - 1, 3, 1, K); P(ex2 + 3, ey - 2, 2, 1, K);
    for (let i = 0; i < 4; i++) P(7 + i * 2, ey + 6 + (i % 2), 2, 1, K);
  }
  if (o.boss) { P(6, -3, 10, 2, '#ffd23f'); P(6, -5, 2, 2, '#ffd23f'); P(10, -6, 2, 3, '#ffd23f'); P(14, -5, 2, 2, '#ffd23f') }   // coroa do chefão
  ctx.restore();
}

/* ---------------- texto ---------------- */
function font(px, w = 500) { ctx.font = `${w} ${px}px ${FONT}` }
function wrap(text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const t = line ? line + ' ' + word : word;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = '  ' + word } else line = t;
    }
    out.push(line);
  }
  return out;
}
const fmt = b => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++ } return (i ? b.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : b) + ' ' + u[i] };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3), rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ---------------- estado da batalha ---------------- */
const MENU = ['LUTAR', 'AGIR', 'ITEM', 'POUPAR', 'DEFENDER'];
// Cada tipo de arquivo é um inimigo diferente: ações de AGIR, falas, frases do narrador e ataques próprios.
// Em AGIR: [nome, piedade na 1ª vez, piedade nas próximas, texto]; o texto recebe o nome do inimigo.
const TYPES = {
  doc: {
    acts: [['Organizar', 50, 50, n => `* Você organiza ${n} em pastinhas.\n* Ele parece mais calmo.`],
           ['Revisar texto', 50, 50, n => `* Você corrige três erros de digitação de ${n}.\n* Ele fica corado.`]],
    taunts: ['EU OCUPO ESPAÇO COM ORGULHO!', 'VOCÊ NEM TEM BACKUP DE MIM!', 'EU SOU IMPORTANTE... EU ACHO.', 'CTRL+Z NÃO VAI TE SALVAR!'],
    flavor: n => [`* ${n} se espreguiça no seu disco.`, `* Cheira a arquivo .tmp esquecido.`, `* ${n} jura que vai ser útil um dia.`],
    patterns: ['bits', 'snake', 'popups', 'laser', 'ring'],
  },
  dir: {
    acts: [['Organizar', 50, 50, n => `* Você separa ${n} por data.\n* As subpastas suspiram aliviadas.`],
           ['Espiar dentro', 50, 50, n => `* Você espia ${n}.\n* Tem coisa aí que nem ele lembrava.`]],
    taunts: ['TENHO SUBPASTAS DENTRO DE SUBPASTAS!', 'NOVA PASTA (2) É MINHA FILHA!', 'VOCÊ NUNCA VAI ACHAR NADA AQUI!', 'EU SOU UM LABIRINTO!'],
    flavor: n => [`* ${n} range como gaveta velha.`, `* Uma subpasta tenta fugir de ${n}.`, `* ${n} se reorganiza sozinha. Pior que antes.`],
    patterns: ['folders', 'spiral', 'bars', 'cursor', 'ring'],
  },
  zip: {
    acts: [['Descompactar', 50, 50, n => `* Você abre o zíper de ${n}.\n* Ele respira fundo pela primeira vez em anos.`],
           ['Apertar o zíper', 50, 50, n => `* Você fecha o zíper de ${n} com carinho.\n* Ele fica menorzinho.`, 'shrink']],
    taunts: ['ME COMPACTA SE FOR CAPAZ!', 'SOU 90% AR!', 'SENHA? QUE SENHA?', 'TENHO UM .ZIP DENTRO DE MIM!'],
    flavor: n => [`* ${n} estala como plástico-bolha.`, `* ${n} tenta caber em si mesmo.`, `* O zíper de ${n} faz ziiiip.`],
    patterns: ['squeeze', 'pinch', 'aim', 'spiral', 'snake'],
  },
  exe: {
    acts: [['Ler os termos', 50, 50, n => `* Você lê os termos de uso de ${n} inteiros.\n* Ninguém nunca tinha feito isso. Ele se emociona.`],
           ['Clicar em Avançar', 50, 50, n => `* Você clica em "Avançar" quatro vezes.\n* ${n} se sente compreendido.`]],
    taunts: ['DESEJA INSTALAR UMA BARRA DE FERRAMENTAS?', 'REINICIE PARA CONCLUIR!', 'ATUALIZANDO... 0%', 'ACEITE OS COOKIES!'],
    flavor: n => [`* ${n} pede permissão de administrador.`, `* A barra de progresso de ${n} anda pra trás.`, `* ${n} instala algo que ninguém pediu.`],
    patterns: ['popups', 'laser', 'cursor', 'aim', 'bars'],
  },
  media: {
    acts: [['Assistir junto', 50, 50, n => `* Você assiste ${n} até o fim.\n* Ele fica feliz por ter sido visto.`],
           ['Pular a abertura', 50, 50, n => `* Você pula a abertura de ${n}.\n* Ele finge que não ligou.`]],
    taunts: ['SÓ MAIS UM EPISÓDIO!', 'EU ESTAVA EM 4K!', 'AUMENTA O VOLUME!', 'SOU SUA LEMBRANÇA FAVORITA!'],
    flavor: n => [`* ${n} toca uma musiquinha baixinho.`, `* ${n} trava no meio do vídeo.`, `* ${n} pede para ser assistido de novo.`],
    patterns: ['notes', 'frames', 'snake', 'spiral', 'laser'],
  },
};
const COMMON_FLAVOR = n => [`* ${n} faz barulho de HD velho.`, `* ${n} se fragmenta de nervoso.`, `* O ventilador do PC acelera.`];
function typeOf(name, kind) {
  if (kind === 'dir') return 'dir';
  const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'iso'].includes(ext)) return 'zip';
  if (['exe', 'msi', 'dll', 'bat', 'cmd', 'sys'].includes(ext)) return 'exe';
  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'mp3', 'wav', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'media';
  return 'doc';
}
const ACTS = () => ['Checar', ...st.T.acts.map(a => a[0]), 'Faxina (50% TP)'];

function newState(info) {
  const mb = info.total / 1048576, lv = Math.log2(1 + mb);   // tudo escala com o tamanho do que vai ser apagado
  const type = info.count > 1 ? (info.kind === 'dir' ? 'dir' : 'doc') : typeOf(info.file || info.name, info.kind);
  const boss = info.total >= 1024 ** 3;                      // 1 GB ou mais: chefão
  return {
    info, type, T: TYPES[type], boss, enraged: false, used: {}, t: 0, phase: boss ? 'bossintro' : 'intro', body: null, smear: [], white: 0, ph: 0, turn: 0,
    hp: 120, maxhp: 120, tp: 0, defend: false, hurtT: 0,
    ehp: 0, emax: Math.round(clamp(40 + lv * 8, 40, 160) * (boss ? 1.5 : 1)), mercy: 0, eatk: Math.round(5 + Math.min(10, lv * .8)),
    speed: 1 + Math.min(.7, lv / 18), escale: 1, eflash: 0, eshake: 0, ealpha: 1, compact: boss ? 1.2 : 1, timers: {}, active: [],
    menu: 0, sub: 0, inv: [{ n: 'Café', h: 40, q: 2 }, { n: 'Energético', h: 70, q: 1 }, { n: 'Backup', h: 999, q: 1 }],
    text: '', shown: 0, after: null, flavor: '', fshown: 0, bubble: null,
    heart: { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 }, bullets: [], iframes: 0, spawn: 0, pattern: 0, boxT: 0,
    fx: [], trail: [], shake: 0, bar: null, swing: 0, from: info.from, result: null,
  };
}
const NAME = () => (st.boss ? '★ ' : '') + st.info.name;

/* ---------------- fluxo ---------------- */
function say(text, after) { st.phase = 'text'; st.text = text; st.shown = 0; st.after = after }
function toMenu() {
  st.phase = 'menu'; st.fshown = 0;
  st.flavor = st.mercy >= 100 ? `* ${NAME()} parece pronto para ir embora em paz.`
    : st.enraged && Math.random() < .5 ? `* ${NAME()} está soltando fumaça de tanta raiva.`
    : pick([...st.T.flavor(NAME()), ...COMMON_FLAVOR(NAME())]);
}
function hurtEnemy(dmg, crit) {
  st.ehp = Math.max(0, st.ehp - dmg); st.eflash = .25; st.eshake = .35;
  (crit ? SFX.crit : SFX.hit)();
  st.fx.push({ type: 'num', x: ENEMY_AT.x, y: ENEMY_AT.y - 60, text: crit ? `${dmg}!` : `${dmg}`, color: crit ? ACC2 : '#fff', t: 0 });
}
function afterAttack() { setTimeout(() => { if (!st) return; st.ehp <= 0 ? win() : enemyTurn() }, 450); st.phase = 'wait' }
function enemyTurn() {
  if (st.ehp <= 0) return win();
  if (st.boss && !st.enraged && st.ehp <= st.emax / 2) {   // chefão na metade da vida: segunda fase
    st.enraged = true; st.speed *= 1.2; st.shake = .5; SFX.shatter();
    return say(`* ${NAME()} ficou FURIOSO!\n* Os ataques agora vêm em dobro.`, enemyTurn);
  }
  st.phase = 'bubble'; st.ph = 0; st.bubble = { text: st.enraged ? 'VOCÊ VAI SE ARREPENDER!!' : pick(st.T.taunts), shown: 0 };
}
function startDodge() {
  Object.assign(BOX, BOX0);
  st.phase = 'dodge'; st.ph = 0; st.boxT = 0; st.bullets = []; st.timers = {}; st.iframes = 0;
  st.heart = { x: BOX.x + BOX.w / 2, y: BOX.y + BOX.h / 2 };
  const p = st.T.patterns, i = st.turn % p.length;
  st.active = st.enraged ? [p[i], p[(i + 1) % p.length]] : [p[i]];   // na fúria, dois ataques ao mesmo tempo
  st.turn++;
}
function endDodge() {
  Object.assign(BOX, BOX0);
  st.bullets = []; st.defend = false;
  st.mercy = Math.min(100, st.mercy + 4);   // cada turno sobrevivido acalma um pouco o arquivo
  toMenu();
}
function win() {
  st.phase = 'win'; st.ph = 0; stopMusic(); SFX.win();
  for (let i = 0; i < 90; i++) st.fx.push({ type: 'p', x: ENEMY_AT.x + rnd(-40, 40), y: ENEMY_AT.y + rnd(-50, 50), vx: rnd(60, 260), vy: rnd(-80, 20), life: rnd(.8, 1.6), t: 0, c: pick(['#ecedf2', '#b6b8c6', ACC, ACC2]) });
  st.ealpha = 0; st.victory = true;
  setTimeout(() => st && say(`* VOCÊ VENCEU${st.boss ? ' O CHEFÃO' : ''}!\n* ${NAME()} foi varrido para a Lixeira.\n* ${fmt(st.info.total)} liberados.`, () => close(true)), 900);
}
function spare() {
  st.phase = 'sparing'; st.ph = 0; st.dance = true; stopMusic(); SFX.spare();
  setTimeout(() => st && say(`* Você poupou ${NAME()}.\n* Ele aceitou ir para a Lixeira em paz.\n* ${fmt(st.info.total)} liberados.`, () => close(true)), 1100);
}
function lose() {
  st.phase = 'lose'; st.ph = 0; st.bullets = []; stopMusic(); SFX.hurt(); setTimeout(() => st && SFX.shatter(), 700);
}
function restart() { const info = st.info; st = newState(info); st.ehp = st.emax; st.phase = 'menu'; finishIntro(); startMusic(); toMenu() }
function finishIntro() { st.introDone = true }

/* ---------------- ações do jogador ---------------- */
function choose() {
  const m = st.menu; SFX.ok();
  if (m === 0 || m === 1) { st.phase = 'target'; st.mode = m === 0 ? 'fight' : 'act' }
  else if (m === 2) { if (st.inv.some(i => i.q > 0)) { st.phase = 'item'; st.sub = st.inv.findIndex(i => i.q > 0) } else say('* Sua mochila está vazia.', toMenu) }
  else if (m === 3) {
    if (st.mercy >= 100) spare();
    else say(`* Você tentou poupar ${NAME()}...\n* Mas ele ainda não quer ir. (PIEDADE ${st.mercy}%)`, enemyTurn);
  }
  else { st.defend = true; st.tp = Math.min(100, st.tp + 16); say('* Você se protege atrás da vassoura.\n* (Dano recebido pela metade; +16% TP)', enemyTurn) }
}
function doAct(i) {
  const n = NAME();
  const last = ACTS().length - 1;
  if (i === 0) say(`* ${n.toUpperCase()} - ATQ ${st.eatk} DEF ${Math.round(st.emax / 40)}${st.boss ? ' - CHEFÃO' : ''}\n* ${fmt(st.info.total)}${st.info.count > 1 ? ` em ${st.info.count} itens` : ''} de pura bagunça.`, enemyTurn);
  else if (i < last) {
    const [, first, again, text, effect] = st.T.acts[i - 1];
    st.mercy = Math.min(100, st.mercy + (st.used[i] ? again : first)); st.used[i] = true;
    if (effect === 'shrink') st.compact = Math.max(.7, st.compact - .1);
    st.pose = 'act'; st.poseT = 1;
    say(`${text(n)} (PIEDADE ${st.mercy}%)`, enemyTurn);
  }
  else {
    if (st.tp < 50) { SFX.back(); return say('* TP insuficiente! Raspe nos tiros para encher.', () => { st.phase = 'act' }) }
    st.tp -= 50; st.phase = 'wait'; st.swing = 1; SFX.whoosh();
    for (let k = 0; k < 40; k++) st.fx.push({ type: 'p', x: ENEMY_AT.x + rnd(-60, 20), y: ENEMY_AT.y + rnd(10, 50), vx: rnd(80, 240), vy: rnd(-120, -20), life: rnd(.5, 1), t: 0, c: '#c8c8d0' });
    setTimeout(() => { if (!st) return; hurtEnemy(Math.round(rnd(70, 90)), true); say('* FAXINA PESADA!\n* Você varre o arquivo com toda a força.', () => { st.ehp <= 0 ? win() : enemyTurn() }) }, 450);
  }
}
function useItem(i) {
  const it = st.inv[i]; it.q--; const before = st.hp; st.hp = Math.min(st.maxhp, st.hp + it.h); SFX.heal();
  st.pose = 'item'; st.poseT = 1.4;
  st.fx.push({ type: 'num', x: HERO_AT.x + 24, y: HERO_AT.y - 10, text: `+${st.hp - before}`, color: '#7dff8a', t: 0 });
  say(`* Você usou ${it.n}.\n* ${st.hp >= st.maxhp ? 'HP no máximo!' : `Recuperou ${st.hp - before} HP.`}`, enemyTurn);
}
function strike() {   // aperta Z na barra de timing
  const b = st.bar, dist = Math.abs(b.x - b.target);
  st.bar = null;
  if (dist > 150) { SFX.back(); st.fx.push({ type: 'num', x: ENEMY_AT.x, y: ENEMY_AT.y - 60, text: 'ERROU', color: '#9a9aa3', t: 0 }); return afterAttack() }
  const crit = dist < 6, dmg = Math.max(1, Math.round((28 + rnd(0, 10)) * (1 - dist / 170) * (crit ? 1.6 : 1)));
  st.fx.push({ type: 'slash', t: 0 }); st.swing = 1;
  setTimeout(() => st && hurtEnemy(dmg, crit), 260);
  afterAttack();
}

/* ---------------- tiros (turno do inimigo) ---------------- */
// Cada ataque: [intervalo entre disparos em s, função que cria os tiros]. O intervalo encolhe com a velocidade do inimigo.
const B_ = BOX;
const PATTERNS = {
  bits: [.2, sp => [{ k: 'bit', x: rnd(B_.x + 8, B_.x + B_.w - 8), y: B_.y - 8, vx: 0, vy: rnd(110, 150) * sp, r: 6, ch: pick(['0', '1']) }]],   // chuva de bits
  folders: [1.1, sp => { const a = rnd(0, Math.PI * 2), v = 105 * sp;                                     // pastas quicando
    return [{ k: 'folder', x: pick([B_.x + 12, B_.x + B_.w - 12]), y: rnd(B_.y + 12, B_.y + B_.h - 12), vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 8, bounce: true }] }],
  bars: [1.15, sp => { const left = Math.random() < .5;                                                   // barras de progresso com uma brecha
    return [{ k: 'bar', x: left ? B_.x - 14 : B_.x + B_.w, y: B_.y, w: 14, gy: rnd(B_.y + 10, B_.y + B_.h - 60), gh: 52, vx: (left ? 1 : -1) * 120 * sp, vy: 0 }] }],
  popups: [.75, () => { const w = 54, h = 40;                                                              // janelas que avisam e depois machucam
    return [{ k: 'popup', x: rnd(B_.x, B_.x + B_.w - w), y: rnd(B_.y, B_.y + B_.h - h), w, h, t: 0, vx: 0, vy: 0 }] }],
  squeeze: [1.4, sp => { const gy = rnd(B_.y + 10, B_.y + B_.h - 62);                                    // zíper fechando: paredes dos dois lados, mesma brecha
    return [-1, 1].map(d => ({ k: 'bar', zip: true, x: d < 0 ? B_.x - 14 : B_.x + B_.w, y: B_.y, w: 14, gy, gh: 54, vx: -d * 95 * sp, vy: 0 })) }],
  aim: [.55, sp => { const side = Math.floor(rnd(0, 4)), h = st.heart;                                  // engrenagens mirando no coração
    const x = side === 0 ? B_.x - 6 : side === 1 ? B_.x + B_.w + 6 : rnd(B_.x, B_.x + B_.w), y = side === 2 ? B_.y - 6 : side === 3 ? B_.y + B_.h + 6 : rnd(B_.y, B_.y + B_.h);
    const a = Math.atan2(h.y - y, h.x - x), v = 115 * sp;
    return [{ k: 'gear', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 7 }] }],
  notes: [.45, sp => [{ k: 'note', x: rnd(B_.x + 10, B_.x + B_.w - 10), y: B_.y - 6, vx: rnd(-60, 60) * sp, vy: rnd(20, 60), g: 260 * sp, r: 7, ch: pick(['♪', '♫']) }]],   // notas pulando com gravidade
  frames: [.6, sp => { const lane = Math.floor(rnd(0, 4)), left = lane % 2 === 0;                         // fotogramas em faixas, como trânsito
    return [{ k: 'rect', x: left ? B_.x - 34 : B_.x + B_.w, y: B_.y + 6 + lane * 38, w: 34, h: 24, vx: (left ? 1 : -1) * 130 * sp, vy: 0 }] }],
  snake: [.075, sp => { const left = Math.floor(st.ph / 1.6) % 2 === 0;                                   // cobra de bolinhas serpenteando; troca de lado a cada 1,6 s
    return [{ k: 'orb', x: left ? B_.x - 6 : B_.x + B_.w + 6, y: B_.y + B_.h / 2, sy: B_.y + B_.h / 2, amp: 52, f: .045, p: st.ph * 2.4, vx: (left ? 1 : -1) * 150 * sp, vy: 0, r: 5 }] }],
  spiral: [.11, sp => { const cx = B_.x + B_.w / 2, cy = B_.y + 10, a = Math.PI / 2 + Math.sin(st.ph * 1.9) * 1.15, v = 105 * sp;   // disco no alto girando e cuspindo em leque
    return [-.38, .38].map(d => ({ k: 'orb', x: cx, y: cy, vx: Math.cos(a + d) * v, vy: Math.sin(a + d) * v, r: 4.5 })) }],
  laser: [1.15, () => { const h = st.heart, two = st.enraged || Math.random() < .25;                      // aviso piscando e depois um raio largo
    const mk = vert => ({ k: 'laser', vert, pos: vert ? clamp(h.x + rnd(-8, 8), B_.x + 10, B_.x + B_.w - 10) : clamp(h.y + rnd(-8, 8), B_.y + 10, B_.y + B_.h - 10), t: 0, x: 0, y: 0, vx: 0, vy: 0 });
    return two ? [mk(true), mk(false)] : [mk(Math.random() < .5)] }],
  ring: [1.7, sp => { const h = st.heart, n = 12, gap = Math.floor(rnd(0, n)), R = 72, v = 58 * sp, out = [];   // anel fechando em volta do coração, com uma brecha
    for (let i = 0; i < n; i++) { if (i === gap || i === (gap + 1) % n) continue; const a = i / n * Math.PI * 2;
      out.push({ k: 'orb', ring: true, x: h.x + Math.cos(a) * R, y: h.y + Math.sin(a) * R, vx: -Math.cos(a) * v, vy: -Math.sin(a) * v, r: 5, t: 0, life: R / v }) }
    return out }],
  cursor: [.62, sp => { const side = Math.floor(rnd(0, 4));                                               // ponteiros: miram no coração e disparam
    const x = side === 0 ? B_.x + 8 : side === 1 ? B_.x + B_.w - 8 : rnd(B_.x + 10, B_.x + B_.w - 10), y = side === 2 ? B_.y + 8 : side === 3 ? B_.y + B_.h - 8 : rnd(B_.y + 10, B_.y + B_.h - 10);
    return [{ k: 'cursor', x, y, vx: 0, vy: 0, ang: 0, v: 270 * sp, r: 6, t: 0 }] }],
  pinch: [.2, sp => [{ k: 'bit', x: rnd(B_.x + 8, B_.x + B_.w - 8), y: B_.y - 8, vx: 0, vy: rnd(100, 135) * sp, r: 6, ch: pick(['0', '1']) }]],   // a caixa aperta enquanto chovem bits
};
function spawnBullets(dt) {
  for (const name of st.active) {
    const [every, make] = PATTERNS[name];
    st.timers[name] = (st.timers[name] ?? 0) - dt;
    if (st.timers[name] <= 0) { st.timers[name] = every / st.speed; st.bullets.push(...make(st.speed)) }
  }
}
function hitTest(b, hx, hy, pad) {
  if (b.k === 'bar') { const inX = hx + pad > b.x && hx - pad < b.x + b.w, inGap = hy - pad > b.gy && hy + pad < b.gy + b.gh; return inX && !inGap }
  if (b.k === 'popup') return b.t > .6 && b.t < 1.1 && hx + pad > b.x && hx - pad < b.x + b.w && hy + pad > b.y && hy - pad < b.y + b.h;
  if (b.k === 'rect') return hx + pad > b.x && hx - pad < b.x + b.w && hy + pad > b.y && hy - pad < b.y + b.h;
  if (b.k === 'laser') return b.t > .7 && b.t < 1.02 && Math.abs((b.vert ? hx : hy) - b.pos) < 7 + pad;
  if (b.k === 'cursor' && b.t < .45) return false;   // mirando ainda não machuca
  return Math.hypot(b.x - hx, b.y - hy) < b.r + pad;
}
function updateDodge(dt) {
  const B = BOX, h = st.heart, v = 165 * dt;
  if (st.active.includes('pinch')) { const k = Math.sin(clamp(st.ph / 4.8, 0, 1) * Math.PI); B.w = BOX0.w - 86 * k; B.x = BOX0.x + (BOX0.w - B.w) / 2 }
  if (keys.ArrowLeft || keys.a) h.x -= v; if (keys.ArrowRight || keys.d) h.x += v;
  if (keys.ArrowUp || keys.w) h.y -= v; if (keys.ArrowDown || keys.s) h.y += v;
  h.x = clamp(h.x, B.x + 9, B.x + B.w - 9); h.y = clamp(h.y, B.y + 8, B.y + B.h - 8);
  if (st.ph > .3 && st.ph < 4.4) spawnBullets(dt);
  st.iframes = Math.max(0, st.iframes - dt);
  for (const b of st.bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; if (b.t !== undefined) b.t += dt;
    if (b.sy !== undefined) b.y = b.sy + Math.sin(b.x * b.f + b.p) * b.amp;
    if (b.k === 'cursor') {
      if (b.t < .45) b.ang = Math.atan2(h.y - b.y, h.x - b.x);
      else if (!b.go) { b.go = true; b.vx = Math.cos(b.ang) * b.v; b.vy = Math.sin(b.ang) * b.v; tone(1200, .04, 'square', .03, 500) }
    }
    if (b.k === 'laser' && !b.fired && b.t > .7) { b.fired = true; st.shake = .12; noise(.3, .12, 1500, 400) }
    if (b.g) {   // notas: caem com gravidade e quicam uma vez no chão da caixa
      b.vy += b.g * dt;
      if (!b.bounced && b.y > B.y + B.h - b.r) { b.y = B.y + B.h - b.r; b.vy = -Math.abs(b.vy) * .85; b.bounced = true }
    }
    if (b.bounce) {
      if (b.x < B.x + b.r || b.x > B.x + B.w - b.r) { b.vx *= -1; b.x = clamp(b.x, B.x + b.r, B.x + B.w - b.r) }
      if (b.y < B.y + b.r || b.y > B.y + B.h - b.r) { b.vy *= -1; b.y = clamp(b.y, B.y + b.r, B.y + B.h - b.r) }
    }
    if (st.iframes <= 0 && hitTest(b, h.x, h.y, 5)) {
      const dmg = Math.round(st.eatk * (st.defend ? .5 : 1) * rnd(.85, 1.15));
      st.hp = Math.max(0, st.hp - dmg); st.iframes = 1; st.shake = .3; st.hurtT = .4; SFX.hurt();
      st.fx.push({ type: 'num', x: HERO_AT.x + 24, y: HERO_AT.y - 10, text: `${dmg}`, color: '#ff5d5d', t: 0 });
      if (st.hp <= 0) return lose();
    } else if (!b.grazed && hitTest(b, h.x, h.y, 20)) {   // raspou sem encostar: ganha TP
      b.grazed = true; st.tp = Math.min(100, st.tp + 4); SFX.graze();
      st.fx.push({ type: 'graze', x: h.x, y: h.y, t: 0 });
    }
  }
  st.bullets = st.bullets.filter(b => b.k === 'popup' || b.k === 'laser' ? b.t < 1.15 : b.ring ? b.t < b.life : b.k === 'cursor' && !b.go ? true : b.x > B.x - 40 && b.x < B.x + B.w + 40 && b.y < B.y + B.h + 20 && b.y > B.y - 30);
  if (st.ph > 5) endDodge();
}

/* ---------------- atualização ---------------- */
function update(dt) {
  st.t += dt; st.ph += dt;
  const T = poseTarget(); if (!st.body) st.body = T;   // a pose desenhada persegue a pose do momento: transições suaves
  const r = 1 - Math.exp(-dt * (st.swing > 0 ? 40 : 14)); for (const k of POSE_KEYS) st.body[k] += (T[k] - st.body[k]) * r;
  st.white = Math.max(0, st.white - dt * 1.6); st.smear.forEach(s => s.a -= dt * 4); st.smear = st.smear.filter(s => s.a > 0);
  if (st.phase === 'bossintro') {
    const bi = st.bi; bi.t += dt;
    if (bi.step === 0 && bi.t > 1) { bi.step = 1; bi.t = 0 }
    if (bi.step === 1 && bi.shown < bi.lines[bi.line].length) { const b0 = Math.floor(bi.shown); bi.shown += dt * 34; if (Math.floor(bi.shown) > b0 && b0 % 2 === 0) tone(rnd(160, 420), .035, 'sawtooth', .03) }
    if (bi.step === 2) { for (const o of bi.orbs) { o.x += o.vx * dt; o.y += o.vy * dt } if (bi.t > 1.8) { st.phase = 'menu'; finishIntro(); st.ehp = st.emax; st.white = 1; toMenu() } }
  }
  st.eflash = Math.max(0, st.eflash - dt); st.eshake = Math.max(0, st.eshake - dt); st.shake = Math.max(0, st.shake - dt);
  st.swing = Math.max(0, st.swing - dt * 1.6); st.hurtT = Math.max(0, st.hurtT - dt); st.poseT = Math.max(0, (st.poseT || 0) - dt);
  const typing = (obj, key, speed = 75) => { const before = Math.floor(obj[key]); obj[key] += dt * speed; if (Math.floor(obj[key]) > before && before % 2 === 0) SFX.blip() };
  if (st.phase === 'intro') {
    if (st.ph > .35 && !st.dashed) { st.dashed = true; SFX.whoosh() }
    if (st.ph > .35 && st.ph < 1.05) st.trail.push({ ...introPos(), a: 1 });
    st.trail.forEach(p => p.a -= dt * 2.2); st.trail = st.trail.filter(p => p.a > 0);
    st.ehp = Math.round(st.emax * clamp((st.ph - .9) / .5, 0, 1));
    if (st.ph > 1.6) { finishIntro(); st.ehp = st.emax; toMenu() }
  }
  if (st.phase === 'menu' && st.fshown < st.flavor.length) typing(st, 'fshown');
  if (st.phase === 'text' && st.shown < st.text.length) typing(st, 'shown');
  if (st.phase === 'fight') {
    st.bar.x -= st.bar.v * dt;
    if (st.bar.x < st.bar.target - 160) { st.bar = null; st.fx.push({ type: 'num', x: ENEMY_AT.x, y: ENEMY_AT.y - 60, text: 'ERROU', color: '#9a9aa3', t: 0 }); SFX.back(); afterAttack() }
  }
  if (st.phase === 'bubble') { if (st.bubble.shown < st.bubble.text.length) st.bubble.shown += dt * 60; if (st.ph > 1.4) { st.bubble = null; startDodge() } }
  if (st.phase === 'dodge') { st.boxT = Math.min(1, st.boxT + dt * 5); updateDodge(dt) }
  const grow = st.phase === 'dodge' || st.phase === 'bubble' ? 1.3 : 1;   // o arquivo cresce no turno dele
  st.escale += (grow * st.compact - st.escale) * Math.min(1, dt * 6);
  if (st.phase === 'sparing') st.ealpha = Math.max(0, 1 - st.ph / 1.1);
  for (const f of st.fx) { f.t += dt; if (f.type === 'p') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 120 * dt } }
  st.fx = st.fx.filter(f => f.t < (f.type === 'p' ? f.life : f.type === 'slash' ? .35 : f.type === 'graze' ? .3 : 1));
  if (st.phase === 'lose' && st.ph > 1.4 && !st.loseText) { st.loseText = true }
}
function introPos() {   // herói e inimigo saem da linha clicada e disparam até a posição de batalha
  const k = ease((st.ph - .35) / .6), f = st.from;
  return { hx: f.hx + (HERO_AT.x - f.hx) * k, hy: f.hy + (HERO_AT.y - f.hy) * k, ex: f.ex + (ENEMY_AT.x - f.ex) * k, ey: f.ey + (ENEMY_AT.y - f.ey) * k };
}

/* ---------------- desenho ---------------- */
/* ---------------- entrada do chefão (1 GB ou mais): fala com [palavras] piscando, a cena se desfaz em faixas e a luta começa ---------------- */
const BC = document.createElement('canvas'); BC.width = W; BC.height = H; const bctx = BC.getContext('2d');
function bossLines() {
  const n = st.info.name.toUpperCase();
  return [
    '* EI, EI, EI! [[Olá, Usuário]]!!\n* QUE [Faxina] MAIS [[Bonita]] VOCÊ ESTÁ FAZENDO!',
    `* EU SOU ${n}!\n* [${fmt(st.info.total)}] DE PURO [[Valor Agregado]]!!`,
    '* POR QUE ME [Apagar]...\n* SE VOCÊ PODE [[Comprar Mais Espaço]]?!',
    '* AGORA É A SUA CHANCE DE VIRAR\n* UM [[ESPAÇO LIVRE]]!!! HAHAHA!',
  ];
}
function bossAdvance() {
  const bi = st.bi, line = bi.lines[bi.line];
  if (bi.shown < line.length) { bi.shown = line.length; return }
  SFX.ok();
  if (++bi.line < bi.lines.length) { bi.shown = 0; return }
  bi.step = 2; bi.t = 0; st.shake = .6; SFX.shatter(); noise(1.4, .18, 6000, 200); startMusic();
  bi.orbs = Array.from({ length: 14 }, () => ({ x: rnd(-60, W + 60), y: rnd(H, H + 200), vx: rnd(-90, 90), vy: rnd(-520, -260), r: rnd(9, 16), c: pick(['#ff4fd8', '#7dffd0', '#4fc3ff', '#ffe14d']) }));
}
function glitchText(s, x, y) {   // [assim] amarelo, [[assim]] rosa e tremendo
  font(21, 600); let cx = x, cy = y, depth = 0;
  for (const ch of s) {
    if (ch === '\n') { cx = x; cy += 30; continue }
    if (ch === '[') depth++;
    const j = depth >= 2 ? rnd(-1.5, 1.5) : 0;
    ctx.fillStyle = depth >= 2 ? '#ff4fd8' : depth === 1 ? '#ffe14d' : '#fff'; ctx.fillText(ch, cx + j, cy + j);
    cx += ctx.measureText(ch).width;
    if (ch === ']') depth = Math.max(0, depth - 1);
  }
}
function drawBossIntro() {
  const bi = st.bi, t = st.t;
  root.style.background = '#000';
  // cena inteira num quadro à parte, para poder fatiar
  bctx.fillStyle = '#12061a'; bctx.fillRect(0, 0, W, H);
  bctx.strokeStyle = 'rgba(255,79,216,.16)'; bctx.lineWidth = 1; const off = (t * 30) % 40;
  for (let x = -40 + off; x < W; x += 40) { bctx.beginPath(); bctx.moveTo(x, 0); bctx.lineTo(x, H); bctx.stroke() }
  for (let y = -40 + off; y < H; y += 40) { bctx.beginPath(); bctx.moveTo(0, y); bctx.lineTo(W, y); bctx.stroke() }
  const old = ctx; ctx = bctx; drawEnemy(W / 2, 200 + Math.sin(t * 3) * 6, { kind: st.type, boss: true, t: t * 2, scale: 2, flash: Math.random() < .03 }); ctx = old;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = bi.step === 0 ? clamp(bi.t / 1, 0, 1) : 1;
  const k = bi.step === 2 ? clamp(bi.t / 1.4, 0, 1) : 0;
  for (let y = 0; y < H; y += 16) {   // faixas: de vez em quando uma escorrega; no fim todas deslizam para os lados
    let dx = Math.random() < .035 ? rnd(-26, 26) : 0;
    if (k) dx = ((y / 16) % 2 ? 1 : -1) * k * k * 720 + Math.sin(y * .3 + t * 30) * 14 * k;
    ctx.drawImage(BC, 0, y, W, 16, dx, y, W, 16);
  }
  ctx.globalAlpha = 1;
  if (bi.step === 2) for (const o of bi.orbs) {   // bolhas coloridas subindo
    ctx.fillStyle = o.c; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, 7); ctx.fill();
    ctx.strokeStyle = '#12061a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(o.x, o.y, o.r * .55, t * 6, t * 6 + 4); ctx.stroke();
  }
  if (bi.step === 1) {
    ctx.fillStyle = '#000'; ctx.fillRect(28, 330, W - 56, 128); ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.strokeRect(28, 330, W - 56, 128);
    glitchText(bi.lines[bi.line].slice(0, Math.floor(bi.shown)), 50, 372);
    if (bi.shown >= bi.lines[bi.line].length && Math.floor(t * 3) % 2) { font(14, 700); ctx.fillStyle = '#ffe14d'; ctx.fillText('Z', W - 58, 446) }
  }
}

function draw() {
  if (st.phase === 'bossintro') return drawBossIntro();
  const intro = st.phase === 'intro', ip = intro ? st.ph : 9;
  const sceneA = clamp(ip / .35, 0, 1) * .85 + clamp((ip - .6) / .5, 0, 1) * .15;
  root.style.background = `rgba(0,0,0,${clamp(ip / .35, 0, 1)})`;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (st.shake > 0) ctx.translate(rnd(-4, 4) * st.shake * 3, rnd(-4, 4) * st.shake * 3);
  ctx.fillStyle = `rgba(10,10,12,${sceneA})`; ctx.fillRect(0, 0, W, H);
  // grade do fundo, rolando devagar
  const ga = clamp((ip - .6) / .5, 0, 1); ctx.globalAlpha = ga;
  const off = (st.t * 10) % 40; ctx.lineWidth = 1;
  for (let x = -40 + off; x < W; x += 40) { ctx.strokeStyle = 'rgba(255,122,26,.10)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 318); ctx.stroke() }
  for (let y = -40 + off; y < 318; y += 40) { ctx.strokeStyle = 'rgba(255,122,26,.10)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke() }
  ctx.globalAlpha = 1;

  // TP (entra pela esquerda)
  const tpX = -60 + 60 * ease((ip - 1.0) / .3);
  drawTP(tpX);

  // personagens
  const pos = intro && st.ph < .35 ? { hx: st.from.hx, hy: st.from.hy, ex: st.from.ex, ey: st.from.ey } : intro ? introPos() : { hx: HERO_AT.x, hy: HERO_AT.y, ex: ENEMY_AT.x, ey: ENEMY_AT.y };
  const tip = renderHero(st.body, st.t);
  for (const p of st.trail) { ctx.globalAlpha = p.a * .5; drawHero(p.hx, p.hy, ACC); drawEnemyAt(p.ex, p.ey, { ...enemyLook(), flash: false, alpha: p.a * .35 }); }
  ctx.globalAlpha = 1;
  if (intro && st.ph < .35) {   // "!" de alerta sobre o arquivo
    font(34, 700); ctx.fillStyle = ACC2; ctx.textAlign = 'center'; ctx.fillText('!', pos.ex, pos.ey - 56 - Math.sin(st.ph * 20) * 3); ctx.textAlign = 'left';
  }
  const blink = st.iframes > 0 && Math.floor(st.t * 14) % 2 === 0;
  if (!(st.phase === 'lose')) {
    const p = 1 - st.swing;   // rastro das cerdas durante o golpe
    if (st.swing > 0 && p > .22 && p < .62) st.smear.push({ x: pos.hx + 24 + (tip[0] - MID) * HS, y: pos.hy + 72 + (tip[1] - GROUND) * HS, a: 1 });
    if (st.smear.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < st.smear.length; i++) { const s0 = st.smear[i - 1], s1 = st.smear[i]; ctx.globalAlpha = s1.a * .8; ctx.strokeStyle = i % 2 ? ACC2 : '#fff'; ctx.lineWidth = 4 + 10 * s1.a; ctx.beginPath(); ctx.moveTo(s0.x, s0.y); ctx.lineTo(s1.x, s1.y); ctx.stroke() }
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = blink ? .4 : 1;
    drawHero(pos.hx, pos.hy, st.hurtT > .2 && Math.floor(st.t * 20) % 2 ? '#ff5d5d' : null);
    ctx.globalAlpha = 1;
  }
  const shake = st.eshake > 0 ? rnd(-6, 6) * st.eshake * 2 : 0;
  drawEnemyAt(pos.ex + shake, pos.ey, enemyLook());

  // efeitos
  for (const f of st.fx) drawFx(f);

  // caixa de desvio + tiros + coração
  if (st.phase === 'dodge') drawDodge();
  if (st.bubble) drawBubble();

  // painel de baixo (sobe no início)
  const panelY = 318 + 162 * (1 - ease((ip - 1.1) / .3));
  drawPanel(panelY);

  if (st.phase === 'lose') drawLose();
  if (st.white > 0) { ctx.fillStyle = `rgba(255,255,255,${st.white})`; ctx.fillRect(-20, -20, W + 40, H + 40) }   // clarão depois da entrada do chefão
  ctx.restore();
}
function enemyLook() { return { kind: st.type, boss: st.boss && st.mercy < 100, t: st.t * (st.enraged ? 1.8 : 1), flash: st.eflash > 0 && Math.floor(st.t * 30) % 2 === 0, alpha: st.ealpha, scale: st.escale, calm: st.mercy >= 100 } }
function drawEnemyAt(x, y, o) { if (o.alpha > 0) drawEnemy(x, y - (st.phase === 'sparing' ? st.ph * 40 : 0), o) }

function drawTP(x) {
  const y = 64, h = 200;
  font(18, 700); ctx.fillStyle = '#fff'; ctx.fillText('T', x + 8, y + 40); ctx.fillText('P', x + 8, y + 60);
  font(14, 600); ctx.fillText(st.tp >= 100 ? 'MAX' : `${Math.round(st.tp)}%`, x + 2, y + 84);
  ctx.fillStyle = '#121214'; ctx.fillRect(x + 32, y, 20, h);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(x + 32, y, 20, h);
  const fh = (h - 4) * st.tp / 100; ctx.fillStyle = st.tp >= 50 ? ACC2 : ACC; ctx.fillRect(x + 34, y + h - 2 - fh, 16, fh);
  ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillRect(x + 34, y + h / 2, 16, 2);   // marca dos 50% da Faxina
}

function drawPanel(y) {
  // faixa com nome, HP e botões
  ctx.fillStyle = '#0a0a0c'; ctx.fillRect(0, y, W, H - y);
  ctx.fillStyle = ACC; ctx.fillRect(0, y, W, 2);
  font(18, 700); ctx.fillStyle = '#fff'; ctx.fillText('VOCÊ', 18, y + 27);
  font(13, 600); ctx.fillStyle = '#c8c8d0'; ctx.fillText('HP', 84, y + 26);
  ctx.fillStyle = '#3a1010'; ctx.fillRect(106, y + 14, 90, 14);
  ctx.fillStyle = st.hp / st.maxhp > .3 ? ACC2 : '#ff5d5d'; ctx.fillRect(106, y + 14, 90 * st.hp / st.maxhp, 14);
  font(14, 600); ctx.fillStyle = '#fff'; ctx.fillText(`${st.hp}/${st.maxhp}`, 204, y + 26);
  if (st.defend) { font(12, 700); ctx.fillStyle = ACC2; ctx.fillText('DEFENDENDO', 18, y + 42) }
  MENU.forEach((m, i) => {
    const bx = 282 + i * 70, on = st.phase === 'menu' && st.menu === i;
    ctx.fillStyle = on ? ACC : '#151517'; ctx.fillRect(bx, y + 8, 64, 28);
    ctx.strokeStyle = on ? ACC2 : '#36363b'; ctx.lineWidth = 2; ctx.strokeRect(bx, y + 8, 64, 28);
    font(m.length > 6 ? 11 : 13, 700); ctx.fillStyle = on ? '#1a0b02' : (i === 3 && st.mercy >= 100 ? '#ffe14d' : '#ecedf2');
    ctx.textAlign = 'center'; ctx.fillText(m, bx + 32, y + 27); ctx.textAlign = 'left';
  });
  // caixa de texto
  const ty = y + 48;
  ctx.strokeStyle = '#ecedf2'; ctx.lineWidth = 3; ctx.strokeRect(14, ty, W - 28, H - ty - 10);
  font(20, 500); ctx.fillStyle = '#fff';
  const ph = st.phase, line = (t, i, x = 34) => ctx.fillText(t, x, ty + 32 + i * 28);
  if (ph === 'menu') wrap(st.flavor.slice(0, Math.floor(st.fshown)), W - 80).forEach((l, i) => line(l, i));
  else if (ph === 'text' || ph === 'win' && st.text) wrap(st.text.slice(0, Math.floor(st.shown)), W - 80).forEach((l, i) => line(l, i));
  else if (ph === 'target') {
    drawHeart(40, ty + 25, 2.4, ACC);
    ctx.fillStyle = st.mercy >= 100 ? '#ffe14d' : '#fff'; line(NAME(), 0, 60);
    font(12, 700); ctx.fillStyle = '#c8c8d0'; ctx.fillText('HP', 380, ty + 18); ctx.fillText('PIEDADE', 500, ty + 18);
    ctx.fillStyle = '#3a1010'; ctx.fillRect(380, ty + 22, 100, 14); ctx.fillStyle = '#4cd964'; ctx.fillRect(380, ty + 22, 100 * st.ehp / st.emax, 14);
    ctx.fillStyle = '#3a2a10'; ctx.fillRect(500, ty + 22, 100, 14); ctx.fillStyle = '#ffe14d'; ctx.fillRect(500, ty + 22, st.mercy, 14);
    font(11, 700); ctx.fillStyle = '#121214'; ctx.fillText(`${Math.round(100 * st.ehp / st.emax)}%`, 384, ty + 33); ctx.fillText(`${st.mercy}%`, 504, ty + 33);
  }
  else if (ph === 'act' || ph === 'item') {
    const acts = ACTS(), opts = ph === 'act' ? acts.map((a, i) => ({ t: a, dim: i === acts.length - 1 && st.tp < 50 })) : st.inv.map(it => ({ t: `${it.n} x${it.q}`, dim: it.q <= 0 }));
    opts.forEach((o, i) => {
      const cx = 60 + (i % 2) * 280, cy = ty + 32 + Math.floor(i / 2) * 30;
      ctx.fillStyle = o.dim ? '#66666e' : '#fff'; ctx.fillText(o.t, cx, cy);
      if (i === st.sub) drawHeart(cx - 22, cy - 7, 2.4, ACC);
    });
  }
  else if (ph === 'fight' && st.bar) {
    const b = st.bar, by = ty + 18, bh = 48;
    ctx.fillStyle = '#121214'; ctx.fillRect(40, by, W - 80, bh);
    ctx.strokeStyle = ACC; ctx.lineWidth = 2; ctx.strokeRect(40, by, W - 80, bh);
    ctx.fillStyle = 'rgba(255,176,46,.25)'; ctx.fillRect(b.target - 18, by + 2, 36, bh - 4);
    ctx.fillStyle = ACC2; ctx.fillRect(b.target - 2, by + 2, 4, bh - 4);
    ctx.fillStyle = '#fff'; ctx.fillRect(b.x - 4, by - 4, 8, bh + 8);
    font(13, 600); ctx.fillStyle = '#c8c8d0'; ctx.fillText('Aperte Z quando a barra branca passar pela linha laranja', 40, by + bh + 22);
  }
  font(11, 600); ctx.fillStyle = '#66666e';
  if (ph === 'menu') ctx.fillText('←→ escolher   Z confirmar   ESC fugir', W - 250, H - 16);
  else if (ph === 'target' || ph === 'act' || ph === 'item') ctx.fillText('Z confirmar   X voltar', W - 150, H - 16);
  else if (ph === 'dodge') ctx.fillText('Setas/WASD: mova o coração · raspe nos tiros para ganhar TP', 200, H - 16);
}
function drawDodge() {
  const B = BOX, k = ease(st.boxT);
  const cx = B.x + B.w / 2, cy = B.y + B.h / 2, w = B.w * k, h = B.h * k;
  ctx.fillStyle = '#000'; ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.strokeStyle = ACC; ctx.lineWidth = 3; ctx.strokeRect(cx - w / 2, cy - h / 2, w, h);
  if (k < 1) return;
  ctx.save(); ctx.beginPath(); ctx.rect(B.x, B.y, B.w, B.h); ctx.clip();
  for (const b of st.bullets) {
    if (b.k === 'bit') { font(16, 700); ctx.fillStyle = '#ecedf2'; ctx.textAlign = 'center'; ctx.fillText(b.ch, b.x, b.y + 6); ctx.textAlign = 'left' }
    else if (b.k === 'folder') { ctx.fillStyle = '#d39a2a'; ctx.fillRect(b.x - 8, b.y - 8, 7, 3); ctx.fillStyle = '#f2b84b'; ctx.fillRect(b.x - 8, b.y - 6, 16, 13) }
    else if (b.k === 'bar') {
      ctx.fillStyle = b.zip ? '#e0a43a' : '#ecedf2'; ctx.fillRect(b.x, B.y, b.w, b.gy - B.y); ctx.fillRect(b.x, b.gy + b.gh, b.w, B.y + B.h - b.gy - b.gh);
      if (b.zip) { ctx.fillStyle = '#6b6b75'; for (let y = B.y; y < B.y + B.h; y += 6) if (y < b.gy || y > b.gy + b.gh) ctx.fillRect(b.x + 4, y, 6, 3) }   // dentes do zíper
      else { ctx.fillStyle = ACC; ctx.fillRect(b.x + 3, B.y, 3, b.gy - B.y); ctx.fillRect(b.x + 3, b.gy + b.gh, 3, B.y + B.h - b.gy - b.gh) }
    } else if (b.k === 'gear') {
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(st.t * 8); ctx.fillStyle = '#c8c8d0';
      for (let i = 0; i < 6; i++) { ctx.rotate(Math.PI / 3); ctx.fillRect(-2, -9, 4, 18) }
      ctx.beginPath(); ctx.arc(0, 0, 6, 0, 7); ctx.fill(); ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 7); ctx.fill(); ctx.restore();
    } else if (b.k === 'note') { font(20, 700); ctx.fillStyle = ACC2; ctx.textAlign = 'center'; ctx.fillText(b.ch, b.x, b.y + 7); ctx.textAlign = 'left' }
    else if (b.k === 'rect') {   // fotograma: moldura com furinhos de filme
      ctx.fillStyle = '#ecedf2'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.fillStyle = '#3b6fa8'; ctx.fillRect(b.x + 4, b.y + 5, b.w - 8, b.h - 10);
      ctx.fillStyle = '#121214'; for (let x = b.x + 3; x < b.x + b.w - 2; x += 7) { ctx.fillRect(x, b.y + 1, 3, 2); ctx.fillRect(x, b.y + b.h - 3, 3, 2) }
    } else if (b.k === 'popup') {
      if (b.t < .6) { if (Math.floor(b.t * 10) % 2 === 0) { ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 2; ctx.strokeRect(b.x, b.y, b.w, b.h); font(16, 700); ctx.fillStyle = '#ff5d5d'; ctx.fillText('!', b.x + b.w / 2 - 3, b.y + b.h / 2 + 6) } }
      else { ctx.fillStyle = '#ecedf2'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.fillStyle = '#ff5d5d'; ctx.fillRect(b.x, b.y, b.w, 9); font(10, 700); ctx.fillStyle = '#121214'; ctx.fillText(st.type === 'exe' ? 'INSTALAR?' : 'ERRO', b.x + 5, b.y + 27) }
    } else if (b.k === 'orb') {
      ctx.fillStyle = b.ring ? '#7dffd0' : st.boss ? '#ff4fd8' : '#ecedf2'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillRect(b.x - 2, b.y - 2, 2, 2);
    } else if (b.k === 'laser') {
      const on = b.t > .7, w = on ? 14 * (.6 + .4 * Math.sin(b.t * 60) ** 2) : 2;
      ctx.globalAlpha = on ? clamp((1.15 - b.t) * 3.5, 0, 1) : Math.floor(b.t * 14) % 2 ? .9 : .3;
      ctx.fillStyle = on ? ACC2 : '#ff5d5d';
      if (b.vert) ctx.fillRect(b.pos - w / 2, B.y, w, B.h); else ctx.fillRect(B.x, b.pos - w / 2, B.w, w);
      if (on) { ctx.fillStyle = '#fff'; const c = w * .4; if (b.vert) ctx.fillRect(b.pos - c / 2, B.y, c, B.h); else ctx.fillRect(B.x, b.pos - c / 2, B.w, c) }
      ctx.globalAlpha = 1;
    } else if (b.k === 'cursor') {
      if (!b.go && Math.floor(b.t * 16) % 2) continue;   // pisca enquanto mira
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.ang);
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, -7); ctx.lineTo(-2, 0); ctx.lineTo(-6, 7); ctx.closePath();
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#121214'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
    }
  }
  if (st.active.includes('spiral')) {   // disco que cospe o leque
    const cx = B.x + B.w / 2, cy = B.y + 10; ctx.save(); ctx.translate(cx, cy); ctx.rotate(st.t * 9);
    ctx.fillStyle = ACC; ctx.beginPath(); ctx.arc(0, 0, 9, 0, 7); ctx.fill(); ctx.fillStyle = '#121214'; for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.fillRect(-1.5, 2, 3, 6) }
    ctx.restore();
  }
  ctx.restore();
  const blink = st.iframes > 0 && Math.floor(st.t * 16) % 2 === 0;
  if (!blink) drawHeart(st.heart.x, st.heart.y, 2.4, ACC);
}
function drawBubble() {
  const b = st.bubble, x = ENEMY_AT.x - 250, y = ENEMY_AT.y - 100, w = 180;
  font(14, 700); const lines = wrap(b.text.slice(0, Math.floor(b.shown)), w - 20);
  const h = 22 + Math.max(1, wrap(b.text, w - 20).length) * 18;
  ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h);
  ctx.beginPath(); ctx.moveTo(x + w, y + h / 2 - 8); ctx.lineTo(x + w + 16, y + h / 2); ctx.lineTo(x + w, y + h / 2 + 8); ctx.fill();
  ctx.fillStyle = '#121214'; lines.forEach((l, i) => ctx.fillText(l, x + 10, y + 22 + i * 18));
}
function drawFx(f) {
  if (f.type === 'num') {
    const k = f.t; ctx.globalAlpha = clamp(1.4 - k * 1.4, 0, 1);
    font(26, 700); ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.textAlign = 'center';
    const y = f.y - k * 40 + Math.abs(Math.sin(k * 9)) * (1 - k) * -10;
    ctx.strokeText(f.text, f.x, y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y); ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  } else if (f.type === 'p') {
    ctx.globalAlpha = clamp(1 - f.t / f.life, 0, 1); ctx.fillStyle = f.c; ctx.fillRect(f.x, f.y, 4, 4); ctx.globalAlpha = 1;
  } else if (f.type === 'slash') {
    const k = f.t / .35; ctx.strokeStyle = ACC2; ctx.lineWidth = 5; ctx.globalAlpha = 1 - k;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(ENEMY_AT.x - 50 + i * 16, ENEMY_AT.y - 50); ctx.lineTo(ENEMY_AT.x - 50 + i * 16 + 100 * Math.min(1, k * 3), ENEMY_AT.y - 50 + 100 * Math.min(1, k * 3)); ctx.stroke() }
    ctx.globalAlpha = 1;
  } else if (f.type === 'graze') {
    ctx.globalAlpha = 1 - f.t / .3; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(f.x, f.y, 10 + f.t * 40, 0, 7); ctx.stroke(); ctx.globalAlpha = 1;
  }
}
function drawLose() {
  ctx.fillStyle = `rgba(0,0,0,${clamp(st.ph / .6, 0, 1)})`; ctx.fillRect(0, 0, W, H);
  const hx = W / 2, hy = 200;
  if (st.ph < .7) drawHeart(hx, hy, 4, ACC);
  else if (st.ph < 1.3) { const d = (st.ph - .7) * 30; drawHeart(hx - d, hy + d * .3, 4, ACC); drawHeart(hx + d, hy + d * .3, 4, ACC) }
  if (st.ph > 1.4) {
    ctx.textAlign = 'center'; font(54, 700); ctx.fillStyle = '#fff'; ctx.fillText('FIM DE JOGO', W / 2, 200);
    font(18, 500); ctx.fillStyle = '#c8c8d0'; ctx.fillText(`${NAME()} venceu e continua no seu disco.`, W / 2, 250);
    font(16, 700); ctx.fillStyle = ACC2; ctx.fillText('Z  tentar de novo        X  desistir', W / 2, 320); ctx.textAlign = 'left';
  }
}

/* ---------------- teclado ---------------- */
const OK = k => k === 'z' || k === 'Z' || k === 'Enter', BACK = k => k === 'x' || k === 'X' || k === 'Shift';
function onKey(e) {
  if (!st) return;
  e.preventDefault(); e.stopPropagation();
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.type === 'keyup') { keys[k] = false; return }
  keys[k] = true; if (e.repeat) return;
  const ph = st.phase;
  if (ph === 'bossintro') { if (OK(k) && st.bi.step === 1) bossAdvance(); return }
  if (ph === 'menu') {
    if (k === 'ArrowLeft' || k === 'a') { st.menu = (st.menu + 4) % 5; SFX.move() }
    else if (k === 'ArrowRight' || k === 'd') { st.menu = (st.menu + 1) % 5; SFX.move() }
    else if (OK(k)) choose();
    else if (k === 'Escape') { SFX.back(); say('* Você fugiu da batalha.\n* O arquivo continua no disco.', () => close(false)) }
  } else if (ph === 'target') {
    if (OK(k)) {
      SFX.ok();
      if (st.mode === 'fight') { st.phase = 'fight'; st.bar = { x: W - 50, v: rnd(330, 400), target: 110 } }
      else { st.phase = 'act'; st.sub = 0 }
    } else if (BACK(k)) { SFX.back(); st.phase = 'menu' }
  } else if (ph === 'act' || ph === 'item') {
    const n = ph === 'act' ? ACTS().length : st.inv.length;
    const mv = d => { st.sub = (st.sub + d + n) % n; SFX.move() };
    if (k === 'ArrowLeft' || k === 'a') mv(-1); else if (k === 'ArrowRight' || k === 'd') mv(1);
    else if (k === 'ArrowUp' || k === 'w') mv(-2); else if (k === 'ArrowDown' || k === 's') mv(2);
    else if (OK(k)) {
      if (ph === 'act') { SFX.ok(); doAct(st.sub) }
      else if (st.inv[st.sub].q > 0) useItem(st.sub); else SFX.back();
    } else if (BACK(k)) { SFX.back(); st.phase = ph === 'act' ? 'target' : 'menu' }
  } else if (ph === 'fight' && OK(k) && st.bar) strike();
  else if (ph === 'text' && OK(k)) { if (st.shown < st.text.length) st.shown = st.text.length; else st.after() }
  else if (ph === 'bubble' && OK(k)) { st.bubble = null; startDodge() }
  else if (ph === 'lose' && st.ph > 1.4) { if (OK(k)) restart(); else if (BACK(k) || k === 'Escape') close(false) }
}

/* ---------------- início e fim ---------------- */
function frame(now) {
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  if (!st) return;
  update(dt); if (st) draw();
  raf = requestAnimationFrame(frame);
}
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H), dpr = devicePixelRatio || 1;
  cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
  cv.width = Math.round(W * s * dpr); cv.height = Math.round(H * s * dpr);
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0); ctx.imageSmoothingEnabled = false;
}
function toCanvas(px, py) { const r = cv.getBoundingClientRect(); return { x: (px - r.left) * W / r.width, y: (py - r.top) * H / r.height } }
let onEnd = null;
function close(won) {
  stopMusic(); cancelAnimationFrame(raf); st = null; keys = {};
  removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKey, true); removeEventListener('resize', fit);
  root.remove(); onEnd && onEnd(won);
}

// info: {name, kind: 'file'|'dir', total, count}; rect: posição da linha clicada na tela; end(won) é chamado no fim
window.Batalha = {
  async start(info, rect, end) {
    if (st) return;
    onEnd = end;
    const cs = getComputedStyle(document.documentElement);
    ACC = cs.getPropertyValue('--accent').trim() || ACC; ACC2 = cs.getPropertyValue('--accent2').trim() || ACC2;
    try { await Promise.race([document.fonts.load(`20px "Pixelify Sans"`), new Promise(r => setTimeout(r, 800))]) } catch {}
    root = Object.assign(document.createElement('div'), { id: 'battle' });
    root.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:transparent';
    cv = document.createElement('canvas'); root.appendChild(cv); document.body.appendChild(root);
    ctx = cv.getContext('2d'); fit();
    const a = rect ? toCanvas(rect.left + 60, rect.top + rect.height / 2) : { x: 120, y: 200 };
    const b = rect ? toCanvas(rect.right - 160, rect.top + rect.height / 2) : { x: 500, y: 200 };
    st = newState({ ...info, from: { hx: a.x - 24, hy: a.y - 36, ex: b.x, ey: b.y } });
    if (st.boss) st.bi = { step: 0, t: 0, line: 0, shown: 0, lines: bossLines(), orbs: [] };
    addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true); addEventListener('resize', fit);
    if (st.boss) noise(.8, .1, 300, 3000); else { SFX.alert(); startMusic() }   // chefão: a música só entra depois da fala
    last = performance.now(); raf = requestAnimationFrame(frame);
  },
  // usados pela segunda batalha (batalha2.js): mesmo desenho e mesma classificação de inimigos
  typeOf,
  draw(c, cx, cy, o) { const old = ctx; ctx = c; drawEnemy(cx, cy, o); ctx = old },
};
})();
