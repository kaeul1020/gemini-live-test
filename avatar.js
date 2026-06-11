// 실시간 립싱크 아바타.
// 출력 오디오를 AnalyserNode로 분석해 입모양(비셈 근사)을 SVG로 렌더링한다.
// 외부 의존성 없음. wawa-lipsync와 같은 원리(스펙트럼 기반)를 경량 구현.

class LipsyncAvatar {
  constructor(container) {
    this.container = container;
    this.bus = null;
    this.analyser = null;
    this.timeData = null;
    this.freqData = null;
    this.rafId = null;

    // 입모양 상태 (스무딩용)
    this.open = 0; // 0(닫힘) ~ 1(크게 벌림)
    this.wide = 0; // 0(둥글게) ~ 1(옆으로 넓게)
    this.talkEnergy = 0; // 머리 움직임용

    // 눈 깜빡임
    this.blinkAt = performance.now() + 1800;
    this.blinkPhase = 1; // 1 = 뜸, 0 = 감음

    this.theme = LipsyncAvatar.themes.mom;
    this.renderBase();
  }

  static themes = {
    mom: { hair: "long", hairColor: "#5b4232", skin: "#f6d7bd", bg: "#ffe9ec", glasses: false },
    dad: { hair: "short", hairColor: "#3c3631", skin: "#f0c9a8", bg: "#e3edff", glasses: true },
    friend: { hair: "long", hairColor: "#2e2a33", skin: "#f8dcc4", bg: "#fff3d9", glasses: false },
    partner: { hair: "short", hairColor: "#2a2a2e", skin: "#f3cfb0", bg: "#e9e4ff", glasses: false },
    coworker: { hair: "short", hairColor: "#4a4038", skin: "#eecdb0", bg: "#e2f4ec", glasses: true },
    guardian: { hair: "short", hairColor: "#56575e", skin: "#f1d2b6", bg: "#e8eef6", glasses: false },
  };

  setPersona(key) {
    this.theme = LipsyncAvatar.themes[key] || LipsyncAvatar.themes.mom;
    this.renderBase();
  }

  // AudioContext에 연결. 재생 소스는 destination 대신 이 bus에 connect한다.
  attach(audioContext) {
    this.detachAudio();
    this.bus = audioContext.createGain();
    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.bus.connect(this.analyser);
    this.analyser.connect(audioContext.destination);
    this.timeData = new Float32Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.startLoop();
    return this.bus;
  }

  detachAudio() {
    if (this.bus) this.bus.disconnect();
    if (this.analyser) this.analyser.disconnect();
    this.bus = null;
    this.analyser = null;
  }

  stop() {
    this.detachAudio();
    this.open = 0;
    this.wide = 0;
    this.talkEnergy = 0;
    // 루프는 유지해 idle 모션(깜빡임)은 계속 보여준다.
  }

  startLoop() {
    if (this.rafId) return;
    const tick = () => {
      this.update();
      this.draw();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  update() {
    let targetOpen = 0;
    let targetWide = 0.4;

    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.timeData);
      this.analyser.getByteFrequencyData(this.freqData);

      // 음량(RMS) → 입 벌림
      let sum = 0;
      for (let i = 0; i < this.timeData.length; i += 1) {
        sum += this.timeData[i] * this.timeData[i];
      }
      const rms = Math.sqrt(sum / this.timeData.length);
      targetOpen = Math.min(1, Math.max(0, (rms - 0.012) * 11));

      // 스펙트럼 중심 → 입 모양 (낮음=오/우 둥글게, 높음=이/에 넓게)
      let weighted = 0;
      let total = 0;
      for (let i = 0; i < this.freqData.length; i += 1) {
        weighted += i * this.freqData[i];
        total += this.freqData[i];
      }
      if (total > 0) {
        const centroid = weighted / total / this.freqData.length; // 0~1
        targetWide = Math.min(1, Math.max(0, (centroid - 0.06) * 5));
      }
    }

    // 스무딩 (열 때 빠르게, 닫을 때 살짝 느리게 — 자연스러움)
    const openRate = targetOpen > this.open ? 0.45 : 0.3;
    this.open += (targetOpen - this.open) * openRate;
    this.wide += (targetWide - this.wide) * 0.2;
    this.talkEnergy += (Math.min(1, this.open * 1.6) - this.talkEnergy) * 0.06;

    // 깜빡임 타이밍
    const now = performance.now();
    if (now > this.blinkAt) {
      const t = (now - this.blinkAt) / 140; // 140ms 깜빡임
      this.blinkPhase = t >= 1 ? 1 : Math.abs(1 - t * 2); // 1→0→1
      if (t >= 1) this.blinkAt = now + 1700 + Math.random() * 2800;
    }
  }

  renderBase() {
    const t = this.theme;
    const longHair = t.hair === "long";

    this.container.innerHTML = `
      <svg viewBox="0 0 240 240" width="100%" height="100%" aria-label="아바타">
        <defs>
          <clipPath id="mouthClip"><ellipse id="mouthClipShape" cx="120" cy="166" rx="16" ry="4"/></clipPath>
          <clipPath id="frameClip"><circle cx="120" cy="120" r="118"/></clipPath>
        </defs>
        <g clip-path="url(#frameClip)">
          <rect width="240" height="240" fill="${t.bg}"/>
          <g id="head">
            ${longHair ? `<path d="M120 28c-46 0-66 34-66 70 0 44 8 88 14 104h104c6-16 14-60 14-104 0-36-20-70-66-70z" fill="${t.hairColor}"/>` : ""}
            <ellipse cx="120" cy="126" rx="62" ry="68" fill="${t.skin}"/>
            ${longHair
              ? `<path d="M120 40c-34 0-52 22-54 48 14-4 28-18 34-30 10 14 38 26 74 22-4-24-22-40-54-40z" fill="${t.hairColor}"/>`
              : `<path d="M120 38c-36 0-56 24-57 52 12-10 24-22 30-34 12 16 44 26 84 20-6-22-24-38-57-38z" fill="${t.hairColor}"/>`}
            <g id="brows" fill="${t.hairColor}">
              <rect x="80" y="96" width="26" height="6" rx="3"/>
              <rect x="134" y="96" width="26" height="6" rx="3"/>
            </g>
            <g id="eyes">
              <g id="eyeL"><ellipse cx="94" cy="116" rx="6" ry="7" fill="#27241f"/><circle cx="96" cy="113" r="2" fill="#fff"/></g>
              <g id="eyeR"><ellipse cx="146" cy="116" rx="6" ry="7" fill="#27241f"/><circle cx="148" cy="113" r="2" fill="#fff"/></g>
            </g>
            ${t.glasses ? `<g stroke="#3a3f4a" stroke-width="3.4" fill="none">
              <circle cx="94" cy="116" r="15"/><circle cx="146" cy="116" r="15"/>
              <path d="M109 114h22M79 112l-12-4M161 112l12-4"/>
            </g>` : ""}
            <path d="M118 132c2 6 2 10-2 13" stroke="#d9a986" stroke-width="3" fill="none" stroke-linecap="round"/>
            <ellipse cx="86" cy="146" rx="9" ry="5" fill="#f2b3a0" opacity="0.55"/>
            <ellipse cx="154" cy="146" rx="9" ry="5" fill="#f2b3a0" opacity="0.55"/>
            <g id="mouthGroup">
              <ellipse id="mouthOuter" cx="120" cy="166" rx="16" ry="4" fill="#8e4a50"/>
              <g clip-path="url(#mouthClip)">
                <ellipse id="mouthInner" cx="120" cy="167" rx="14" ry="3" fill="#5d2730"/>
                <rect id="teeth" x="104" y="158" width="32" height="7" rx="2.5" fill="#fff"/>
                <ellipse id="tongue" cx="120" cy="176" rx="11" ry="6" fill="#c96f72"/>
              </g>
            </g>
          </g>
        </g>
        <circle cx="120" cy="120" r="117" fill="none" stroke="rgba(23,32,51,0.12)" stroke-width="2"/>
      </svg>
    `;

    this.el = {
      head: this.container.querySelector("#head"),
      eyeL: this.container.querySelector("#eyeL"),
      eyeR: this.container.querySelector("#eyeR"),
      mouthOuter: this.container.querySelector("#mouthOuter"),
      mouthInner: this.container.querySelector("#mouthInner"),
      mouthClipShape: this.container.querySelector("#mouthClipShape"),
      teeth: this.container.querySelector("#teeth"),
      tongue: this.container.querySelector("#tongue"),
    };
    this.startLoop();
  }

  draw() {
    if (!this.el) return;
    const { open, wide } = this;

    // 입: 벌림 → 세로, 넓음 → 가로. 벌림 상한을 둬 언캐니 방지.
    const ry = 4 + open * 14;
    const rx = 13 + wide * 7 - open * 3;
    for (const shape of [this.el.mouthOuter, this.el.mouthClipShape]) {
      shape.setAttribute("rx", String(Math.max(8, rx)));
      shape.setAttribute("ry", String(ry));
    }
    this.el.mouthInner.setAttribute("rx", String(Math.max(6, rx - 2)));
    this.el.mouthInner.setAttribute("ry", String(Math.max(2, ry - 1)));

    // 이빨은 어느 정도 벌렸을 때만, 혀는 크게 벌렸을 때만 보임
    this.el.teeth.setAttribute("y", String(166 - ry + 1));
    this.el.teeth.setAttribute("opacity", open > 0.12 ? "1" : "0");
    this.el.tongue.setAttribute("cy", String(166 + ry * 0.7));
    this.el.tongue.setAttribute("opacity", open > 0.4 ? "1" : "0");

    // 발화 중 미세한 머리 움직임 + idle 흔들림
    const now = performance.now();
    const idleSway = Math.sin(now / 1900) * 1.3;
    const talkBob = Math.sin(now / 170) * 2.2 * this.talkEnergy;
    const tilt = Math.sin(now / 2600) * 1.2 + this.talkEnergy * Math.sin(now / 410) * 1.4;
    this.el.head.setAttribute(
      "transform",
      `translate(${idleSway} ${talkBob}) rotate(${tilt} 120 126)`
    );

    // 깜빡임
    const blink = Math.max(0.08, this.blinkPhase);
    this.el.eyeL.setAttribute("transform", `translate(0 ${116 * (1 - blink)}) scale(1 ${blink})`);
    this.el.eyeR.setAttribute("transform", `translate(0 ${116 * (1 - blink)}) scale(1 ${blink})`);
  }
}

window.LipsyncAvatar = LipsyncAvatar;
