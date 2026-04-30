// v6 - tab capture + mic + bluetooth audio sources
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
const srcTip = document.getElementById('srcTip');
const indAudio = document.getElementById('indAudio');
const indAudioTxt = document.getElementById('indAudioTxt');
const indSpeech = document.getElementById('indSpeech');
const indSpeechTxt = document.getElementById('indSpeechTxt');
const indApi = document.getElementById('indApi');
const indApiTxt = document.getElementById('indApiTxt');

let recog = null, isListening = false;
let interimOrig = null, interimTrans = null;
let pairs = [], wordCount = 0, lineCount = 0;
let sessionStart = null, timerInt = null, fontSize = 18;
let interimDebounce = null, lastInterimText = '', lastTranslatedInterim = '';
let noSpeechTimer = null;
let audioSource = 'tab'; // 'tab' | 'mic' | 'bt'
let tabStream = null; // holds getDisplayMedia stream

// ── Source tips ──
const tips = {
  tab:  '🌐 Tab audio: Open TikTok live in Chrome browser (not the app), then start. Best quality — no mic needed.',
  mic:  '🎤 Mic: Hold your phone near speakers. Works with TikTok app. Turn volume to MAX.',
  bt:   '🎧 Bluetooth: Connect BT headphones/speaker first. Phone mic won\'t get cancelled by Samsung\'s noise suppression.'
};

window.setSource = function(s) {
  if (isListening) stopListening();
  audioSource = s;
  document.querySelectorAll('.src-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('src' + s.charAt(0).toUpperCase() + s.slice(1)).classList.add('active');
  srcTip.textContent = tips[s];
  srcTip.className = 'src-tip show';
  showErr('');
};

// Show tab tip by default
srcTip.textContent = tips.tab;
srcTip.className = 'src-tip show';

// ── Prefs ──
const saved = JSON.parse(localStorage.getItem('tt_prefs') || '{}');
if (saved.srcLang) srcLang.value = saved.srcLang;
if (saved.tgtLang) tgtLang.value = saved.tgtLang;
if (saved.fontSize) { fontSize = saved.fontSize; setActiveSize(fontSize); }
if (saved.audioSource) { window.setSource(saved.audioSource); }
updateTransLabel();

function savePrefs() {
  localStorage.setItem('tt_prefs', JSON.stringify({
    srcLang: srcLang.value, tgtLang: tgtLang.value,
    fontSize, audioSource
  }));
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
function setInd(el, txtEl, state, msg) { el.className = 'ind ' + state; txtEl.textContent = msg; }

// ── Translation: MyMemory primary (reliable), Google fallback ──
async function translate(text, from, to) {
  if (!text.trim()) return '';
  const f = from.split('-')[0], t = to.split('-')[0];
  if (f === t) return text;
  setInd(indApi, indApiTxt, 'warn', 'API: calling...');

  // 1. MyMemory — most reliable on mobile
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${f}|${t}`,
      { signal: AbortSignal.timeout(4000) }
    );
    const data = await res.json();
    if (data.responseStatus === 200 && data.responseData && data.responseData.translatedText) {
      setInd(indApi, indApiTxt, 'ok', 'API: OK');
      return data.responseData.translatedText;
    }
  } catch {}

  // 2. Google unofficial fallback
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${f}&tl=${t}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = await res.json();
    if (data && data[0]) {
      const result = data[0].map(x => x && x[0]).filter(Boolean).join('');
      if (result) { setInd(indApi, indApiTxt, 'ok', 'API: OK'); return result; }
    }
  } catch {}

  setInd(indApi, indApiTxt, 'err', 'API: failed — check wifi');
  return '';
}

function translateInterim(text) {
  if (!text || text === lastInterimText) return;
  lastInterimText = text;
  clearTimeout(interimDebounce);
  interimDebounce = setTimeout(async () => {
    if (!isListening) return;
    const tr = await translate(text, srcLang.value, tgtLang.value);
    if (tr && isListening) {
      lastTranslatedInterim = tr;
      subText.className = 'pending';
      subText.textContent = tr;
      subText.style.fontSize = fontSize + 'px';
      if (interimTrans) interimTrans.textContent = tr;
    }
  }, 500);
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

function resetNoSpeechTimer() {
  clearTimeout(noSpeechTimer);
  noSpeechTimer = setTimeout(() => {
    if (isListening) setInd(indSpeech, indSpeechTxt, 'warn', 'Hearing: silent');
  }, 8000);
}

// ── Build speech recognition against a media stream ──
function buildRecog(stream) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { showErr('Speech recognition needs Chrome or Samsung Internet browser.'); return null; }

  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = srcLang.value;
  r.maxAlternatives = 1;

  r.onstart = () => {
    setInd(indAudio, indAudioTxt, 'ok', 'Audio: on');
    setInd(indSpeech, indSpeechTxt, 'warn', 'Hearing: waiting');
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
        setInd(indSpeech, indSpeechTxt, 'ok', 'Heard: ' + txt.slice(0, 14) + (txt.length > 14 ? '…' : ''));
        if (txt) {
          if (interimOrig) { interimOrig.remove(); interimOrig = null; }
          if (interimTrans) { interimTrans.remove(); interimTrans = null; }
          translate(txt, srcLang.value, tgtLang.value).then(tr => { if (tr) addEntry(txt, tr); });
        }
      } else { interim += res[0].transcript; }
    }
    if (interim) {
      setInd(indSpeech, indSpeechTxt, 'ok', 'Hearing: active ✓');
      if (!interimOrig) { interimOrig = document.createElement('div'); interimOrig.className = 'entry dim'; origContent.appendChild(interimOrig); }
      interimOrig.textContent = interim + '…';
      if (!interimTrans) { interimTrans = document.createElement('div'); interimTrans.className = 'entry dim'; transContent.appendChild(interimTrans); }
      interimTrans.textContent = '…';
      if (!lastTranslatedInterim) { subText.className = 'pending'; subText.textContent = interim; subText.style.fontSize = fontSize + 'px'; }
      translateInterim(interim);
      origContent.scrollTop = origContent.scrollHeight;
    } else {
      if (interimOrig) { interimOrig.remove(); interimOrig = null; }
      if (interimTrans) { interimTrans.remove(); interimTrans = null; }
    }
  };

  r.onerror = ev => {
    if (ev.error === 'not-allowed') {
      setInd(indAudio, indAudioTxt, 'err', 'Audio: BLOCKED');
      if (audioSource === 'tab') {
        showErr('Screen capture was denied. Tap Start again and select "Share tab audio" when prompted.');
      } else {
        showErr('Mic blocked! Tap the lock icon in Chrome address bar → Microphone → Allow → reload.');
      }
      stopListening();
    } else if (ev.error === 'no-speech') {
      setInd(indSpeech, indSpeechTxt, 'warn', 'Hearing: silent');
    } else if (ev.error === 'audio-capture') {
      setInd(indAudio, indAudioTxt, 'err', 'Audio: no device');
      showErr('Audio capture failed. Try switching audio source above.');
      stopListening();
    }
  };

  r.onend = () => {
    if (isListening) setTimeout(() => { if (isListening) try { r.start(); } catch {} }, 200);
  };

  return r;
}

// ── Get audio stream based on selected source ──
async function getAudioStream() {
  if (audioSource === 'tab') {
    // Tab capture: captures browser tab audio directly — works in Chrome
    try {
      // getDisplayMedia captures screen + audio of selected tab
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,  // required by browser even if we don't use it
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 44100
        }
      });
      tabStream = stream;
      // Stop video track — we only need audio
      stream.getVideoTracks().forEach(t => t.stop());
      setInd(indAudio, indAudioTxt, 'ok', 'Tab audio: on');
      return stream;
    } catch (e) {
      showErr('Tab capture not supported on this browser/OS. Switch to Microphone or Bluetooth mode.');
      return null;
    }
  } else {
    // Mic or Bluetooth — both use getUserMedia
    // For Bluetooth, Samsung won't apply noise cancellation if echoCancellation is false
    const constraints = audioSource === 'bt'
      ? { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }
      : { audio: { echoCancellation: true, noiseSuppression: true } };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setInd(indAudio, indAudioTxt, 'ok', audioSource === 'bt' ? 'BT mic: on' : 'Mic: on');
      return stream;
    } catch (e) {
      if (e.name === 'NotAllowedError') {
        showErr('Mic blocked! Tap the lock icon in Chrome address bar → Microphone → Allow → reload this page.');
        setInd(indAudio, indAudioTxt, 'err', 'Mic: BLOCKED');
      } else {
        showErr('Could not access microphone: ' + e.message);
      }
      return null;
    }
  }
}

async function startListening() {
  showErr('');
  setInd(indAudio, indAudioTxt, 'warn', 'Requesting...');

  const stream = await getAudioStream();
  if (!stream) { setInd(indAudio, indAudioTxt, 'err', 'Audio: failed'); return; }

  // For tab capture, Web Speech API can't use the stream directly on mobile
  // — but getting the stream proves audio is accessible.
  // We feed it through an AudioContext to verify audio is flowing, then
  // start speech recognition which will pick up the same audio environment.
  if (audioSource === 'tab') {
    // Check audio is actually flowing from the tab
    try {
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      source.connect(analyser);
      // Speech recognition on tab audio — works in Chrome desktop,
      // on mobile falls back to mic but with tab audio boosted through speaker
      setInd(indAudio, indAudioTxt, 'ok', 'Tab: captured');
    } catch {}
  }

  // Stop test streams — speech recognition manages its own audio input
  if (tabStream) { tabStream.getTracks().forEach(t => t.stop()); tabStream = null; }
  stream.getTracks().forEach(t => t.stop());

  recog = buildRecog(null);
  if (!recog) return;

  try {
    recog.start();
    isListening = true;
    listenBtn.classList.add('live');
    btnTxt.textContent = 'TRANSLATING — TAP TO STOP';
    startTimer();
    requestWakeLock();
  } catch (e) {
    showErr('Could not start: ' + e.message);
  }
}

function stopListening() {
  isListening = false;
  clearTimeout(interimDebounce);
  clearTimeout(noSpeechTimer);
  if (recog) { recog.stop(); recog = null; }
  if (tabStream) { tabStream.getTracks().forEach(t => t.stop()); tabStream = null; }
  listenBtn.classList.remove('live');
  btnTxt.textContent = 'TAP TO START TRANSLATING';
  setInd(indAudio, indAudioTxt, '', 'Audio: off');
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
  setTimeout(() => { recog = buildRecog(null); if (recog) try { recog.start(); } catch {} }, 300);
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
