// Magic: The Gathering Comprehensive Rules, downloaded from Wizards by the local server.
const RULE_RE = /^(\d{3}(?:\.\d+[a-z]?)?)\.?\s+(.+)$/;

export const Rules = {
  loaded: false,
  error: null,
  entries: [],
  byId: new Map(),
  glossary: [],
  effective: '',
  source: '',

  async load() {
    try {
      const r = await fetch('/api/rules');
      if (!r.ok) throw new Error(await r.text());
      const buf = await r.arrayBuffer();
      const b = new Uint8Array(buf);
      const text = b[0] === 0xff && b[1] === 0xfe ? new TextDecoder('utf-16le').decode(buf) : new TextDecoder('utf-8').decode(buf);
      this.source = r.headers.get('X-Rules-Source') || '';
      this.parse(text);
      this.loaded = true;
    } catch (e) {
      this.error = e.message || String(e);
    }
    return this;
  },

  parse(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const eff = text.match(/effective as of ([^.]+)\./i);
    this.effective = eff ? eff[1] : '';
    const glossaryIdx = lines.map((l, i) => (l.trim() === 'Glossary' ? i : -1)).filter(i => i >= 0);
    const creditsIdx = lines.map((l, i) => (l.trim() === 'Credits' ? i : -1)).filter(i => i >= 0);
    const bodyStart = lines.findIndex((l, i) => i > (glossaryIdx[0] ?? 0) && /^100\.1\.?\s/.test(l.trim()));
    const glStart = glossaryIdx.at(-1) ?? lines.length;
    const glEnd = creditsIdx.at(-1) > glStart ? creditsIdx.at(-1) : lines.length;
    let last = null;
    for (let i = Math.max(0, bodyStart - 40); i < glStart; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const m = line.match(RULE_RE);
      if (m && (i >= bodyStart || /^\d{3}\.?\s/.test(line))) {
        last = { id: m[1], text: m[2] };
        this.byId.set(last.id, last);
      } else if (last && i >= bodyStart) {
        last.text += '\n' + line;
      }
    }
    this.entries = [...this.byId.values()];
    let term = null;
    for (let i = glStart + 1; i < glEnd; i++) {
      const line = lines[i].trim();
      if (!line) { term = null; continue; }
      if (!term) { term = { term: line, def: '' }; this.glossary.push(term); }
      else term.def += (term.def ? '\n' : '') + line;
    }
  },

  get(id) { return this.byId.get(id); },

  children(id) {
    return this.entries.filter(e => e.id === id || (e.id.startsWith(id) && (/^[a-z]$/.test(e.id.slice(id.length)) || (/^\d{3}$/.test(id) && e.id[3] === '.'))));
  },

  keyword(kw) {
    const head = this.entries.find(e => /^702\.\d+$/.test(e.id) && e.text.toLowerCase() === kw.toLowerCase());
    if (!head) return null;
    return { id: head.id, text: this.get(head.id + 'a')?.text || '' };
  },

  search(q) {
    q = q.trim();
    if (!q) return { rules: [], glossary: [] };
    if (/^\d{3}(\.\d+[a-z]?)?\.?$/.test(q)) return { rules: this.children(q.replace(/\.$/, '')).slice(0, 120), glossary: [] };
    const words = q.toLowerCase().split(/\s+/);
    const hit = s => words.every(w => s.toLowerCase().includes(w));
    return {
      glossary: this.glossary.filter(g => hit(g.term)).concat(this.glossary.filter(g => !hit(g.term) && hit(g.def))).slice(0, 8),
      rules: this.entries.filter(e => hit(e.text)).slice(0, 80),
    };
  },
};
