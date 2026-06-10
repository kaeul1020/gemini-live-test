# Gemini Live Voice Call Test

Gemini Live API로 **실시간 음성 통화처럼 대화**할 수 있는지 검증하는 로컬 테스트 앱입니다.

브라우저에서 마이크 입력을 받고, 로컬 Node 서버가 Gemini Live WebSocket에 연결합니다. 응답 오디오는 다시 브라우저에서 재생됩니다.

## 기능

- 마이크 입력을 Gemini Live API로 실시간 전송
- Gemini 음성 응답을 스피커로 재생
- 사용자 끼어들기, 응답 지연, 한국어 음성 품질 확인
- 페르소나 프리셋 지원
  - 엄마
  - 아빠
  - 친구
  - 애인
  - 직장동료
  - 보호자
- 상황 모드 지원
  - 밤길 귀가
  - 불편한 자리 탈출
  - 중고거래/낯선 만남
  - 택시/차량 이동

## 준비물

- Node.js 22 이상 권장
  - 이 앱은 Node의 내장 `WebSocket`을 사용합니다.
  - 별도 npm 패키지 설치 없이 실행됩니다.
- Gemini API Key
  - Google AI Studio에서 발급합니다.
  - 팀원 각자 본인 키를 사용하세요.

## 실행 방법

```bash
git clone <repo-url>
cd gemini-live-test
node server.mjs
```

서버가 정상 실행되면 터미널에 아래처럼 표시됩니다.

```text
Gemini Live raw proxy server: http://localhost:5173
```

브라우저에서 접속합니다.

```text
http://localhost:5173
```

## 사용 순서

1. `Persona`를 선택합니다.
2. `상황 모드`를 선택합니다.
3. `Gemini API Key`에 본인 API 키를 입력합니다.
4. `Model`은 기본값을 우선 사용합니다.
5. `연결 시작`을 누릅니다.
6. 브라우저가 마이크 권한을 요청하면 허용합니다.
7. `세션 준비 완료` 로그가 뜨면 말해봅니다.

정상 연결 시 로그 흐름은 대략 이렇습니다.

```text
로컬 이벤트 스트림 연결됨. Gemini Live 세션을 설정합니다.
Google Live WebSocket 연결 중...
Google Live WebSocket 연결됨. setup 전송.
세션 준비 완료. 바로 말해봐도 됩니다.
마이크 오디오 전송 시작.
오디오 응답 chunk 수신 ...
```

## 테스트할 것

- 한국어로 자연스럽게 응답하는지
- 사용자가 Gemini 응답 도중 말을 끊으면 반응이 멈추는지
- 페르소나별 말투가 실제 전화 상대처럼 들리는지
- 밤길 귀가, 자리 탈출 같은 상황에서 대답이 짧고 현실적인지
- 응답 지연이 실제 통화처럼 받아들일 만한지

## 모델명

기본값:

```text
gemini-3.1-flash-live-preview
```

만약 팀원 계정에서 모델 접근이 안 되면 Google AI Studio 또는 Gemini API 문서에서 현재 사용 가능한 Live 모델명을 확인해 `Model` 입력칸에 바꿔 넣으세요.

## 파일 구조

```text
gemini-live-test/
  index.html      # 테스트 UI
  styles.css      # 화면 스타일
  app.js          # 브라우저 마이크/스피커/로그 처리
  server.mjs      # 로컬 프록시 + Gemini Live WebSocket 연결
  package.json    # 실행 스크립트
```

## 보안 주의

이 앱은 테스트 편의를 위해 API 키를 브라우저에서 입력받아 **로컬 프록시 서버**로 전달합니다.

주의:

- API 키를 코드에 하드코딩하지 마세요.
- API 키를 GitHub에 커밋하지 마세요.
- 데모/개발용으로만 사용하세요.
- 실제 서비스에서는 ephemeral token 또는 인증된 백엔드 프록시를 사용해야 합니다.

## 문제 해결

### 마이크 막대가 움직이지 않음

- 브라우저 마이크 권한을 허용했는지 확인하세요.
- macOS라면 `시스템 설정 > 개인정보 보호 및 보안 > 마이크`에서 브라우저 권한을 확인하세요.
- `http://localhost:5173`으로 접속해야 합니다. 일반 파일 열기 방식은 마이크 권한이 제대로 동작하지 않을 수 있습니다.

### `세션 준비 완료`가 안 뜸

- API 키가 올바른지 확인하세요.
- 해당 API 키/프로젝트에서 Live API 모델을 사용할 수 있는지 확인하세요.
- `Model` 입력값을 현재 사용 가능한 Live 모델명으로 바꿔보세요.
- 로그의 `Google WebSocket 종료` reason을 확인하세요.

### 연결 직후 끊김

로그에 나온 `reason=` 메시지가 가장 중요합니다.

예:

```text
reason=realtime_input.media_chunks is deprecated...
```

이런 메시지가 나오면 API 스키마가 바뀐 것이므로 `server.mjs`의 전송 필드를 확인해야 합니다.

### 소리는 들어가는데 Gemini가 말하지 않음

- `마이크 오디오 전송 시작` 로그가 뜨는지 확인하세요.
- 너무 짧게 말하면 VAD가 턴 종료를 못 잡을 수 있으니 2~3초 말하고 잠깐 멈춰보세요.
- 스피커 볼륨과 브라우저 자동재생 차단 여부를 확인하세요.

### 포트가 이미 사용 중

다른 서버가 `5173`을 쓰고 있으면 포트를 바꿔 실행할 수 있습니다.

```bash
PORT=5174 node server.mjs
```

그다음 브라우저에서 접속합니다.

```text
http://localhost:5174
```

## 팀 공유 팁

레포는 private으로 공유하는 것을 권장합니다.

```bash
git init
git add .
git commit -m "Add Gemini Live voice call test"
```

GitHub에서 private repository를 만든 뒤 remote를 연결하고 push하세요.

```bash
git remote add origin <repo-url>
git branch -M main
git push -u origin main
```
