const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

const els = {
  persona: document.querySelector("#personaSelect"),
  scenario: document.querySelector("#scenarioSelect"),
  personaAvatar: document.querySelector("#personaAvatar"),
  personaSubtitle: document.querySelector("#personaSubtitle"),
  personaTitle: document.querySelector("#personaTitle"),
  apiKey: document.querySelector("#apiKeyInput"),
  model: document.querySelector("#modelInput"),
  voice: document.querySelector("#voiceSelect"),
  system: document.querySelector("#systemInput"),
  connect: document.querySelector("#connectButton"),
  mute: document.querySelector("#muteButton"),
  hangup: document.querySelector("#hangupButton"),
  text: document.querySelector("#textInput"),
  sendText: document.querySelector("#sendTextButton"),
  log: document.querySelector("#log"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  timer: document.querySelector("#timer"),
  micMeter: document.querySelector("#micMeter"),
  speakerMeter: document.querySelector("#speakerMeter"),
};

let eventSource = null;
let audioContext = null;
let micStream = null;
let micSource = null;
let micProcessor = null;
let muted = false;
let connectedAt = 0;
let timerId = null;
let speakerMeterId = null;
let setupReady = false;
let sentAudioChunks = 0;
let setupTimerId = null;

const playback = {
  nextTime: 0,
  sources: new Set(),
  level: 0,
};

const personas = {
  mom: {
    title: "엄마",
    avatar: "엄",
    subtitle: "안전 귀가 통화",
    voice: "Kore",
    tone:
      "너는 사용자의 엄마처럼 통화한다. 다정하지만 과하게 장황하지 않고, 걱정스러운 상황에서는 침착하게 확인 질문을 한다. 반말을 자연스럽게 쓰되 사용자를 몰아붙이지 않는다.",
    examples:
      "예: '응, 엄마야. 지금 어디쯤이야?', '괜찮아, 나랑 계속 통화하면서 가자.', '주변에 사람 많은 쪽으로 걸어가.'",
  },
  dad: {
    title: "아빠",
    avatar: "아",
    subtitle: "안전 동행 통화",
    voice: "Orus",
    tone:
      "너는 사용자의 아빠처럼 통화한다. 말수는 적지만 든든하고 침착하다. 짧은 문장으로 상황을 확인하고, 필요하면 위치 공유와 안전한 동선을 권한다.",
    examples:
      "예: '아빠야. 천천히 말해봐.', '지금 밝은 길로 가.', '도착할 때까지 안 끊을게.'",
  },
  friend: {
    title: "민지",
    avatar: "친",
    subtitle: "친구와 통화 중",
    voice: "Aoede",
    tone:
      "너는 사용자의 친한 친구처럼 통화한다. 편하고 자연스럽게 반응하되, 위험 신호가 보이면 농담을 줄이고 바로 안전 행동을 돕는다.",
    examples:
      "예: '야 나야. 지금 통화하는 척 말고 그냥 나랑 얘기해.', '오케이, 내가 계속 듣고 있을게.', '불편하면 지금 나랑 약속 있다고 해.'",
  },
  partner: {
    title: "하준",
    avatar: "애",
    subtitle: "애인과 통화 중",
    voice: "Puck",
    tone:
      "너는 사용자의 애인처럼 통화한다. 가까운 사이처럼 자연스럽고 따뜻하게 말한다. 질투나 통제처럼 들리지 않게 하고, 사용자가 빠져나올 명분을 만들어준다.",
    examples:
      "예: '응 자기야, 나 지금 밖이야.', '내가 데리러 가는 척할게.', '무리하지 말고 바로 나와.'",
  },
  coworker: {
    title: "팀장님",
    avatar: "팀",
    subtitle: "업무 전화",
    voice: "Charon",
    tone:
      "너는 사용자의 직장 상사나 동료처럼 통화한다. 공손하고 업무적인 톤으로 짧게 말한다. 불편한 자리에서 빠져나올 수 있도록 급한 업무 전화처럼 행동한다.",
    examples:
      "예: '지금 바로 확인 가능하실까요?', '회의 건으로 급히 연락드렸습니다.', '가능하면 조용한 곳으로 이동해 주세요.'",
  },
  guardian: {
    title: "보호자",
    avatar: "보",
    subtitle: "보호자 통화",
    voice: "Kore",
    tone:
      "너는 사용자의 안전 보호자처럼 통화한다. 침착하고 명확하게 상황을 파악한다. 위험도가 높으면 가까운 안전 지점 이동, 위치 공유, 112 신고를 자연스럽게 안내한다.",
    examples:
      "예: '현재 위치를 말할 수 있나요?', '사람이 많은 곳으로 이동하세요.', '위험하면 지금 바로 신고해도 괜찮습니다.'",
  },
};

const scenarios = {
  walkHome:
    "상황은 밤길 귀가다. 사용자가 혼자 걷는 중일 수 있으니 주변 위치, 밝은 길, 사람 많은 곳, 도착 확인을 자연스럽게 챙긴다.",
  escape:
    "상황은 불편한 자리에서 빠져나오려는 것이다. AI는 실제 통화 상대처럼 말하며 사용자가 '나가야 할 이유'를 만들 수 있게 돕는다.",
  transaction:
    "상황은 중고거래나 낯선 사람과의 만남이다. 장소, 사람 수, 거래 진행 여부를 조심스럽게 확인하고 필요하면 공개된 장소로 이동하게 한다.",
  taxi:
    "상황은 택시나 차량 이동이다. 목적지, 경로, 차량 분위기를 확인하고 사용자가 불안해하면 통화를 유지하며 위치 공유를 권한다.",
};

els.apiKey.value = localStorage.getItem("geminiLiveApiKey") || "";
els.persona.value = localStorage.getItem("geminiLivePersona") || "mom";
els.scenario.value = localStorage.getItem("geminiLiveScenario") || "walkHome";

els.connect.addEventListener("click", start);
els.hangup.addEventListener("click", stop);
els.mute.addEventListener("click", toggleMute);
els.sendText.addEventListener("click", sendText);
els.persona.addEventListener("change", applyPersonaPreset);
els.scenario.addEventListener("change", applyPersonaPreset);
els.text.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendText();
});

window.addEventListener("beforeunload", () => {
  stop();
});

applyPersonaPreset();

async function start() {
  const apiKey = els.apiKey.value.trim();
  const model = els.model.value.trim();

  if (!apiKey) {
    log("API 키를 먼저 입력해줘.", "error");
    return;
  }

  if (!model) {
    log("모델명을 입력해줘.", "error");
    return;
  }

  localStorage.setItem("geminiLiveApiKey", apiKey);
  setUiConnecting();

  try {
    audioContext = new AudioContext();
    await audioContext.resume();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    await openEventStream();
    await postJson("/start", {
      apiKey,
      model,
      voiceName: els.voice.value,
      systemInstruction: els.system.value.trim(),
    });
    startSetupTimer();
    startMicStreaming();
    log("마이크 레벨 표시 시작. 세션 준비 전에는 오디오를 보내지 않습니다.");
  } catch (error) {
    log(error.message || String(error), "error");
    cleanup(false);
    setUiIdle();
  }
}

function applyPersonaPreset() {
  const persona = personas[els.persona.value] || personas.mom;
  const scenarioText = scenarios[els.scenario.value] || scenarios.walkHome;
  const instruction = [
    persona.tone,
    scenarioText,
    "너는 실제 전화 상대처럼 행동한다. 자신이 AI라고 먼저 말하지 않는다.",
    "사용자가 말을 끊거나 끼어들면 즉시 멈추고 사용자의 말을 먼저 듣는다.",
    "답변은 보통 1~2문장으로 짧게 유지한다. 긴 설명, 목록, 안내문처럼 말하지 않는다.",
    "사용자가 위험하다는 암시를 하면 목소리 톤을 낮추고 침착하게 현재 위치와 주변 상황을 확인한다.",
    "긴급 위험이면 안전한 장소로 이동, 위치 공유, 112 신고를 권하되 겁을 주지 않는다.",
    persona.examples,
  ].join("\n");

  els.personaTitle.textContent = persona.title;
  els.personaAvatar.textContent = persona.avatar;
  els.personaSubtitle.textContent = persona.subtitle;
  els.voice.value = persona.voice;
  els.system.value = instruction;
  localStorage.setItem("geminiLivePersona", els.persona.value);
  localStorage.setItem("geminiLiveScenario", els.scenario.value);
}

function openEventStream() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource("/events");
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error("로컬 이벤트 스트림 연결 시간이 초과되었습니다."));
    }, 3000);

    eventSource.addEventListener("open", () => {
      window.clearTimeout(timeoutId);
      log("로컬 이벤트 스트림 연결됨. Gemini Live 세션을 설정합니다.");
      resolve();
    });
    eventSource.addEventListener("error", () => {
      log("로컬 이벤트 스트림 오류가 발생했습니다.", "error");
    });
    eventSource.addEventListener("message", handleServerMessage);
  });
}

function startSetupTimer() {
  window.clearTimeout(setupTimerId);
  setupTimerId = window.setTimeout(() => {
    if (setupReady) return;
    log("8초 동안 SDK 세션 준비 이벤트가 오지 않았습니다. 모델명/키 권한/Live API 사용 가능 여부를 확인해야 합니다.", "error");
  }, 5000);
}

function startMicStreaming() {
  if (micProcessor) return;

  micSource = audioContext.createMediaStreamSource(micStream);
  micProcessor = audioContext.createScriptProcessor(4096, 1, 1);

  micProcessor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    const level = rms(input);
    els.micMeter.value = muted ? 0 : Math.min(1, level * 8);

    if (muted) return;

    const pcm16 = floatTo16BitPCM(resampleLinear(input, audioContext.sampleRate, INPUT_RATE));
    sendAudioChunk(pcm16);
  };

  micSource.connect(micProcessor);
  micProcessor.connect(audioContext.destination);
}

function sendAudioChunk(int16Samples) {
  if (!setupReady) return;

  postJson("/audio", {
    data: arrayBufferToBase64(int16Samples.buffer),
    mimeType: `audio/pcm;rate=${INPUT_RATE}`,
  }).catch((error) => {
    log(`오디오 전송 실패: ${error.message || String(error)}`, "error");
  });

  sentAudioChunks += 1;
  if (sentAudioChunks === 1) {
    log("마이크 오디오 전송 시작.");
  }
}

function sendText() {
  const text = els.text.value.trim();
  if (!text) return;

  postJson("/text", { text }).catch((error) => {
    log(`텍스트 전송 실패: ${error.message || String(error)}`, "error");
  });
  log(`나: ${text}`, "user");
  els.text.value = "";
}

function handleServerMessage(event) {
  const payload = JSON.parse(event.data);

  if (payload.type === "status") {
    log(payload.message);
    return;
  }

  if (payload.type === "error") {
    log(payload.message, "error");
    setUiError();
    return;
  }

  if (payload.type === "setupComplete") {
    log("세션 준비 완료. 바로 말해봐도 됩니다.");
    setupReady = true;
    window.clearTimeout(setupTimerId);
    setupTimerId = null;
    setUiConnected();
    return;
  }

  const message = payload.message;

  if (message?.serverContent) {
    handleServerContent(message.serverContent);
  }

  if (message?.toolCall) {
    log(`toolCall 수신: ${JSON.stringify(message.toolCall)}`);
  }
}

function handleServerContent(content) {
  if (content.interrupted) {
    log("Gemini 응답이 사용자 끼어들기로 중단됨.");
    clearPlaybackQueue();
  }

  if (content.generationComplete) {
    log("Gemini generation complete.");
  }

  if (content.inputTranscription?.text) {
    log(`나: ${content.inputTranscription.text}`, "user");
  }

  if (content.outputTranscription?.text) {
    log(`Gemini: ${content.outputTranscription.text}`, "model");
  }

  const parts = content.modelTurn?.parts || [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      log(`오디오 응답 chunk 수신 (${part.inlineData.data.length} chars).`);
      playPcm24(part.inlineData.data);
    }
  }

  if (content.turnComplete) {
    log("Gemini turn complete.");
  }
}

function playPcm24(base64Audio) {
  if (!audioContext) return;

  const samples = base64ToInt16Array(base64Audio);
  const audioBuffer = audioContext.createBuffer(1, samples.length, OUTPUT_RATE);
  const channel = audioBuffer.getChannelData(0);

  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] / 32768;
    channel[i] = Math.max(-1, Math.min(1, value));
    sum += value * value;
  }
  playback.level = Math.sqrt(sum / Math.max(1, samples.length));

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);

  const startTime = Math.max(audioContext.currentTime + 0.03, playback.nextTime);
  source.start(startTime);
  playback.nextTime = startTime + audioBuffer.duration;
  playback.sources.add(source);
  source.onended = () => playback.sources.delete(source);

  if (!speakerMeterId) {
    speakerMeterId = window.setInterval(() => {
      els.speakerMeter.value = Math.min(1, playback.level * 8);
      playback.level *= 0.82;
      if (playback.sources.size === 0 && playback.level < 0.01) {
        els.speakerMeter.value = 0;
        window.clearInterval(speakerMeterId);
        speakerMeterId = null;
      }
    }, 60);
  }
}

function clearPlaybackQueue() {
  for (const source of playback.sources) {
    try {
      source.stop();
    } catch {
      // Source may already be stopped.
    }
  }
  playback.sources.clear();
  playback.nextTime = audioContext ? audioContext.currentTime : 0;
  playback.level = 0;
  els.speakerMeter.value = 0;
}

function toggleMute() {
  muted = !muted;
  els.mute.textContent = muted ? "마이크 켜기" : "마이크 끄기";

  log(muted ? "마이크 음소거." : "마이크 재개.");
}

function stop() {
  postJson("/stop", {}).catch(() => {});
  cleanup(true);
}

function cleanup(shouldLog) {
  clearPlaybackQueue();

  if (micProcessor) {
    micProcessor.disconnect();
    micProcessor.onaudioprocess = null;
  }
  if (micSource) micSource.disconnect();
  if (micStream) {
    for (const track of micStream.getTracks()) track.stop();
  }
  if (audioContext) audioContext.close();

  if (eventSource) eventSource.close();
  eventSource = null;
  audioContext = null;
  micStream = null;
  micSource = null;
  micProcessor = null;
  muted = false;
  setupReady = false;
  sentAudioChunks = 0;
  els.micMeter.value = 0;
  els.speakerMeter.value = 0;

  window.clearInterval(timerId);
  window.clearTimeout(setupTimerId);
  timerId = null;
  setupTimerId = null;
  connectedAt = 0;
  els.timer.textContent = "00:00";

  setUiIdle();
  if (shouldLog) log("통화를 종료했습니다.");
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}`);
  }

  return response.json();
}

function setUiConnecting() {
  els.connect.disabled = true;
  els.hangup.disabled = false;
  setSettingsDisabled(true);
  els.statusDot.className = "status-dot";
  els.statusText.textContent = "연결 중";
}

function setUiConnected() {
  els.connect.disabled = true;
  els.hangup.disabled = false;
  setSettingsDisabled(true);
  els.mute.disabled = false;
  els.text.disabled = false;
  els.sendText.disabled = false;
  els.statusDot.className = "status-dot connected";
  els.statusText.textContent = "통화 중";
  connectedAt = Date.now();
  timerId = window.setInterval(updateTimer, 250);
}

function setUiIdle() {
  els.connect.disabled = false;
  els.hangup.disabled = true;
  setSettingsDisabled(false);
  els.mute.disabled = true;
  els.mute.textContent = "마이크 끄기";
  els.text.disabled = true;
  els.sendText.disabled = true;
  els.statusDot.className = "status-dot";
  els.statusText.textContent = "대기 중";
}

function setSettingsDisabled(disabled) {
  els.persona.disabled = disabled;
  els.scenario.disabled = disabled;
  els.model.disabled = disabled;
  els.voice.disabled = disabled;
  els.system.disabled = disabled;
}

function setUiError() {
  els.statusDot.className = "status-dot error";
  els.statusText.textContent = "오류";
}

function updateTimer() {
  const seconds = Math.floor((Date.now() - connectedAt) / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  els.timer.textContent = `${mm}:${ss}`;
}

function log(message, type = "") {
  const entry = document.createElement("p");
  entry.className = `log-entry ${type}`.trim();
  entry.innerHTML = `<span class="time">${new Date().toLocaleTimeString()}</span> ${escapeHtml(message)}`;
  els.log.append(entry);
  els.log.scrollTop = els.log.scrollHeight;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function resampleLinear(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;

  const ratio = fromRate / toRate;
  const newLength = Math.round(samples.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i += 1) {
    const position = i * ratio;
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const weight = position - left;
    result[i] = samples[left] * (1 - weight) + samples[right] * weight;
  }

  return result;
}

function floatTo16BitPCM(samples) {
  const result = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    result[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return result;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function base64ToInt16Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Int16Array(bytes.buffer);
}
