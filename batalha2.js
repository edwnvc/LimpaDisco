// Segunda batalha: duelo de monstrinhos por turnos. O Clawd luta contra o arquivo; vencer ou
// prender o arquivo na LIXEIRA manda ele para a Lixeira de verdade. Arte, textos e sons próprios.
(() => {
'use strict';
const W = 640, H = 480, FONT = '"Pixelify Sans", monospace', INK = '#1d1d21', PAPER = '#f3f1ea', CLAWD_C = '#d97757';
const CLAWD = ['..XXXXXXXX..', '..XoXXXXoX..', 'XXXXXXXXXXXX', 'XXXXXXXXXXXX', '..XXXXXXXX..', '..XXXXXXXX..', '..X.X..X.X..', '..X.X..X.X..'];
// strong: tipos de arquivo contra os quais o golpe é super eficaz
const MOVES = [
  { n: 'Garrada', pow: 40, acc: 1, strong: ['dir', 'media', 'zip'] },
  { n: 'Compilar', pow: 55, acc: .9, strong: ['exe', 'doc'] },
  { n: 'Debugar', pow: 0, acc: 1, strong: [] },          // baixa o ataque do inimigo
  { n: 'rm -rf', pow: 95, acc: .6, strong: [] },         // forte, mas erra bastante
];
const ENEMY_MOVES = {
  doc: ['Parede de Texto', 'Fonte Cômica'], dir: ['Subpasta Infinita', 'Nova Pasta (2)'], zip: ['Compressão', 'Senha Esquecida'],
  exe: ['Tela Azul', 'Atualização Forçada'], media: ['Volume Máximo', 'Carregando...'],
};
let cv, ctx, root, S = null, raf = 0, last = 0, actx = null, music = null, gain = null, onEnd = null;

const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = b => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++ } return (i ? b.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : b) + ' ' + u[i] };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- som ---------------- */
function ac() { return actx || (actx = new AudioContext()) }
function tone(f, d = .06, type = 'square', v = .05, f2 = 0) {
  const a = ac(), o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
  g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(1e-4, t + d);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + d + .02);
}
const SFX = {
  move: () => tone(700, .035), ok: () => tone(880, .06, 'square', .05, 1320), back: () => tone(440, .06, 'square', .045, 300),
  hit: () => tone(260, .16, 'sawtooth', .09, 70), strong: () => { tone(400, .1, 'sawtooth', .09, 90); setTimeout(() => tone(900, .12, 'square', .06, 1400), 90) },
  miss: () => tone(300, .15, 'triangle', .05, 200), heal: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .08), i * 60)),
  pop: () => tone(300, .12, 'square', .07, 1200), shake: () => tone(180, .05, 'square', .06), cry: () => tone(900, .25, 'sawtooth', .05, 300),
  win: () => [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => tone(f, .12), i * 95)), faint: () => tone(500, .5, 'sawtooth', .07, 60),
};
async function startMusic() {
  try {
    const r = await fetch('musica2', { cache: 'no-store' }); if (!r.ok || !S) return;   
    const buf = await ac().decodeAudioData(await r.arrayBuffer()); if (!S) return;
    if (ac().state === 'suspended') await ac().resume();
    music = ac().createBufferSource(); music.buffer = buf; music.loop = true;
    gain = ac().createGain(); gain.gain.value = .12;
    music.connect(gain).connect(ac().destination); music.start();
  } catch { window.toast && toast('Não consegui tocar a música do duelo.', true) }
}
function stopMusic() { if (!music) return; const m = music; gain.gain.setTargetAtTime(0, ac().currentTime, .15); setTimeout(() => { try { m.stop() } catch {} }, 900); music = null }

/* ---------------- roteiro: funções que esperam (texto, menu, animação) ---------------- */
function say(text) { S.text = text; S.shown = 0; return new Promise(r => S.wait = r) }               // espera Z
async function note(text, ms = 500) { S.text = text; S.shown = 0; await sleep(text.length * 16 + ms) }   // passa sozinho
function menu(opts, back = false, i = 0) { return new Promise(r => S.menu = { opts, i, back, done: v => { S.menu = null; r(v) } }) }
function tween(obj, key, to, ms) { return new Promise(res => S.tweens.push({ obj, key, from: obj[key], to, t: 0, d: ms / 1000, res })) }

async function run() {
  const name = S.name, e = S;
  await tween(S, 'wipe', 1, 550);                       // faixas pretas fecham a tela
  S.scene = true; await tween(S, 'wipe', 0, 450);       // e abrem já no campo de batalha
  SFX.cry(); await tween(S, 'ex', 0, 500);
  await say(`Um ${name} selvagem apareceu!`);
  S.text = 'Vai, CLAWD!'; S.shown = 99; SFX.pop(); await tween(S, 'cs', 1.15, 180); await tween(S, 'cs', 1, 120);
  await sleep(350);
  for (;;) {
    const a = await menu(['LUTAR', 'LIXEIRA', `CAFÉ x${S.coffee}`, 'FUGIR']);
    if (a === 0) {
      const m = await menu(MOVES.map(x => x.n), true);
      if (m < 0) continue;
      await playerMove(MOVES[m]);
      if (S.ehp <= 0) {
        SFX.faint(); await Promise.all([tween(S, 'ey', 90, 500), tween(S, 'ea', 0, 500)]);
        stopMusic(); SFX.win(); S.happy = true;
        await say(`${name} desmaiou!`); await say(`CLAWD varreu ${name} para a Lixeira.\n${fmt(S.info.total)} liberados!`);
        return close(true);
      }
    } else if (a === 1) {
      if (await capture()) { stopMusic(); SFX.win(); S.happy = true; await say(`Pronto! ${name} foi pego na LIXEIRA!\n${fmt(S.info.total)} liberados!`); return close(true) }
    } else if (a === 2) {
      if (!S.coffee) { await say('O café acabou!'); continue }
      S.coffee--; const before = S.hp; S.hp = Math.min(S.maxhp, S.hp + 50); SFX.heal();
      await say(`CLAWD tomou um café.\nRecuperou ${S.hp - before} de energia!`);
    } else { await say('Você fugiu em segurança!\nO arquivo continua no disco.'); return close(false) }

    // vez do inimigo
    const mv = ENEMY_MOVES[S.type][Math.floor(rnd(0, 2))];
    await note(`${name} usou ${mv}!`, 250);
    await tween(S, 'ex', -40, 110); await tween(S, 'ex', 0, 140);
    if (Math.random() < .1) { SFX.miss(); await say('Mas errou!') }
    else {
      const dmg = Math.round(S.eatk * S.eatkMul * rnd(.85, 1.15));
      S.hp = Math.max(0, S.hp - dmg); S.cflash = .45; SFX.hit(); await sleep(650);
    }
    if (S.hp <= 0) {
      SFX.faint(); await tween(S, 'cs', 0, 400);
      await say('CLAWD ficou sem energia...');
      if (await menu(['DE NOVO', 'DESISTIR']) !== 0) { await say(`${name} continua no seu disco.`); return close(false) }
      Object.assign(S, { hp: S.maxhp, ehp: S.emax, eatkMul: 1, coffee: 2 }); SFX.pop(); await tween(S, 'cs', 1, 250);
    }
  }
}
async function playerMove(m) {
  await note(`CLAWD usou ${m.n}!`, 250);
  await tween(S, 'cx', 46, 110); await tween(S, 'cx', 0, 140);
  if (Math.random() > m.acc) { SFX.miss(); return say('Mas errou!') }
  if (!m.pow) { S.eatkMul = Math.max(.4, S.eatkMul * .7); SFX.heal(); return say(`CLAWD achou os bugs de ${S.name}.\nO ataque dele diminuiu!`) }
  const strong = m.strong.includes(S.type), crit = Math.random() < .1;
  const dmg = Math.round(m.pow * .6 * rnd(.85, 1) * (strong ? 1.6 : 1) * (crit ? 1.5 : 1));
  S.ehp = Math.max(0, S.ehp - dmg); S.eflash = .45; (strong ? SFX.strong : SFX.hit)(); await sleep(650);
  if (crit) await say('Acerto crítico!');
  if (strong) await say('É super eficaz!');
}
async function capture() {   // quanto menos vida o arquivo tem, mais fácil prender
  await note('Você jogou uma LIXEIRA!', 150);
  const b = S.bin = { x: 150, y: 260, r: 0 };
  await Promise.all([tween(b, 'x', 470, 480), (async () => { await tween(b, 'y', 50, 240); await tween(b, 'y', 110, 240) })(), tween(b, 'r', 6.28, 480)]);
  b.r = 0; SFX.pop(); await tween(S, 'es', 0, 260); await tween(b, 'y', 176, 200);
  const ok = Math.random() < .2 + .8 * (1 - S.ehp / S.emax);
  for (let i = 0; i < (ok ? 3 : Math.ceil(rnd(0, 2))); i++) { await sleep(380); SFX.shake(); await tween(b, 'r', .4, 80); await tween(b, 'r', -.4, 120); await tween(b, 'r', 0, 80) }
  await sleep(350);
  if (ok) return true;
  S.bin = null; SFX.pop(); await tween(S, 'es', 1, 200);
  await say(`Ah, não! ${S.name} escapou!`);
  return false;
}

/* ---------------- desenho ---------------- */
function font(px, w = 600) { ctx.font = `${w} ${px}px ${FONT}` }
function box(x, y, w, h) { ctx.fillStyle = INK; ctx.fillRect(x - 4, y - 4, w + 8, h + 8); ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = CLAWD_C; ctx.lineWidth = 2; ctx.strokeRect(x + 3, y + 3, w - 6, h - 6) }
function hpBox(x, y, label, lv, hp, max, numbers) {
  box(x, y, 250, numbers ? 66 : 50);
  font(18, 700); ctx.fillStyle = INK; ctx.fillText(label, x + 12, y + 22);
  font(14); ctx.textAlign = 'right'; ctx.fillText('Nv' + lv, x + 238, y + 22); ctx.textAlign = 'left';
  font(12, 700); ctx.fillStyle = CLAWD_C; ctx.fillText('HP', x + 12, y + 40);
  ctx.fillStyle = INK; ctx.fillRect(x + 36, y + 30, 202, 12); ctx.fillStyle = '#d9d6cc'; ctx.fillRect(x + 38, y + 32, 198, 8);
  const k = clamp(hp / max, 0, 1); ctx.fillStyle = k > .5 ? '#4cc35a' : k > .2 ? '#e8b93a' : '#e0503a'; ctx.fillRect(x + 38, y + 32, 198 * k, 8);
  if (numbers) { font(15, 700); ctx.fillStyle = INK; ctx.textAlign = 'right'; ctx.fillText(`${Math.ceil(hp)} / ${max}`, x + 238, y + 59); ctx.textAlign = 'left' }
}
function wrap(text, maxW) {
  const out = [];
  for (const para of text.split('\n')) { let line = ''; for (const w of para.split(' ')) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w } else line = t } out.push(line) }
  return out;
}
function drawClawd() {
  if (S.cs <= .02) return;
  const s = 13 * S.cs, bob = S.happy ? -Math.abs(Math.sin(S.t * 7)) * 16 : Math.round(Math.sin(S.t * 3) * 2);
  const x = 150 + S.cx - 6 * s, y = 334 - 8 * s + bob, flash = S.cflash > 0 && Math.floor(S.t * 24) % 2;
  const blink = S.t % 3.4 < .13;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 12; c++) {
    const ch = CLAWD[r][c]; if (ch === '.') continue;
    const legs = r >= 6 && Math.sin(S.t * 6 + c) > .5 && !S.happy ? -2 : 0;   // perninhas mexendo
    ctx.fillStyle = flash ? '#fff' : ch === 'o' && !blink ? '#000' : CLAWD_C;
    ctx.fillRect(x + c * s, y + r * s + legs, s + .6, s + .6);
  }
}
function drawBin(b) {
  ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
  ctx.fillStyle = INK; ctx.fillRect(-17, -16, 34, 6); ctx.fillRect(-6, -21, 12, 5); ctx.fillRect(-14, -9, 28, 30);
  ctx.fillStyle = '#9a9aa3'; ctx.fillRect(-11, -7, 22, 25); ctx.fillStyle = INK; for (const dx of [-6, 0, 6]) ctx.fillRect(dx - 1, -3, 2, 17);
  ctx.restore();
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  root.style.background = S.scene ? '#000' : 'transparent';
  if (S.scene) {
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#e9e5da'; for (let y = 0; y < 350; y += 16) ctx.fillRect(0, y, W, 6);               // listras do fundo
    for (const [px, py, rx] of [[470, 208, 110], [150, 338, 140]]) {                                       // plataformas
      ctx.fillStyle = '#c9c4b4'; ctx.beginPath(); ctx.ellipse(px, py + 4, rx, rx * .22, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#dcd8cc'; ctx.beginPath(); ctx.ellipse(px, py, rx, rx * .22, 0, 0, 7); ctx.fill();
    }
    if (S.es > .02 && S.ea > 0) Batalha.draw(ctx, 470 + S.ex, 140 + S.ey, { kind: S.type, boss: S.boss, t: S.t, scale: 1.3 * S.es, alpha: S.ea, flash: S.eflash > 0 && Math.floor(S.t * 24) % 2 });
    if (S.bin) drawBin(S.bin);
    drawClawd();
    if (S.ex === 0) hpBox(26, 34, S.name, S.elv, S.ehpS, S.emax, false);
    if (S.cs >= 1) hpBox(364, 262, 'CLAWD', 50, S.hpS, S.maxhp, true);
    // caixa de texto e menu
    box(12, 366, 616, 102);
    const m = S.menu; font(20, 500); ctx.fillStyle = INK;
    wrap(S.text.slice(0, Math.floor(S.shown)), m ? 280 : 580).forEach((l, i) => ctx.fillText(l, 30, 400 + i * 26));
    if (S.wait && S.shown >= S.text.length && Math.floor(S.t * 3) % 2) { ctx.fillStyle = CLAWD_C; ctx.fillRect(598, 446, 12, 8) }   // "aperte Z"
    if (m) {
      box(322, 366, 306, 102); font(18, 700);
      m.opts.forEach((o, i) => {
        const x = 356 + (i % 2) * 142, y = 404 + Math.floor(i / 2) * 36;
        ctx.fillStyle = INK; ctx.fillText(o, x, y);
        if (i === m.i) { ctx.fillStyle = CLAWD_C; ctx.beginPath(); ctx.moveTo(x - 18, y - 13); ctx.lineTo(x - 6, y - 6); ctx.lineTo(x - 18, y + 1); ctx.fill() }
      });
    }
  }
  if (S.wipe > 0) { ctx.fillStyle = '#000'; for (let i = 0; i < 8; i++) { const w = W * S.wipe; ctx.fillRect(i % 2 ? W - w : 0, i * 60, w, 60) } }   // faixas alternadas
}

/* ---------------- laço, teclado, início e fim ---------------- */
function frame(now) {
  if (!S) return;
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  S.t += dt; S.eflash = Math.max(0, S.eflash - dt); S.cflash = Math.max(0, S.cflash - dt);
  if (S.shown < S.text.length) { const b = Math.floor(S.shown); S.shown += dt * 70; if (Math.floor(S.shown) > b && b % 3 === 0) tone(520, .02, 'square', .025) }
  S.ehpS += (S.ehp - S.ehpS) * Math.min(1, dt * 7); S.hpS += (S.hp - S.hpS) * Math.min(1, dt * 7);   // barras de vida descem suave
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
    let j = m.i;
    if (['ArrowLeft', 'ArrowRight', 'a', 'd'].includes(k)) j = m.i ^ 1;
    else if (['ArrowUp', 'ArrowDown', 'w', 's'].includes(k)) j = (m.i + 2) % 4;
    if (j !== m.i && j < m.opts.length) { m.i = j; SFX.move() }
    else if (ok) { SFX.ok(); m.done(m.i) }
    else if (back && m.back) { SFX.back(); m.done(-1) }
  } else if (S.wait && ok) {
    if (S.shown < S.text.length) S.shown = S.text.length;
    else { const r = S.wait; S.wait = null; r() }
  }
}
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H), dpr = devicePixelRatio || 1;
  cv.style.width = W * s + 'px'; cv.style.height = H * s + 'px';
  cv.width = Math.round(W * s * dpr); cv.height = Math.round(H * s * dpr);
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0); ctx.imageSmoothingEnabled = false;
}
function close(won) {
  stopMusic(); cancelAnimationFrame(raf); S = null;
  removeEventListener('keydown', onKey, true); removeEventListener('resize', fit);
  root.remove(); onEnd && onEnd(won);
}

// Mesma assinatura da Batalha: info {name, file, kind, total, count}; end(won) no fim.
window.Batalha2 = {
  async start(info, rect, end) {
    if (S) return;
    onEnd = end;
    try { await Promise.race([document.fonts.load('20px "Pixelify Sans"'), sleep(800)]) } catch {}
    root = document.createElement('div'); root.style.cssText = 'position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:transparent';
    cv = document.createElement('canvas'); root.appendChild(cv); document.body.appendChild(root);
    ctx = cv.getContext('2d'); fit();
    const lv = Math.log2(1 + info.total / 1048576), boss = info.total >= 1024 ** 3;   // mesma escala de dificuldade da outra batalha
    const emax = Math.round(clamp(40 + lv * 8, 40, 160) * (boss ? 1.5 : 1));
    S = {
      info, name: (boss ? '★ ' : '') + info.name.toUpperCase(), boss, t: 0, tweens: [], text: '', shown: 0, wait: null, menu: null,
      type: info.count > 1 ? (info.kind === 'dir' ? 'dir' : 'doc') : Batalha.typeOf(info.file || info.name, info.kind),
      emax, ehp: emax, ehpS: emax, elv: clamp(Math.round(3 + lv * 5), 1, 99), eatk: 9 + Math.min(11, lv), eatkMul: 1,
      maxhp: 100, hp: 100, hpS: 100, coffee: 2,
      wipe: 0, scene: false, ex: 320, ey: 0, ea: 1, es: 1, eflash: 0, cx: 0, cs: 0, cflash: 0, bin: null, happy: false,
    };
    addEventListener('keydown', onKey, true); addEventListener('resize', fit);
    SFX.ok(); startMusic();
    last = performance.now(); raf = requestAnimationFrame(frame);
    run();
  },
};
})();
