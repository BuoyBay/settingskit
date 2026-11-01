// Standalone browser module, also executable under Node with injected storage.
const MAX = 65536, LIMIT = 2147483647n;
function fail(message) { throw new Error(`SettingsKit: ${message}`); }
function unicode(s, max = 4096) {
  if (typeof s !== 'string' || s.length > max) fail('string size/type');
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const n = s.charCodeAt(i);
    if (n < 32 && n !== 9 && n !== 10 && n !== 13) fail('NUL/control');
    if (n >= 0xd800 && n <= 0xdbff) {
      const low = s.charCodeAt(++i);
      if (!(low >= 0xdc00 && low <= 0xdfff)) fail('unpaired surrogate');
      bytes += 4;
    } else if (n >= 0xdc00 && n <= 0xdfff) fail('unpaired surrogate');
    else bytes += n < 128 ? 1 : n < 2048 ? 2 : 3;
    if (bytes > max) fail('UTF8 byte size');
  }
  return s;
}
function integer(s) {
  if (typeof s !== 'string' || !/^(0|-?[1-9][0-9]*)$/.test(s)) fail('integer syntax');
  const n = BigInt(s);
  if (n < -(2n**63n) || n > 2n**63n-1n) fail('integer overflow');
  return n;
}
function keyCheck(k) { unicode(k, 64); if (!k.length || /[^\x00-\x7f]/.test(k)) fail('ASCII key required'); }
function unique(pairs) {
  if (!Array.isArray(pairs) || pairs.length > 128) fail('settings count');
  const m = new Map();
  for (const p of pairs) {
    if (!Array.isArray(p) || p.length !== 2) fail('pair');
    const [k, v] = p; keyCheck(k); unicode(v);
    if (m.has(k)) fail('duplicate key');
    m.set(k, v);
  }
  return m;
}
// Parse a deliberately small JSON subset, checking duplicates before constructing maps.
export function parseDocument(text) {
  unicode(text, MAX); let pos = 0;
  const ws = () => { while (/[ \n\r\t]/.test(text[pos] ?? '\0')) pos++; };
  function take(c) { ws(); if (text[pos++] !== c) fail('JSON token'); }
  function str() {
    take('"'); let s = '';
    while (pos < text.length) {
      let c = text[pos++];
      if (c === '"') return unicode(s);
      if (c === '\\') {
        c = text[pos++];
        const escapes = {'"':'"','\\':'\\','/':'/','n':'\n','r':'\r','t':'\t'};
        if (c === 'u') {
          const hex4 = () => {
            const hex=text.slice(pos,pos+4);
            if(!/^[0-9a-fA-F]{4}$/.test(hex)) fail('unicode escape');
            pos+=4; return parseInt(hex,16);
          };
          let n=hex4();
          if(n>=0xd800 && n<=0xdbff) {
            if(text.slice(pos,pos+2)!=='\\u') fail('missing low surrogate');
            pos+=2; const low=hex4();
            if(low<0xdc00 || low>0xdfff) fail('invalid low surrogate');
            n=0x10000+(n-0xd800)*1024+low-0xdc00;
          } else if(n>=0xdc00 && n<=0xdfff) fail('unpaired low surrogate');
          c=String.fromCodePoint(n);
        } else {
          if (!Object.hasOwn(escapes, c)) fail('unsupported escape');
          c = escapes[c];
        }
      } else if (c.charCodeAt(0) < 32) fail('raw control');
      s += c;
      if (s.length > 4096) fail('string bound');
    }
    fail('unterminated string');
  }
  function object(values = false) {
    const m = new Map(); take('{'); ws();
    if (text[pos] !== '}') {
      while (true) {
        const k = str(); if (m.has(k)) fail('duplicate JSON key'); take(':');
        m.set(k, !values && k === 'values' ? object(true) : str());
        if (m.size > 128) fail('member count');
        ws(); if (text[pos] !== ',') break; take(',');
      }
    }
    take('}'); return m;
  }
  const doc = object(); ws();
  if (pos !== text.length || doc.size !== 3 || !doc.has('version') || !doc.has('revision') || !(doc.get('values') instanceof Map)) fail('envelope');
  const version = integer(doc.get('version')), revision = integer(doc.get('revision'));
  if (version < 1n || version > 1000n || revision < 0n || revision > LIMIT) fail('version/revision');
  const values = unique([...doc.get('values')]);
  return {version:Number(version), revision:revision.toString(), values};
}
function encode(version, revision, values) {
  const body = [...values].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k,v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',');
  return unicode(`{"version":"${version}","revision":"${revision}","values":{${body}}}`, MAX);
}
export class MemoryStorage {
  #items = new Map(); failWrites = false;
  getItem(k) { return this.#items.get(k) ?? null; }
  setItem(k,v) { if (this.failWrites) fail('injected write'); this.#items.set(k,String(v)); }
  removeItem(k) { if (this.failWrites) fail('injected write'); this.#items.delete(k); }
}
export class BrowserSettings {
  #rules; #version; #validate; #migrate; #storage; #key; #target; #handler;
  #raw = ''; #values = new Map(); #revision = '0'; #future = false; #busy = false;
  #listeners = new Set(); #error;
  notificationFailed = false;
  constructor({version,rules,validate = () => {},migrate = () => fail('missing migration'),storage = globalThis.localStorage,key,eventTarget = globalThis.window,onError = () => {}}) {
    if (!Number.isInteger(version) || version < 1 || version > 1000 || !Array.isArray(rules) || rules.length > 128) fail('schema');
    keyCheck(key); this.#key=key; this.#version=version; this.#storage=storage;
    this.#rules=new Map(); this.#validate=validate; this.#migrate=migrate; this.#error=onError;
    for (const r of rules) {
      keyCheck(r.key); if (this.#rules.has(r.key)) fail('duplicate rule');
      if (!['text','integer','boolean'].includes(r.kind)) fail('kind');
      const copy = {...r, choices:[...(r.choices ?? [])]};
      if (r.kind === 'integer') {
        copy.minimum = BigInt(r.minimum); copy.maximum = BigInt(r.maximum);
      } else if (!Number.isSafeInteger(r.minimum) || !Number.isSafeInteger(r.maximum)) fail('bounds');
      if (copy.minimum > copy.maximum) fail('bounds');
      this.#rules.set(r.key,Object.freeze(copy)); this.#check(copy,r.default);
    }
    this.#normalize(new Map());
    this.#load(this.#readRaw());
    this.#target=eventTarget;
    this.#handler = e => {
      if (e.storageArea !== this.#storage || (e.key !== key && e.key !== null)) return;
      try { this.refresh(); } catch (err) { this.#error(err); }
    };
    eventTarget?.addEventListener('storage',this.#handler);
  }
  #readRaw() {
    const raw=this.#storage.getItem(this.#key);
    if(raw === '') fail('empty stored document');
    return raw ?? '';
  }
  #check(r,v) {
    unicode(v);
    if (r.choices.length && !r.choices.includes(v)) fail('choice');
    if (r.kind === 'integer') { const n=integer(v); if(n<r.minimum || n>r.maximum) fail('integer range'); }
    if (r.kind === 'boolean' && v !== 'true' && v !== 'false') fail('boolean');
    if (r.kind === 'text' && ([...v].length<r.minimum || [...v].length>r.maximum)) fail('text length');
  }
  #effective(values) { return new Map([...this.#rules].map(([k,r]) => [k,values.get(k) ?? r.default])); }
  #normalize(values) {
    const out=new Map(); unique([...values]);
    for(const [k,v] of values) { const r=this.#rules.get(k); if(!r) fail('unknown key'); this.#check(r,v); if(v!==r.default) out.set(k,v); }
    this.#validate(this.#effective(out)); return out;
  }
  #migrated(doc) {
    let pairs=[...doc.values];
    for(let v=doc.version;v<this.#version;v++) pairs=[...unique(this.#migrate(v,pairs.map(p=>[...p])))];
    return this.#normalize(unique(pairs));
  }
  #load(raw) {
    const doc=raw ? parseDocument(raw) : {version:this.#version,revision:'0',values:new Map()};
    const future=doc.version>this.#version, values=future ? new Map() : this.#migrated(doc);
    this.#raw=raw; this.#revision=doc.revision; this.#future=future; this.#values=values;
  }
  #notify(keys,origin) {
    this.notificationFailed=false;
    const event=Object.freeze({keys:Object.freeze([...keys].sort()),origin,revision:this.#revision});
    for(const listener of [...this.#listeners]) { try { listener(event); } catch { this.notificationFailed=true; } }
  }
  get(key) { if(!this.#rules.has(key)) fail('unknown key'); return this.#values.get(key) ?? this.#rules.get(key).default; }
  get revision() { return this.#revision; }
  get isFuture() { return this.#future; }
  get persistence() { return 'browser-local-visible-durability-unverified'; }
  export() { return this.#future ? this.#raw : encode(this.#version,this.#revision,this.#values); }
  snapshot() { return this.export(); }
  subscribe(listener) { this.#listeners.add(listener); return () => this.#listeners.delete(listener); }
  #guard(expected) {
    if(this.#busy) fail('reentrancy'); if(this.#future) fail('future read-only');
    if(expected!==this.#revision) fail('revision conflict');
  }
  #transaction(expected,origin,makeValues) {
    this.#guard(expected); this.#busy=true;
    try {
      unicode(origin); const next=this.#normalize(makeValues());
      const keys=[...new Set([...this.#values.keys(),...next.keys()])].filter(k => this.#values.get(k)!==next.get(k));
      if(!keys.length) return;
      if(BigInt(this.#revision)===LIMIT) fail('revision exhausted');
      const rev=(BigInt(this.#revision)+1n).toString(), raw=encode(this.#version,rev,next);
      if(this.#readRaw()!==this.#raw) fail('store conflict');
      this.#storage.setItem(this.#key,raw);
      if(this.#storage.getItem(this.#key)!==raw) fail('readback failed');
      this.#values=next; this.#revision=rev; this.#raw=raw; this.#notify(keys,origin);
    } finally { this.#busy=false; }
  }
  apply(pairs,expected,origin) {
    this.#transaction(expected,origin,() => {const m=new Map(this.#values); for(const [k,v] of unique(pairs)) m.set(k,v); return m;});
  }
  import(text,expected,origin) {
    this.#transaction(expected,origin,() => {const doc=parseDocument(text); if(doc.version>this.#version) fail('future import'); return this.#migrated(doc);});
  }
  reset(key,expected,origin) { const r=this.#rules.get(key); if(!r) fail('unknown key'); this.apply([[key,r.default]],expected,origin); }
  resetAll(expected,origin) { this.#transaction(expected,origin,() => new Map()); }
  refresh() {
    if(this.#busy) fail('reentrancy'); this.#busy=true;
    try {
      const raw=this.#readRaw(); if(raw===this.#raw) return;
      const before=this.#effective(this.#values), oldRaw=this.#raw;
      this.#load(raw);
      const after=this.#effective(this.#values), keys=[...before.keys()].filter(k => before.get(k)!==after.get(k));
      if(oldRaw!==raw) this.#notify(keys,'storage');
    } finally { this.#busy=false; }
  }
  close() { this.#target?.removeEventListener('storage',this.#handler); this.#listeners.clear(); }
}
