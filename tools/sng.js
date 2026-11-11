// Extrai uma música .sng do Clone Hero para uma pasta (mapa, áudios e song.ini), no formato que a batalha de ritmo lê.
// Uso: node tools/sng.js "musica.sng" "assets/ritmo/Nome da Música"
const fs = require('fs'), path = require('path');
const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('uso: node tools/sng.js arquivo.sng pasta-de-saida'); process.exit(1) }
const b = fs.readFileSync(src);
if (b.toString('latin1', 0, 6) !== 'SNGPKG') throw new Error('não é um arquivo .sng');
const mask = b.subarray(10, 26);
let p = 26;
const u64 = () => { const v = Number(b.readBigUInt64LE(p)); p += 8; return v };
const i32 = () => { const v = b.readInt32LE(p); p += 4; return v };
const str = n => { const s = b.toString('utf8', p, p + n); p += n; return s };

u64(); const meta = {};                                    // metadados viram o song.ini
for (let n = u64(); n--;) { const k = str(i32()); meta[k] = str(i32()) }
u64(); const files = [];
for (let n = u64(); n--;) { const name = str(b[p++]); files.push({ name, len: u64(), at: u64() }) }

fs.mkdirSync(out, { recursive: true });
for (const f of files) {
  if (path.basename(f.name) !== f.name || f.name.startsWith('.')) throw new Error('nome de arquivo inválido no .sng: ' + f.name);   // nada de "../" para fora da pasta
  const data = Buffer.from(b.subarray(f.at, f.at + f.len));
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 16] ^ (i & 255);   // os dados vêm embaralhados com uma máscara simples
  fs.writeFileSync(path.join(out, f.name), data);
  console.log(f.name, data.length);
}
fs.writeFileSync(path.join(out, 'song.ini'), '[song]\n' + Object.entries(meta).map(([k, v]) => `${k} = ${v}`).join('\n') + '\n');
console.log('song.ini', Object.keys(meta).length, 'campos');
