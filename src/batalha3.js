// Terceira batalha: 3D por turnos, com um grupo de três contra o arquivo. A tela "quebra como vidro",
// a câmera gira até o plano aberto e corta para um plano fechado a cada golpe (quatro ângulos que se alternam).
// Visual no estilo dos consoles antigos: imagem em baixa resolução, poucos polígonos, texturas granuladas,
// vértices "tremendo" e um leve efeito de TV de tubo. Vencer manda o arquivo para a Lixeira.
// Arte, textos e sons próprios; sem biblioteca de 3D (WebGL puro, formas arredondadas geradas por fórmula).
(() => {
'use strict';
const H = 540, RES = 400, FONT = 'Manrope, sans-serif', ACC = '#ff7a1a', FOG = [.72, .79, .8];   // RES: altura da imagem 3D antes de ampliar
let W = 960;   // largura lógica: acompanha a proporção da janela
const PARTY = [
  { n: 'CLAWD', c: '#d97757', max: 120, atk: 34, sp: { n: 'rm -rf', help: 'Golpe fortíssimo, mas pode errar.', pow: 80, acc: .7 } },
  { n: 'SONNET', c: '#8f7ae0', max: 90, atk: 24, sp: { n: 'Refatorar', help: 'Magia que nunca erra.', pow: 46, magic: true } },
  { n: 'HAIKU', c: '#5fb37a', max: 80, atk: 20, sp: { n: 'Café', help: 'Recupera a energia do grupo.', heal: 45 } },
];
const ENEMY_MOVES = {
  doc: ['Parede de Texto', 'Fonte Cômica'], dir: ['Subpasta Infinita', 'Nova Pasta (2)'], zip: ['Compressão', 'Senha Esquecida'],
  exe: ['Tela Azul', 'Atualização Forçada'], media: ['Volume Máximo', 'Carregando...'],
};
let cv, ctx, glc, gl, U, A, root, S = null, raf = 0, last = 0, actx = null, music = null, gain = null, onEnd = null;

const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmt = b => { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++ } return (i ? b.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : b) + ' ' + u[i] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const mixc = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);

/* ---------------- som ---------------- */
function ac() { return actx || (actx = new AudioContext()) }
function tone(f, d = .06, type = 'square', v = .05, f2 = 0) {
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
const SFX = {
  move: () => tone(700, .035), ok: () => tone(880, .06, 'square', .05, 1320),
  // vidro: estalo grave, chiado agudo e vários "tlins" de caco caindo
  glass: () => { tone(160, .12, 'sawtooth', .14, 50); noise(.45, .32, 7000, 2500); for (let i = 0; i < 16; i++) setTimeout(() => S && tone(rnd(2600, 7500), rnd(.05, .2), 'sine', .045), 50 + rnd(0, 750)) },
  run: () => noise(.3, .08, 500, 1800), hit: () => { noise(.16, .25, 1800, 300); tone(200, .16, 'sawtooth', .1, 60) },
  magic: () => [660, 880, 1320, 1760].forEach((f, i) => setTimeout(() => tone(f, .16, 'sine', .06, f * 1.5), i * 70)),
  miss: () => tone(300, .15, 'triangle', .05, 200), heal: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, .08), i * 60)),
  faint: () => tone(500, .5, 'sawtooth', .07, 60),
};
async function loadSong(name) { try { const r = await fetch(name, { cache: 'no-store' }); return r.ok ? await ac().decodeAudioData(await r.arrayBuffer()) : null } catch { return null } }
function play(buf) {   // troca a música que está tocando
  stopMusic(); if (!buf || !S) return;
  if (ac().state === 'suspended') ac().resume();
  music = ac().createBufferSource(); music.buffer = buf; music.loop = true;
  gain = ac().createGain(); gain.gain.value = .12;
  music.connect(gain).connect(ac().destination); music.start();
}
function stopMusic() { if (!music) return; const m = music, g = gain; g.gain.setTargetAtTime(0, ac().currentTime, .08); setTimeout(() => { try { m.stop() } catch {} }, 600); music = null }

/* ---------------- 3D mínimo: matrizes 4x4 (por colunas) ---------------- */
function mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o }
function persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0] }
const nrm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l) }, cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
function lookAt(e, a, roll) {
  const z = nrm([e[0] - a[0], e[1] - a[1], e[2] - a[2]]), x0 = nrm(cross([0, 1, 0], z)), y0 = cross(z, x0), c = Math.cos(roll), s = Math.sin(roll);
  const x = x0.map((v, i) => v * c + y0[i] * s), y = y0.map((v, i) => v * c - x0[i] * s);   // roll: horizonte levemente inclinado
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
}
const moveM = (x, y, z) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
function entM(x, y, z, yaw, tilt, s) {   // posição · giro (Y) · inclinar para a frente (X) · escala
  const c = Math.cos(yaw), n = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
  return mul([c, 0, -n, 0, 0, 1, 0, 0, n, 0, c, 0, x, y, z, 1], [s, 0, 0, 0, 0, ct * s, st * s, 0, 0, -st * s, ct * s, 0, 0, 0, 0, 1]);
}

/* ---------------- WebGL: um programa só; cada malha é uma lista de [posição, normal, textura, cor] ---------------- */
function initGL() {
  gl = glc.getContext('webgl', { antialias: false, alpha: false }); if (!gl) return false;
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s }, p = gl.createProgram();
  // snap: arredonda cada vértice para uma grade grossa, o que dá a "tremida" dos consoles antigos; a luz é calculada por vértice
  gl.attachShader(p, sh(gl.VERTEX_SHADER, `attribute vec3 p,n,c; attribute vec2 t; uniform mat4 mvp,model; uniform vec2 snap; uniform float unlit;
    varying vec3 vc; varying vec2 vt; varying float vz;
    void main(){ vec4 q = mvp*vec4(p,1.); if (q.w > 0.) q.xy = floor(q.xy/q.w*snap+.5)/snap*q.w; gl_Position = q;
      float d = max(dot(normalize((model*vec4(n,0.)).xyz), normalize(vec3(.45,1.,.65))), 0.);
      vc = unlit > .5 ? c : c*(.5+.68*d); vt = t; vz = unlit > .5 ? 0. : q.w; }`));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, `precision mediump float; varying vec3 vc; varying vec2 vt; varying float vz; uniform sampler2D tex; uniform vec3 fog; uniform float flash;
    void main(){ vec4 k = texture2D(tex, vt); gl_FragColor = vec4(mix(mix(k.rgb*vc, vec3(1.), flash), fog, clamp((vz-24.)/60., 0., 1.)), k.a); }`));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return false;
  gl.useProgram(p);
  A = {}; for (const k of ['p', 'n', 't', 'c']) { A[k] = gl.getAttribLocation(p, k); gl.enableVertexAttribArray(A[k]) }
  U = {}; for (const k of ['mvp', 'model', 'snap', 'unlit', 'fog', 'flash']) U[k] = gl.getUniformLocation(p, k);
  gl.uniform3fv(U.fog, FOG); gl.enable(gl.DEPTH_TEST); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  return true;
}
function buf(v) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW); return { b, n: v.length / 11 } }
function texOf(canvas, repeat) {
  const t = gl.createTexture(), w = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE; gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);   // sem suavizar: pontos visíveis
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  return t;
}
function paint(w, h, f) { const c = document.createElement('canvas'); c.width = w; c.height = h; f(c.getContext('2d')); return c }
function drawMesh(VP, m, model, tex, flash = 0, unlit = 0) {
  gl.bindBuffer(gl.ARRAY_BUFFER, m.b);
  gl.vertexAttribPointer(A.p, 3, gl.FLOAT, false, 44, 0); gl.vertexAttribPointer(A.n, 3, gl.FLOAT, false, 44, 12);
  gl.vertexAttribPointer(A.t, 2, gl.FLOAT, false, 44, 24); gl.vertexAttribPointer(A.c, 3, gl.FLOAT, false, 44, 32);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniformMatrix4fv(U.mvp, false, mul(VP, model)); gl.uniformMatrix4fv(U.model, false, model); gl.uniform1f(U.flash, flash); gl.uniform1f(U.unlit, unlit);
  gl.drawArrays(gl.TRIANGLES, 0, m.n);
}

/* ---------------- formas ---------------- */
const hash = (x, z) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s) };
function vnoise(x, z) {   // ruído suave entre 0 e 1
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi, sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
// Superfície em grade: f(u,v) devolve [x,y,z, nx,ny,nz, tu,tv, r,g,b]. flat: cada triângulo com uma luz só (facetado).
function surf(V, nu, nv, f, flat) {
  const g = []; for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) g.push(f(i / nu, j / nv));
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = g[j * (nu + 1) + i], b = g[j * (nu + 1) + i + 1], c = g[(j + 1) * (nu + 1) + i + 1], d = g[(j + 1) * (nu + 1) + i];
    for (const t of [[a, b, c], [a, c, d]]) {
      let n = null;
      if (flat) { n = nrm(cross([t[1][0] - t[0][0], t[1][1] - t[0][1], t[1][2] - t[0][2]], [t[2][0] - t[0][0], t[2][1] - t[0][1], t[2][2] - t[0][2]])); if (dot(n, [t[0][3], t[0][4], t[0][5]]) < 0) n = n.map(x => -x) }
      for (const v of t) V.push(v[0], v[1], v[2], ...(n || [v[3], v[4], v[5]]), v[6], v[7], v[8], v[9], v[10]);
    }
  }
}
// Bolha: de esfera (e = 1) a caixa de cantos redondos (e pequeno). rough: amassa a superfície (pedra, copa de árvore).
// c: cor fixa ou função da altura (0 embaixo, 1 em cima). face: a textura cobre a frente inteira (rosto do inimigo).
function blob(V, cx, cy, cz, rx, ry, rz, nu, nv, { e = 1, c, rough = 0, flat = false, seed = 0, face = false }) {
  const pw = (w, x) => Math.sign(w) * Math.abs(w) ** x;
  surf(V, nu, nv, (u, v) => {
    const a = (v - .5) * Math.PI, b = u * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
    let x = pw(ca, e) * pw(cb, e), y = pw(sa, e), z = pw(ca, e) * pw(sb, e);
    if (rough) { const k = 1 + rough * (vnoise(x * 2.1 + seed + z * 1.3, y * 2.1 - z * 1.7 + seed) - .5) * 2; x *= k; y *= k; z *= k }
    const n = nrm([pw(ca, 2 - e) * pw(cb, 2 - e) / rx, pw(sa, 2 - e) / ry, pw(ca, 2 - e) * pw(sb, 2 - e) / rz]), col = typeof c === 'function' ? c(y * .5 + .5) : c;
    const px = cx + x * rx, py = cy + y * ry, pz = cz + z * rz;
    return [px, py, pz, ...n, face ? x * .5 + .5 : (px + py) * .35, face ? .5 - y * .5 : (pz + py) * .35, ...col];
  }, flat);
}
function clawdParts(col, white) {   // corpo arredondado com olhinhos e bracinhos; quatro perninhas em dois pares que alternam
  const c = rgb(col), sh = c.map(v => v * .78), dk = [.05, .05, .06], body = [], legs = xs => { const V = []; for (const x of xs) blob(V, x, .27, 0, .115, .3, .14, 6, 4, { e: .6, c: sh }); return buf(V) };
  blob(body, 0, .93, 0, .82, .5, .56, 12, 8, { e: .42, c: y => mixc(sh, c, clamp(y * 1.6, 0, 1)) });
  for (const s of [-1, 1]) { blob(body, s * .92, .88, 0, .2, .15, .23, 6, 4, { e: .6, c: sh }); blob(body, s * .33, 1.05, .53, .075, .17, .06, 6, 4, { e: .7, c: dk }) }
  return [{ mesh: buf(body), tex: white }, { mesh: legs([-.56, .2]), tex: white, leg: 1 }, { mesh: legs([-.2, .56]), tex: white, leg: 2 }];
}
function enemyParts(kind, boss, white) {   // corpo de cantos redondos com o desenho do arquivo estampado na frente, e duas perninhas
  const face = paint(88, 112, c => { c.fillStyle = '#121214'; c.fillRect(0, 0, 88, 112); Batalha.draw(c, 44, 56, { kind, boss, t: 0, scale: 1 }) });
  const body = [], legs = [];
  blob(body, 0, 2, 0, 1.2, 1.52, .5, 12, 10, { e: .3, c: [1, 1, 1], face: true });
  for (const s of [-1, 1]) blob(legs, s * .5, .32, 0, .18, .36, .22, 6, 4, { e: .6, c: [.09, .09, .1] });
  return [{ mesh: buf(body), tex: texOf(face) }, { mesh: buf(legs), tex: white, leg: 1 }];
}
function ground(x, z) {   // altura do terreno: plano na clareira, morros em volta (mais altos ao fundo)
  const d = Math.hypot(x / 1.5, z), k = clamp((d - 11) / 15, 0, 1), s = k * k * (3 - 2 * k);
  return s * (1.2 + 5 * vnoise(x * .11 + 3, z * .11) + (z < 0 ? 2.5 : 0));
}
function scenery() {   // tudo o que não se mexe vira uma malha só: terreno, pedras e árvores
  let s = 7; const r = (a, b) => (s = s * 16807 % 2147483647, a + s / 2147483647 * (b - a)), V = [];
  const dirt = rgb('#8a6b45'), dirt2 = rgb('#6f5637'), grass = rgb('#5d9440'), grass2 = rgb('#3f6f2e');
  surf(V, 56, 56, (u, v) => {
    const x = u * 112 - 56, z = v * 112 - 56, n = vnoise(x * .35, z * .35), k = clamp((Math.hypot(x / 13.5, z / 7.5) + (n - .5) * .4 - .85) * 5, 0, 1);   // 0 = terra batida, 1 = grama
    return [x, ground(x, z), z, 0, 1, 0, x / 3, z / 3, ...mixc(mixc(dirt, dirt2, n), mixc(grass, grass2, vnoise(x * .2 + 9, z * .2)), k)];
  }, true);
  for (let i = 0; i < 16; i++) {   // pedras e paredões, em arco atrás da clareira
    const a = Math.PI * (1.08 + i / 15 * .84) + r(-.05, .05), d = r(17, 25), x = Math.cos(a) * d * 1.45, z = Math.sin(a) * d, h = r(3, 8), g = r(.4, .52);
    blob(V, x, ground(x, z) + h * .45, z, r(3, 6), h, r(2.5, 5), 7, 5, { rough: .32, flat: true, seed: i * 3.7, c: y => [g * (.7 + y * .5), g * (.66 + y * .46), g * (.58 + y * .4)] });
  }
  for (let i = 0; i < 30; i++) {   // árvores: tronco e copa amassada, em volta (menos na frente da câmera)
    const a = r(.72, 2.28) * Math.PI + (i % 6 ? 0 : Math.PI * .1), d = r(15, 36), x = Math.cos(a) * d * 1.4, z = Math.sin(a) * d, y = ground(x, z), k = r(.8, 1.5), g = r(.75, 1.1);
    blob(V, x, y + 1.6 * k, z, .32 * k, 1.9 * k, .32 * k, 5, 3, { e: .5, c: [.36, .27, .18] });
    blob(V, x, y + 4.4 * k, z, 2.3 * k, 1.9 * k, 2.3 * k, 7, 5, { rough: .3, flat: true, seed: i * 1.9, c: t => [.16 * g + t * .1, .36 * g + t * .2, .15 * g + t * .06] });
    blob(V, x + .5 * k, y + 5.8 * k, z - .3 * k, 1.5 * k, 1.2 * k, 1.5 * k, 6, 4, { rough: .3, flat: true, seed: i * 2.3, c: t => [.2 * g + t * .1, .42 * g + t * .2, .17 * g + t * .06] });
  }
  return buf(V);
}

/* ---------------- câmera ---------------- */
function camera() {
  const c = S.cam; let eye, at, roll = -.035;
  if (c.mode === 'close') {            // golpe: plano fechado em um de quatro ângulos, chegando "empurrado" para perto
    const a = c.a, b = c.b, mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, k = 1 - (1 - c.k) ** 3;
    const v = [
      [[mx - .7, 6.4, mz + 4.3], [mx, 1, mz], .05],                    // de cima
      [[mx - .3, 1.1, mz + 8.2], [mx, 1.7, mz], -.09],                  // rente ao chão, de lado
      [[a.x - 4.8, 3.6, a.z + 3.6], [b.x, 1.6, b.z], .04],             // por cima do ombro de quem ataca
      [[b.x + 3.4, 3.6, b.z + 3], [a.x, 1, a.z], -.05],                // por trás de quem apanha
    ][c.v];
    at = v[1]; eye = v[0].map((p, i) => at[i] + (p - at[i]) * (1 + (1 - k) * .55)); roll = v[2];
  } else if (c.mode === 'win') {       // vitória: gira devagar em volta do grupo
    const a = 1.15 + Math.sin(S.t * .4) * .5; eye = [-5.2 + Math.cos(a) * 9, 3, -.8 + Math.sin(a) * 9]; at = [-5.2, 1, -.8];
  } else {                             // plano aberto: grupo à esquerda, inimigo à direita e mais perto
    at = [-.6, 1, 0]; eye = [1.5 + Math.sin(S.t * .25) * .5, 7, 16.5];
    if (S.swoop < 1) {                 // entrada: vem de longe, do alto, girando em volta da arena
      const k = 1 - (1 - S.swoop) ** 3, ang = (1 - k) * 2.3, rs = 1 + (1 - k) * 1.1, dx = eye[0] - at[0], dz = eye[2] - at[2];
      eye = [at[0] + (dx * Math.cos(ang) + dz * Math.sin(ang)) * rs, eye[1] + (1 - k) * 9, at[2] + (dz * Math.cos(ang) - dx * Math.sin(ang)) * rs]; roll -= (1 - k) * .25;
    }
  }
  if (S.shake > 0) eye = eye.map(v => v + rnd(-1, 1) * S.shake * .35);
  return mul(persp(.72, W / H, .2, 400), lookAt(eye, at, roll));
}
function project(p) {   // ponto do mundo -> ponto na tela (para números de dano, marcador e brilhos)
  const m = S.VP, w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [((m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12]) / w * .5 + .5) * W, (.5 - (m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13]) / w * .5) * H];
}

/* ---------------- roteiro ---------------- */
function say(text) { S.msg = text; return new Promise(r => S.wait = () => { S.msg = ''; r() }) }
function menu(opts, helps, i = 0) { return new Promise(r => S.menu = { opts, helps, i, done: v => { S.menu = null; r(v) } }) }
function tween(obj, key, to, ms) { return new Promise(res => S.tweens.push({ obj, key, from: obj[key], to, t: 0, d: ms / 1000, res })) }
const hop = async (o, h, ms) => { await tween(o, 'y', h, ms / 2); await tween(o, 'y', 0, ms / 2) };
function pop(t, text, color = '#fff') { S.pops.push({ p: [t.x, t.top, t.z], text, color, t: 0 }) }
function spark(t, c = '255,190,110', dy = 0) { S.fx.push({ p: [t.x + rnd(-.3, .3), t.top * .55 + dy, t.z + .5], c, t: 0 }) }
function hurt(t, d, crit) { t.hp = Math.max(0, t.hp - d); t.flash = .3; S.shake = .45; S.white = .12; spark(t); pop(t, (crit ? 'CRÍTICO  ' : '') + d, crit ? '#ffd27a' : '#fff'); SFX.hit() }
function closeUp(a, b) {   // nunca repete o ângulo do golpe anterior
  S.camN = (S.camN + 1 + Math.floor(rnd(0, 3))) % 4;
  S.cam = { mode: 'close', a, b, k: 0, v: S.camN }; tween(S.cam, 'k', 1, 300); S.blurT = .28;
}

async function strike(p, name, pow, acc) {   // corre até o inimigo; a câmera corta para perto dos dois; depois volta ao plano aberto
  const e = S.e; S.help = `${p.n}: ${name}`; SFX.run();
  const go = Promise.all([tween(p, 'x', e.x - 2.5, 430), tween(p, 'z', e.z + .3, 430), hop(p, .9, 430)]);
  await sleep(240); closeUp(p, e); await go;
  await tween(p, 'tilt', .6, 80);
  if (Math.random() > acc) { SFX.miss(); pop(e, 'ERROU') }
  else { const crit = Math.random() < .1; hurt(e, Math.round(pow * rnd(.85, 1.1) * (crit ? 1.5 : 1)), crit); tween(e, 'x', e.hx + .6, 70).then(() => S && tween(e, 'x', e.hx, 180)) }
  await tween(p, 'tilt', 0, 150); await sleep(700);
  S.cam = { mode: 'wide' };
  await Promise.all([tween(p, 'x', p.hx, 340), tween(p, 'z', p.hz, 340), hop(p, .7, 340)]);
}
async function magic(p, sp) {
  const e = S.e; S.help = `${p.n}: ${sp.n}`; SFX.magic(); await hop(p, 1.2, 380);
  closeUp(e, e); for (let i = 0; i < 4; i++) { spark(e, '190,150,255', rnd(-.8, .8)); await sleep(110) }
  hurt(e, Math.round(sp.pow * rnd(.9, 1.1))); await sleep(750); S.cam = { mode: 'wide' };
}
async function heal(p, sp) {
  S.help = `${p.n}: ${sp.n}`; await hop(p, 1, 360); SFX.heal();
  for (const m of S.party) if (m.hp > 0) { m.hp = Math.min(m.max, m.hp + sp.heal); spark(m, '120,255,160'); pop(m, '+' + sp.heal, '#8dffb0') }
  await sleep(850);
}
async function enemyTurn() {
  const e = S.e, alive = S.party.filter(p => p.hp > 0), t = alive[Math.floor(rnd(0, alive.length))], mv = ENEMY_MOVES[S.type][Math.floor(rnd(0, 2))];
  S.active = e; S.help = `${S.name}: ${mv}`; await sleep(500); SFX.run();
  await Promise.all([tween(e, 'x', t.x + 2.7, 380), tween(e, 'z', t.z, 380), hop(e, .8, 380)]);
  if (Math.random() < .1) { SFX.miss(); pop(t, 'ERROU') }
  else { hurt(t, Math.round(S.eatk * rnd(.85, 1.15))); if (t.hp <= 0) { SFX.faint(); tween(t, 'tilt', -1.45, 300) } }
  await sleep(480);
  await Promise.all([tween(e, 'x', e.hx, 330), tween(e, 'z', e.hz, 330), hop(e, .6, 330)]);
  await sleep(150);
}
async function run() {
  S.shot = await getShot(); if (!S) return;
  S.shards = makeShards(); S.ready = true; SFX.glass();
  await tween(S, 'crack', 1, 420); await sleep(200);                           // a tela trinca...
  S.blurT = 1.5; tween(S, 'swoop', 1, 1700); await tween(S, 'fly', 1, 1000);   // ...os cacos voam e a câmera chega girando
  S.shards = null; await sleep(650); S.hud = true;
  S.help = `${S.name} apareceu!`; await sleep(700);
  for (;;) {
    for (const p of S.party) {
      if (p.hp <= 0) continue;
      S.active = p;
      const a = await menu(['Atacar', p.sp.n, 'Fugir'], ['Ataca o inimigo de perto.', p.sp.help, 'Sai da batalha. O arquivo continua no disco.']);
      if (a === 0) await strike(p, 'Atacar', p.atk, .95);
      else if (a === 1) await (p.sp.heal ? heal(p, p.sp) : p.sp.magic ? magic(p, p.sp) : strike(p, p.sp.n, p.sp.pow, p.sp.acc));
      else { S.active = null; await say('Você fugiu em segurança!\nO arquivo continua no disco.'); return close(false) }
      if (S.e.hp <= 0) {
        S.active = null; S.help = ''; SFX.faint(); stopMusic();
        await Promise.all([tween(S.e, 's', 0, 700), tween(S.e, 'yaw', 9, 700)]);
        S.cam = { mode: 'win' }; S.blurT = .3; S.happy = S.won = true; play(S.fan);   // fanfarra da vitória
        await say(`Vitória! ${S.name} foi varrido para a Lixeira.\n${fmt(S.info.total)} liberados!`);
        return close(true);
      }
    }
    await enemyTurn();
    if (S.party.every(p => p.hp <= 0)) {
      S.active = null; await say('O grupo ficou sem energia...');
      if (await menu(['De novo', 'Desistir'], ['Recomeça a batalha.', 'O arquivo continua no disco.']) !== 0) return close(false);
      for (const p of S.party) { p.hp = p.max; p.tilt = 0 } S.e.hp = S.e.max;
    }
  }
}

/* ---------------- vidro quebrando ---------------- */
function getShot() {   // foto da tela atual (pedida ao programa); se não vier, usa um fundo escuro
  return new Promise(res => {
    const dark = () => res(paint(16, 9, x => { x.fillStyle = '#0e0e10'; x.fillRect(0, 0, 16, 9) }));
    window.onShot = d => { const i = new Image(); i.onload = () => res(i); i.onerror = dark; i.src = 'data:image/jpeg;base64,' + d };
    try { chrome.webview.postMessage({ cmd: 'shot' }) } catch { dark() }
    setTimeout(dark, 1500);
  });
}
function makeShards() {   // malha de pontos tremida -> triângulos; cada caco sai voando para longe do ponto de impacto
  const C = 11, R = 7, P = [], out = [], ix = W * .5, iy = H * .45, diag = Math.hypot(W, H);
  for (let r = 0; r <= R; r++) for (let c = 0; c <= C; c++) P.push([(c + (c && c < C ? rnd(-.4, .4) : 0)) * W / C, (r + (r && r < R ? rnd(-.4, .4) : 0)) * H / R]);
  for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
    const a = P[r * (C + 1) + c], b = P[r * (C + 1) + c + 1], d = P[(r + 1) * (C + 1) + c], e = P[(r + 1) * (C + 1) + c + 1];
    for (const t of Math.random() < .5 ? [[a, b, d], [b, e, d]] : [[a, b, e], [a, e, d]]) {
      const cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3, dx = cx - ix, dy = cy - iy, dist = Math.hypot(dx, dy) || 1;
      out.push({ t, cx, cy, dx: dx / dist, dy: dy / dist, far: dist / diag, sp: rnd(300, 800), spin: rnd(-3, 3), flip: rnd(2, 7), r0: rnd(-.09, .09), shine: Math.random() < .5 ? rnd(.12, .55) : 0 });
    }
  }
  return out;
}
function drawShards() {
  ctx.imageSmoothingEnabled = true;
  for (const s of S.shards) {
    const k = clamp(S.crack * 1.9 - s.far * 1.6, 0, 1), f = clamp(S.fly * 1.35 - s.far * .5, 0, 1);   // perto do impacto trinca e voa primeiro
    if (f >= 1) continue;
    const off = k * 5 + f * f * s.sp * 1.5, sc = 1 + f * 1.3;
    ctx.save(); ctx.globalAlpha = 1 - f * f;
    ctx.translate(s.cx + s.dx * off, s.cy + s.dy * off + f * f * 130); ctx.rotate(s.r0 * k + s.spin * f); ctx.scale(sc * Math.cos(s.flip * f), sc); ctx.translate(-s.cx, -s.cy);
    ctx.beginPath(); ctx.moveTo(...s.t[0]); ctx.lineTo(...s.t[1]); ctx.lineTo(...s.t[2]); ctx.closePath(); ctx.clip();
    ctx.drawImage(S.shot, 0, 0, W, H);
    if (s.shine) { ctx.fillStyle = `rgba(255,255,255,${s.shine * k})`; ctx.fill() }               // reflexo do vidro
    ctx.strokeStyle = `rgba(255,255,255,${.55 * k})`; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.restore();
  }
}

/* ---------------- desenho ---------------- */
function font(px, w = 600) { ctx.font = `${w} ${px}px ${FONT}` }
function panel(x, y, w, h) { ctx.fillStyle = 'rgba(12,12,16,.74)'; ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.stroke() }
function render() {
  const G = S.gfx, I = moveM(0, 0, 0);
  gl.viewport(0, 0, glc.width, glc.height); gl.clearColor(...FOG, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  const VP = S.VP = camera();
  drawMesh(VP, G.sky, I, G.white, 0, 1);
  drawMesh(VP, G.land, I, G.grain);
  gl.enable(gl.BLEND); gl.depthMask(false);   // sombras redondas no chão
  for (const e of S.ents) if (e.s > .01) { const w = e.top * .75 * e.s; drawMesh(VP, G.quad, [w, 0, 0, 0, 0, 1, 0, 0, 0, 0, w * .8, 0, e.x, .05, e.z, 1], G.shadow, 0, 1) }
  gl.disable(gl.BLEND); gl.depthMask(true);
  for (const e of S.ents) {
    if (e.s <= .01) continue;
    const up = e.hp > 0, bob = !up ? 0 : e === S.e ? Math.sin(S.t * 2.4) * .08 : Math.abs(Math.sin(S.t * (S.happy ? 9 : 3) + e.i)) * (S.happy ? .7 : .05);
    const M = entM(e.x, e.y + bob, e.z, e.yaw, e.tilt, e.s), fast = e.y > .02 || S.happy;   // pernas mexem mais rápido quando corre
    for (const p of e.parts) drawMesh(VP, p.mesh, p.leg && up ? mul(M, moveM(0, Math.max(0, Math.sin(S.t * (fast ? 22 : 4) + p.leg * Math.PI + e.i)) * (fast ? .14 : .05), 0)) : M, p.tex, e.flash > 0 ? .85 : 0);
  }
}
function turns() {   // próximos a agir, a partir de quem está na vez
  const round = [...S.party.filter(p => p.hp > 0), S.e], i = Math.max(0, round.indexOf(S.active)), out = [];
  for (let k = 0; k < 6; k++) out.push(round[(i + k) % round.length]);
  return out;
}
function draw() {
  if (S.fly <= 0) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H) }                             // atrás das trincas: preto
  else { render(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = S.blurT > 0 ? .3 : 1; ctx.drawImage(glc, 0, 0, W, H); ctx.globalAlpha = 1 }   // ampliada sem suavizar; rastro = borrão de movimento
  if (S.shards) drawShards();
  for (const f of S.fx) {              // brilho do impacto
    const [x, y] = project(f.p), k = f.t / .4, r = 30 + k * 110, g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${1 - k})`); g.addColorStop(.35, `rgba(${f.c},${.8 * (1 - k)})`); g.addColorStop(1, `rgba(${f.c},0)`);
    ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * .785 + f.p[0]; ctx.moveTo(x + Math.cos(a) * r * .5, y + Math.sin(a) * r * .5); ctx.lineTo(x + Math.cos(a) * r * 1.1, y + Math.sin(a) * r * 1.1) }
    ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
  }
  for (const p of S.pops) {            // números de dano subindo
    const [x, y] = project(p.p); font(30, 800); ctx.textAlign = 'center'; ctx.globalAlpha = clamp(2.4 - p.t * 2, 0, 1);
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(p.text, x, y - p.t * 46); ctx.fillStyle = p.color; ctx.fillText(p.text, x, y - p.t * 46);
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
  }
  if (S.white > 0) { ctx.fillStyle = `rgba(255,255,255,${S.white * 4})`; ctx.fillRect(0, 0, W, H) }
  if (S.hud) hud();
  if (S.fly > 0) {                     // TV de tubo, bem de leve: linhas horizontais e cantos escurecidos
    ctx.fillStyle = S.scan; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, H / 2, H * .45, W / 2, H / 2, Math.hypot(W, H) * .56); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.3)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}
function hud() {
  const a = S.active, m = S.menu;
  if (a && a !== S.e && m && S.cam.mode === 'wide') {   // marcador em cima de quem está na vez
    const [x, y] = project([a.x, a.top + .5 + Math.sin(S.t * 6) * .08, a.z]); ctx.fillStyle = ACC; ctx.beginPath(); ctx.moveTo(x - 9, y - 12); ctx.lineTo(x + 9, y - 12); ctx.lineTo(x, y); ctx.fill();
  }
  const help = m ? m.helps[m.i] : S.help;
  if (help) { panel(24, 18, Math.min(W - 140, 560), 32); font(15, 500); ctx.fillStyle = '#e8e8ee'; ctx.fillText(help, 40, 39) }
  turns().forEach((t, i) => {          // fila de turnos, à direita
    const s = i ? 26 : 34, x = W - 30 - s, y = 22 + i * 34 + (i ? 8 : 0);
    ctx.fillStyle = 'rgba(12,12,16,.74)'; ctx.fillRect(x - 3, y - 3, s + 6, s + 6); ctx.fillStyle = t === S.e ? '#c8c8d0' : t.c; ctx.fillRect(x, y, s, s);
    font(i ? 13 : 16, 800); ctx.fillStyle = '#121214'; ctx.textAlign = 'center'; ctx.fillText(t === S.e ? '?' : t.n[0], x + s / 2, y + s / 2 + (i ? 5 : 6)); ctx.textAlign = 'left';
  });
  const px = W - 372, py = H - 122;    // grupo: nome, barra e número de energia
  panel(px, py, 348, 100);
  S.party.forEach((p, i) => {
    const y = py + 12 + i * 29;
    if (p === a) { ctx.fillStyle = 'rgba(255,122,26,.28)'; ctx.fillRect(px + 4, y - 2, 340, 26); ctx.fillStyle = ACC; ctx.fillRect(px + 4, y - 2, 3, 26) }
    ctx.fillStyle = p.c; ctx.fillRect(px + 16, y + 6, 10, 10);
    font(15, 700); ctx.fillStyle = p.hp > 0 ? '#fff' : '#77777f'; ctx.fillText(p.n, px + 34, y + 17);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(px + 124, y + 8, 130, 7);
    const k = p.hpS / p.max; ctx.fillStyle = k > .5 ? '#5fd06e' : k > .2 ? '#e8b93a' : '#e0503a'; ctx.fillRect(px + 124, y + 8, 130 * k, 7);
    font(14, 600); ctx.fillStyle = '#e8e8ee'; ctx.textAlign = 'right'; ctx.fillText(`${Math.ceil(p.hpS)} / ${p.max}`, px + 334, y + 17); ctx.textAlign = 'left';
  });
  if (m) {                             // comandos, embaixo à esquerda
    const mh = 40 + m.opts.length * 30; panel(24, H - 22 - mh, 220, mh);
    font(12, 800); ctx.fillStyle = a ? a.c : ACC; ctx.fillText(a ? a.n : 'E AGORA?', 40, H - mh);
    m.opts.forEach((o, i) => {
      const y = H - mh + 14 + i * 30;
      if (i === m.i) { ctx.fillStyle = 'rgba(255,122,26,.3)'; ctx.fillRect(30, y, 208, 26); ctx.fillStyle = ACC; ctx.beginPath(); ctx.moveTo(38, y + 6); ctx.lineTo(48, y + 13); ctx.lineTo(38, y + 20); ctx.fill() }
      font(16, i === m.i ? 700 : 500); ctx.fillStyle = '#fff'; ctx.fillText(o, 58, y + 19);
    });
  }
  if (S.msg) {                         // mensagem que espera Z / Enter
    const lines = S.msg.split('\n'), w = Math.min(W - 60, 620), x = (W - w) / 2, h = 34 + lines.length * 26, y = H * .2 - h / 2;   // no alto, para não tapar a comemoração
    panel(x, y, w, h); font(18, 600); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; lines.forEach((l, i) => ctx.fillText(l, W / 2, y + 36 + i * 26)); ctx.textAlign = 'left';
    if (Math.floor(S.t * 3) % 2) { ctx.fillStyle = ACC; ctx.beginPath(); ctx.moveTo(x + w - 26, y + h - 18); ctx.lineTo(x + w - 14, y + h - 18); ctx.lineTo(x + w - 20, y + h - 10); ctx.fill() }
  }
}

/* ---------------- laço, teclado, início e fim ---------------- */
function frame(now) {
  if (!S) return;
  const dt = Math.min(.05, (now - last) / 1000); last = now;
  S.t += dt; S.shake = Math.max(0, S.shake - dt * 1.6); S.white = Math.max(0, S.white - dt); S.blurT -= dt;
  for (const e of S.ents) { e.flash = Math.max(0, e.flash - dt); e.hpS += (e.hp - e.hpS) * Math.min(1, dt * 7) }
  for (const tw of S.tweens) { tw.t += dt; const k = Math.min(1, tw.t / tw.d); tw.obj[tw.key] = tw.from + (tw.to - tw.from) * k; if (k >= 1) tw.res() }
  S.tweens = S.tweens.filter(tw => tw.t < tw.d);
  for (const f of S.fx) f.t += dt; S.fx = S.fx.filter(f => f.t < .4);
  for (const p of S.pops) p.t += dt; S.pops = S.pops.filter(p => p.t < 1.2);
  if (S.ready) draw();
  raf = requestAnimationFrame(frame);
}
function onKey(e) {
  if (!S) return;
  e.preventDefault(); e.stopPropagation(); if (e.repeat) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key, ok = k === 'z' || k === 'Enter' || k === ' ', m = S.menu;
  if (m) {
    const d = ['ArrowDown', 's'].includes(k) ? 1 : ['ArrowUp', 'w'].includes(k) ? -1 : 0;
    if (d) { m.i = (m.i + d + m.opts.length) % m.opts.length; SFX.move() }
    else if (ok) { SFX.ok(); m.done(m.i) }
  } else if (S.wait && ok) { const r = S.wait; S.wait = null; SFX.ok(); r() }
}
function fit() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5); W = H * innerWidth / innerHeight;
  cv.style.width = innerWidth + 'px'; cv.style.height = innerHeight + 'px';
  cv.width = Math.round(innerWidth * dpr); cv.height = Math.round(innerHeight * dpr);
  glc.height = RES; glc.width = Math.round(RES * W / H); gl.uniform2f(U.snap, glc.width / 2, glc.height / 2);
  ctx.setTransform(cv.width / W, 0, 0, cv.height / H, 0, 0);
}
function close(won) {
  stopMusic(); cancelAnimationFrame(raf); S = null; window.onShot = null;
  removeEventListener('keydown', onKey, true); removeEventListener('resize', fit);
  root.remove(); onEnd && onEnd(won);
}

// Mesma assinatura das outras batalhas: info {name, file, kind, total, count}; end(won) no fim.
// Devolve false se o computador não tiver 3D (aí quem chamou usa outra batalha).
window.Batalha3 = {
  start(info, rect, end) {
    if (S) return true;
    glc = document.createElement('canvas'); if (!initGL()) return false;
    onEnd = end;
    root = document.createElement('div'); root.style.cssText = 'position:fixed;inset:0;z-index:100;background:transparent';
    cv = document.createElement('canvas'); cv.style.display = 'block'; root.appendChild(cv); document.body.appendChild(root);
    ctx = cv.getContext('2d'); fit();
    const lv = Math.log2(1 + info.total / 1048576), boss = info.total >= 1024 ** 3;   // mesma escala de dificuldade das outras batalhas
    const emax = Math.round(clamp(40 + lv * 8, 40, 160) * (boss ? 1.5 : 1) * 2.2);   // 2,2x: aqui são três batendo
    const type = info.count > 1 ? (info.kind === 'dir' ? 'dir' : 'doc') : Batalha.typeOf(info.file || info.name, info.kind);
    const white = texOf(paint(1, 1, c => { c.fillStyle = '#fff'; c.fillRect(0, 0, 1, 1) })), sky = [], quad = [];
    blob(sky, 0, 0, 0, 250, 250, 250, 12, 8, { c: y => mixc(FOG, [.3, .5, .8], clamp((y - .5) * 2.4, 0, 1)) });   // céu: da cor da névoa no horizonte ao azul no alto
    for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) quad.push(x, 0, z, 0, 1, 0, x * .5 + .5, z * .5 + .5, 0, 0, 0);
    const gfx = {
      white, sky: buf(sky), quad: buf(quad), land: scenery(),
      grain: texOf(paint(64, 64, c => { for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const v = 190 + Math.random() * 65 - (Math.random() < .06 ? 60 : 0); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x, y, 1, 1) } }), true),
      shadow: texOf(paint(32, 32, c => { const g = c.createRadialGradient(16, 16, 2, 16, 16, 16); g.addColorStop(0, 'rgba(0,0,0,.5)'); g.addColorStop(1, 'rgba(0,0,0,0)'); c.fillStyle = g; c.fillRect(0, 0, 32, 32) })),
    };
    const ent = (o, x, z, yaw, top, parts, s = 1) => Object.assign(o, { x, y: 0, z, hx: x, hz: z, yaw, tilt: 0, s, flash: 0, top, parts, hpS: o.hp });
    const party = PARTY.map((p, i) => ent({ ...p, i, hp: p.max }, [-8, -5.2, -2.6][i], [-2.4, -.8, 1][i], 1.15, 1.7, clawdParts(p.c, white)));   // de frente para o inimigo, um pouco virados para a câmera
    const e = ent({ max: emax, hp: emax, i: 9 }, 4.8, 1.6, -1, boss ? 4.9 : 3.7, enemyParts(type, boss, white), boss ? 1.35 : 1);
    S = {
      info, name: (boss ? '★ ' : '') + info.name.toUpperCase(), type, t: 0, tweens: [], fx: [], pops: [], menu: null, wait: null, msg: '', help: '',
      party, e, ents: [...party, e], gfx, eatk: 16 + Math.min(14, lv), active: null, cam: { mode: 'wide' }, camN: Math.floor(rnd(0, 4)),
      ready: false, hud: false, shot: null, shards: null, crack: 0, fly: 0, swoop: 0, blurT: 0, shake: 0, white: 0, happy: false, won: false, fan: null,
      scan: ctx.createPattern(paint(1, 3, c => { c.fillStyle = 'rgba(0,0,0,.1)'; c.fillRect(0, 0, 1, 1) }), 'repeat'),
    };
    addEventListener('keydown', onKey, true); addEventListener('resize', fit);
    loadSong('musica3').then(b => S && !S.won && play(b));
    loadSong('musica4').then(b => { if (S) { S.fan = b; if (S.won) play(b) } });   // fanfarra: já fica pronta para a vitória
    last = performance.now(); raf = requestAnimationFrame(frame);
    run();
    return true;
  },
};
})();
