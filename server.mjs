import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5173);
const googleEndpoint =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

let googleSocket = null;
let googleReady = false;
const eventClients = new Set();

// VC(보이스 컨버전) 상태 — Gemini 오디오를 윈도우 버퍼링 후 ElevenLabs STS로 음색 변환
const VC_SAMPLE_RATE = 24000;
const VC_WINDOW_SAMPLES = Math.round(VC_SAMPLE_RATE * 1.6); // ~1.6초 윈도우
const vc = {
  enabled: false,
  apiKey: "",
  voiceId: "",
  chunks: [],
  bufferedSamples: 0,
  queue: Promise.resolve(),
  generation: 0, // 끼어들기/재시작 시 증가 → 이전 작업 결과 폐기
  outputFormat: "pcm_24000",
};

const server = createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && requestUrl.pathname === "/events") {
    handleEvents(req, res);
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/start") {
    const body = await readJson(req);
    await startGoogleLive(body);
    writeJson(res, { ok: true });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/audio") {
    const body = await readJson(req);
    sendGoogle({
      realtimeInput: {
        audio: {
          data: body.data,
          mimeType: body.mimeType,
        },
      },
    });
    writeJson(res, { ok: true, ready: googleReady });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/text") {
    const body = await readJson(req);
    sendGoogle({
      clientContent: {
        turns: [{ role: "user", parts: [{ text: body.text }] }],
        turnComplete: true,
      },
    });
    writeJson(res, { ok: true, ready: googleReady });
    return;
  }

  if (req.method === "POST" && requestUrl.pathname === "/stop") {
    closeGoogle("client stop");
    writeJson(res, { ok: true });
    return;
  }

  // 모듈 B — 대화 위험 점수 (텍스트)
  if (req.method === "POST" && requestUrl.pathname === "/analyze") {
    const body = await readJson(req);
    const result = await analyzeDanger(body);
    writeJson(res, result);
    return;
  }

  // 모듈 C — 세이프워드 2단 맥락 검증
  if (req.method === "POST" && requestUrl.pathname === "/verify-safeword") {
    const body = await readJson(req);
    const result = await verifySafeword(body);
    writeJson(res, result);
    return;
  }

  // 모듈 D — 음성 톤 분석 (루트1, 스트레치)
  if (req.method === "POST" && requestUrl.pathname === "/analyze-audio") {
    const body = await readJson(req);
    const result = await analyzeTone(body);
    writeJson(res, result);
    return;
  }

  serveStatic(requestUrl, res);
});

async function serveStatic(requestUrl, res) {
  try {
    const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(__dirname, safePath);
    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": mimeTypes[extname(filePath)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

function handleEvents(req, res) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  res.write("\n");
  eventClients.add(res);
  req.on("close", () => eventClients.delete(res));
}

async function startGoogleLive({ apiKey, model, voiceName, systemInstruction, vcEnabled, vcApiKey, vcVoiceId }) {
  closeGoogle("restart");
  googleReady = false;

  if (!apiKey || !model) {
    broadcast({ type: "error", message: "API 키와 모델명이 필요합니다." });
    return;
  }

  resetVc();
  vc.enabled = Boolean(vcEnabled);
  vc.apiKey = (vcApiKey || "").trim();
  vc.voiceId = (vcVoiceId || "").trim();
  vc.outputFormat = "pcm_24000";
  if (vc.enabled && (!vc.apiKey || !vc.voiceId)) {
    vc.enabled = false;
    broadcast({ type: "error", message: "VC 사용에는 ElevenLabs API Key와 Voice ID가 모두 필요합니다. VC 없이 진행합니다." });
  }
  if (vc.enabled) {
    broadcast({ type: "status", message: `VC 활성화: Gemini 음성을 ElevenLabs 보이스(${vc.voiceId})로 변환합니다.` });
  }

  const url = `${googleEndpoint}?key=${encodeURIComponent(apiKey)}`;
  googleSocket = new WebSocket(url);
  broadcast({ type: "status", message: "Google Live WebSocket 연결 중..." });

  googleSocket.addEventListener("open", () => {
    const setup = buildSetup(model, voiceName, systemInstruction);
    broadcast({ type: "status", message: "Google Live WebSocket 연결됨. setup 전송." });
    broadcast({ type: "debug", message: `setup: ${JSON.stringify(setup, null, 2)}` });
    sendGoogle(setup);
  });

  googleSocket.addEventListener("message", async (event) => {
    const text = await readSocketText(event.data);
    broadcast({ type: "debug", message: `google raw: ${text.slice(0, 600)}` });

    let message;
    try {
      message = JSON.parse(text);
    } catch {
      broadcast({ type: "error", message: `Google 메시지 JSON 파싱 실패: ${text.slice(0, 200)}` });
      return;
    }

    if (message.setupComplete !== undefined) {
      googleReady = true;
      broadcast({ type: "setupComplete" });
      return;
    }

    if (message.toolCall) {
      const calls = message.toolCall.functionCalls || [];
      // 모델이 멈추지 않도록 즉시 ack 응답
      sendGoogle({
        toolResponse: {
          functionResponses: calls.map((fc) => ({ id: fc.id, name: fc.name, response: { result: "ok" } })),
        },
      });
      broadcast({ type: "toolCall", calls });
      return;
    }

    if (vc.enabled && message.serverContent) {
      handleVcServerContent(message);
      return;
    }

    broadcast({ type: "serverMessage", message });
  });

  googleSocket.addEventListener("error", (error) => {
    broadcast({ type: "error", message: `Google WebSocket error: ${error.message || String(error)}` });
  });

  googleSocket.addEventListener("close", (event) => {
    googleReady = false;
    broadcast({
      type: "status",
      message: `Google WebSocket 종료: code=${event.code} reason=${event.reason || "(none)"}`,
    });
  });
}

function buildSetup(model, voiceName, systemInstruction) {
  const setup = {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
      },
      // 세이프워드 감지: 텍스트 transcription은 누락이 잦으므로,
      // 원본 오디오를 직접 듣는 Live 모델이 함수호출로 잡게 한다.
      tools: [
        {
          functionDeclarations: [
            {
              name: "report_safeword_detected",
              description:
                "사용자가 미리 등록한 세이프워드(위급 신호용 단어/문장)를 말했을 때 즉시 호출한다. 사용자가 위험하다는 뜻이다.",
              parameters: {
                type: "object",
                properties: {
                  phrase: { type: "string", description: "사용자가 실제로 말한 세이프워드 문구" },
                },
              },
            },
          ],
        },
      ],
    },
  };

  if (systemInstruction) {
    setup.setup.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  if (voiceName) {
    setup.setup.generationConfig.speechConfig = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName,
        },
      },
    };
  }

  return setup;
}

// ---------- VC(보이스 컨버전) ----------

function resetVc() {
  vc.generation += 1;
  vc.chunks = [];
  vc.bufferedSamples = 0;
}

// Gemini serverContent에서 오디오만 가로채 버퍼링하고, 나머지(자막·턴 이벤트)는 그대로 전달
function handleVcServerContent(message) {
  const content = message.serverContent;

  if (content.interrupted) {
    resetVc(); // 끼어들기: 대기 중 오디오 전부 폐기
  }

  const parts = content.modelTurn?.parts || [];
  const audioParts = parts.filter((part) => part.inlineData?.data);
  for (const part of audioParts) {
    const pcm = Buffer.from(part.inlineData.data, "base64");
    vc.chunks.push(pcm);
    vc.bufferedSamples += pcm.length / 2;
  }

  if (vc.bufferedSamples >= VC_WINDOW_SAMPLES) flushVcWindow();
  if (content.generationComplete || content.turnComplete) flushVcWindow();

  // 오디오 파트를 제거한 메시지를 클라이언트로 (자막·이벤트 유지)
  if (audioParts.length > 0) {
    const stripped = {
      ...message,
      serverContent: {
        ...content,
        modelTurn: { ...content.modelTurn, parts: parts.filter((part) => !part.inlineData?.data) },
      },
    };
    broadcast({ type: "serverMessage", message: stripped });
  } else {
    broadcast({ type: "serverMessage", message });
  }
}

function flushVcWindow() {
  if (vc.bufferedSamples === 0) return;

  const pcm = Buffer.concat(vc.chunks);
  vc.chunks = [];
  vc.bufferedSamples = 0;
  const generation = vc.generation;

  // 순차 큐: 윈도우 순서대로 변환·전송 (재생 순서 보장)
  vc.queue = vc.queue.then(() => convertVcWindow(pcm, generation)).catch(() => {});
}

async function convertVcWindow(pcm, generation) {
  const startedAt = Date.now();
  try {
    const wav = pcmToWav(pcm, VC_SAMPLE_RATE);
    const form = new FormData();
    form.append("audio", new Blob([wav], { type: "audio/wav" }), "window.wav");
    form.append("model_id", "eleven_multilingual_sts_v2");

    const url = `https://api.elevenlabs.io/v1/speech-to-speech/${encodeURIComponent(vc.voiceId)}/stream?output_format=${vc.outputFormat}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": vc.apiKey },
      body: form,
    });

    if (generation !== vc.generation) return; // 끼어들기로 무효화된 윈도우

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      // 플랜이 PCM 출력을 막는 경우 mp3로 폴백해 재시도
      if (vc.outputFormat === "pcm_24000" && /output_format|pcm/i.test(detail)) {
        vc.outputFormat = "mp3_44100_128";
        broadcast({ type: "status", message: "VC: PCM 출력 미지원 플랜 → mp3로 전환합니다." });
        return convertVcWindow(pcm, generation);
      }
      throw new Error(`STS HTTP ${response.status}: ${detail}`);
    }

    const converted = Buffer.from(await response.arrayBuffer());
    if (generation !== vc.generation) return;

    broadcast({
      type: "vcAudio",
      format: vc.outputFormat,
      data: converted.toString("base64"),
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    if (generation !== vc.generation) return;
    // 폴백: 변환 실패 시 원본 Gemini 음성으로 재생 (통화 유지가 우선)
    broadcast({ type: "error", message: `VC 변환 실패 → 원본 음성으로 폴백: ${error.message || String(error)}` });
    broadcast({ type: "vcAudio", format: "pcm_24000", data: pcm.toString("base64"), fallback: true });
  }
}

function pcmToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// ---------- /VC ----------

// ---------- 위험 감지 / 세이프워드 검증 (Gemini Flash generateContent) ----------

const DEFAULT_ANALYSIS_MODEL = "gemini-flash-latest";

// generateContent 호출 + structured JSON 파싱 공통 헬퍼
async function geminiJson({ apiKey, model, systemPrompt, userParts, schema }) {
  if (!apiKey) throw new Error("API 키 없음");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model || DEFAULT_ANALYSIS_MODEL
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: "user", parts: userParts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
      temperature: 0.2,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`generateContent HTTP ${response.status}: ${detail}`);
  }

  const data = await response.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "{}";
  return JSON.parse(text);
}

// 모듈 B — 대화 위험 점수 (텍스트 패턴만)
async function analyzeDanger({ apiKey, model, transcript }) {
  const systemPrompt = [
    "너는 안전앱의 위험 감지 분석기다. 사용자(피해 가능자)의 통화 발화 transcript를 보고 위험도를 평가한다.",
    "텍스트(내용)에서 드러나는 신호만 본다: 코드화된/암시적 말투, 위치·동선 노출, 내용상 공포·강요 표현, 제3자가 옆에 있는 듯한 정황.",
    "목소리 떨림·억지 톤 같은 음성 신호는 텍스트로 판단할 수 없으니 추정하지 마라.",
    "danger_score는 0~1 실수. level: safe(<0.4) / watch(0.4~0.7) / alert(>0.7).",
    "확신이 없으면 과하게 alert로 올리지 말고 watch로 둔다.",
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      danger_score: { type: "number" },
      level: { type: "string", enum: ["safe", "watch", "alert"] },
      signals: { type: "array", items: { type: "string" } },
      reason: { type: "string" },
    },
    required: ["danger_score", "level", "signals", "reason"],
  };

  try {
    const result = await geminiJson({
      apiKey,
      model,
      systemPrompt,
      userParts: [{ text: `최근 통화 발화:\n${transcript || "(없음)"}` }],
      schema,
    });
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

// 모듈 C — 세이프워드 2단 맥락 검증
async function verifySafeword({ apiKey, model, safeWord, context }) {
  const systemPrompt = [
    "너는 안전앱의 세이프워드 검증기다. 사용자가 위급 시 말하기로 미리 등록한 세이프워드가 방금 발화에서 감지됐다.",
    "직전 대화 맥락을 보고, 그 발화가 '진짜 위험 신호'인지 '일상 대화 속 우연한 사용'인지 판단한다.",
    "맥락에서 갑작스럽게 튀거나(non-sequitur), 흐름과 안 맞거나, 반복되면 진짜 신호일 가능성이 높다.",
    "중요: 세이프워드는 미탐(놓침)이 오탐보다 훨씬 위험하다. 애매하면 confirmed=true 쪽으로 기운다. 명백히 일상적 사용일 때만 false.",
    "confidence는 0~1.",
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      confirmed: { type: "boolean" },
      confidence: { type: "number" },
      reason: { type: "string" },
    },
    required: ["confirmed", "confidence", "reason"],
  };

  try {
    const result = await geminiJson({
      apiKey,
      model,
      systemPrompt,
      userParts: [{ text: `등록 세이프워드: "${safeWord}"\n\n직전 대화 맥락:\n${context || "(없음)"}` }],
      schema,
    });
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

// 모듈 D — 음성 톤 분석 (루트1). audioBase64는 PCM16, sampleRate Hz.
async function analyzeTone({ apiKey, model, audioBase64, sampleRate }) {
  const systemPrompt = [
    "너는 안전앱의 음성 톤 분석기다. 짧은 통화 오디오 클립에서 화자의 정서적 위험 신호를 본다.",
    "tone_score는 0~1(공포/긴장도). 떨림, 억지로 밝은 척하는 톤(내용과 톤 불일치), 울먹임 등을 신호로 본다.",
    "third_party_voice: 화자 외 다른 사람 목소리가 배경에 들리면 true.",
    "노이즈에 민감하니 확신 없으면 점수를 낮게 둔다.",
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      tone_score: { type: "number" },
      tone: { type: "array", items: { type: "string" } },
      third_party_voice: { type: "boolean" },
    },
    required: ["tone_score", "tone", "third_party_voice"],
  };

  try {
    const pcm = Buffer.from(audioBase64, "base64");
    const wav = pcmToWav(pcm, sampleRate || 16000);
    const result = await geminiJson({
      apiKey,
      model,
      systemPrompt,
      userParts: [
        { text: "이 통화 오디오 클립의 톤을 분석해줘." },
        { inlineData: { mimeType: "audio/wav", data: wav.toString("base64") } },
      ],
      schema,
    });
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

// ---------- /위험 감지 ----------

function sendGoogle(message) {
  if (!googleSocket || googleSocket.readyState !== WebSocket.OPEN) return false;
  googleSocket.send(JSON.stringify(message));
  return true;
}

function closeGoogle(reason) {
  googleReady = false;
  resetVc();
  if (!googleSocket) return;
  try {
    googleSocket.close(1000, reason);
  } catch {
    // Ignore shutdown errors.
  }
  googleSocket = null;
}

function broadcast(payload) {
  const wire = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of eventClients) {
    client.write(wire);
  }
}

async function readSocketText(data) {
  if (typeof data === "string") return data;
  if (data instanceof Blob) return data.text();
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer).toString("utf8");
  return String(data);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function writeJson(res, body) {
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

server.listen(port, () => {
  console.log(`Gemini Live raw proxy server: http://localhost:${port}`);
});
