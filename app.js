// v3 - clear button states, always-visible lang selector
const listenBtn = document.getElementById('listenBtn');
const btnTxt = document.getElementById('btnTxt');
const listenStatus = document.getElementById('listenStatus');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const swapBtn = document.getElementById('swapBtn');
const origContent = document.getElementById('origContent');
const transContent = document.getElementById('transContent');
const transLabel = document.getElementById('transLabel');
const errBar = document.getElementById('errBar');
const srcLang = document.getElementById('srcLang');
const tgtLang = document.getElementById('tgtLang');
const subText = document.getElementById('subText');
const subLabel = document.getElementById('subLabel');
const cLines = document.getElementById('cLines');
const cWords = document.getElementById('cWords');
const cTime = document.getElementById('cTime');

let recog = null, isListening = false;
let interimOrig = null, interimTrans = null;
let pairs = [], wordCount = 0, lineCount = 0;
let sessionStart = null, timerInt = null, fontSize = 18;

// ── Restore prefs ──
const saved = JSON.parse(localStorage.getItem('tt_prefs') || '{}');
if (saved.srcLang) srcLang.value = saved.srcLang;
if (saved.tgtLang) tgtLang.value = saved.tgtLang;
if (saved.fontSize) { fontSize = saved.fontSize; setActiveSize(fontSize); }
updateTransLabel();

function savePrefs() {
  localStorage.setItem('tt_prefs', JSON.stringify({ srcLang: srcLang.value, tgtLang: tgtLang.value, fontSize }));
}
srcLang.addEventListener('change', () => { savePrefs(); if (isListening) restartRecog(); });
tgtLang.addEventListener('change', () => { savePrefs(); updateTransLabel(); });

function updateTransLabel() {
  transLabel.textContent = tgtLang.options[tgtLang.selectedIndex].text;
}

// ── Swap ──
swapBtn.addEventListener('click', () => {
  const s = srcLang.value, t = tgtLang.value;
  if ([...srcLang.options].find(o => o.value === t)) srcLang.value = t;
  if ([...tgtLang.options].find(o => o.value === s)) tgtLang.value = s;
  savePrefs(); updateTransLabel();
  if (isListening) restartRecog();
});

// ── Size ──
document.querySelectorAll('.sz').forEach(btn => {
  btn.addEventListener('click', () => { setActiveSize(parseInt(btn.dataset.s)); savePrefs(); });
});
function setActiveSize(s) {
  fontSize = s;
  subText.style.fontSize = s + 'px';
  document.querySelectorAll('.sz').forEach(b => b.classList.toggle('on', parseInt(b.dataset.s) === s));
}

function showErr(msg) { errBar.style.display = msg ? 'block' : 'none'; errBar.textContent = msg || ''; }

async function translate(text, from, to) {
  if (!text.trim()) return '';
  const f = from.split('-')[0], t = to.split('-')[0];
  if (f === t) return text;
  try {
    const res = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${f}|${t}`);
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData) return data.responseData.translatedText;
    return '[unavailable]';
  } catch { return '[network error]'; }
}

function addEntry(orig, trans) {
  const o = document.createElement('div'); o.className = 'entry'; o.textContent = orig;
  origContent.appendChild(o);
  const t = document.createElement('div'); t.className = 'entry'; t.textContent = trans;
  transContent.appendChild(t);
  pairs.push({ orig, trans, time: new Date().toLocaleTimeString() });
  lineCount++;
  wordCount += orig.trim().split(/\s+/).filter(Boolean).length;
  cLines.textContent = lineCount;
  cWords.textContent = wordCount;
  subText.className = 'live';
  subText.style.fontSize = fontSize + 'px';
  subText.textContent = trans;
  subLabel.className = 'sub-label live';
  origContent.scrollTop = origContent.scrollHeight;
  transContent.scrollTop = transContent.scrollHeight;
}

function startTimer() {
  sessionStart = Date.now();
  timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    cTime.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
}
function stopTimer() { clearInterval(timerInt); }

function buildRecog() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showErr('Speech recognition needs Chrome on Android or Safari on iPhone.');
    return null;
  }
  const r = new SR();
  r.continuous = true; r.interimResults = true; r.lang = srcLang.value;

  r.onstart = () => {
    listenStatus.textContent = '🟢 Listening — turn up volume so mic hears the stream';
    listenStatus.className = 'listen-status live';
  };

  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) {
        const txt = res[0].transcript.trim();
        if (txt) {
          if (interimOrig) { interimOrig.remove(); interimOrig = null; }
          if (interimTrans) { interimTrans.remove(); interimTrans = null; }
          const tEl = document.createElement('div'); tEl.className = 'entry dim'; tEl.textContent = '…';
          transContent.appendChild(tEl);
          subText.className = 'pending'; subText.textContent = 'Translating…';
          translate(txt, srcLang.value, tgtLang.value).then(tr => { tEl.remove(); addEntry(txt, tr); });
        }
      } else { interim += res[0].transcript; }
    }
    if (interim) {
      if (!interimOrig) { interimOrig = document.createElement('div'); interimOrig.className = 'entry dim'; origContent.appendChild(interimOrig); }
      interimOrig.textContent = interim + '…';
      if (!interimTrans) { interimTrans = document.createElement('div'); interimTrans.className = 'entry dim'; transContent.appendChild(interimTrans); }
      interimTrans.textContent = '…';
      subText.className = 'pending'; subText.textContent = interim; subText.style.fontSize = fontSize + 'px';
      origContent.scrollTop = origContent.scrollHeight;
    } else {
      if (interimOrig) { interimOrig.remove(); interimOrig = null; }
      if (interimTrans) { interimTrans.remove(); interimTrans = null; }
    }
  };

  r.onerror = ev => {
    if (ev.error === 'not-allowed') {
      showErr('Mic blocked! Tap the lock icon in Chrome\'s address bar → allow Microphone → reload page.');
      stopListening();
    } else if (ev.error === 'no-speech') {
      listenStatus.textContent = '🟡 No speech detected — is volume up?';
    }
  };

  r.onend = () => { if (isListening) try { r.start(); } catch {} };
  return r;
}

function startListening() {
  showErr('');
  recog = buildRecog(); if (!recog) return;
  try {
    recog.start(); isListening = true;
    listenBtn.classList.add('live');
    btnTxt.textContent = 'TRANSLATING — TAP TO STOP';
    startTimer();
  } catch (e) { showErr('Could not start mic: ' + e.message); }
}

function stopListening() {
  isListening = false;
  if (recog) { recog.stop(); recog = null; }
  listenBtn.classList.remove('live');
  btnTxt.textContent = 'TAP TO START TRANSLATING';
  listenStatus.textContent = 'Not listening';
  listenStatus.className = 'listen-status';
  subLabel.className = 'sub-label';
  stopTimer();
  if (interimOrig) { interimOrig.remove(); interimOrig = null; }
  if (interimTrans) { interimTrans.remove(); interimTrans = null; }
}

function restartRecog() {
  if (!isListening) return;
  if (recog) { recog.stop(); recog = null; }
  setTimeout(() => { recog = buildRecog(); if (recog) try { recog.start(); } catch {} }, 300);
}

listenBtn.addEventListener('click', () => isListening ? stopListening() : startListening());

clearBtn.addEventListener('click', () => {
  origContent.innerHTML = ''; transContent.innerHTML = '';
  pairs = []; lineCount = 0; wordCount = 0;
  cLines.textContent = '0'; cWords.textContent = '0'; cTime.textContent = '0:00';
  subText.textContent = 'Translation will appear here'; subText.className = '';
  subLabel.className = 'sub-label';
  stopTimer(); sessionStart = null;
});

saveBtn.addEventListener('click', () => {
  if (!pairs.length) return;
  const src = srcLang.options[srcLang.selectedIndex].text;
  const tgt = tgtLang.options[tgtLang.selectedIndex].text;
  const header = `TikTok Live Translator\n${new Date().toLocaleString()}\n${src} → ${tgt}\n${'─'.repeat(40)}\n\n`;
  const body = pairs.map((p, i) => `[${String(i+1).padStart(3,'0')}] ${p.time}\n  ${p.orig}\n  ${p.trans}`).join('\n\n');
  const blob = new Blob([header + body], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `tt-${Date.now()}.txt`; a.click();
});

// Wake lock
let wakeLock = null;
async function requestWakeLock() {
  if ('wakeLock' in navigator) try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible' && isListening) await requestWakeLock();
});
listenBtn.addEventListener('click', () => { if (isListening) requestWakeLock(); });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
