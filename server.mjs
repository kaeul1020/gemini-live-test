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

async function startGoogleLive({ apiKey, model, voiceName, systemInstruction }) {
  closeGoogle("restart");
  googleReady = false;

  if (!apiKey || !model) {
    broadcast({ type: "error", message: "API 키와 모델명이 필요합니다." });
    return;
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

function sendGoogle(message) {
  if (!googleSocket || googleSocket.readyState !== WebSocket.OPEN) return false;
  googleSocket.send(JSON.stringify(message));
  return true;
}

function closeGoogle(reason) {
  googleReady = false;
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
