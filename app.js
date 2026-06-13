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
  vcEnabled: document.querySelector("#vcEnabledInput"),
  vcKey: document.querySelector("#vcKeyInput"),
  vcVoice: document.querySelector("#vcVoiceInput"),
  system: document.querySelector("#systemInput"),
  connect: document.querySelector("#connectButton"),
  mute: document.querySelector("#muteButton"),
  hangup: document.querySelector("#hangupButton"),
  lipsyncDemo: document.querySelector("#lipsyncDemoButton"),
  saveTurn: document.querySelector("#saveTurnButton"),
  text: document.querySelector("#textInput"),
  sendText: document.querySelector("#sendTextButton"),
  log: document.querySelector("#log"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  timer: document.querySelector("#timer"),
  micMeter: document.querySelector("#micMeter"),
  speakerMeter: document.querySelector("#speakerMeter"),
  // 안전 기능
  safeWord: document.querySelector("#safeWordInput"),
  analysisModel: document.querySelector("#analysisModelInput"),
  toneEnabled: document.querySelector("#toneEnabledInput"),
  dangerLevel: document.querySelector("#dangerLevel"),
  dangerFill: document.querySelector("#dangerFill"),
  dangerReason: document.querySelector("#dangerReason"),
  reportModal: document.querySelector("#reportModal"),
  reportTrigger: document.querySelector("#reportTrigger"),
  reportTitle: document.querySelector("#reportTitle"),
  reportDetail: document.querySelector("#reportDetail"),
  reportGps: document.querySelector("#reportGps"),
  reportCountdown: document.querySelector("#reportCountdown"),
  reportCancel: document.querySelector("#reportCancel"),
  reportNow: document.querySelector("#reportNow"),
  reportToast: document.querySelector("#reportToast"),
};

// ----- 안전 기능 상태 -----
const safety = {
  transcript: "",        // 사용자 발화 누적(분석용)
  lastAnalyzedAt: 0,
  analyzeTimer: null,
  guidanceGiven: false,  // 세이프워드 유도를 이미 했는지
  reportActive: false,   // 신고 모달 표시 중
  reportTimer: null,
  safeWordFired: false,  // 세이프워드 후보 트리거 중복 방지
  gps: null,
  toneChunks: [],        // 모듈 D용 PCM 누적
  toneSamples: 0,
};
const TONE_WINDOW_SAMPLES = INPUT_RATE * 6; // ~6초 윈도우

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
  bus: null,
};

const avatar = new LipsyncAvatar(document.querySelector("#avatarStage"));

const personas = {
  mom: {
    title: "엄마",
    avatar: "엄",
    subtitle: "안전 귀가 통화",
    voice: "Kore",
    tone:
      "너는 사용자의 엄마처럼 통화한다. 다정하지만 과하게 장황하지 않고, 걱정스러운 상황에서는 침착하게 확인 질문을 한다. 반말을 자연스럽게 쓰되 사용자를 몰아붙이지 않는다.\n[목소리 연기] 50대 한국 엄마를 연기한다: 톤을 낮추고 말 속도를 조금 늦춘다. 문장 끝을 부드럽게 흘리고, '응', '그래그래', '아이고' 같은 추임새를 자연스럽게 섞는다. 또박또박 아나운서처럼 말하지 말고 일상 전화 통화처럼 편하게 말한다.",
    examples:
      "예: '응, 엄마야. 지금 어디쯤이야?', '괜찮아, 나랑 계속 통화하면서 가자.', '주변에 사람 많은 쪽으로 걸어가.'",
  },
  dad: {
    title: "아빠",
    avatar: "아",
    subtitle: "안전 동행 통화",
    voice: "Orus",
    tone:
      "너는 사용자의 아빠처럼 통화한다. 말수는 적지만 든든하고 침착하다. 짧은 문장으로 상황을 확인하고, 필요하면 위치 공유와 안전한 동선을 권한다.\n[목소리 연기] 50대 한국 아빠를 연기한다: 낮고 묵직한 톤, 느린 속도, 짧은 문장. '어', '그래', '음' 같은 추임새를 가끔 쓴다. 감정 기복 없이 담담하게, 일상 전화 통화처럼 말한다.",
    examples:
      "예: '아빠야. 천천히 말해봐.', '지금 밝은 길로 가.', '도착할 때까지 안 끊을게.'",
  },
  friend: {
    title: "민지",
    avatar: "친",
    subtitle: "친구와 통화 중",
    voice: "Aoede",
    tone:
      "너는 사용자의 친한 친구처럼 통화한다. 편하고 자연스럽게 반응하되, 위험 신호가 보이면 농담을 줄이고 바로 안전 행동을 돕는다.\n[목소리 연기] 20대 한국 여성 친구를 연기한다: 빠르고 가벼운 말씨, '야', '헐', '진짜?' 같은 리액션을 자연스럽게 쓴다. 발음을 또박또박 하지 말고 친구끼리 통화하듯 흘리며 말한다.",
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
els.vcEnabled.checked = localStorage.getItem("vcEnabled") === "1";
els.vcKey.value = localStorage.getItem("vcApiKey") || "";
els.vcVoice.value = localStorage.getItem("vcVoiceId") || "";
els.safeWord.value = localStorage.getItem("safeWord") || "짜장면";
els.toneEnabled.checked = localStorage.getItem("toneEnabled") === "1";

els.safeWord.addEventListener("change", () => localStorage.setItem("safeWord", els.safeWord.value.trim()));
els.toneEnabled.addEventListener("change", () => localStorage.setItem("toneEnabled", els.toneEnabled.checked ? "1" : "0"));
els.reportCancel.addEventListener("click", () => closeReportModal("사용자 취소"));
els.reportNow.addEventListener("click", () => doReport("manual"));

els.connect.addEventListener("click", start);
els.lipsyncDemo.addEventListener("click", runLipsyncDemo);
els.saveTurn.addEventListener("click", downloadLastTurn);
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
    playback.bus = avatar.attach(audioContext);
    playback.nextTime = 0; // 이전 세션의 예약 시각이 남아 첫 턴이 무음이 되는 것 방지

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    localStorage.setItem("vcEnabled", els.vcEnabled.checked ? "1" : "0");
    localStorage.setItem("vcApiKey", els.vcKey.value.trim());
    localStorage.setItem("vcVoiceId", els.vcVoice.value.trim());

    resetSafety();
    await openEventStream();
    await postJson("/start", {
      apiKey,
      model,
      voiceName: els.voice.value,
      systemInstruction: buildSystemInstruction(),
      vcEnabled: els.vcEnabled.checked,
      vcApiKey: els.vcKey.value.trim(),
      vcVoiceId: els.vcVoice.value.trim(),
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
  avatar.setPersona(els.persona.value);
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
    accumulateTone(pcm16);
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
  onUserUtterance(text);
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

  if (payload.type === "vcAudio") {
    playVcAudio(payload);
    return;
  }

  if (payload.type === "toolCall") {
    handleToolCall(payload.calls);
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
    finalizeTurnCapture();
  }

  if (content.generationComplete) {
    log("Gemini generation complete.");
  }

  if (content.inputTranscription?.text) {
    log(`나: ${content.inputTranscription.text}`, "user");
    onUserUtterance(content.inputTranscription.text);
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
    finalizeTurnCapture();
  }
}

// ----- 응답 오디오 캡처 (VC 테스트용 WAV 추출) -----
const turnCapture = { current: [], last: null };

function finalizeTurnCapture() {
  if (turnCapture.current.length === 0) return;
  let total = 0;
  for (const part of turnCapture.current) total += part.length;
  const merged = new Int16Array(total);
  let offset = 0;
  for (const part of turnCapture.current) {
    merged.set(part, offset);
    offset += part.length;
  }
  turnCapture.last = merged;
  turnCapture.current = [];
  els.saveTurn.disabled = false;
  els.saveTurn.textContent = `마지막 응답 WAV 저장 (${(total / OUTPUT_RATE).toFixed(1)}초)`;
}

function downloadLastTurn() {
  const samples = turnCapture.last;
  if (!samples) return;

  const header = new DataView(new ArrayBuffer(44));
  const dataSize = samples.length * 2;
  const writeStr = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) header.setUint8(offset + i, text.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  header.setUint32(4, 36 + dataSize, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, OUTPUT_RATE, true);
  header.setUint32(28, OUTPUT_RATE * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  writeStr(36, "data");
  header.setUint32(40, dataSize, true);

  const blob = new Blob([header.buffer, samples.buffer], { type: "audio/wav" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `gemini-turn-${Date.now()}.wav`;
  link.click();
  URL.revokeObjectURL(link.href);
  log("마지막 응답을 WAV로 저장했습니다. Colab Seed-VC 테스트의 소스로 사용하세요.");
}

function playPcm24(base64Audio) {
  if (!audioContext) return;
  if (audioContext.state === "suspended") audioContext.resume();

  const samples = base64ToInt16Array(base64Audio);
  turnCapture.current.push(samples);
  const audioBuffer = audioContext.createBuffer(1, samples.length, OUTPUT_RATE);
  const channel = audioBuffer.getChannelData(0);

  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] / 32768;
    channel[i] = Math.max(-1, Math.min(1, value));
    sum += value * value;
  }
  playback.level = Math.sqrt(sum / Math.max(1, samples.length));

  scheduleAudioBuffer(audioBuffer);
}

// VC 변환 오디오 재생: PCM이면 기존 경로, mp3면 디코딩 후 동일 큐에 합류
async function playVcAudio(payload) {
  if (!audioContext) return;

  if (payload.fallback) {
    log("VC 폴백 윈도우 재생 (원본 음성).");
  } else if (payload.ms) {
    log(`VC 변환 완료 (${payload.ms}ms, ${payload.format}).`);
  }

  if (payload.format.startsWith("pcm")) {
    playPcm24(payload.data);
    return;
  }

  try {
    if (audioContext.state === "suspended") audioContext.resume();
    const bytes = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0));
    const audioBuffer = await audioContext.decodeAudioData(bytes.buffer);
    playback.level = 0.5;
    scheduleAudioBuffer(audioBuffer);
  } catch (error) {
    log(`VC 오디오 디코딩 실패: ${error.message || String(error)}`, "error");
  }
}

function scheduleAudioBuffer(audioBuffer) {
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(playback.bus || audioContext.destination);

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
  avatar.stop();
  playback.bus = null;

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
  playback.nextTime = 0;
  els.micMeter.value = 0;
  els.speakerMeter.value = 0;

  window.clearInterval(timerId);
  window.clearTimeout(setupTimerId);
  timerId = null;
  setupTimerId = null;
  connectedAt = 0;
  els.timer.textContent = "00:00";

  resetSafety();
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

// API 키/서버 없이 아바타 립싱크만 확인하는 데모.
// "말소리 비슷한" 합성음(음절 단위로 피치·음량이 바뀌는 톤)을 재생한다.
let demoRunning = false;

async function runLipsyncDemo() {
  if (demoRunning) return;
  if (audioContext) {
    log("통화 중에는 데모를 실행할 수 없습니다.", "error");
    return;
  }

  demoRunning = true;
  els.lipsyncDemo.disabled = true;
  log("립싱크 데모 시작 — 아바타 입을 보세요.");

  const ctx = new AudioContext();
  await ctx.resume();
  const bus = avatar.attach(ctx);

  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(bus);

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  osc.connect(filter);
  filter.connect(master);
  osc.start();

  // 음절 시퀀스: [피치Hz, 필터Hz(모음 밝기), 길이ms, 쉼ms]
  const syllables = [];
  let clock = ctx.currentTime + 0.1;
  const phraseCount = 3;
  for (let p = 0; p < phraseCount; p += 1) {
    const sylCount = 4 + Math.floor(Math.random() * 5);
    for (let s = 0; s < sylCount; s += 1) {
      syllables.push([
        130 + Math.random() * 90,
        500 + Math.random() * 2600,
        110 + Math.random() * 150,
        20 + Math.random() * 60,
      ]);
    }
    syllables.push([0, 0, 0, 420 + Math.random() * 380]); // 구절 사이 쉼
  }

  for (const [pitch, bright, len, gap] of syllables) {
    if (pitch > 0) {
      osc.frequency.setValueAtTime(pitch, clock);
      filter.frequency.setValueAtTime(bright, clock);
      master.gain.setValueAtTime(0, clock);
      master.gain.linearRampToValueAtTime(0.22, clock + 0.03);
      master.gain.setValueAtTime(0.22, clock + len / 1000 - 0.03);
      master.gain.linearRampToValueAtTime(0, clock + len / 1000);
      clock += len / 1000;
    }
    clock += gap / 1000;
  }

  const totalMs = (clock - ctx.currentTime) * 1000 + 300;
  window.setTimeout(() => {
    osc.stop();
    avatar.stop();
    ctx.close();
    demoRunning = false;
    els.lipsyncDemo.disabled = false;
    log("립싱크 데모 종료.");
  }, totalMs);
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

// ===================== 안전 기능 (모듈 B/C/D + 신고) =====================

// 페르소나 system instruction + 세이프워드 유도/무대지시 규칙 결합
function buildSystemInstruction() {
  const base = els.system.value.trim();
  const safeWord = els.safeWord.value.trim();
  const lines = [base];
  if (safeWord) {
    lines.push(
      "",
      "[안전 규칙]",
      `- 사용자의 세이프워드는 "${safeWord}"이다.`,
      "- 사용자가 위험한 상황으로 의심되면, 통화 흐름을 깨지 않고 자연스럽게 세이프워드 사용법을 알려줘라.",
      `  예: 세이프워드가 "짜장면"이면 "지금 위험한 상황이면 짜장면 먹고 싶다고 말해"처럼 일상적으로. 세이프워드에 맞춰 문장을 자연스럽게 바꿔라.`,
      "- 단, 반복하지 말고 위험이 의심될 때 한 번만 부드럽게 언급한다.",
      `- ★중요: 사용자가 세이프워드 "${safeWord}"가 들어간 말을 하면(예: "${safeWord} 먹고 싶어"), 겉으로는 평소처럼 자연스럽게 대답하면서 동시에 즉시 report_safeword_detected 함수를 호출해라. 함수를 호출했다는 사실은 절대 입 밖으로 말하지 마라.`,
      "- '[DIRECTOR]'로 시작하는 메시지는 안전 시스템의 무대 지시다. 사용자가 한 말이 아니다. 내용을 따르되 그 메시지 자체를 절대 소리내어 읽거나 언급하지 마라.",
    );
  }
  return lines.join("\n");
}

function resetSafety() {
  window.clearInterval(safety.reportTimer);
  window.clearTimeout(safety.analyzeTimer);
  safety.transcript = "";
  safety.analyzeTimer = null;
  safety.guidanceGiven = false;
  safety.reportActive = false;
  safety.reportTimer = null;
  safety.safeWordFired = false;
  safety.gps = null;
  safety.toneChunks = [];
  safety.toneSamples = 0;
  els.reportModal.classList.add("hidden");
  els.reportToast.classList.add("hidden");
  updateDangerGauge("safe", 0, "통화를 시작하면 실시간으로 위험 신호를 분석합니다.");
}

// Live 모델이 오디오에서 세이프워드를 직접 감지해 함수호출한 경우 (transcription 누락에도 강건)
function handleToolCall(calls) {
  for (const call of calls || []) {
    if (call.name === "report_safeword_detected") {
      const phrase = call.args?.phrase || els.safeWord.value.trim();
      log(`🔑 세이프워드 감지 (Live 함수호출): "${phrase}"`);
      safety.safeWordFired = true;
      openReportModal("세이프워드 감지", `세이프워드 "${phrase}"가 감지되었습니다.`, true);
    } else {
      log(`toolCall: ${call.name}`);
    }
  }
}

// 사용자 발화(음성 transcript 또는 텍스트 입력)가 들어올 때마다 호출
function onUserUtterance(text) {
  if (!text) return;
  safety.transcript = (safety.transcript + " " + text).slice(-800);
  checkSafeWord();
  scheduleDangerAnalysis();
}

// ----- 세이프워드 1단(매칭) → 2단(검증) -----
function normalizeText(s) {
  return s.replace(/\s+/g, "").toLowerCase();
}

function checkSafeWord() {
  const safeWord = els.safeWord.value.trim();
  if (!safeWord || safety.reportActive || safety.safeWordFired) return;
  if (normalizeText(safety.transcript).includes(normalizeText(safeWord))) {
    safety.safeWordFired = true;
    log(`세이프워드 후보 감지: "${safeWord}" → 2단 맥락 검증 중...`);
    verifySafeWord(safeWord);
  }
}

async function verifySafeWord(safeWord) {
  const apiKey = els.apiKey.value.trim();
  const model = els.analysisModel.value.trim();
  try {
    const r = await postJson("/verify-safeword", { apiKey, model, safeWord, context: safety.transcript });
    if (!r.ok) {
      log(`세이프워드 검증 실패: ${r.error}`, "error");
      safety.safeWordFired = false;
      return;
    }
    log(`세이프워드 2단 검증: confirmed=${r.confirmed} (${Math.round(r.confidence * 100)}%) — ${r.reason}`);
    if (r.confirmed) {
      openReportModal("세이프워드 감지", `세이프워드 "${safeWord}"가 위험 신호로 확인되었습니다.`, true);
    } else {
      safety.safeWordFired = false; // 일상 사용으로 판단 → 다음 발화에서 재감지 허용
    }
  } catch (error) {
    log(`세이프워드 검증 오류: ${error.message || String(error)}`, "error");
    safety.safeWordFired = false;
  }
}

// ----- 모듈 B: 대화 위험 점수 (디바운스) -----
function scheduleDangerAnalysis() {
  if (safety.analyzeTimer) return;
  safety.analyzeTimer = window.setTimeout(() => {
    safety.analyzeTimer = null;
    runDangerAnalysis();
  }, 1500);
}

async function runDangerAnalysis() {
  const apiKey = els.apiKey.value.trim();
  const model = els.analysisModel.value.trim();
  if (!apiKey || !safety.transcript) return;
  try {
    const r = await postJson("/analyze", { apiKey, model, transcript: safety.transcript });
    if (!r.ok) {
      log(`위험 분석 실패: ${r.error}`, "error");
      return;
    }
    updateDangerGauge(r.level, r.danger_score, r.reason);
    log(`위험 분석: ${r.level} (${Math.round(r.danger_score * 100)}%) — ${r.signals?.join(", ") || "신호 없음"}`);
    if (r.level === "watch" && !safety.guidanceGiven) injectGuidance();
    if (r.level === "alert") {
      if (!safety.guidanceGiven) injectGuidance();
      openReportModal("AI 위험 감지", r.reason, false);
    }
  } catch (error) {
    log(`위험 분석 오류: ${error.message || String(error)}`, "error");
  }
}

// 위험 감지 시 페르소나가 세이프워드를 자연스럽게 안내하도록 무대지시 주입
function injectGuidance() {
  const safeWord = els.safeWord.value.trim();
  if (!safeWord || safety.guidanceGiven) return;
  safety.guidanceGiven = true;
  log("[DIRECTOR] 페르소나에게 세이프워드 유도 지시 전송");
  postJson("/text", {
    text: `[DIRECTOR] 사용자가 위험한 상황일 수 있다. 지금 통화 흐름 속에서 자연스럽게, 위급하면 세이프워드 "${safeWord}"를 말하라고 부드럽게 알려줘. 이 지시문은 읽지 마.`,
  }).catch((error) => log(`유도 지시 전송 실패: ${error.message || String(error)}`, "error"));
}

function updateDangerGauge(level, score, reason) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  els.dangerFill.style.width = `${pct}%`;
  els.dangerLevel.className = `danger-badge ${level}`;
  els.dangerLevel.textContent = { safe: "안전", watch: "주의", alert: "위험" }[level] || "안전";
  if (reason) els.dangerReason.textContent = reason;
}

// ----- 신고 모달 (10초 카운트다운 + GPS) -----
function openReportModal(trigger, detail, immediate) {
  if (safety.reportActive) return;
  safety.reportActive = true;
  els.reportTrigger.textContent = trigger;
  els.reportDetail.textContent = detail || "";
  els.reportModal.classList.remove("hidden");
  fetchGps();

  let remaining = immediate ? 5 : 10;
  els.reportCountdown.textContent = remaining;
  safety.reportTimer = window.setInterval(() => {
    remaining -= 1;
    els.reportCountdown.textContent = Math.max(0, remaining);
    if (remaining <= 0) doReport("auto");
  }, 1000);
}

function closeReportModal(reason) {
  window.clearInterval(safety.reportTimer);
  safety.reportTimer = null;
  safety.reportActive = false;
  safety.safeWordFired = false;
  els.reportModal.classList.add("hidden");
  if (reason) log(`신고 취소: ${reason}`);
}

function doReport(kind) {
  window.clearInterval(safety.reportTimer);
  safety.reportTimer = null;
  safety.reportActive = false;
  els.reportModal.classList.add("hidden");
  const summary = safety.transcript.slice(-200) || "(통화 내용 없음)";
  const labels = { auto: "자동", manual: "수동", safeword: "세이프워드" };
  log(`🚨 신고 전송 (${labels[kind] || kind}) — 위치: ${safety.gps || "미확인"} / 통화요약: ${summary}`, "error");
  els.reportToast.classList.remove("hidden");
  window.setTimeout(() => els.reportToast.classList.add("hidden"), 4000);
}

function fetchGps() {
  els.reportGps.textContent = "확인 중…";
  if (!navigator.geolocation) {
    els.reportGps.textContent = "위치 미지원";
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      safety.gps = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      els.reportGps.textContent = safety.gps;
    },
    () => {
      els.reportGps.textContent = "위치 권한 거부됨";
      safety.gps = null;
    },
    { timeout: 5000 },
  );
}

// ----- 모듈 D: 음성 톤 분석 (보조 신호, 단독 트리거 금지) -----
function accumulateTone(pcm16) {
  if (!els.toneEnabled.checked) return;
  safety.toneChunks.push(pcm16);
  safety.toneSamples += pcm16.length;
  if (safety.toneSamples >= TONE_WINDOW_SAMPLES) flushTone();
}

function flushTone() {
  if (safety.toneSamples === 0 || safety.reportActive) return;
  const merged = new Int16Array(safety.toneSamples);
  let offset = 0;
  for (const chunk of safety.toneChunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  safety.toneChunks = [];
  safety.toneSamples = 0;

  postJson("/analyze-audio", {
    apiKey: els.apiKey.value.trim(),
    model: els.analysisModel.value.trim(),
    audioBase64: arrayBufferToBase64(merged.buffer),
    sampleRate: INPUT_RATE,
  })
    .then((r) => {
      if (!r.ok) {
        log(`톤 분석 실패: ${r.error}`, "error");
        return;
      }
      log(
        `음성 톤: ${Math.round(r.tone_score * 100)}% [${r.tone?.join(", ") || "-"}]` +
          (r.third_party_voice ? " ⚠️제3자 목소리" : ""),
      );
    })
    .catch((error) => log(`톤 분석 오류: ${error.message || String(error)}`, "error"));
}

// ===================== /안전 기능 =====================

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
