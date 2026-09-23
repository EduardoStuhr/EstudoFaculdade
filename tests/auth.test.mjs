import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

// Compile actual production modules; mock only D1's transport and the email API.
const root = mkdtempSync(join(tmpdir(), 'estudo-auth-'));
writeFileSync(join(root, 'package.json'), '{"type":"module"}');
const joseUrl = import.meta.resolve('jose');
const sources = ['lib/auth.ts', 'lib/auth-http.ts', 'lib/auth-email.ts', 'lib/auth-handler.ts',
  ...['login', 'register', 'verify-email', 'resend-verification', 'forgot-password', 'reset-password', 'logout'].map(a => `app/api/auth/${a}/route.ts`)];
for (const source of sources) {
  let content = readFileSync(source, 'utf8')
    .replace('import { env } from "cloudflare:workers";', 'const env = globalThis.__authTestEnv;')
    .replace('from "jose"', `from ${JSON.stringify(joseUrl)}`)
    .replace(/from "(@\/|\.\/)([^";]+)"/g, (_, prefix, name) => `from ${JSON.stringify(pathToFileURL(join(root, prefix === '@/' ? name : `lib/${name}`) + '.js').href)}`);
  const target = join(root, source.replace(/\.ts$/, '.js'));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, ts.transpileModule(content, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const env = globalThis.__authTestEnv = { JWT_SECRET: 'unit-tests-only-a-long-secret-with-32-characters', APP_URL: 'https://caderno.example', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'Caderno <conta@example.test>' };
const { getAuthenticatedUserId, hashPassword, verifyPassword } = await import(pathToFileURL(join(root, 'lib/auth.js')));
const routes = {};
for (const action of ['login', 'register', 'verify-email', 'resend-verification', 'forgot-password', 'reset-password', 'logout']) {
  routes[action] = (await import(pathToFileURL(join(root, `app/api/auth/${action}/route.js`)))).POST;
}
let sqlite;
let mail;
let failMail;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  assert.equal(url, 'https://api.resend.com/emails');
  assert.equal(init.headers.Authorization, 'Bearer test-key');
  if (failMail) return new Response('{}', { status: 500 });
  mail.push(JSON.parse(init.body));
  return Response.json({ id: 'test' });
};
function statement(sql, bindings = []) {
  return {
    bind: (...values) => statement(sql, values),
    first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
    run: async () => { const result = sqlite.prepare(sql).run(...bindings); return { success: true, meta: { changes: Number(result.changes) } }; },
    execute: () => ({ success: true, results: sqlite.prepare(sql).all(...bindings) }),
  };
}
beforeEach(() => {
  sqlite?.close();
  sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('drizzle').filter(f => f.endsWith('.sql')).sort()) sqlite.exec(readFileSync(join('drizzle', file), 'utf8'));
  sqlite.exec('PRAGMA foreign_keys = ON');
  env.DB = {
    prepare: sql => statement(sql),
    batch: async statements => {
      sqlite.exec('BEGIN');
      try { const results = statements.map(s => s.execute()); sqlite.exec('COMMIT'); return results; }
      catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  env.APP_URL = 'https://caderno.example';
  env.RESEND_API_KEY = 'test-key';
  mail = []; failMail = false;
});
after(() => { sqlite.close(); globalThis.fetch = originalFetch; delete globalThis.__authTestEnv; rmSync(root, { recursive: true }); });
const password = 'uma-senha-longa-e-segura';
function call(action, body = {}, headers = {}) {
  return routes[action](new Request(`https://caderno.example/api/auth/${action}`, {
    method: 'POST', headers: { Origin: 'https://caderno.example', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...headers }, body: JSON.stringify(body),
  }));
}
const register = (email = 'eduardo@example.test') => call('register', { name: 'Eduardo', email, password });
const token = () => new URL(mail.at(-1).text.match(/https:\/\/\S+/)[0]).hash.split('token=')[1];
const login = (pass = password) => call('login', { email: 'eduardo@example.test', password: pass });
const cookieRequest = cookie => new Request('https://caderno.example/api/notebook', { headers: { Cookie: cookie } });
async function verified() {
  assert.equal((await register()).status, 202);
  assert.equal((await call('verify-email', { token: token(), password })).status, 200);
}

test('register normalizes email, hashes secrets, sends link, and does not create session', async () => {
  const response = await register(' Eduardo@Example.Test ');
  assert.equal(response.status, 202); assert.equal(response.headers.get('set-cookie'), null);
  const user = sqlite.prepare('SELECT * FROM users').get();
  assert.equal(user.email, 'eduardo@example.test'); assert.equal(user.email_verified_at, null);
  assert.notEqual(user.password_hash, password);
  assert.equal(await verifyPassword(password, user.password_hash), true);
  assert.equal(mail.length, 1); assert.equal(token().length, 64);
  assert.notEqual(sqlite.prepare('SELECT token_hash FROM auth_tokens').get().token_hash, token());
  assert.equal((await login()).status, 403);
});

test('verification establishes owner password, rejects reuse and permits authenticated access', async () => {
  await register(); const link = token(); const ownerPassword = 'senha-escolhida-pelo-dono';
  assert.equal((await call('verify-email', { token: link, password: ownerPassword })).status, 200);
  assert.equal((await call('verify-email', { token: link, password })).status, 400);
  assert.equal((await login()).status, 401);
  const response = await login(ownerPassword);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Lax/);
  assert.ok(await getAuthenticatedUserId(cookieRequest(cookie)));
});

test('recovery expires other links and revokes old sessions', async () => {
  await verified();
  const oldCookie = (await login()).headers.get('set-cookie');
  await call('forgot-password', { email: 'eduardo@example.test' }); const first = token();
  await call('forgot-password', { email: 'eduardo@example.test' }); const second = token();
  const updated = 'uma-senha-totalmente-nova';
  assert.equal((await call('reset-password', { token: first, password: updated })).status, 200);
  assert.equal((await call('reset-password', { token: second, password })).status, 400);
  assert.equal(await getAuthenticatedUserId(cookieRequest(oldCookie)), null);
  assert.equal((await login()).status, 401); assert.equal((await login(updated)).status, 200);
});

test('logout revokes only the current server session', async () => {
  await verified();
  const a = (await login()).headers.get('set-cookie'); const b = (await login()).headers.get('set-cookie');
  assert.equal((await call('logout', {}, { Cookie: a })).status, 200);
  assert.equal(await getAuthenticatedUserId(cookieRequest(a)), null);
  assert.ok(await getAuthenticatedUserId(cookieRequest(b)));
});

test('expired and wrong-purpose tokens cannot change credentials', async () => {
  await register(); const link = token();
  assert.equal((await call('reset-password', { token: link, password })).status, 400);
  sqlite.exec('UPDATE auth_tokens SET expires_at = 1');
  assert.equal((await call('verify-email', { token: link, password })).status, 400);
  assert.equal(sqlite.prepare('SELECT email_verified_at FROM users').get().email_verified_at, null);
});

test('two concurrent verification requests have only one successful consumer', async () => {
  await register(); const body = { token: token(), password };
  const responses = await Promise.all([call('verify-email', body), call('verify-email', body)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 400]);
});

test('resend works for existing unverified accounts; duplicate registration preserves password', async () => {
  await register();
  const before = sqlite.prepare('SELECT password_hash FROM users').get().password_hash;
  const duplicate = await call('register', { name: 'Other', email: 'eduardo@example.test', password: 'outra-senha-bem-longa' });
  assert.equal(duplicate.status, 202); assert.equal(mail.length, 1);
  assert.equal(sqlite.prepare('SELECT password_hash FROM users').get().password_hash, before);
  assert.equal((await call('resend-verification', { email: 'eduardo@example.test' })).status, 202);
  assert.equal(mail.length, 2);
  assert.equal((await call('verify-email', { token: token(), password })).status, 200);
});

test('recovery and resend do not disclose account existence', async () => {
  await verified();
  const existing = await call('forgot-password', { email: 'eduardo@example.test' });
  const missing = await call('forgot-password', { email: 'missing@example.test' });
  assert.equal(existing.status, missing.status); assert.deepEqual(await existing.json(), await missing.json());
  const count = mail.length;
  assert.equal((await call('resend-verification', { email: 'eduardo@example.test' })).status, 202);
  assert.equal(mail.length, count);
});

test('account throttle persists across different IPs and returns retry-after', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await call('login', { email: 'missing@example.test', password }, { 'CF-Connecting-IP': `192.0.2.${i}` })).status, 401);
  const response = await call('login', { email: 'missing@example.test', password }, { 'CF-Connecting-IP': '192.0.2.90' });
  assert.equal(response.status, 429); assert.ok(Number(response.headers.get('retry-after')) > 0);
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM auth_rate_limits').all()).includes('missing@example.test'));
});

test('IP throttle stops attempts across different addresses and expires', async () => {
  for (let i = 0; i < 40; i++) assert.equal((await call('verify-email', { token: 'bad', password })).status, 400);
  assert.equal((await call('verify-email', { token: 'bad', password })).status, 429);
  sqlite.exec('UPDATE auth_rate_limits SET expires_at = 1');
  assert.equal((await call('verify-email', { token: 'bad', password })).status, 400);
});

test('validation rejects wrong origin, bad JSON, oversized payload and invalid inputs', async () => {
  assert.equal((await call('register', {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('register', {}, { 'Content-Type': 'text/plain' })).status, 415);
  for (const body of [null, [], { name: 'a', email: 'bad', password }, { name: 'a', email: 'a@example.test', password: 'short' }])
    assert.equal((await call('register', body)).status, 400);
  assert.equal((await call('register', { name: 'x'.repeat(5000) })).status, 413);
  const malformed = new Request('https://caderno.example/api/auth/register', { method: 'POST', headers: { Origin: 'https://caderno.example', 'Content-Type': 'application/json' }, body: '{' });
  assert.equal((await routes.register(malformed)).status, 400);
});

test('email failure leaves recoverable pending account, no session or live token', async () => {
  failMail = true;
  const response = await register();
  assert.equal(response.status, 503); assert.equal(response.headers.get('set-cookie'), null);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get().n, 0);
  failMail = false;
  assert.equal((await call('resend-verification', { email: 'eduardo@example.test' })).status, 202);
  assert.equal(mail.length, 1);
});

test('missing email config or insecure public URL fails closed before creating account', async () => {
  env.RESEND_API_KEY = '';
  assert.equal((await register()).status, 503);
  env.RESEND_API_KEY = 'test-key'; env.APP_URL = 'http://public.example';
  assert.equal((await register()).status, 503);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('legacy hashes remain compatible and malformed hashes fail closed', async () => {
  const hash = await hashPassword(password);
  assert.equal(await verifyPassword(password, hash), true);
  assert.equal(await verifyPassword('wrong', hash), false);
  assert.equal(await verifyPassword(password, hash.replace('$600000$', '$999999999$')), false);
  assert.equal(await verifyPassword(password, 'broken'), false);
});
