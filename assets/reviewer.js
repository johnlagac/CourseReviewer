/* ============================================================
   Course Reviewer engine — shared by every subject.
   Load this file, then call REVIEWER.init(config) from the
   subject page. Nothing here is subject-specific; everything a
   subject supplies goes through init(). Schema: see HANDOVER.md
   ============================================================ */
(function(){
'use strict';


/* ============================================================
   STORAGE — localStorage with an in-memory fallback, because
   some browsers throw on localStorage under file://
   ============================================================ */
function makeStore(ns){
  var mem = {};
  function k(key){ return 'rv:' + ns + ':' + key; }
  return {
    get: function(key, dflt){
      var raw = null;
      try { raw = localStorage.getItem(k(key)); } catch(e){}
      if (raw === null || raw === undefined) raw = mem[k(key)];
      if (raw === null || raw === undefined) return dflt;
      try { var o = JSON.parse(raw); return (o && o.v === 1) ? o.d : dflt; } catch(e){ return dflt; }
    },
    set: function(key, val){
      var raw = JSON.stringify({ v:1, d:val });
      mem[k(key)] = raw;
      try { localStorage.setItem(k(key), raw); } catch(e){}
    },
    del: function(key){
      delete mem[k(key)];
      try { localStorage.removeItem(k(key)); } catch(e){}
    }
  };
}

/* Shared across every subject and the landing page, so one theme
   choice follows the reader everywhere. Exposed as REVIEWER.theme
   so a page without the full engine can read and write it too. */
var theme = {
  KEY: 'rv:theme',
  get: function(){
    try { return localStorage.getItem(theme.KEY); } catch(e){ return null; }
  },
  set: function(t){
    try { localStorage.setItem(theme.KEY, t); } catch(e){}
  }
};

/* ============================================================
   HELPERS
   ============================================================ */
var $ = function(id){ return document.getElementById(id); };

function esc(s){
  return String(s).replace(/[&<>"]/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];
  });
}

/* Numeric parsing. Accounting parentheses negate; a trailing %
   divides; currency and separators are stripped. A stray letter
   anywhere makes it invalid rather than silently parsing. */
function parseNum(raw){
  if (raw === null || raw === undefined) return NaN;
  var s = String(raw).trim();
  if (!s) return NaN;
  var neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1).trim(); }
  if (/^[-−–]/.test(s)) { neg = !neg; s = s.replace(/^[-−–]\s*/, ''); }
  var pct = /%\s*$/.test(s);
  s = s.replace(/[₱$€£¥]/g, '')
       .replace(/[\s,_]/g, '')
       .replace(/%$/, '')
       .replace(/[xX×]$/, '');
  if (!/^\d*\.?\d+(e[+-]?\d+)?$/i.test(s)) return NaN;
  var v = parseFloat(s);
  if (!isFinite(v)) return NaN;
  if (pct) v = v / 100;
  return neg ? -v : v;
}

function readNum(raw, item){
  var v = parseNum(raw);
  if (isNaN(v)) return NaN;
  /* unit:'%' items store the answer as a decimal. A bare number
     of 1 or more must have been meant as a percentage. */
  if (item.unit === '%' && String(raw).indexOf('%') === -1 && Math.abs(v) >= 1) v = v / 100;
  return v;
}

function numOk(v, item){
  if (isNaN(v)) return false;
  if (item.tol  !== undefined) return Math.abs(v - item.a) <= item.tol;
  if (item.rtol !== undefined) return Math.abs(v - item.a) <= Math.abs(item.a) * item.rtol;
  return Math.abs(v - item.a) <= Math.max(Math.abs(item.a) * 0.005, 1e-9);
}

function normText(s){
  return String(s).toLowerCase()
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\b(the|a|an|of|for|to|is|are|in|on)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/* Bounded edit distance, so one typo still counts */
function lev(a, b, cap){
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  var prev = [], cur = [], i, j;
  for (j = 0; j <= b.length; j++) prev[j] = j;
  for (i = 1; i <= a.length; i++){
    cur[0] = i; var best = i;
    for (j = 1; j <= b.length; j++){
      cur[j] = Math.min(prev[j] + 1, cur[j-1] + 1, prev[j-1] + (a.charAt(i-1) === b.charAt(j-1) ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > cap) return cap + 1;
    prev = cur.slice();
  }
  return prev[b.length];
}

/* Exact match after normalising, plus one typo. No substring
   matching — "X is not what you want" must not score as "X". */
function textOk(raw, item){
  var t = normText(raw);
  if (!t) return false;
  var accepted = item.a.map(normText);
  if (accepted.indexOf(t) > -1) return true;
  return accepted.some(function(x){
    var cap = x.length > 8 ? 2 : 1;
    return x.length >= 4 && lev(t, x, cap) <= cap;
  });
}

/* ------------------------------------------------------------
   CODE ANSWERS

   normText above cannot grade code and must never be used for it.
   It lowercases (so True and true collapse), strips every operator
   and bracket (so len(a) becomes "len" and x != y becomes "x y"),
   removes the words for/is/in, and then forgives two characters of
   typo — which between them score `x < 5` as a correct answer to
   `x > 5`, and range(6) as a correct answer to range(5).

   So code is matched exactly, after normalising only what is
   genuinely insignificant in Python: surrounding whitespace,
   spacing around operators and delimiters, and quote style (PEP 8
   deliberately leaves that to taste). Case is preserved because
   Python is case-sensitive, and there is no edit-distance
   tolerance because in code two characters is the whole answer.
   ------------------------------------------------------------ */
/* ============================================================
   PYTHON RUNTIME

   Runs real CPython in the page via Pyodide, so a reader can edit
   a snippet and see what it actually does. Three decisions worth
   knowing, each of them measured rather than assumed:

   1. It runs in a Web Worker, not on the main thread. Beginners
      write infinite loops, and on the main thread `while True:`
      freezes the tab permanently with no way back. A worker can
      be terminated, which is what RUN_TIMEOUT below does.

   2. The runtime is fetched from a CDN, never from disk. A page
      opened by double-click has a `file://` origin, and browsers
      refuse to fetch one local file from another — so a vendored
      copy cannot work, while a cross-origin CDN fetch can, and
      does. The cost is that the first run of a session needs
      network; everything is browser-cached afterwards.

   3. One interpreter serves the whole page, so imports and names
      persist between cells the way they do in a notebook. Killing
      a runaway cell resets that, and the UI says so.

   If the runtime cannot load — offline, or a blocked CDN — cells
   fall back to showing their expected output and say why. Nothing
   else on the page depends on any of this.
   ============================================================ */
var PY_INDEX_URL = 'https://cdn.jsdelivr.net/pyodide/v0.28.3/full/';
var RUN_TIMEOUT  = 15000;   /* ms before a cell is assumed runaway */

var PyRunner = (function(){
  var worker = null, booting = null, seq = 0, pending = {}, loaded = {};
  var INDEX = PY_INDEX_URL;

  /* The worker is built from a Blob so it inherits this page's
     origin and may importScripts the cross-origin runtime. */
  function workerSource(){
    return [
      'importScripts(' + JSON.stringify(INDEX + 'pyodide.js') + ');',
      'var py = null;',
      'self.onmessage = async function(e){',
      '  var m = e.data;',
      '  try {',
      '    if (m.cmd === "boot"){',
      '      py = await loadPyodide({ indexURL: ' + JSON.stringify(INDEX) + ' });',
      '      self.postMessage({ id:m.id, ok:true });',
      '    } else if (m.cmd === "load"){',
      '      await py.loadPackage(m.pkgs);',
      '      self.postMessage({ id:m.id, ok:true });',
      '    } else if (m.cmd === "run"){',
      '      var buf = "";',
      '      py.setStdout({ batched: function(s){ buf += s + "\\n"; } });',
      '      py.setStderr({ batched: function(s){ buf += s + "\\n"; } });',
      '      try {',
      '        await py.runPythonAsync(m.code);',
      '        self.postMessage({ id:m.id, ok:true, out:buf });',
      '      } catch (err){',
      '        self.postMessage({ id:m.id, ok:false, out:buf, err:String(err) });',
      '      }',
      '    }',
      '  } catch (err){',
      '    self.postMessage({ id:m.id, ok:false, err:String(err && err.message || err) });',
      '  }',
      '};'
    ].join('\n');
  }

  function spawn(){
    var url = URL.createObjectURL(new Blob([workerSource()], { type:'text/javascript' }));
    var w = new Worker(url);
    w.onmessage = function(e){
      var p = pending[e.data.id];
      if (!p) return;
      delete pending[e.data.id];
      clearTimeout(p.timer);
      p.resolve(e.data);
    };
    w.onerror = function(){
      /* Usually a blocked or unreachable CDN. Fail every waiter so
         no cell is left spinning forever. */
      Object.keys(pending).forEach(function(k){
        clearTimeout(pending[k].timer);
        pending[k].resolve({ ok:false, err:'runtime-unavailable' });
        delete pending[k];
      });
      booting = null;
    };
    return w;
  }

  function send(msg, timeout){
    if (!worker) return Promise.resolve({ ok:false, err:'runtime-unavailable' });
    var id = ++seq;
    msg.id = id;
    return new Promise(function(resolve){
      pending[id] = { resolve:resolve, timer:setTimeout(function(){
        delete pending[id];
        /* Assume runaway code. Killing the worker is the only way
           back, and it discards every name the page had defined. */
        kill();
        resolve({ ok:false, err:'timeout' });
      }, timeout || RUN_TIMEOUT) };
      worker.postMessage(msg);
    });
  }

  function kill(){
    if (worker){ worker.terminate(); worker = null; }
    booting = null; loaded = {}; pending = {};
  }

  function boot(){
    if (booting) return booting;
    try { worker = spawn(); }
    catch (e){ return Promise.resolve({ ok:false, err:'runtime-unavailable' }); }
    /* The first boot pulls ~13MB, so it gets a longer leash. */
    booting = send({ cmd:'boot' }, 120000).then(function(r){
      if (!r.ok) kill();
      return r;
    });
    return booting;
  }

  function need(pkgs){
    var want = (pkgs || []).filter(function(p){ return !loaded[p]; });
    if (!want.length) return Promise.resolve({ ok:true });
    return send({ cmd:'load', pkgs:want }, 120000).then(function(r){
      if (r.ok) want.forEach(function(p){ loaded[p] = true; });
      return r;
    });
  }

  return {
    /* Resolves {ok, out, err}. Never rejects — callers render the
       failure rather than handling an exception. */
    run: function(code, pkgs){
      return boot().then(function(b){
        if (!b.ok) return b;
        return need(pkgs).then(function(l){
          if (!l.ok) return l;
          return send({ cmd:'run', code:code });
        });
      });
    },
    booted: function(){ return !!worker; },
    reset: kill,
    /* Point at a self-hosted copy instead of the CDN. Only useful
       when the page is served over http — see the note above. */
    configure: function(url){ if (url){ kill(); INDEX = url; } }
  };
})();

/* ------------------------------------------------------------
   PYTHON HIGHLIGHTING — display only, never grading.

   A reviewer for a programming course asks the reader to read a
   lot of code, so the code is coloured. This is a single-pass
   tokeniser rather than a parser: comments and strings are
   matched before identifiers, so a keyword inside a string is not
   recoloured. Anything it fails to recognise is emitted verbatim,
   which is why it can safely run over arbitrary content.
   ------------------------------------------------------------ */
var PY_KW = /^(False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)$/;
var PY_BI = /^(abs|all|any|bool|dict|dir|divmod|enumerate|filter|float|format|frozenset|getattr|help|hex|id|input|int|isinstance|issubclass|iter|len|list|map|max|min|next|object|open|ord|pow|print|range|repr|reversed|round|set|setattr|sorted|str|sum|super|tuple|type|vars|zip)$/;

function pyHighlight(src){
  /* Order matters: comment, then string, then number, then word. */
  var re = /(#[^\n]*)|("""[\s\S]*?"""|'''[\s\S]*?'''|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')|(\b\d[\w.]*)|([A-Za-z_]\w*)|([\s\S])/g;
  var out = '', m;
  while ((m = re.exec(src)) !== null){
    if (m[1])      out += '<i class="k-cm">' + esc(m[1]) + '</i>';
    else if (m[2]) out += '<i class="k-st">' + esc(m[2]) + '</i>';
    else if (m[3]) out += '<i class="k-nu">' + esc(m[3]) + '</i>';
    else if (m[4]){
      if (PY_KW.test(m[4]))      out += '<i class="k-kw">' + m[4] + '</i>';
      else if (PY_BI.test(m[4])) out += '<i class="k-bi">' + m[4] + '</i>';
      else                       out += esc(m[4]);
    }
    else out += esc(m[5]);
  }
  return out;
}

/* Idempotent, so it can run again when a quiz mounts later and
   brings its own code blocks in a solution. */
function highlightCode(root){
  var blocks = (root || document).querySelectorAll('.codeblock:not(.out):not(.lit)');
  for (var i = 0; i < blocks.length; i++){
    var b = blocks[i];
    /* A caption is prose, not code. Lift it out before reading
       textContent, or it gets tokenised into the first line. */
    var cap = b.querySelector('.codecap'), capHTML = '';
    if (cap){ capHTML = cap.outerHTML; cap.parentNode.removeChild(cap); }
    b.innerHTML = capHTML + pyHighlight(b.textContent.replace(/^\n/, ''));
    b.classList.add('lit');
  }
}

/* ------------------------------------------------------------
   RUNNABLE CELL — the editor, its Run button and its output.
   `spec` is { code, pkgs, test, sol, solcode, onSettle }.
   onSettle(passed) is called only for cells that carry a test.
   ------------------------------------------------------------ */
function buildPyCell(spec){
  var el = document.createElement('div');
  el.className = 'pyc' + (spec.test ? ' ex' : '');
  el.innerHTML =
    (spec.q ? '<div class="pyq">' + spec.q + '</div>' : '') +
    '<div class="pyc-bar">' +
      '<button type="button" class="btn sm run">Run</button>' +
      (spec.test ? '<button type="button" class="btn ghost sm check">Run tests</button>' : '') +
      '<button type="button" class="btn ghost sm reset">Reset</button>' +
      (spec.sol || spec.solcode ? '<button type="button" class="btn ghost sm peek">Show solution</button>' : '') +
      '<span class="pyc-state"></span>' +
    '</div>' +
    '<textarea class="pyc-in" spellcheck="false" autocapitalize="off" autocorrect="off"></textarea>' +
    '<div class="pyc-out" hidden></div>' +
    (spec.sol || spec.solcode ? '<div class="sol">' + (spec.sol || '') +
      (spec.solcode ? '<div class="codeblock">' + esc(spec.solcode) + '</div>' : '') + '</div>' : '');

  var ta    = el.querySelector('.pyc-in');
  var out   = el.querySelector('.pyc-out');
  var state = el.querySelector('.pyc-state');
  var sol   = el.querySelector('.sol');
  var start = spec.code || '';
  var settled = false;

  ta.value = start;
  /* Line count is a reliable size even while the section is still
     hidden; measuring is not, because a display:none element
     reports a scrollHeight of 0 and would collapse the box. */
  ta.rows = Math.max(3, start.split('\n').length + 1);
  function autosize(){
    ta.style.height = 'auto';
    if (ta.scrollHeight > 0) ta.style.height = (ta.scrollHeight + 2) + 'px';
  }
  ta.addEventListener('input', autosize);

  /* Tab must indent, not move focus — this is Python. Shift+Tab
     removes one level. Escape restores tabbing out, for keyboard
     users who would otherwise be trapped in the box. */
  var trap = true;
  ta.addEventListener('keydown', function(e){
    if (e.key === 'Escape'){ trap = false; return; }
    if (e.key !== 'Tab' || !trap) return;
    e.preventDefault();
    var s = ta.selectionStart, t = ta.selectionEnd, v = ta.value;
    if (e.shiftKey){
      var ls = v.lastIndexOf('\n', s - 1) + 1;
      if (v.slice(ls, ls + 4) === '    '){
        ta.value = v.slice(0, ls) + v.slice(ls + 4);
        ta.selectionStart = ta.selectionEnd = Math.max(ls, s - 4);
      }
    } else {
      ta.value = v.slice(0, s) + '    ' + v.slice(t);
      ta.selectionStart = ta.selectionEnd = s + 4;
    }
    autosize();
  });
  ta.addEventListener('focus', function(){ trap = true; });

  function show(cls, text){
    out.hidden = false;
    out.className = 'pyc-out ' + cls;
    out.textContent = text;
  }
  function busy(msg){ state.className = 'pyc-state busy'; state.textContent = msg; }
  function idle(cls, msg){ state.className = 'pyc-state ' + (cls || ''); state.textContent = msg || ''; }

  function explain(err){
    if (err === 'runtime-unavailable')
      return 'Python could not start. The runtime is downloaded the first time you press Run, so this usually means no internet connection — or that something is blocking jsdelivr.net. Everything else on this page works offline; only the Run button needs the network, and only once per browser.';
    if (err === 'timeout')
      return 'Stopped after ' + (RUN_TIMEOUT / 1000) + ' seconds. That is almost always a loop that never ends — check that something in the body changes the condition. The interpreter was restarted, so anything you defined in earlier cells is gone; run those cells again.';
    return err;
  }

  function exec(code, pkgs, after){
    if (!PyRunner.booted()) busy('Starting Python — first run downloads the runtime…');
    else busy('Running…');
    out.hidden = true;
    return PyRunner.run(code, pkgs).then(function(r){
      if (!r.ok && (r.err === 'runtime-unavailable' || r.err === 'timeout')){
        idle('no', r.err === 'timeout' ? 'Stopped' : 'Unavailable');
        show('err', explain(r.err));
        return null;
      }
      idle('');
      after(r);
      return r;
    });
  }

  el.querySelector('.run').onclick = function(){
    exec(ta.value, spec.pkgs, function(r){
      var body = (r.out || '').replace(/\n+$/, '');
      if (r.ok){
        show('', body || '(ran without printing anything)');
        idle('ok', 'Ran');
      } else {
        show('err', (body ? body + '\n' : '') + lastLine(r.err));
        idle('no', 'Error');
      }
    });
  };

  var chk = el.querySelector('.check');
  if (chk) chk.onclick = function(){
    /* The reader's code and the test run as one program, so the
       test sees exactly the names the reader defined. */
    exec(ta.value + '\n\n' + spec.test, spec.pkgs, function(r){
      var body = (r.out || '').replace(/\n+$/, '');
      if (r.ok){
        show('ok', (body ? body + '\n\n' : '') + 'All tests passed.');
        idle('ok', 'Passed');
        if (!settled){ settled = true; if (spec.onSettle) spec.onSettle(true); }
      } else {
        show('err', (body ? body + '\n' : '') + lastLine(r.err));
        idle('no', 'Failed');
      }
    });
  };

  el.querySelector('.reset').onclick = function(){
    ta.value = start; autosize(); out.hidden = true; idle('');
  };

  var peek = el.querySelector('.peek');
  if (peek) peek.onclick = function(){
    var on = sol.classList.toggle('on');
    this.textContent = on ? 'Hide solution' : 'Show solution';
    /* Same rule as a concept check: seeing the answer first means
       it is not earned. */
    if (on && !settled){
      settled = true;
      if (spec.onSettle) spec.onSettle(false);
      idle('rv', 'Revealed — not scored');
    }
    if (on) highlightCode(sol);
  };

  return el;
}

function lastLine(s){
  var parts = String(s).split('\n').filter(function(x){ return x.trim(); });
  return parts.length ? parts[parts.length - 1] : String(s);
}

/* A sentinel that cannot occur in Python source, so a lifted
   literal is never confused with real code. */
var SENT = '@';

function normCode(s){
  var t = String(s).replace(/\r\n?/g, '\n')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  /* Lift string literals out first, so the spacing rules below
     cannot reach inside them: the space in ', '.join(x) is data,
     not formatting, and collapsing it changes the output. */
  var lits = [];
  t = t.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, function(m){
    lits.push(m.slice(1, -1));
    return SENT + (lits.length - 1) + SENT;
  });
  t = t.replace(/[ \t]+/g, ' ')
       .replace(/\s*([^\w\s@])\s*/g, '$1')  /* x > 5 === x>5 */
       .replace(/\n+/g, '\n')
       .trim();
  /* Restore with one quote style, so 'a' and "a" compare equal. */
  return t.replace(/@(\d+)@/g, function(_, i){ return '"' + lits[+i] + '"'; });
}

function codeOk(raw, item){
  var t = normCode(raw);
  if (!t) return false;
  var accepted = (item.a instanceof Array ? item.a : [item.a]).map(normCode);
  return accepted.indexOf(t) > -1;
}

/* One dispatch for every typed-input question, shared by the
   immediate check and by deferred grading, so the two can never
   disagree about what counts as correct. */
function inputOk(raw, item){
  if (item.t === 'num')  return numOk(readNum(raw, item), item);
  if (item.t === 'code') return codeOk(raw, item);
  return textOk(raw, item);
}

function shuffle(arr, rnd){
  var a = arr.slice(), i, j, tmp;
  for (i = a.length - 1; i > 0; i--){
    j = Math.floor((rnd ? rnd() : Math.random()) * (i + 1));
    tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}
function range(n){ var a = [], i; for (i = 0; i < n; i++) a[i] = i; return a; }
var LET = ['A','B','C','D','E','F'];
/* ============================================================
   INIT — everything below depends on the subject's config and on
   the DOM, so it lives inside one call rather than at module scope.
   ============================================================ */
function init(cfg){
  cfg = cfg || {};

  var store        = makeStore(cfg.id || 'reviewer');
  var BANKS        = cfg.banks || {};
  var TOPIC_TITLES = cfg.topicTitles || {};
  var EXAM         = cfg.exam || null;
  var TREE         = (cfg.map && cfg.map.tree) || null;
  var RES          = (cfg.map && cfg.map.results) || null;
  var EXERCISES    = (cfg.python && cfg.python.exercises) || {};
  if (cfg.python && cfg.python.indexURL) PyRunner.configure(cfg.python.indexURL);

  /* Stable ids, so saved progress keeps tracking the right question. */
  Object.keys(BANKS).forEach(function(k){
    BANKS[k].forEach(function(q, i){ q.id = k + '-' + (i + 1); q.topic = k; });
  });
  Object.keys(EXERCISES).forEach(function(k){
    EXERCISES[k].forEach(function(x, i){ x.id = 'x-' + k + '-' + (i + 1); x.topic = k; });
  });

  /* ============================================================
     PROGRESS (study-mode concept checks only)
     ============================================================ */
  var progress = store.get('progress', {});
  var pbar = $('pbar'), pscore = $('pscore');
  function paintProgress(){
    var ids = Object.keys(progress), tot = 0, right = 0, i;
    var total = 0;
    Object.keys(BANKS).forEach(function(k){ total += BANKS[k].length; });
    Object.keys(EXERCISES).forEach(function(k){ total += EXERCISES[k].length; });
    for (i = 0; i < ids.length; i++){ tot++; if (progress[ids[i]] === 1) right++; }
    if (pbar) pbar.style.width = total ? (tot / total * 100) + '%' : '0%';
    if (pscore) pscore.textContent = right + ' / ' + tot + ' correct';
  }
  function record(id, ok){
    progress[id] = ok ? 1 : 0;
    store.set('progress', progress);
    paintProgress();
  }

  /* ============================================================
     QUESTION RENDERER
     mode 'study' — mark immediately, Show answer available
     mode 'test'  — collect answers, grade on submit
     ============================================================ */
  function makeView(item){
    var n = (item.opts || []).length;
    var ord;
    if (item.t === 'tf') ord = range(n);              /* True/False must stay in order */
    else if (item.t === 'mc' || item.t === 'ms') ord = shuffle(range(n));
    else ord = range(n);
    return { src:item, order:ord, picked:null, picks:[], raw:'',
             locked:false, revealed:false, correct:false, answered:false };
  }

  function buildItem(v, idx, mode){
    var item = v.src;
    var el = document.createElement('div');
    el.className = 'q';
    var head = '<div class="qhead"><div class="qn">' + (idx + 1) + '</div><div class="qtext">' + item.q + '</div></div>';
    var body = '';
    var i;

    if (item.t === 'mc' || item.t === 'ms' || item.t === 'tf'){
      body = '<div class="opts">';
      for (i = 0; i < v.order.length; i++){
        var oi = v.order[i];
        var letter = item.t === 'tf' ? (oi === 0 ? 'T' : 'F') : LET[i];
        body += '<button type="button" class="opt" data-oi="' + oi + '">' +
                '<span class="ol">' + letter + '</span><span>' + item.opts[oi] + '</span></button>';
      }
      body += '</div>';
      if (item.t === 'ms') body += '<div class="ansrow"><button type="button" class="btn sm chk">Check selection</button><span class="vd"></span></div>';
    } else {
      var isCode = item.t === 'code';
      var ph = item.t === 'num' ? 'Type a number' : isCode ? 'Type the Python' : 'Type your answer';
      /* Phone keyboards capitalise and autocorrect by default, which
         silently rewrites Python into something that cannot be right. */
      var attrs = isCode ? ' autocapitalize="off" autocorrect="off" spellcheck="false"' : '';
      body = '<div class="ansrow"><input class="ain' + (isCode ? ' code' : '') +
             '" placeholder="' + ph + '" autocomplete="off"' + attrs + '>' +
             (mode === 'study' ? '<button type="button" class="btn sm chk">Check</button>' : '') +
             '<span class="vd"></span></div>';
    }

    var foot = mode === 'study'
      ? '<div class="ansrow"><button type="button" class="btn ghost sm rev">Show answer</button></div>'
      : '';
    el.innerHTML = head + body + foot + '<div class="sol">' + (item.sol || '') + '</div>';

    var sol = el.querySelector('.sol');
    var vd  = el.querySelector('.vd');

    function openSol(){ sol.classList.add('on'); var r = el.querySelector('.rev'); if (r) r.textContent = 'Hide answer'; }

    if (mode === 'study'){
      el.querySelector('.rev').onclick = function(){
        var on = sol.classList.toggle('on');
        this.textContent = on ? 'Hide answer' : 'Show answer';
        /* Revealing before answering counts as seen-but-not-earned. */
        if (on && !v.answered && !v.revealed){
          v.revealed = true;
          record(item.id, false);
          if (vd){ vd.className = 'vd rv'; vd.textContent = 'Revealed — not scored'; }
        }
      };
    }

    function lockChoice(){
      var btns = el.querySelectorAll('.opt');
      for (var j = 0; j < btns.length; j++){
        btns[j].disabled = true;
        var oi = parseInt(btns[j].getAttribute('data-oi'), 10);
        if (item.t === 'ms'){
          if (item.a.indexOf(oi) > -1) btns[j].classList.add('ok');
          else if (v.picks.indexOf(oi) > -1) btns[j].classList.add('no');
        } else {
          if (oi === item.a) btns[j].classList.add('ok');
          else if (oi === v.picked) btns[j].classList.add('no');
        }
      }
    }

    function settle(ok){
      v.answered = true; v.correct = ok;
      el.classList.add(ok ? 'right' : 'wrong');
      if (vd){ vd.className = 'vd ' + (ok ? 'ok' : 'no'); vd.textContent = ok ? 'Correct' : 'Not quite'; }
      if (mode === 'study'){
        if (!v.revealed) record(item.id, ok);
        if (!ok) openSol();
      }
    }

    /* --- choice types --- */
    if (item.t === 'mc' || item.t === 'tf'){
      var opts = el.querySelectorAll('.opt');
      for (i = 0; i < opts.length; i++){
        opts[i].onclick = function(){
          if (v.locked) return;
          v.picked = parseInt(this.getAttribute('data-oi'), 10);
          if (mode === 'test'){
            for (var j = 0; j < opts.length; j++) opts[j].classList.remove('picked');
            this.classList.add('picked');
            return;
          }
          v.locked = true;
          lockChoice();
          settle(v.picked === item.a);
        };
      }
    } else if (item.t === 'ms'){
      var mopts = el.querySelectorAll('.opt');
      for (i = 0; i < mopts.length; i++){
        mopts[i].onclick = function(){
          if (v.locked) return;
          var oi = parseInt(this.getAttribute('data-oi'), 10);
          var at = v.picks.indexOf(oi);
          if (at > -1) { v.picks.splice(at, 1); this.classList.remove('picked'); }
          else { v.picks.push(oi); this.classList.add('picked'); }
        };
      }
      var chk = el.querySelector('.chk');
      if (chk) chk.onclick = function(){
        if (v.locked || !v.picks.length) return;
        v.locked = true; lockChoice();
        var ok = v.picks.length === item.a.length &&
                 v.picks.every(function(x){ return item.a.indexOf(x) > -1; });
        settle(ok);
      };
    } else {
      var inp = el.querySelector('.ain');
      var check = function(){
        if (v.locked) return;
        v.raw = inp.value;
        if (!String(v.raw).trim()) return;
        v.locked = true;
        inp.disabled = true;
        var ok = inputOk(v.raw, item);
        inp.classList.add(ok ? 'right' : 'wrong');
        settle(ok);
      };
      inp.oninput = function(){ v.raw = inp.value; };
      inp.onkeydown = function(e){ if (e.key === 'Enter' && mode === 'study') check(); };
      var cbtn = el.querySelector('.chk');
      if (cbtn) cbtn.onclick = check;
    }

    /* Grading hook used by test and exam mode */
    v.grade = function(){
      if (v.locked) return v.correct;
      v.locked = true;
      var ok = false;
      if (item.t === 'mc' || item.t === 'tf'){
        ok = v.picked !== null && v.picked === item.a;
        lockChoice();
      } else if (item.t === 'ms'){
        ok = v.picks.length === item.a.length && v.picks.every(function(x){ return item.a.indexOf(x) > -1; });
        lockChoice();
      } else {
        var inp2 = el.querySelector('.ain');
        if (inp2){
          v.raw = inp2.value; inp2.disabled = true;
          if (String(v.raw).trim()){
            ok = inputOk(v.raw, item);
            inp2.classList.add(ok ? 'right' : 'wrong');
          } else if (vd){ vd.className = 'vd no'; vd.textContent = 'No answer'; }
        }
      }
      v.correct = ok; v.answered = true;
      el.classList.add(ok ? 'right' : 'wrong');
      if (vd && String(vd.textContent) !== 'No answer'){
        vd.className = 'vd ' + (ok ? 'ok' : 'no');
        vd.textContent = ok ? 'Correct' : 'Not quite';
      }
      sol.classList.add('on');
      return ok;
    };
    v.node = el;
    return el;
  }

  function renderQuiz(list, host, mode){
    host.innerHTML = '';
    var views = list.map(makeView);
    views.forEach(function(v, i){ host.appendChild(buildItem(v, i, mode || 'study')); });
    return views;
  }

  /* mount every study quiz lazily, once per section */
  var mounted = {};
  function mountQuizzes(sectionId){
    if (mounted[sectionId]) return;
    var sec = $(sectionId);
    if (!sec) return;
    var hosts = sec.querySelectorAll('[data-quiz]');
    for (var i = 0; i < hosts.length; i++){
      var key = hosts[i].getAttribute('data-quiz');
      if (BANKS[key]) renderQuiz(BANKS[key], hosts[i], 'study');
      else hosts[i].innerHTML = '<p class="fatal">No question bank named "' + esc(key) + '".</p>';
    }
    mountPython(sec);
    /* Solutions can carry code blocks, and they only exist now. */
    highlightCode(sec);
    mounted[sectionId] = true;
  }

  /* Runnable cells. Two kinds: a .pycell written inline in the
     content, which just runs; and a [data-exercise] host filled
     from the config, which also carries tests and counts toward
     progress exactly as a concept check does. */
  function mountPython(sec){
    var cells = sec.querySelectorAll('.pycell');
    for (var i = 0; i < cells.length; i++){
      var src = cells[i];
      /* A caption is a label, not code — lift it out before reading
         the source, or it becomes the first line of the program. */
      var cap = src.querySelector('.codecap'), capHTML = '';
      if (cap){ capHTML = cap.outerHTML; cap.parentNode.removeChild(cap); }
      var cell = buildPyCell({
        q: capHTML || null,
        code: src.textContent.replace(/^\n/, '').replace(/\s+$/, ''),
        pkgs: (src.getAttribute('data-pkgs') || '').split(',').filter(Boolean)
      });
      src.parentNode.replaceChild(cell, src);
    }
    var hosts = sec.querySelectorAll('[data-exercise]');
    for (var j = 0; j < hosts.length; j++){
      var key = hosts[j].getAttribute('data-exercise');
      var set = EXERCISES[key];
      if (!set){
        hosts[j].innerHTML = '<p class="fatal">No exercise set named "' + esc(key) + '".</p>';
        continue;
      }
      hosts[j].innerHTML = '';
      set.forEach(function(x, n){
        hosts[j].appendChild(buildPyCell({
          q: '<span class="exn">' + (n + 1) + '</span>' + x.q,
          code: x.start || '',
          pkgs: x.pkgs,
          test: x.test,
          sol: x.sol,
          solcode: x.solcode,
          onSettle: (function(id){ return function(ok){ record(id, ok); }; })(x.id)
        }));
      });
    }
  }

  /* ============================================================
     DECISION MAP
     ============================================================ */
  var dmBody = $('dmbody'), crumb = $('crumb'), dmPath = [];
  function dmRender(node){
    if (!TREE || !dmBody) return;
    var n = TREE[node];
    if (!n) return;
    crumb.textContent = dmPath.length ? dmPath.join('  ›  ') : '';
    var h = '<div class="dmq">' + n.q + '</div><div class="dmopts">';
    n.o.forEach(function(o, i){
      h += '<button type="button" class="dmo" data-i="' + i + '"><b>' + o.t + '</b><span>' + o.d + '</span></button>';
    });
    h += '</div>';
    if (dmPath.length) h += '<button type="button" class="dmback" data-back="1">← start over</button>';
    dmBody.innerHTML = h;
    var btns = dmBody.querySelectorAll('.dmo');
    for (var i = 0; i < btns.length; i++){
      btns[i].onclick = function(){
        var o = n.o[parseInt(this.getAttribute('data-i'), 10)];
        dmPath.push(o.t);
        if (o.r) dmResult(o.r); else dmRender(o.n);
      };
    }
    var bk = dmBody.querySelector('[data-back]');
    if (bk) bk.onclick = function(){ dmPath = []; dmRender('root'); };
  }
  function dmResult(key){
    if (!RES || !RES[key] || !dmBody) return;
    var r = RES[key];
    crumb.textContent = dmPath.join('  ›  ');
    dmBody.innerHTML = '<div class="dmres"><h4>' + r.h + '</h4><p style="margin-bottom:0">' + r.b + '</p>' +
      (r.l ? '<p style="margin:10px 0 0"><a href="' + r.l + '">Open the full topic →</a></p>' : '') +
      '</div><button type="button" class="dmback" data-back="1">← start over</button>';
    dmBody.querySelector('[data-back]').onclick = function(){ dmPath = []; dmRender('root'); };
  }

  /* ============================================================
     COMPREHENSIVE TEST
     ============================================================ */
  var testCfg = store.get('testcfg', { topics: Object.keys(BANKS), size: 30, fb: 'end' });
  var testViews = null;

  function chips(host, items, isOn, onPick){
    host.innerHTML = '';
    items.forEach(function(it){
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (isOn(it) ? ' on' : '');
      b.textContent = it.label;
      b.onclick = function(){ onPick(it); };
      host.appendChild(b);
    });
  }

  function paintTestCfg(){
    if (!$('test-topics')) return;
    chips($('test-topics'),
      Object.keys(BANKS).map(function(k){ return { key:k, label:TOPIC_TITLES[k] }; }),
      function(it){ return testCfg.topics.indexOf(it.key) > -1; },
      function(it){
        var at = testCfg.topics.indexOf(it.key);
        if (at > -1) testCfg.topics.splice(at, 1); else testCfg.topics.push(it.key);
        store.set('testcfg', testCfg); paintTestCfg();
      });
    chips($('test-size'),
      [{key:15,label:'Quick · 15'},{key:30,label:'Standard · 30'},{key:0,label:'Everything'}],
      function(it){ return testCfg.size === it.key; },
      function(it){ testCfg.size = it.key; store.set('testcfg', testCfg); paintTestCfg(); });
    chips($('test-fb'),
      [{key:'end',label:'At the end'},{key:'now',label:'Immediately'}],
      function(it){ return testCfg.fb === it.key; },
      function(it){ testCfg.fb = it.key; store.set('testcfg', testCfg); paintTestCfg(); });

    var pool = buildPool();
    $('test-hint').textContent = testCfg.topics.length
      ? pool.length + ' questions available in this selection'
      : 'Select at least one topic.';
    $('test-start').disabled = !testCfg.topics.length;
  }

  function buildPool(){
    var pool = [];
    testCfg.topics.forEach(function(k){ if (BANKS[k]) pool = pool.concat(BANKS[k]); });
    return pool;
  }

  function pickQuestions(){
    var byTopic = {};
    testCfg.topics.forEach(function(k){ if (BANKS[k]) byTopic[k] = shuffle(BANKS[k]); });
    /* one question per concept group */
    var seen = {}, staged = [];
    var keys = Object.keys(byTopic), max = 0;
    keys.forEach(function(k){ if (byTopic[k].length > max) max = byTopic[k].length; });
    var i, ki;
    for (i = 0; i < max; i++){
      for (ki = 0; ki < keys.length; ki++){
        var q = byTopic[keys[ki]][i];
        if (!q) continue;
        var c = q.c || q.id;
        if (seen[c]) continue;
        seen[c] = 1;
        staged.push(q);
      }
    }
    var want = testCfg.size || staged.length;
    return shuffle(staged).slice(0, Math.min(want, staged.length));
  }

  function startTest(){
    if (!$('test-host')) return;
    var list = pickQuestions();
    if (!list.length) return;
    testViews = renderQuiz(list, $('test-host'), testCfg.fb === 'now' ? 'study' : 'test');
    $('test-count').textContent = list.length + ' questions';
    $('test-topicline').textContent = '· ' + testCfg.topics.length + ' topics · answers ' +
      (testCfg.fb === 'now' ? 'shown as you go' : 'shown at the end');
    $('test-run').hidden = false;
    $('test-result').hidden = true;
    $('test-result').innerHTML = '';
    $('test-run').scrollIntoView({ behavior:'smooth', block:'start' });
  }

  function gradeTest(){
    if (!testViews) return;
    var blank = testViews.filter(function(v){
      return !v.locked && v.picked === null && !v.picks.length && !String(v.raw || '').trim();
    }).length;
    if (blank > 0 && !window.confirm(blank + ' unanswered — submit anyway? They will be marked incorrect.')) return;

    var right = 0, byTopic = {};
    testViews.forEach(function(v){
      var ok = v.grade();
      var tk = v.src.topic;
      if (!byTopic[tk]) byTopic[tk] = { r:0, n:0 };
      byTopic[tk].n++;
      if (ok){ right++; byTopic[tk].r++; }
    });
    var pct = Math.round(right / testViews.length * 100);
    var band = pct >= 85 ? ['Exam ready', 'var(--ok)']
             : pct >= 70 ? ['Solid — patch the gaps', 'var(--ok)']
             : pct >= 50 ? ['Passing, but drill the weak topics', 'var(--warn)']
             : ['Go back to the topic pages', 'var(--bad)'];

    var weakest = null;
    Object.keys(byTopic).forEach(function(k){
      var f = byTopic[k].r / byTopic[k].n;
      if (weakest === null || f < weakest.f) weakest = { k:k, f:f };
    });

    var h = '<div class="card score"><div class="eyebrow">Result</div>' +
      '<div class="big" style="color:' + band[1] + '">' + pct + '%</div>' +
      '<p style="margin:6px 0 0"><strong>' + band[0] + '</strong></p>' +
      '<p class="hint" style="margin:4px 0 0">' + right + ' of ' + testViews.length + ' correct' +
      (weakest ? ' · weakest topic: ' + TOPIC_TITLES[weakest.k] : '') + '</p>' +
      '<div class="brk">';
    Object.keys(byTopic).sort().forEach(function(k){
      h += '<div class="brkc"><b>' + byTopic[k].r + '/' + byTopic[k].n + '</b><span>' + TOPIC_TITLES[k] + '</span></div>';
    });
    h += '</div><div class="startrow" style="justify-content:center">' +
         '<button type="button" class="btn ghost" id="test-again">New test</button></div></div>';

    var res = $('test-result');
    res.innerHTML = h;
    res.hidden = false;
    $('test-again').onclick = function(){
      $('test-run').hidden = true; res.hidden = true; testViews = null;
      $('test-host').innerHTML = '';
      $('test').scrollIntoView({ behavior:'smooth', block:'start' });
    };
    res.scrollIntoView({ behavior:'smooth', block:'center' });

    var hist = store.get('history', []);
    hist.unshift({ at: Date.now(), pct: pct, n: testViews.length });
    if (hist.length > 50) hist.length = 50;
    store.set('history', hist);
  }

  /* ============================================================
     MOCK FINAL
     ============================================================ */
  var examViews = [], examBuilt = false, examTimer = null;

  function buildExam(){
    if (examBuilt || !EXAM || !$('ex-host')) return;
    var host = $('ex-host');
    host.innerHTML = '';
    examViews = [];
    EXAM.questions.forEach(function(q){
      var box = document.createElement('div');
      box.className = 'exq';
      box.innerHTML = '<h3>' + q.n + ' — ' + q.t + '</h3>' + (q.stem ? '<div>' + q.stem + '</div>' : '');
      q.parts.forEach(function(p){
        var wrap = document.createElement('div');
        wrap.className = 'part';
        var lab = document.createElement('div');
        lab.className = 'plab';
        lab.innerHTML = '<span class="pmark">' + p.pts + ' marks</span>' + p.l;
        wrap.appendChild(lab);
        var slot = document.createElement('div');
        wrap.appendChild(slot);
        var item = { id:'ex-' + q.n + '-' + p.l.slice(0, 6), t:p.t, q:'', opts:p.opts, a:p.a,
                     tol:p.tol, rtol:p.rtol, unit:p.unit, sol:p.sol, pts:p.pts };
        var v = makeView(item);
        var node = buildItem(v, 0, 'test');
        node.querySelector('.qhead').style.display = 'none';
        node.style.border = 'none'; node.style.padding = '0'; node.style.margin = '0';
        node.style.background = 'transparent';
        slot.appendChild(node);
        examViews.push(v);
        box.appendChild(wrap);
      });
      host.appendChild(box);
    });
    examBuilt = true;
  }

  function fmtTime(s){
    if (s < 0) s = 0;
    var m = Math.floor(s / 60), ss = s % 60;
    return m + ':' + (ss < 10 ? '0' : '') + ss;
  }
  function paintTimer(){
    var st = store.get('examstart', null);
    var el = $('ex-timer');
    if (!el || !EXAM) return;
    if (!st){ el.textContent = EXAM.mins + ':00'; el.classList.remove('warn'); return; }
    var left = EXAM.mins * 60 - Math.floor((Date.now() - st) / 1000);
    el.textContent = fmtTime(left);
    el.classList.toggle('warn', left <= 300);
    if (left <= 0){ stopTimer(); gradeExam(); }
  }
  function startTimer(){
    store.set('examstart', Date.now());
    $('ex-timer-btn').textContent = 'Stop timer';
    if (examTimer) clearInterval(examTimer);
    examTimer = setInterval(paintTimer, 1000);
    paintTimer();
  }
  function stopTimer(){
    if (examTimer){ clearInterval(examTimer); examTimer = null; }
    store.del('examstart');
    var b = $('ex-timer-btn'); if (b) b.textContent = 'Start timer';
  }

  function gradeExam(){
    if (!EXAM) return;
    buildExam();
    stopTimer();
    var earned = 0, possible = 0, missed = [];
    examViews.forEach(function(v, i){
      var ok = v.grade();
      possible += v.src.pts;
      if (ok) earned += v.src.pts; else missed.push(i + 1);
    });
    var pct = possible ? Math.round(earned / possible * 100) : 0;
    var band = pct >= 85 ? ['Exam ready', 'var(--ok)']
             : pct >= 70 ? ['Solid — patch the gaps', 'var(--ok)']
             : pct >= 50 ? ['Passing, but drill the weak topics', 'var(--warn)']
             : ['Go back to the topic pages', 'var(--bad)'];
    $('ex-result').innerHTML =
      '<div class="card score"><div class="eyebrow">Result · ' + EXAM.name + '</div>' +
      '<div class="big" style="color:' + band[1] + '">' + pct + '%</div>' +
      '<p style="margin:6px 0 0"><strong>' + band[0] + '</strong></p>' +
      '<p class="hint" style="margin:4px 0 0">' + earned + ' of ' + possible +
      ' marks — using estimated weights, not the professor’s rubric</p>' +
      (missed.length ? '<p class="hint" style="margin:8px 0 0">Parts missed: ' + missed.join(', ') + '</p>' : '') +
      '<p class="hint" style="margin:10px 0 0">Every worked solution below is now open.</p></div>';
    $('ex-result').scrollIntoView({ behavior:'smooth', block:'center' });
  }

  function resetExam(){
    if (!EXAM) return;
    stopTimer();
    examBuilt = false;
    $('ex-result').innerHTML = '';
    buildExam();
    $('exam').scrollIntoView({ behavior:'smooth', block:'start' });
  }

  /* ============================================================
     FORMULA SHEET FILTER
     ============================================================ */
  var fs = $('fs'), fsnone = $('fsnone');
  if (fs){
    fs.addEventListener('input', function(){
      var q = fs.value.trim().toLowerCase();
      var anyVisible = false;
      var secs = document.querySelectorAll('#sheet .fsec');
      for (var i = 0; i < secs.length; i++){
        var sec = secs[i];
        var rows = sec.querySelectorAll('tr[data-f], .card[data-f]');
        if (!q){
          sec.classList.remove('hidden');
          for (var j = 0; j < rows.length; j++) rows[j].classList.remove('hidden');
          anyVisible = true;
          continue;
        }
        var shown = 0;
        for (var k = 0; k < rows.length; k++){
          var hit = rows[k].textContent.toLowerCase().indexOf(q) > -1;
          rows[k].classList.toggle('hidden', !hit);
          if (hit) shown++;
        }
        var secHit = shown > 0 || (rows.length === 0 && sec.textContent.toLowerCase().indexOf(q) > -1);
        sec.classList.toggle('hidden', !secHit);
        if (secHit) anyVisible = true;
      }
      fsnone.classList.toggle('hidden', anyVisible);
    });
  }

  /* ============================================================
     ROUTER
     ============================================================ */
  var mt = $('mt');
  var rail = $('rail');
  var links = Array.prototype.slice.call(rail.querySelectorAll('a[href^="#"]'));
  var PAGES = links.map(function(a){ return a.getAttribute('href').slice(1); });
  var TITLES = links.map(function(a){
    var em = a.querySelector('em');
    var t = a.textContent || '';
    return em ? t.replace(em.textContent, '').trim() : t.trim();
  });
  var sections = Array.prototype.slice.call(document.querySelectorAll('main > section'));
  var current = PAGES[0];
  var pager = $('pager'), pageidx = $('pageidx');

  function pgCard(i, dir){
    if (i < 0 || i >= PAGES.length) return '<span class="pg ghost"></span>';
    return '<a class="pg' + (dir === 'next' ? ' nxt' : '') + '" href="#' + PAGES[i] + '">' +
           '<small>' + (dir === 'next' ? 'Next' : 'Previous') + '</small>' + esc(TITLES[i]) + '</a>';
  }
  function renderPager(i){
    pager.innerHTML = pgCard(i - 1, 'prev') + pgCard(i + 1, 'next');
  }

  function go(id){
    var i = PAGES.indexOf(id);
    if (i < 0){ i = 0; id = PAGES[0]; }
    current = id;
    sections.forEach(function(s){ s.classList.toggle('active', s.id === id); });
    links.forEach(function(a, k){
      a.classList.toggle('on', k === i);
      if (k === i) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    renderPager(i);
    if (pageidx) pageidx.textContent = (i + 1) + ' / ' + PAGES.length;
    mountQuizzes(id);
    if (id === 'exam') buildExam();
    if (id === 'test') paintTestCfg();
    window.scrollTo(0, 0);
    rail.classList.remove('open');
    if (mt) mt.setAttribute('aria-expanded', 'false');
    store.set('last', id);
  }
  function navigate(id){
    if ('#' + id !== location.hash) history.pushState(null, '', '#' + id);
    go(id);
  }
  document.addEventListener('click', function(e){
    var a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!a) return;
    var id = a.getAttribute('href').slice(1);
    if (PAGES.indexOf(id) === -1) return;
    e.preventDefault();
    navigate(id);
  });
  window.addEventListener('popstate', function(){ go((location.hash || '#start').slice(1)); });

  document.addEventListener('keydown', function(e){
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    var i = PAGES.indexOf(current);
    if (e.key === 'ArrowLeft'  && i > 0) navigate(PAGES[i - 1]);
    if (e.key === 'ArrowRight' && i < PAGES.length - 1) navigate(PAGES[i + 1]);
  });

  /* ============================================================
     THEME, NAV, PRINT
     ============================================================ */
  /* Theme is deliberately NOT namespaced per subject — one choice
     should follow the reader across every reviewer and the landing
     page. Everything else in storage stays subject-scoped. */
  var root = document.documentElement, tbtn = $('theme');
  function setTheme(t){
    root.setAttribute('data-theme', t);
    if (tbtn) tbtn.textContent = t === 'dark' ? 'Light' : 'Dark';
    theme.set(t);
  }
  setTheme(theme.get() === 'dark' ? 'dark' : 'light');
  if (tbtn) tbtn.addEventListener('click', function(){
    setTheme(root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
  });

  if (mt) mt.addEventListener('click', function(){
    var open = rail.classList.toggle('open');
    mt.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  /* Capture the active section BEFORE forcing everything visible,
     otherwise afterprint navigates the reader back to page 1. */
  var printBack = null;
  window.addEventListener('beforeprint', function(){
    printBack = current;
    PAGES.forEach(function(p){ mountQuizzes(p); });
    sections.forEach(function(s){ s.classList.add('active'); });
  });
  window.addEventListener('afterprint', function(){ go(printBack || PAGES[0]); });

  /* ============================================================
     WIRING + BOOT
     ============================================================ */
  function on(id, fn){ var el = $(id); if (el) el.onclick = fn; }

  on('test-start',   startTest);
  on('test-submit',  gradeTest);
  on('test-submit2', gradeTest);
  on('test-abandon', function(){
    $('test-run').hidden = true; $('test-result').hidden = true;
    $('test-host').innerHTML = ''; testViews = null;
    $('test').scrollIntoView({ behavior:'smooth', block:'start' });
  });
  on('ex-grade',  gradeExam);
  on('ex-grade2', gradeExam);
  on('ex-reset',  resetExam);
  on('ex-timer-btn', function(){
    if (store.get('examstart', null)) stopTimer(); else startTimer();
    paintTimer();
  });

  dmRender('root');
  highlightCode(document);
  paintProgress();
  paintTestCfg();
  if (EXAM && store.get('examstart', null)){
    examTimer = setInterval(paintTimer, 1000);
    if ($('ex-timer-btn')) $('ex-timer-btn').textContent = 'Stop timer';
  }
  paintTimer();
  go((location.hash || '#' + (store.get('last', PAGES[0]))).replace('#', ''));

  /* The browser restores scroll position and performs its native fragment
     scroll after this script runs, either of which would leave the heading
     tucked under the sticky top bar. */
  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch(e){}
  window.addEventListener('load', function(){
    window.scrollTo(0, 0);
    requestAnimationFrame(function(){ window.scrollTo(0, 0); });
  });

}

window.REVIEWER = { init: init, theme: theme };

})();
