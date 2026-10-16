// ─── AI Trading Co-Pilot Frontend Mantığı ────────────────────────

let ws = null;
let voiceAlertEnabled = true;
let attachedImageBase64 = null;
let isListening = false;
let speechRecognizer = null;

// DOM Elemanları
const statusDot = document.getElementById('statusDot');
const positionTicker = document.getElementById('positionTicker');
const chatFeed = document.getElementById('chatFeed');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const micBtn = document.getElementById('micBtn');
const manualTriggerBtn = document.getElementById('manualTriggerBtn');
const voiceAlertBtn = document.getElementById('voiceAlertBtn');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeModalBtn = document.getElementById('closeModalBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const imageUploadInput = document.getElementById('imageUploadInput');
const imagePreviewContainer = document.getElementById('imagePreviewContainer');
const imagePreview = document.getElementById('imagePreview');
const removeImageBtn = document.getElementById('removeImageBtn');

// Radar DOM Elemanları (2. Ekran Metrikleri)
const radarOi5m = document.getElementById('radarOi5m');
const radarOi4h = document.getElementById('radarOi4h');
const radarFunding = document.getElementById('radarFunding');
const radarTopTraders = document.getElementById('radarTopTraders');
const radarTaker = document.getElementById('radarTaker');

// ─── 1. WebSocket Bağlantısı ─────────────────────────────────────
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    statusDot.className = 'pulse-indicator online';
    console.log('[WebSocket] Sunucuya bağlandı.');
  };

  ws.onmessage = (event) => {
    try {
      const { type, payload } = JSON.parse(event.data);
      handleWsMessage(type, payload);
    } catch (e) {
      console.error('[WebSocket] Mesaj parse hatası:', e);
    }
  };

  ws.onclose = () => {
    statusDot.className = 'pulse-indicator offline';
    console.warn('[WebSocket] Bağlantı koptu, 3sn içinde yeniden deneniyor...');
    setTimeout(connectWebSocket, 3000);
  };
}

// ─── 2. WebSocket Mesaj Yönlendirici ──────────────────────────────
function handleWsMessage(type, payload) {
  switch (type) {
    case 'POSITION_RADAR':
      updatePositionRadar(payload.position, payload.derivatives, payload.hasKey);
      break;

    case 'ANALYSIS_START':
      showTypingIndicator(`⚡ ${payload.symbol} için 2. ekran verileri (OI, Para Akışı, Duvarlar) taranıyor...`);
      break;

    case 'NEW_COPILOT_MESSAGE':
      removeTypingIndicator();
      appendMessageCard(payload);
      if (voiceAlertEnabled) {
        playNotificationSound(); // Sadece hafif 'bip' bildirim sesi (sesli okuma yok)
      }
      break;
  }
}

// ─── 3. Canlı Pozisyon & 2. Ekran Radar Güncellemesi ──────────────
function updatePositionRadar(pos, deriv, hasKey) {
  if (!pos) {
    positionTicker.innerHTML = `<span class="ticker-empty">${hasKey ? 'Binance Futures: Açık pozisyon yok (Takipte...)' : '⚠️ API Anahtarı girilmedi. Ayarlar ⚙️ kısmından ekleyin.'}</span>`;
  } else {
    const pnlClass = parseFloat(pos.pnlPercent) >= 0 ? 'pnl-positive' : 'pnl-negative';
    const badgeClass = pos.isLong ? 'badge-long' : 'badge-short';
    const dirText = pos.isLong ? 'LONG' : 'SHORT';

    positionTicker.innerHTML = `
      <div class="ticker-active">
        <span class="${badgeClass}">${pos.symbol} ${dirText} ${pos.leverage}x</span>
        <span>Giriş: <strong>${pos.entryPrice}</strong></span>
        <span>Mark: <strong>${pos.markPrice}</strong></span>
        <span class="${pnlClass}">PnL: ${pos.pnlPercent > 0 ? '+' : ''}${pos.pnlPercent}% (${pos.unRealizedProfit > 0 ? '+' : ''}${pos.unRealizedProfit.toFixed(2)} $)</span>
        <span style="color: #64748b;">Liq: ${pos.liquidationPrice}</span>
      </div>
    `;
  }

  // 2. Ekran Türev & Para Akışı Göstergeleri
  if (deriv) {
    if (radarOi5m) {
      const isPos = deriv.oiDelta5m >= 0;
      radarOi5m.innerHTML = `<span class="${isPos ? 'pnl-positive' : 'pnl-negative'}">${isPos ? '+' : ''}${deriv.oiDelta5m.toLocaleString()} $ (${isPos ? '+' : ''}${deriv.oiDelta5mPercent}%)</span>`;
    }
    if (radarOi4h) {
      const isPos4 = deriv.oiDelta4h >= 0;
      radarOi4h.innerHTML = `<span class="${isPos4 ? 'pnl-positive' : 'pnl-negative'}">${isPos4 ? '+' : ''}${deriv.oiDelta4h.toLocaleString()} $ (${isPos4 ? '+' : ''}${deriv.oiDelta4hPercent}%)</span>`;
    }
    if (radarFunding) {
      radarFunding.innerHTML = `<span style="color: ${parseFloat(deriv.fundingPercent) < 0 ? '#ef4444' : '#10b981'}; font-weight: 700;">%${deriv.fundingPercent}</span>`;
    }
    if (radarTopTraders) {
      radarTopTraders.innerHTML = deriv.topTraderLongRatio ? `%${deriv.topTraderLongRatio} L / %${deriv.topTraderShortRatio} S` : '--';
    }
    if (radarTaker) {
      const isBuy = deriv.takerBuySellRatio >= 1;
      radarTaker.innerHTML = `<span class="${isBuy ? 'pnl-positive' : 'pnl-negative'}">${deriv.takerBuySellRatio}x (${isBuy ? 'Alıcı Ağırlıklı' : 'Satıcı Ağırlıklı'})</span>`;
    }
  }
}

// ─── 4. Sohbet Kartı Ekleme & Markdown Biçimlendirme ──────────────
function appendMessageCard(msg) {
  const card = document.createElement('div');
  const isProactive = msg.type === 'proactive_5m';
  card.className = `message-card ${isProactive ? 'proactive-card' : 'user-card'}`;

  // Markdown benzeri kalınlaştırma ve listeleri HTML'e çevir
  let formattedText = msg.text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n- /g, '<br>• ')
    .replace(/\n/g, '<br>');

  card.innerHTML = `
    <div class="msg-header">
      <span class="msg-badge">${msg.title || '🤖 CO-PILOT ANALİZİ'}</span>
      <span class="msg-time">${msg.time}</span>
    </div>
    <div class="msg-body">
      ${formattedText}
    </div>
  `;

  chatFeed.appendChild(card);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

// ─── 5. Soru Gönderme (Metin veya Görselle) ──────────────────────
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text && !attachedImageBase64) return;

  // Kullanıcı mesajını ekrana bas
  const userMsgCard = {
    id: Date.now().toString(),
    sender: 'user',
    type: 'user_ask',
    title: '👤 SİZİN SORUNUZ',
    text: text + (attachedImageBase64 ? '<br><em>[Ekran görüntüsü eklendi]</em>' : ''),
    time: new Date().toLocaleTimeString('tr-TR')
  };
  appendMessageCard(userMsgCard);

  userInput.value = '';
  const imgPayload = attachedImageBase64;
  clearImageAttachment();

  showTypingIndicator('Co-Pilot yanıtlıyor...');

  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: text, imageBase64: imgPayload })
    });
    const data = await res.json();
    removeTypingIndicator();

    if (data.answer) {
      appendMessageCard(data.answer);
      if (voiceAlertEnabled) {
        playNotificationSound();
      }
    }
  } catch (err) {
    removeTypingIndicator();
    appendMessageCard({
      sender: 'system',
      type: 'error',
      title: '⚠️ HATA',
      text: 'Sunucuya bağlanırken bir hata oluştu: ' + err.message,
      time: new Date().toLocaleTimeString('tr-TR')
    });
  }
}

// Yazıyor İndikatörü
function showTypingIndicator(label) {
  removeTypingIndicator();
  const ind = document.createElement('div');
  ind.id = 'typingIndicator';
  ind.className = 'message-card system-card';
  ind.style.fontStyle = 'italic';
  ind.style.opacity = '0.7';
  ind.innerText = label;
  chatFeed.appendChild(ind);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

// ─── 6. Sesli Komut (Web Speech API) ─────────────────────────────
function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    micBtn.title = 'Tarayıcınız Web Speech API desteklemiyor.';
    return;
  }

  speechRecognizer = new SpeechRecognition();
  speechRecognizer.lang = 'tr-TR';
  speechRecognizer.continuous = false;
  speechRecognizer.interimResults = false;

  speechRecognizer.onstart = () => {
    isListening = true;
    micBtn.classList.add('listening');
    userInput.placeholder = 'Dinliyorum, konuşun... (örn: kâr alayım mı?)';
  };

  speechRecognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    userInput.value = transcript;
    sendMessage(); // Otomatik gönder
  };

  speechRecognizer.onerror = (event) => {
    console.warn('Speech error:', event.error);
    isListening = false;
    micBtn.classList.remove('listening');
    userInput.placeholder = 'Co-Pilot\'a sor...';
  };

  speechRecognizer.onend = () => {
    isListening = false;
    micBtn.classList.remove('listening');
    userInput.placeholder = 'Co-Pilot\'a sor...';
  };

  micBtn.addEventListener('click', () => {
    if (isListening) {
      speechRecognizer.stop();
    } else {
      speechRecognizer.start();
    }
  });
}

// Basit Bildirim Sesi (Web Audio API)
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // Ses desteklenmiyorsa geç
  }
}

// ─── 7. Pano (Clipboard) & Görsel Yapıştırma (Ctrl+V) ─────────────
window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const blob = items[i].getAsFile();
      const reader = new FileReader();
      reader.onload = (event) => {
        attachedImageBase64 = event.target.result;
        imagePreview.src = attachedImageBase64;
        imagePreviewContainer.style.display = 'flex';
      };
      reader.readAsDataURL(blob);
      break;
    }
  }
});

imageUploadInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    attachedImageBase64 = event.target.result;
    imagePreview.src = attachedImageBase64;
    imagePreviewContainer.style.display = 'flex';
  };
  reader.readAsDataURL(file);
});

removeImageBtn.addEventListener('click', clearImageAttachment);

function clearImageAttachment() {
  attachedImageBase64 = null;
  imagePreview.src = '';
  imagePreviewContainer.style.display = 'none';
  imageUploadInput.value = '';
}

// ─── 8. Ayarlar & Modal ──────────────────────────────────────────
settingsBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/settings');
    const data = await res.json();
    document.getElementById('cfgManualSymbol').value = data.manualSymbol || '';
    document.getElementById('cfgProactiveToggle').checked = data.proactiveEnabled;
    if (data.hasGeminiKey) document.getElementById('cfgGeminiKey').placeholder = '●●●●●● (Kayıtlı)';
    if (data.hasBinanceKey) document.getElementById('cfgBinanceKey').placeholder = '●●●●●● (Kayıtlı)';
  } catch (e) {}
  settingsModal.style.display = 'flex';
});

closeModalBtn.addEventListener('click', () => settingsModal.style.display = 'none');

saveSettingsBtn.addEventListener('click', async () => {
  const payload = {
    geminiApiKey: document.getElementById('cfgGeminiKey').value || undefined,
    binanceApiKey: document.getElementById('cfgBinanceKey').value || undefined,
    binanceApiSecret: document.getElementById('cfgBinanceSecret').value || undefined,
    manualSymbol: document.getElementById('cfgManualSymbol').value,
    proactiveEnabled: document.getElementById('cfgProactiveToggle').checked
  };

  await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  settingsModal.style.display = 'none';
  alert('Ayarlar kaydedildi ve bağlantılar yenilendi!');
});

// Manuel "Hemen Analiz Et" butonu
manualTriggerBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('/api/analyze-now', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) alert(data.error);
  } catch (e) {
    alert('Hata: ' + e.message);
  }
});

// Ses Bildirim Butonu
voiceAlertBtn.addEventListener('click', () => {
  voiceAlertEnabled = !voiceAlertEnabled;
  voiceAlertBtn.classList.toggle('active', voiceAlertEnabled);
  voiceAlertBtn.querySelector('.btn-label').innerText = voiceAlertEnabled ? 'Ses Açık' : 'Sessiz';
});

// Tuş Kontrolleri
sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Başlangıç
connectWebSocket();
setupSpeechRecognition();
