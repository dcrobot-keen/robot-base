# 소스 코드 설명

이 레포에 실제로 존재하는 코드 파일들을 하나씩 설명한다. 리서치나 계획이 아니라 "지금 여기 있는 코드가 정확히 무엇을 하는가"를 남기는 문서다.

## platformio.ini

실제 타겟 보드가 아직 정해지지 않은 상태의 자리표시자다. `[env:esp32dev]`로 일반적인 ESP32 개발 보드를 가정해뒀지만, 이건 "PlatformIO 프로젝트 구조가 이렇게 생겼다"는 것만 보여주는 용도이고, 실제 보드가 정해지면 이 섹션을 그 보드에 맞게 통째로 바꿔야 한다. 지금 이 파일로 실제 빌드를 해본 적은 없다.

## src/main.cpp

`setup()`과 `loop()`이 빈 채로 있는 완전한 자리표시자다. 실제 로직은 아직 한 줄도 들어있지 않고, 주석으로 "`sim/src`에서 먼저 검증한 로직을 여기로 포팅하라"는 지시만 남겨뒀다. 이 파일이 채워지는 시점이 곧 "진짜 펌웨어 개발이 시작되는 시점"이다.

## sim/package.json

`ros-chromium-firmware-sim` Node.js 패키지 정의. 유일한 의존성은 `ws`(WebSocket 서버). `"type": "module"`, `npm start` → `node src/index.js`.

## sim/src/roboteq.js

Former 2.0 베이스의 실제 시리얼 프로토콜(Roboteq ASCII 라인 프로토콜) 코덱. `../../former-motor-protocol.md`가 이 프로토콜을 역추출·정리한 공통 문서이고, 이 파일은 그 구현이다. 처음 프로토타입이 쓰던 SOF/LEN/CMD/CRC16 바이너리 프레임(`frame.js` + `commands.js`)은 타겟 로봇이 정해지기 전까지의 placeholder였고, 이제 삭제됐다.

- `encodeCommand(line)` — 명령 문자열(끝에 `\r` 없이)을 바이트로. 예: `encodeCommand('!G 1 500_!G 2 -500')`.
- `cmd` — 명령/쿼리 문자열 빌더 모음(`motorGo`, `estop`, `keepAlive`, `motorCommand`, `queryRuntime` 등). 호출부가 프로토콜 문서처럼 읽히도록 얇은 템플릿만.
- `RoboteqDecoder` — 스트리밍 라인 디코더. `push(bytes)`마다 `\r` 단위로 잘라 파싱한 메시지 배열을 낸다. 메시지는 `{type:'ack', ok}`(`+`/`-`), `{type:'reply', key, values, raw}`(`KEY=v:v` / `KEY:v:v`), `{type:'line', raw}`(그 외 — 시뮬레이터가 받는 *명령* 라인도 이 형태이고, `raw`를 `_`로 다시 쪼갠다).

이 파일은 `web/packages/transport/src/roboteq.js`와 바이트 단위로 동일해야 한다. 두 레포가 파일시스템 경로로 서로를 참조하지 않는 원칙 때문에 일부러 복제했고, 프로토콜을 바꿀 때 두 파일을 사람이 맞춰야 한다(알려진 기술 부채). `former-motor-protocol.md`가 그 공통 소스 역할을 한다.

## sim/src/index.js

Former 2.0의 Roboteq 모터 컨트롤러를 흉내내는 WebSocket 서버. 실제 컨트롤러는 RS232 시리얼이지만, 브라우저가 raw 시리얼 포트를 못 여니 검증 흐름에 실제 크로미움 탭을 넣기 위해 WebSocket으로 감쌌다 — 그 위에 얹힌 프로토콜은 진짜 Roboteq ASCII 명령 그대로다.

상태(`state`)는 연결 단위가 아니라 프로세스 전역이다 — `cmd[2]`(채널별 마지막 `!G` 명령값), `enc[2]`(엔코더 카운트), `motorEnabled`(`!MG`/`!EX`), `estopped`(`!EX` 또는 RWD 워치독이 래치), 가짜 전압/온도, `lastCmdAt`. 실제 하드웨어도 컨트롤러 하나에 물리 상태 하나뿐이라 시뮬레이터도 그렇게 맞췄다.

`handleSub(ws, sub)`가 `_`로 쪼갠 서브명령 하나를 처리한다. **어떤 명령이든** 받으면 `lastCmdAt`을 갱신한다 — 이게 RWD 워치독을 먹이는 방식이고, 실제 Roboteq RWD도 "시리얼에 무슨 트래픽이든 오면 리셋"이다. 쿼리(`?FID`/`?A`/`?AI`/`?C`/`?FF`/`?T`/`?V`/`?DI`)는 `KEY=...` 라인으로 응답, 액션(`^ECHOF`/`!R`/`!B`/`!AC`/`!DC`/`!C`/`!MG`/`!EX`/`!G`)은 `+`로 ack(모르는 건 `-`). `!G`는 `motorEnabled && !estopped`일 때만 `cmd[]`에 반영하고, 아니면 로그만 남기고 무시한다(그래도 `+`는 보냄).

파일 맨 아래 `setInterval`(20ms)이 두 가지를 한다. (1) `cmd[]`에 비례해 `enc[]`를 적분해서 가짜 바퀴 회전을 만든다(±1000 단위 = ±200 RPM, 16384 counts/rev). (2) **RWD 워치독** — `Date.now() - state.lastCmdAt > RWD_MS`면 `stopMotors()`를 호출한다. 이 타이머는 **연결 여부와 완전히 무관하게** 돈다. 서버가 막 떠서 아무도 안 붙은 상태에서도 `RWD_MS` 뒤 첫 정지가 찍히고(콜드 부팅 기본값 = 안전), 연결이 끊긴 뒤에도(정상 종료든 크래시든 — 그건 아래 계층 얘기라 워치독과 무관) `RWD_MS` 뒤 스스로 정지한다. 이게 이 프로젝트 안전 모델의 "펌웨어가 워치독을 소유한다"에 해당하는 실제 메커니즘이다.

`wss.on('connection')`에서 연결이 열릴 때마다 `lastCmdAt` 리셋, `estopped=false`, `motorEnabled=false`, `cmd` 0으로 — 새 연결이 워치독을 재무장하고 모터는 다시 비활성 상태로 시작한다(실제 `on_activate`가 `!MG`를 보내야 하는 것과 같음). `stopMotors(reason)`은 이미 `estopped`면 중복 로그를 막고, 아니면 `cmd` 0, `motorEnabled=false`, `estopped=true`로 래치하고 이유와 함께 로그. 호출 경로는 `!EX`와 RWD 타임아웃 둘.

`SIM_PORT`(기본 8765), `SIM_RWD_MS`(기본 1000 — Roboteq RWD 기본값; 빠른 테스트는 `SIM_RWD_MS=300`처럼).
