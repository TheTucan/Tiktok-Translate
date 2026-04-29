const listenBtn = document.getElementById('listenBtn');
const btnTxt = document.getElementById('btnTxt');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const swapBtn = document.getElementById('swapBtn');
const origContent = document.getElementById('origContent');
const transContent = document.getElementById('transContent');
const transLabel = document.getElementById('transLabel');
const statusTxt = document.getElementById('statusTxt');
const errBar = document.getElementById('errBar');
const srcLang = document.getElementById('srcLang');
const tgtLang = document.getElementById('tgtLang');
const subText = document.getElementById('subText');
const subBadge = document.getElementById('subBadge');
const timerPill = document.getElementById('timerPill');
const cLines = document.getElementById('cLines');
const cWords = document.getElementById('cWords');
const cTime = document.getElementById('cTime');
const installBanner = document.getElementById('installBanner');
const installBtn = document.getElementById('installBtn');

let recog = null, isListening = false;
let interimOrig = null, interimTrans = null;
let pairs = [], wordCount = 0, lineCount = 0;
let sessionStart = null, timerInt = null, fontSize = 22;
let deferredInstall = null;

// ── PWA Install prompt ──
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  installBanner.style.display = 'flex';
});
installBtn.addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  if (outcome === 'accepted') installBanner.style.display = 'none';
  deferredInstall = null;
});

// ── Saved prefs ──
const saved = JSON.parse(localStorage.getItem('tt_prefs') || '{}');
if (saved.srcLang) srcLang.value = saved.srcLang;
if (saved.tgtLang) tgtLang.value = saved.tgtLang;
if (saved.fontSize) { fontSize = saved.fontSize; setActiveSize(fontSize); }
updateTransLabel();

function savePrefs() {
  localStorage.setItem('tt_prefs', JSON.stringify({ srcLang: srcLang.value, tgtLang: tgtLang.value, fontSize }));
}

srcLang.addEventListener('change', savePrefs);
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
});

// ── Size buttons ──
document.querySelectorAll('.sz').forEach(btn => {
  btn.addEventListener('click', () => {
    setActiveSize(parseInt(btn.dataset.s));
    savePrefs();
  });
});
function setActiveSize(s) {
  fontSize = s;
  subText.style.fontSize = s + 'px';
  document.querySelectorAll('.sz').forEach(b => b.classList.toggle('on', parseInt(b.dataset.s) === s));
}

// ── Helpers ──
function showErr(msg) { errBar.style.display = msg ? 'block' : 'none'; errBar.textContent = msg || ''; }
function setStatus(msg) { statusTxt.textContent = msg; }

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
  subText.textContent = trans;
  subText.style.fontSize = fontSize + 'px';
  origContent.scrollTop = origContent.scrollHeight;
  transContent.scrollTop = transContent.scrollHeight;
}

function startTimer() {
  sessionStart = Date.now();
  timerInt = setInterval(() => {
    const s = Math.floor((Date.now() - sessionStart) / 1000);
    const d = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    cTime.textContent = d;
    timerPill.textContent = d;
  }, 1000);
  timerPill.classList.add('live');
}
function stopTimer() { clearInterval(timerInt); timerPill.classList.remove('live'); }

// ── Speech Recognition ──
function initRecog() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showErr('Speech recognition requires Chrome on Android, or Safari on iPhone. Please open this page in Chrome.');
    return null;
  }
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = srcLang.value;

  r.onstart = () => {
    setStatus('Listening — hold your phone near the stream audio.');
    subBadge.classList.add('live');
  };

  r.onresult = async (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) {
        const txt = res[0].transcript.trim();
        if (txt) {
          if (interimOrig) { interimOrig.remove(); interimOrig = null; }
          if (interimTrans) { interimTrans.remove(); interimTrans = null; }
          const tEl = document.createElement('div'); tEl.className = 'entry dim'; tEl.textContent = 'Translating...';
          transContent.appendChild(tEl);
          subText.className = 'pending'; subText.textContent = 'Translating...';
          translate(txt, srcLang.value, tgtLang.value).then(tr => { tEl.remove(); addEntry(txt, tr); });
        }
      } else { interim += res[0].transcript; }
    }
    if (interim) {
      if (!interimOrig) { interimOrig = document.createElement('div'); interimOrig.className = 'entry dim'; origContent.appendChild(interimOrig); }
      interimOrig.textContent = interim + '...';
      if (!interimTrans) { interimTrans = document.createElement('div'); interimTrans.className = 'entry dim'; transContent.appendChild(interimTrans); }
      interimTrans.textContent = '...';
      subText.className = 'pending'; subText.textContent = interim; subText.style.fontSize = fontSize + 'px';
      origContent.scrollTop = origContent.scrollHeight;
    } else {
      if (interimOrig) { interimOrig.remove(); interimOrig = null; }
      if (interimTrans) { interimTrans.remove(); interimTrans = null; }
    }
  };

  r.onerror = ev => {
    if (ev.error === 'not-allowed') {
      showErr('Microphone blocked. Tap the lock/mic icon in your browser address bar and allow microphone access.');
      stopListening();
    } else if (ev.error === 'no-speech') {
      setStatus('No speech detected — is stream audio audible through speakers?');
    } else if (ev.error === 'network') {
      setStatus('Network hiccup — retrying...');
    }
  };

  r.onend = () => { if (isListening) { try { r.start(); } catch {} } };
  return r;
}

function startListening() {
  showErr('');
  recog = initRecog();
  if (!recog) return;
  try {
    recog.start();
    isListening = true;
    listenBtn.classList.add('live');
    btnTxt.textContent = 'Stop Listening';
    startTimer();
  } catch (e) { showErr('Could not start mic: ' + e.message); }
}

function stopListening() {
  isListening = false;
  if (recog) { recog.stop(); recog = null; }
  listenBtn.classList.remove('live');
  btnTxt.textContent = 'Start Listening';
  subBadge.classList.remove('live');
  setStatus('Stopped. Tap Start to resume.');
  stopTimer();
  if (interimOrig) { interimOrig.remove(); interimOrig = null; }
  if (interimTrans) { interimTrans.remove(); interimTrans = null; }
}

listenBtn.addEventListener('click', () => isListening ? stopListening() : startListening());

clearBtn.addEventListener('click', () => {
  origContent.innerHTML = ''; transContent.innerHTML = '';
  pairs = []; lineCount = 0; wordCount = 0;
  cLines.textContent = '0'; cWords.textContent = '0'; cTime.textContent = '0:00'; timerPill.textContent = '0:00';
  subText.textContent = 'Ready — tap Start to begin'; subText.className = '';
  subBadge.classList.remove('live');
  stopTimer(); sessionStart = null;
  setStatus('Cleared.');
});

saveBtn.addEventListener('click', () => {
  if (!pairs.length) { setStatus('Nothing to save yet.'); return; }
  const src = srcLang.options[srcLang.selectedIndex].text;
  const tgt = tgtLang.options[tgtLang.selectedIndex].text;
  const header = `TikTok Live Translator\nSaved: ${new Date().toLocaleString()}\n${src} → ${tgt}\n${'─'.repeat(40)}\n\n`;
  const body = pairs.map((p, i) => `[${String(i+1).padStart(3,'0')}] ${p.time}\n  ${p.orig}\n  ${p.trans}`).join('\n\n');
  const blob = new Blob([header + body], { type: 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `tt-transcript-${Date.now()}.txt`; a.click();
  setStatus(`Saved ${pairs.length} lines.`);
});

// Keep screen awake while listening (where supported)
let wakeLock = null;
async function requestWakeLock() {
  if ('wakeLock' in navigator) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  }
}
document.addEventListener('visibilitychange', async () => {
  if (wakeLock !== null && document.visibilityState === 'visible' && isListening) {
    await requestWakeLock();
  }
});
listenBtn.addEventListener('click', () => { if (isListening) requestWakeLock(); });

// Register service worker for offline use
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
