// v5 - diagnostics + robust mic + dual API + interim translation
const listenBtn = document.getElementById('listenBtn');
const btnTxt = document.getElementById('btnTxt');
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

// Indicator elements
const indMic = document.getElementById('indMic');
const indMicTxt = document.getElementById('indMicTxt');
const indSpeech = document.getElementById('indSpeech');
const indSpeechTxt = document.getElementById('indSpeechTxt');
const indApi = document.getElementById('indApi');
const indApiTxt = document.getElementById('indApiTxt');

let recog = null, isListening = false;
let interimOrig = null, interimTrans = null;
let pairs = [], wordCount = 0, lineCount = 0;
let sessionStart = null, timerInt = null, fontSize = 18;
let interimDebounce = null, lastInterimText = '', lastTranslatedInterim = '';
let speechDetectedAt = null, noSpeechTimer = null;

// ── Indicator helpers ──
function setInd(el, txtEl, state, msg) {
  el.className = 'ind ' + state;
  txtEl.textContent = msg;
}

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

swapBtn.addEventListener('click', () => {
  const s = srcLang.value, t = tgtLang.value;
  if ([...srcLang.options].find(o => o.value === t)) srcLang.value = t;
  if ([...tgtLang.options].find(o => o.value === s)) tgtLang.value = s;
  savePrefs(); updateTransLabel();
  if (isListening) restartRecog();
});

document.querySelectorAll('.sz').forEach(btn => {
  btn.addEventListener('click', () => { setActiveSize(parseInt(btn.dataset.s)); savePrefs(); });
});
function setActiveSize(s) {
  fontSize = s;
  subText.style.fontSize = s + 'px';
  document.querySelectorAll('.sz').forEach(b => b.classList.toggle('on', parseInt(b.dataset.s) === s));
}

function showErr(msg) { errBar.style.display = msg ? 'block' : 'none'; errBar.textContent = msg || ''; }

// ── TRANSLATION: Google unofficial first, MyMemory fallback ──
async function translate(text, from, to) {
  if (!text.trim()) return '';
  const f = from.split('-')[0], t = to.split('-')[0];
  if (f === t) return text;

  setInd(indApi, indApiTxt, 'warn', 'API: calling...');

  // 1. Google Translate (unofficial, fastest ~100-200ms)
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${f}&tl=${t}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (data && data[0]) {
      const result = data[0].map(x => x && x[0]).filter(Boolean).join('');
      if (result) {
        setInd(indApi, indApiTxt, 'ok', 'API: Google OK');
        return result;
      }
    }
  } catch {}

  // 2. MyMemory fallback
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${f}|${t}`,
      { signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData) {
      setInd(indApi, indApiTxt, 'ok', 'API: MyMemory OK');
      return data.responseData.translatedText;
    }
  } catch {}

  setInd(indApi, indApiTxt, 'err', 'API: failed');
  return '[translation failed]';
}

// ── Interim debounced translation (shows subtitle while still speaking) ──
function translateInterim(text) {
  if (!text || text === lastInterimText) return;
  lastInterimText = text;
  clearTimeout(interimDebounce);
  interimDebounce = setTimeout(async () => {
    if (!isListening) return;
    const tr = await translate(text, srcLang.value, tgtLang.value);
    if (tr && isListening && !tr.startsWith('[')) {
      lastTranslatedInterim = tr;
      subText.className = 'pending';
      subText.textContent = tr;
      subText.style.fontSize = fontSize + 'px';
      if (interimTrans) interimTrans.textContent = tr;
    }
  }, 500); // 500ms debounce — translates quickly but not on every keystroke
}

function addEntry(orig, trans) {
  clearTimeout(interimDebounce);
  lastInterimText = ''; lastTranslatedInterim = '';

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

// ── No-speech watchdog: warns if nothing heard for 8 seconds ──
function resetNoSpeechTimer() {
  clearTimeout(noSpeechTimer);
  noSpeechTimer = setTimeout(() => {
    if (isListening) {
      setInd(indSpeech, indSpeechTxt, 'warn', 'Hearing: silent');
    }
  }, 8000);
}

function buildRecog() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    showErr('Speech recognition needs Chrome (Android) or Safari (iPhone). Please switch browsers.');
    return null;
  }
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = srcLang.value;
  r.maxAlternatives = 1;

  r.onstart = () => {
    setInd(indMic, indMicTxt, 'ok', 'Mic: on');
    setInd(indSpeech, indSpeechTxt, 'warn', 'Hearing: waiting');
    setInd(indApi, indApiTxt, '', 'API: ready');
    resetNoSpeechTimer();
    showErr('');
  };

  r.onresult = (e) => {
    resetNoSpeechTimer();
    let interim = '';

    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) {
        const txt = res[0].transcript.trim();
        setInd(indSpeech, indSpeechTxt, 'ok', 'Heard: ' + txt.slice(0, 12) + (txt.length > 12 ? '...' : ''));
        if (txt) {
          if (interimOrig) { interimOrig.remove(); interimOrig = null; }
          if (interimTrans) { interimTrans.remove(); interimTrans = null; }
          translate(txt, srcLang.value, tgtLang.value).then(tr => addEntry(txt, tr));
        }
      } else {
        interim += res[0].transcript;
      }
    }

    if (interim) {
      setInd(indSpeech, indSpeechTxt, 'ok', 'Hearing: active');
      if (!interimOrig) {
        interimOrig = document.createElement('div');
        interimOrig.className = 'entry dim';
        origContent.appendChild(interimOrig);
      }
      interimOrig.textContent = interim + '…';
      if (!interimTrans) {
        interimTrans = document.createElement('div');
        interimTrans.className = 'entry dim';
        transContent.appendChild(interimTrans);
      }
      // Show raw text in subtitle immediately while translation loads
      if (!lastTranslatedInterim) {
        subText.className = 'pending';
        subText.textContent = interim;
        subText.style.fontSize = fontSize + 'px';
      }
      translateInterim(interim);
      origContent.scrollTop = origContent.scrollHeight;
    } else {
      if (interimOrig) { interimOrig.remove(); interimOrig = null; }
      if (interimTrans) { interimTrans.remove(); interimTrans = null; }
    }
  };

  r.onerror = ev => {
    console.log('Speech error:', ev.error);
    if (ev.error === 'not-allowed') {
      setInd(indMic, indMicTxt, 'err', 'Mic: BLOCKED');
      showErr('Mic blocked! In Chrome: tap the lock icon in the address bar → Microphone → Allow → reload this page.');
      stopListening();
    } else if (ev.error === 'no-speech') {
      setInd(indSpeech, indSpeechTxt, 'warn', 'Hearing: silent');
    } else if (ev.error === 'audio-capture') {
      setInd(indMic, indMicTxt, 'err', 'Mic: no device');
      showErr('No microphone found. Check that your phone mic is not blocked by a case.');
      stopListening();
    } else if (ev.error === 'network') {
      setInd(indSpeech, indSpeechTxt, 'warn', 'Speech: net error');
    } else if (ev.error === 'aborted') {
      // normal on restart, ignore
    }
  };

  r.onend = () => {
    if (isListening) {
      // Auto-restart — small delay avoids hammering
      setTimeout(() => {
        if (isListening) try { r.start(); } catch {}
      }, 200);
    }
  };

  return r;
}

function startListening() {
  showErr('');
  // First check mic permission explicitly
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then(stream => {
      // Permission granted — stop the test stream and start recognition
      stream.getTracks().forEach(t => t.stop());
      setInd(indMic, indMicTxt, 'ok', 'Mic: on');
      recog = buildRecog();
      if (!recog) return;
      try {
        recog.start();
        isListening = true;
        listenBtn.classList.add('live');
        btnTxt.textContent = 'TRANSLATING — TAP TO STOP';
        startTimer();
        requestWakeLock();
      } catch (e) {
        showErr('Could not start mic: ' + e.message);
      }
    })
    .catch(err => {
      setInd(indMic, indMicTxt, 'err', 'Mic: BLOCKED');
      showErr('Microphone blocked! Tap the lock icon next to the web address in Chrome, set Microphone to Allow, then reload.');
    });
}

function stopListening() {
  isListening = false;
  clearTimeout(interimDebounce);
  clearTimeout(noSpeechTimer);
  if (recog) { recog.stop(); recog = null; }
  listenBtn.classList.remove('live');
  btnTxt.textContent = 'TAP TO START TRANSLATING';
  setInd(indMic, indMicTxt, '', 'Mic: off');
  setInd(indSpeech, indSpeechTxt, '', 'Hearing: -');
  subLabel.className = 'sub-label';
  stopTimer();
  if (interimOrig) { interimOrig.remove(); interimOrig = null; }
  if (interimTrans) { interimTrans.remove(); interimTrans = null; }
  lastInterimText = ''; lastTranslatedInterim = '';
}

function restartRecog() {
  if (!isListening) return;
  if (recog) { recog.stop(); recog = null; }
  setTimeout(() => {
    recog = buildRecog();
    if (recog) try { recog.start(); } catch {}
  }, 300);
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
  const header = `TikTok Live Translator\n${new Date().toLocaleString()}\n${src} to ${tgt}\n${'-'.repeat(40)}\n\n`;
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
  if (document.visibilityState === 'visible' && isListening) requestWakeLock();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
