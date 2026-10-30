#!/usr/bin/env node
// Gera o hash da senha do login (HABBLAUD_REMOTE_PASSWORD_HASH) sem gravar a senha em lugar nenhum.
// Uso: node scripts/gerar-senha.mjs        (pede a senha duas vezes, escondida)
// Só usa módulos do Node; mesmo formato de server/remote/password.ts (scrypt N=2^15, r=8, p=1).
import { randomBytes, scrypt } from 'node:crypto';
import { stdin, stdout } from 'node:process';

function ask(prompt) {
  return new Promise((resolve) => {
    stdout.write(prompt);
    let value = '';
    const raw = stdin.isTTY;
    if (raw) stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (ch) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') {
          if (raw) stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (c === '\u0003') process.exit(1);
        if (c === '\u007f') value = value.slice(0, -1);
        else value += c;
      }
    };
    stdin.on('data', onData);
  });
}

const a = await ask('Senha (mínimo 10 caracteres): ');
const b = await ask('Repita a senha: ');
if (a !== b) {
  console.error('As senhas não conferem.');
  process.exit(1);
}
if (a.length < 10) {
  console.error('Use pelo menos 10 caracteres.');
  process.exit(1);
}
const logN = 15;
const salt = randomBytes(16);
const key = await new Promise((ok, fail) =>
  scrypt(a.normalize('NFC'), salt, 32, { N: 2 ** logN, r: 8, p: 1, maxmem: 256 * 2 ** logN * 8 }, (err, k) => (err ? fail(err) : ok(k))),
);
console.log('\nCole esta linha no .env:\n');
console.log(`HABBLAUD_REMOTE_PASSWORD_HASH=scrypt:${logN}:8:1:${salt.toString('base64url')}:${key.toString('base64url')}`);
