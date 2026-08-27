// Mock firmware — a WebSocket server standing in for real hardware until a
// board is chosen (see plan.md Phase 1/2). WebSocket, not raw TCP, because
// a real browser tab can't open a raw TCP socket at all — this is what
// lets an actual Chromium tab join the test, not just a Node.js client.
//
// Implements exactly the safety property the whole architecture depends
// on: the 300ms heartbeat watchdog and the resulting E-STOP live here,
// independent of whatever is (or isn't) on the other end of the
// connection.
//
// Run: node src/index.js   (or `npm start`)

import { WebSocketServer } from 'ws';
import { encodeFrame, FrameDecoder } from './frame.js';
import { CMD } from './commands.js';

const PORT = Number(process.env.SIM_PORT || 8765);
const HEARTBEAT_TIMEOUT_MS = 300;
const WATCHDOG_TICK_MS = 50;

const state = {
  leftMps: 0,
  rightMps: 0,
  estopped: false,
  lastHeartbeatAt: Date.now(),
};

function log(msg) {
  console.log(`[firmware-sim ${new Date().toISOString()}] ${msg}`);
}

function forceEstop(reason) {
  if (state.estopped) return;
  state.estopped = true;
  state.leftMps = 0;
  state.rightMps = 0;
  log(`ESTOP — motors zeroed (${reason})`);
}

function handleFrame(ws, cmd, payload) {
  if (cmd === CMD.HEARTBEAT) {
    state.lastHeartbeatAt = Date.now();
    if (ws.readyState === ws.OPEN) ws.send(encodeFrame(CMD.HEARTBEAT, payload)); // echo
  } else if (cmd === CMD.SET_VELOCITY) {
    if (state.estopped) {
      log('ignoring SET_VELOCITY — currently estopped');
      return;
    }
    const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    state.leftMps = dv.getFloat32(0, true);
    state.rightMps = dv.getFloat32(4, true);
    log(`velocity set: left=${state.leftMps} right=${state.rightMps}`);
  } else if (cmd === CMD.ESTOP) {
    forceEstop('explicit ESTOP command');
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  log('connection opened — watchdog (re)armed');
  state.lastHeartbeatAt = Date.now();
  state.estopped = false;

  const decoder = new FrameDecoder();
  ws.on('message', (data) => {
    for (const { cmd, payload } of decoder.push(new Uint8Array(data))) handleFrame(ws, cmd, payload);
  });
  ws.on('close', () => log('connection closed — watchdog keeps running regardless'));
  ws.on('error', () => {}); // an abrupt/reset connection is expected during the crash test
});

// Runs whether or not anything is connected — this is the load-bearing part.
setInterval(() => {
  if (!state.estopped && Date.now() - state.lastHeartbeatAt > HEARTBEAT_TIMEOUT_MS) {
    forceEstop(`no heartbeat for >${HEARTBEAT_TIMEOUT_MS}ms`);
  }
}, WATCHDOG_TICK_MS);

log(`listening on ws://127.0.0.1:${PORT}`);
