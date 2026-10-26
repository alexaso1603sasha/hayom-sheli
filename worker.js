// שרת ההתראות של "היום שלי" - Cloudflare Worker (קובץ יחיד).
// דורש: KV בשם KV, סודות VAPID_PUBLIC ו-VAPID_PRIVATE, משתנה VAPID_SUBJECT, וטריגר Cron כל דקה.

const enc = new TextEncoder();
const b64uToBytes = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); s += '='.repeat((4 - s.length % 4) % 4); return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
const bytesToB64u = b => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const concat = (...arrs) => { const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; };

/* ---------- Web Push (RFC 8291 + 8292) ---------- */
async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

async function encryptPayload(sub, plaintext) {
  const uaPublic = b64uToBytes(sub.keys.p256dh), authSecret = b64uToBytes(sub.keys.auth);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const data = concat(enc.encode(plaintext), new Uint8Array([2]));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, data));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = 65;
  return concat(header, asPublic, cipher);
}

async function vapidJwt(audience, subject, pub, priv) {
  const p = b64uToBytes(pub);
  const jwk = { kty: 'EC', crv: 'P-256', x: bytesToB64u(p.slice(1, 33)), y: bytesToB64u(p.slice(33, 65)), d: priv, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = bytesToB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64u(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const input = `${header}.${claims}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(input)));
  return `${input}.${bytesToB64u(sig)}`;
}

async function buildRequest(sub, payloadText, env) {
  const jwt = await vapidJwt(new URL(sub.endpoint).origin, env.VAPID_SUBJECT || 'mailto:admin@example.com', env.VAPID_PUBLIC, env.VAPID_PRIVATE);
  return {
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '3600',
      'Urgency': 'high',
      'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`
    },
    body: await encryptPayload(sub, payloadText)
  };
}

async function sendPush(sub, payloadText, env) {
  const { headers, body } = await buildRequest(sub, payloadText, env);
  return fetch(sub.endpoint, { method: 'POST', headers, body });
}

/* ---------- לוגיקת תזכורות ---------- */
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function localNow(tz, at = new Date()) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(at);
  } catch (e) { return localNow('UTC', at); }
  const g = type => parts.find(p => p.type === type).value;
  return {
    date: `${g('year')}-${g('month')}-${g('day')}`,
    minutes: (Number(g('hour')) % 24) * 60 + Number(g('minute')),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'))
  };
}

// מחזירה את התזכורות שהגיע זמנן ועוד לא נשלחו. חלון של 5 דקות כדי לא לפספס אם ה-Cron התעכב.
function findDue(data, now, sent) {
  const due = [];
  for (let off = 0; off < 2; off++) {
    const date = addDays(now.date, off), weekday = (now.weekday + off) % 7;
    for (const t of data.tasks || []) {
      if (!t || t.type === 'general' || !t.time || !t.reminder || t.reminder === 'none') continue;
      const occurs = t.type === 'dated' ? t.date === date : t.type === 'recurring' && Array.isArray(t.days) && t.days.includes(weekday);
      if (!occurs || (t.done && t.done[date])) continue;
      const [h, m] = String(t.time).split(':').map(Number);
      if (Number.isNaN(h) || Number.isNaN(m)) continue;
      const at = off * 1440 + h * 60 + m - Number(t.reminder);
      const id = `${t.id}|${date}`;
      if (now.minutes >= at && now.minutes < at + 5 && !sent[id]) due.push({ id, title: String(t.title || ''), tag: `${t.id}-${date}` });
    }
  }
  return due;
}

async function processUser(env, code) {
  const data = await env.KV.get('d:' + code, 'json');
  if (!data) return;
  const now = localNow(data.tz || 'UTC');
  const sentRaw = (await env.KV.get('x:' + code, 'json')) || {};
  const due = findDue(data, now, sentRaw);
  if (!due.length) return;
  let subs = (await env.KV.get('s:' + code, 'json')) || [];
  if (!subs.length) return;
  const sent = { ...sentRaw }, gone = new Set();
  for (const item of due) {
    const payload = JSON.stringify({ title: 'יומי', body: `תזכורת: ${item.title}`, tag: item.tag });
    let delivered = false;
    for (const sub of subs) {
      try {
        const res = await sendPush(sub, payload, env);
        if (res.status === 404 || res.status === 410) gone.add(sub.endpoint);
        else if (res.ok) delivered = true;
      } catch (e) { /* ננסה שוב בדקה הבאה */ }
    }
    if (delivered || gone.size === subs.length) sent[item.id] = now.date;
  }
  const cutoff = addDays(now.date, -2);
  for (const k of Object.keys(sent)) if (sent[k] < cutoff) delete sent[k];
  await env.KV.put('x:' + code, JSON.stringify(sent), { expirationTtl: 259200 });
  if (gone.size) await env.KV.put('s:' + code, JSON.stringify(subs.filter(s => !gone.has(s.endpoint))));
}

async function runCron(env) {
  const codes = (await env.KV.get('idx', 'json')) || [];
  for (const code of codes) {
    try { await processUser(env, code); } catch (e) { console.log('user error', e && e.message); }
  }
}

/* ---------- API ---------- */
const cors = env => ({ 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
const reply = (env, data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors(env) } });
const validCode = c => typeof c === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(c);

async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });

  if (url.pathname === '/api/vapid' && request.method === 'GET') return reply(env, { key: env.VAPID_PUBLIC || '' });

  if (url.pathname === '/api/sync' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!validCode(code)) return reply(env, { error: 'bad code' }, 400);
    return reply(env, (await env.KV.get('d:' + code, 'json')) || {});
  }

  if (url.pathname === '/api/sync' && request.method === 'PUT') {
    const text = await request.text();
    if (text.length > 400000) return reply(env, { error: 'too large' }, 413);
    let body; try { body = JSON.parse(text); } catch (e) { return reply(env, { error: 'bad json' }, 400); }
    if (!validCode(body.code) || !Array.isArray(body.tasks) || !Array.isArray(body.groups)) return reply(env, { error: 'bad data' }, 400);
    await env.KV.put('d:' + body.code, JSON.stringify({ tasks: body.tasks, groups: body.groups, tz: String(body.tz || 'UTC'), updatedAt: Number(body.updatedAt) || Date.now() }));
    const idx = (await env.KV.get('idx', 'json')) || [];
    if (!idx.includes(body.code)) { idx.push(body.code); await env.KV.put('idx', JSON.stringify(idx)); }
    return reply(env, { ok: true });
  }

  if (url.pathname === '/api/subscribe' && request.method === 'POST') {
    let body; try { body = await request.json(); } catch (e) { return reply(env, { error: 'bad json' }, 400); }
    const s = body.subscription;
    if (!validCode(body.code) || !s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://') || !s.keys || !s.keys.p256dh || !s.keys.auth) return reply(env, { error: 'bad subscription' }, 400);
    const subs = ((await env.KV.get('s:' + body.code, 'json')) || []).filter(x => x.endpoint !== s.endpoint);
    subs.push({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth } });
    await env.KV.put('s:' + body.code, JSON.stringify(subs.slice(-10)));
    return reply(env, { ok: true });
  }

  return reply(env, { ok: true, name: 'hayom-sheli-push' });
}

export default {
  fetch: (request, env) => handle(request, env).catch(e => reply(env, { error: String(e && e.message) }, 500)),
  scheduled: (event, env, ctx) => { ctx.waitUntil(runCron(env)); }
};
