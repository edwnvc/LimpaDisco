// Quarta batalha: estilo RPG psicodélico dos anos 90, em primeira pessoa. Entrada em espiral, fundo que ondula
// linha a linha com as cores girando, caixas de texto com "•" e o contador de vida que rola: depois de um golpe
// mortal ainda dá para vencer antes de ele chegar a zero. Arte, textos, música e sons próprios.
(() => {
'use strict';
const W = 256, H = 224, FONT = '"Pixelify Sans", monospace';   // tudo é desenhado em 256x224 e ampliado sem suavizar
const PAL = {   // cores do fundo de cada tipo de arquivo
  doc: ['#2a1450', '#5a2a9a', '#9a5ad8', '#e0a8ff', '#5a2a9a'], dir: ['#0e3a1a', '#1f7a3a', '#5ac85a', '#d8ff8a', '#1f7a3a'],
  zip: ['#4a1a08', '#a8481a', '#f09030', '#ffe080', '#a8481a'], exe: ['#081a4a', '#1a4aa8', '#3a9af0', '#a8f0ff', '#1a4aa8'],
  media: ['#4a0830', '#a81a6a', '#f05aa8', '#ffc0e0', '#a81a6a'], boss: ['#300000', '#8a0a0a', '#e02a1a', '#ffb000', '#8a0a0a'],
};
const MOVES = {
  doc: ['jogou um parágrafo inteiro em você', 'mudou sua fonte para Comic Sans'], dir: ['abriu uma subpasta sem fim', 'criou a "Nova Pasta (7)"'],
  zip: ['se compactou e quicou em você', 'pediu uma senha esquecida'], exe: ['mostrou uma tela azul', 'pediu para reiniciar AGORA'],
  media: ['tocou no volume máximo', 'travou em 99%'],
};
let cv, ctx, L, lc, root, S = null, raf = 0, last = 0, actx = null, onEnd = null, loop = null;
const T = document.createElement('canvas'); T.width = T.height = 32; const tc = T.getContext('2d');   // ladrilho do fundo

const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v)), pick = a => a[Math.floor(Math.random() * a.length)];
const fmt = b => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++ } return (i ? b.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : b) + ' ' + u[i] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- som: efeitos e uma musiquinha em loop, tudo sintetizado ---------------- */
function ac() { return actx || (actx = new AudioContext()) }
function tone(f, d = .06, type = 'square', v = .05, f2 = 0, at = 0) {
  const a = ac(), o = a.createOscillator(), g = a.createGain(), t = (at || a.currentTime);
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(1e-4, t + d);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + .02);
}
const SFX = {
  move: () => tone(900, .03, 'square', .04), ok: () => tone(660, .05, 'square', .05, 990), back: () => tone(500, .05, 'square', .04, 330),
  blip: () => tone(1200, .015, 'square', .02), hit: () => { tone(180, .15, 'sawtooth', .1, 60); tone(90, .2, 'square', .08) },
  smash: () => { [0, 60, 120].forEach(d => setTimeout(() => tone(140, .25, 'sawtooth', .12, 40), d)); tone(2400, .3, 'square', .05, 300) },
  hurt: () => { tone(300, .12, 'square', .09, 80); setTimeout(() => tone(200, .15, 'square', .08, 60), 90) },
  psi: () => [880, 1320, 1760, 2640].forEach((f, i) => setTimeout(() => tone(f, .12, 'triangle', .06, f / 2), i * 50)),
  heal: () => [523, 784, 1046, 1568].forEach((f, i) => setTimeout(() => tone(f, .1, 'triangle', .06), i * 70)),
  swirl: () => { tone(200, 1, 'sawtooth', .05, 1600); tone(203, 1, 'square', .03, 1620) },
  miss: () => tone(1500, .1, 'triangle', .04, 2400), mortal: () => [440, 415, 392, 370].forEach((f, i) => setTimeout(() => tone(f, .14, 'square', .06), i * 110)),
  win: () => [523, 659, 784, 1046, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, i === 6 ? .5 : .12, 'square', .06), i * 120)),
};
function startLoop() {   // baixo saltitante + arpejo, 150 bpm; agenda um pouco à frente para não engasgar
  const a = ac(), step = 60 / 150 / 2, bass = [110, 0, 110, 131, 0, 147, 131, 0, 98, 0, 98, 123, 0, 131, 147, 165], arp = [440, 554, 659, 880, 659, 554];
  let n = 0, next = a.currentTime + .1;
  loop = setInterval(() => {
    while (next < a.currentTime + .25) {
      const b = bass[n % 16]; if (b) tone(b * (S && S.boss ? .94 : 1), step * .9, 'square', .035, 0, next);
      if (n % 2 === 0) tone(arp[(n / 2) % arp.length] * (n % 32 < 16 ? 1 : 1.122), step * .5, 'triangle', .025, 0, next);
      next += step; n++;
    }
  }, 60);
}
function stopLoop() { clearInterval(loop); loop = null }

/* ---------------- roteiro ---------------- */
function say(text) { S.text = text; S.shown = 0; return new Promise(r => S.wait = r) }               // espera Z
async function note(text, ms = 450) { S.text = text; S.shown = 0; await sleep(text.length * 22 + ms) }   // passa sozinho
function menu(opts, back = false, cols = 2) { return new Promise(r => S.menu = { opts, i: 0, back, cols, done: v => { S.menu = null; r(v) } }) }
function tween(obj, key, to, ms) { return new Promise(res => S.tweens.push({ obj, key, from: obj[key], to, t: 0, d: ms / 1000, res })) }
const hurtMe = d => { S.hp = Math.max(0, S.hp - d); S.shake = .35; S.red = .3; SFX.hurt() };

async function run() {
  if (!S.retry) {
    SFX.swirl(); await tween(S, 'swirl', 1, 1100);                                   // espiral cobre a tela
    S.scene = true; await tween(S, 'swirl', 2, 500);                                  // e se desfaz já na batalha
    await say(`• Você topou com ${S.name}!`);
  } else await say(`• ${S.name} ainda está aqui!`);
  for (;;) {
    if (S.dead) return defeat();
    S.active = true;
    const a = await menu(['Bater', 'Poder', 'Itens', 'Defender', 'Fugir']);
    S.active = false; S.defend = false;
    if (S.dead) return defeat();
    if (a === 0) {
      await note('• Você bateu!', 150);
      if (Math.random() < .08) { SFX.miss(); await say('• Errou por pouco!') }
      else {
        const smash = Math.random() < .22, d = Math.round(rnd(16, 22) * (smash ? 2.6 : 1));
        if (smash) { S.smash = 1.2; SFX.smash() } else SFX.hit();
        S.blink = .5; S.ehp -= d; await sleep(smash ? 900 : 450);
        await say(`• ${S.name} perdeu ${d} de vida!`);
      }
    } else if (a === 1) {
      const P = [['Faxina α', 4], ['Faxina β', 9], ['Cura α', 5]];
      const m = await menu(P.map(([n, c]) => `${n}  ${c} PP`), true, 1); if (m < 0) continue;
      const [n, c] = P[m];
      if (S.pp < c) { SFX.back(); await say('• Você não tem PP suficiente!'); continue }
      S.pp -= c; await note(`• Você tentou ${n}!`, 150); SFX.psi(); S.psi = 1;
      if (m === 2) { const h = Math.min(40, S.max - S.hp); S.hp += h; await sleep(600); SFX.heal(); await say(`• Você recuperou ${h} de vida!`) }
      else { const d = Math.round(m ? rnd(50, 62) : rnd(26, 32)); await sleep(800); S.blink = .5; S.ehp -= d; SFX.hit(); await say(`• ${S.name} perdeu ${d} de vida!`) }
    } else if (a === 2) {
      const it = S.items.filter(x => x.q > 0); if (!it.length) { await say('• Sua mochila está vazia.'); continue }
      const m = await menu(it.map(x => `${x.n} x${x.q}`), true, 1); if (m < 0) continue;
      const x = it[m]; x.q--;
      if (x.pp) { const g = Math.min(x.pp, S.maxpp - S.pp); S.pp += g; SFX.heal(); await say(`• Você tomou ${x.n}.\n• Recuperou ${g} PP!`) }
      else { const h = Math.min(x.hp, S.max - S.hp); S.hp += h; SFX.heal(); await say(`• Você comeu ${x.n}.\n• Recuperou ${h} de vida!`) }
    } else if (a === 3) { S.defend = true; await say('• Você se protegeu.') }
    else {
      await note('• Você tentou fugir...', 300);
      if (Math.random() < .65) { await say('• E conseguiu! O arquivo continua no disco.'); return close(false) }
      await say('• Mas não deu!');
    }
    if (S.ehp <= 0) return victory();

    // vez do arquivo
    await note(`• ${S.name} ${pick(MOVES[S.type])}!`, 300);
    if (Math.random() < .1) { SFX.miss(); await say('• Mas você desviou rapidinho!') }
    else {
      const d = Math.round(S.atk * rnd(.85, 1.15) * (S.defend ? .5 : 1)); hurtMe(d);
      await say(`• Você levou ${d} de dano!` + (S.hp <= 0 ? '\n• Dano mortal! Vença antes que o contador zere!' : ''));
      if (S.hp <= 0) SFX.mortal();
    }
    if (S.dead) return defeat();
  }
}
async function victory() {
  S.won = true; S.text = ''; stopLoop(); await tween(S, 'efade', 0, 900);
  SFX.win();
  await say(`• Você derrotou ${S.name}!`);
  await say(`• ${S.name} foi para a Lixeira.\n• ${fmt(S.info.total)} liberados!`);
  close(true);
}
async function defeat() {   // o contador chegou a zero
  S.over = true; stopLoop(); SFX.mortal();
  await say('• Você desmaiou...');
  if (await menu(['Tentar de novo', 'Desistir'], false, 1) !== 0) { await say(`• ${S.name} continua no seu disco.`); return close(false) }
  Object.assign(S, { hp: S.max, hpD: S.max, pp: S.maxpp, ppD: S.maxpp, ehp: S.emax, over: false, dead: false, retry: true }); startLoop(); run();
}

/* ---------------- desenho ---------------- */
function font(px, w = 600) { lc.font = `${w} ${px}px ${FONT}` }
function win(x, y, w, h) {   // janela preta de borda branca dupla e cantos arredondados
  lc.fillStyle = '#000'; lc.beginPath(); lc.roundRect(x, y, w, h, 4); lc.fill();
  lc.strokeStyle = '#fff'; lc.lineWidth = 1; lc.beginPath(); lc.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 3); lc.stroke();
  lc.strokeStyle = '#8a8a9a'; lc.beginPath(); lc.roundRect(x + 3.5, y + 3.5, w - 7, h - 7, 2); lc.stroke();
}
function background(t) {
  const pal = S.boss ? PAL.boss : PAL[S.type], k = Math.floor(t * 7);
  tc.fillStyle = pal[k % pal.length]; tc.fillRect(0, 0, 32, 32);   // cantos do ladrilho também pintados (senão vaza o quadro anterior)
  for (let i = 8; i > 0; i--) {   // losangos concêntricos com as cores girando
    tc.fillStyle = pal[(i + k) % pal.length]; const r = i * 2;
    tc.beginPath(); tc.moveTo(16, 16 - r); tc.lineTo(16 + r, 16); tc.lineTo(16, 16 + r); tc.lineTo(16 - r, 16); tc.fill();
  }
  const pat = lc.createPattern(T, 'repeat');
  for (let y = 0; y < H; y++) {   // linhas pares e ímpares ondulam para lados opostos (entrelaçado)
    const odd = y & 1, dx = Math.sin(y * .045 + t * (odd ? 2.1 : -1.7)) * (odd ? 18 : 12) + t * (odd ? 9 : -6), dy = Math.sin(y * .02 + t * 1.3) * 10 - t * 7;
    pat.setTransform(new DOMMatrix().translate(dx, dy)); lc.fillStyle = pat; lc.fillRect(0, y, W, 1);
  }
}
function odo(x, y, v) {   // contador de 3 dígitos; o das unidades rola de verdade
  const n = Math.max(0, v), ip = Math.floor(n), f = n - ip;
  font(12, 700); lc.fillStyle = '#121214'; lc.fillRect(x, y, 24, 13);
  const s = String(ip).padStart(3, '0');
  lc.save(); lc.beginPath(); lc.rect(x, y, 24, 13); lc.clip(); lc.fillStyle = '#fff';
  lc.fillText(s[0], x + 2, y + 11); lc.fillText(s[1], x + 9, y + 11);
  lc.fillText(s[2], x + 16, y + 11 + f * 12); lc.fillText(String((ip + 1) % 10), x + 16, y - 1 + f * 12);
  lc.restore();
}
function wrap(text, maxW) {
  const out = [];
  for (const para of text.split('\n')) { let line = ''; for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (lc.measureText(t).width > maxW && line) { out.push(line); line = '  ' + w } else line = t } out.push(line) }
  return out;
}
function draw() {
  const t = S.t;
  lc.setTransform(1, 0, 0, 1, 0, 0);
  if (S.scene) {
    if (S.shake > 0) lc.setTransform(1, 0, 0, 1, Math.round(rnd(-3, 3) * S.shake * 3), 0);
    background(t);
    if (S.psi > 0) { lc.globalCompositeOperation = 'lighter'; lc.fillStyle = `hsla(${t * 900 % 360},100%,60%,${S.psi * .5})`; lc.fillRect(0, 0, W, H); lc.globalCompositeOperation = 'source-over' }
    const show = S.efade > 0 && !(S.blink > 0 && Math.floor(t * 20) % 2);
    if (show) {   // o arquivo, piscando quando apanha e sumindo em pontilhado quando é derrotado
      lc.globalAlpha = S.efade; Batalha.draw(lc, 128, 108 + Math.sin(t * 2) * 2, { kind: S.type, boss: S.boss, t, scale: S.boss ? 1.05 : .9 });
      if (S.efade < 1) { lc.fillStyle = '#000'; for (let y = 0; y < H; y += 2) for (let x = (y / 2) % 2; x < W; x += 2) if (Math.random() > S.efade) lc.fillRect(x, y, 1, 1) }
      lc.globalAlpha = 1;
    }
    if (S.smash > 0) {   // acerto crítico
      font(26, 700); lc.textAlign = 'center'; const j = rnd(-1, 1);
      lc.fillStyle = '#000'; lc.fillText('SMAAAASH!!', 129 + j, 113); lc.fillStyle = Math.floor(t * 16) % 2 ? '#ffe14d' : '#ff5d5d'; lc.fillText('SMAAAASH!!', 128 + j, 112); lc.textAlign = 'left';
    }
    // vida e PP (sobe um pouco quando é a sua vez)
    const bx = 96, by = 166 - (S.active ? 6 : 0) + (S.hpD <= 0 ? 4 : 0);
    win(bx, by, 64, 52); lc.fillStyle = S.hp <= 0 ? '#ff5d5d' : '#fff'; font(11, 700); lc.fillText('VOCÊ', bx + 8, by + 15);
    font(9, 700); lc.fillStyle = '#c8c8d0'; lc.fillText('HP', bx + 8, by + 30); lc.fillText('PP', bx + 8, by + 45);
    odo(bx + 30, by + 20, S.hpD); odo(bx + 30, by + 35, S.ppD);
    // texto ou menu
    const m = S.menu;
    if (m || S.text) {
      win(6, 6, W - 12, 54); font(11, 600); lc.fillStyle = '#fff';
      if (m) m.opts.forEach((o, i) => {
        const x = 22 + (i % m.cols) * 112, y = 22 + Math.floor(i / m.cols) * 14;
        lc.fillStyle = '#fff'; lc.fillText(o, x, y);
        if (i === m.i && Math.floor(t * 4) % 2) { lc.fillStyle = '#ffe14d'; lc.beginPath(); lc.moveTo(x - 10, y - 8); lc.lineTo(x - 4, y - 4); lc.lineTo(x - 10, y); lc.fill() }
      });
      else wrap(S.text.slice(0, Math.floor(S.shown)), W - 36).forEach((l, i) => lc.fillText(l, 16, 22 + i * 14));
      if (!m && S.wait && S.shown >= S.text.length && Math.floor(t * 3) % 2) { lc.fillStyle = '#fff'; lc.beginPath(); lc.moveTo(236, 50); lc.lineTo(244, 50); lc.lineTo(240, 54); lc.fill() }
    }
    if (S.red > 0) { lc.fillStyle = `rgba(255,40,40,${S.red})`; lc.fillRect(0, 0, W, H) }
  } else { lc.clearRect(0, 0, W, H) }
  if (S.swirl > 0 && S.swirl < 2) {   // espiral de entrada: braços coloridos girando e engrossando até cobrir a tela
    const k = S.swirl <= 1 ? S.swirl : 2 - S.swirl, cols = S.boss ? ['#e02a1a', '#000'] : ['#ffe14d', '#3a9af0', '#f05aa8', '#5ac85a'];
    lc.save(); lc.translate(W / 2, H / 2); lc.rotate(t * 7);
    for (let a = 0; a < 6; a++) {
      lc.fillStyle = cols[a % cols.length]; lc.beginPath();
      for (let r = 0; r < 200; r += 4) { const th = a * Math.PI / 3 + r * .05; lc.lineTo(Math.cos(th) * r, Math.sin(th) * r) }
      for (let r = 196; r >= 0; r -= 4) { const th = a * Math.PI / 3 + r * .05 + k * 1.2; lc.lineTo(Math.cos(th) * r, Math.sin(th) * r) }
      lc.fill();
    }
    lc.restore();
    if (S.swirl > 1) { lc.fillStyle = `rgba(0,0,0,${2 - S.swirl})`; lc.fillRect(0, 0, W, H) }
  }
  ctx.clearRect(0, 0, cv.width, cv.height); ctx.imageSmoothingEnabled = false; ctx.drawImage(L, 0, 0, cv.width, cv.height);
}

/* ---------------- laço, teclado, início e fim ---------------- */
function frame(now) {
  if (!S) return;
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  S.t += dt; for (const k of ['shake', 'red', 'blink', 'smash', 'psi']) S[k] = Math.max(0, S[k] - dt);
  if (S.shown < S.text.length) { const b = Math.floor(S.shown); S.shown += dt * 45; if (Math.floor(S.shown) > b && b % 2 === 0) SFX.blip() }
  // o contador de vida rola devagar até o valor de verdade (cura sobe mais rápido); se chegar a zero, acabou
  S.hpD += clamp(S.hp - S.hpD, -dt * 9, dt * 40); S.ppD += clamp(S.pp - S.ppD, -dt * 12, dt * 30);
  if (S.hpD <= 0 && !S.dead && !S.won) {   // zerou: avisa o roteiro (ele decide num ponto seguro) e solta o que estiver esperando
    S.dead = true; if (S.menu) S.menu.done(-9); else if (S.wait) { const r = S.wait; S.wait = null; r() }
  }
  for (const tw of S.tweens) { tw.t += dt; const k = Math.min(1, tw.t / tw.d); tw.obj[tw.key] = tw.from + (tw.to - tw.from) * k; if (k >= 1) tw.res() }
  S.tweens = S.tweens.filter(tw => tw.t < tw.d);
  draw();
  raf = requestAnimationFrame(frame);
}
function onKey(e) {
  if (!S) return;
  e.preventDefault(); e.stopPropagation(); if (e.repeat) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, ok = k === 'z' || k === 'Enter' || k === ' ', back = k === 'x' || k === 'Escape' || k === 'Backspace';
  const m = S.menu;
  if (m) {
    const n = m.opts.length, c = m.cols;
    let j = m.i;
    if (k === 'ArrowRight' || k === 'd') j = Math.min(n - 1, m.i + 1); else if (k === 'ArrowLeft' || k === 'a') j = Math.max(0, m.i - 1);
    else if (k === 'ArrowDown' || k === 's') j = m.i + c < n ? m.i + c : m.i; else if (k === 'ArrowUp' || k === 'w') j = m.i - c >= 0 ? m.i - c : m.i;
    if (j !== m.i) { m.i = j; SFX.move() } else if (ok) { SFX.ok(); m.done(m.i) } else if (back && m.back) { SFX.back(); m.done(-1) }
  } else if (S.wait && ok) {
    if (S.shown < S.text.length) S.shown = S.text.length; else { const r = S.wait; S.wait = null; r() }
  }
}
function fit() {
  const s = Math.max(1, Math.floor(Math.min(innerWidth / W, innerHeight / H) * 4) / 4), dpr = devicePixelRatio || 1;
  cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px'; cv.width = Math.round(W * s * dpr); cv.height = Math.round(H * s * dpr);
}
function close(won) {
  stopLoop(); cancelAnimationFrame(raf); S = null;
  removeEventListener('keydown', onKey, true); removeEventListener('resize', fit);
  root.remove(); onEnd && onEnd(won);
}

// Mesma assinatura das outras batalhas: info {name, file, kind, total, count}; end(won) no fim.
window.Batalha4 = {
  async start(info, rect, end) {
    if (S) return;
    onEnd = end;
    try { await Promise.race([document.fonts.load('12px "Pixelify Sans"'), sleep(800)]) } catch {}
    root = document.createElement('div'); root.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#000';
    cv = document.createElement('canvas'); root.appendChild(cv); document.body.appendChild(root);
    ctx = cv.getContext('2d'); L = document.createElement('canvas'); L.width = W; L.height = H; lc = L.getContext('2d'); fit();
    const lv = Math.log2(1 + info.total / 1048576), boss = info.total >= 1024 ** 3;   // mesma escala de dificuldade das outras batalhas
    const emax = Math.round(clamp(40 + lv * 8, 40, 160) * (boss ? 1.5 : 1) * 1.3);
    const n = info.name.length > 18 ? info.name.slice(0, 17) + '…' : info.name;
    S = {
      info, name: (boss ? '★ ' : '') + n, boss, t: 0, tweens: [], text: '', shown: 0, wait: null, menu: null,
      type: info.count > 1 ? (info.kind === 'dir' ? 'dir' : 'doc') : Batalha.typeOf(info.file || info.name, info.kind),
      max: 90, hp: 90, hpD: 90, maxpp: 24, pp: 24, ppD: 24, emax, ehp: emax, atk: 13 + Math.min(14, lv * 1.2),
      items: [{ n: 'Biscoito', hp: 35, q: 2 }, { n: 'Refrigerante', pp: 12, q: 1 }],
      swirl: 0, scene: false, efade: 1, blink: 0, smash: 0, psi: 0, shake: 0, red: 0, active: false, defend: false, over: false, won: false,
    };
    addEventListener('keydown', onKey, true); addEventListener('resize', fit);
    startLoop();
    last = performance.now(); raf = requestAnimationFrame(frame);
    run();
  },
};
})();
