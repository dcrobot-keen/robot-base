// Mock firmware — a WebSocket server standing in for the Former 2.0's
// Roboteq motor controller until we test against the real robot. WebSocket
// (not a raw serial port) so an actual Chromium tab can join the test; the
// protocol on top is the real Roboteq ASCII line protocol
// (../../former-motor-protocol.md).
//
// It implements the safety property the whole architecture leans on: the
// Roboteq serial watchdog (RWD). If no command arrives for RWD
// milliseconds the controller zeroes the motors on its own, regardless of
// what is (or isn't) on the other end. Default 1000ms, Roboteq's own
// default; override with SIM_RWD_MS (e.g. SIM_RWD_MS=300 for a fast test).
//
// Run: node src/index.js   (or `npm start`)

import { WebSocketServer } from 'ws';
import { encodeCommand, RoboteqDecoder } from './roboteq.js';

const PORT = Number(process.env.SIM_PORT || 8765);
const RWD_MS = Number(process.env.SIM_RWD_MS || 1000);
const TICK_MS = 20;

// ±1000 command units == ±200 wheel RPM; 16384 counts/rev
// (former-motor-protocol.md). Counts advanced per unit, per millisecond:
const COUNTS_PER_UNIT_MS = (200 / 60) * 16384 / 1000 / 1000;

const state = {
  cmd: [0, 0],          // last !G command per channel, -1000..1000
  enc: [0, 0],          // encoder counts
  motorEnabled: false,  // !MG / !EX
  estopped: false,      // latched by !EX or the RWD watchdog
  voltage: 27.2,        // fake pack voltage (V)
  temperature: 31.0,    // fake (°C)
  lastCmdAt: Date.now(),
};

function log(msg) {
  console.log(`[roboteq-sim ${new Date().toISOString()}] ${msg}`);
}

function reply(ws, line) {
  if (ws.readyState === ws.OPEN) ws.send(encodeCommand(line));
}

function stopMotors(reason) {
  if (state.estopped) return;
  state.cmd[0] = 0;
  state.cmd[1] = 0;
  state.motorEnabled = false;
  state.estopped = true;
  log(`motors zeroed — ${reason}`);
}

function handleSub(ws, sub) {
  sub = sub.trim();
  if (sub === '') return;
  state.lastCmdAt = Date.now(); // ANY command feeds the RWD watchdog

  // queries ---------------------------------------------------------------
  if (sub === '?FID') return reply(ws, 'FID=ROBOTEQ SIM - see former-motor-protocol.md');
  if (sub === '?A')   return reply(ws, `A=${Math.round(Math.abs(state.cmd[0]) / 2)}:${Math.round(Math.abs(state.cmd[1]) / 2)}`);
  if (sub === '?AI')  return reply(ws, 'AI=0:0:0:0:0');
  if (sub === '?C')   return reply(ws, `C=${Math.round(state.enc[0])}:${Math.round(state.enc[1])}`);
  if (sub === '?FF')  return reply(ws, `FF=${state.motorEnabled ? 0 : 16}`);
  if (sub.startsWith('?T')) return reply(ws, `T=${state.temperature.toFixed(0)}`);
  if (sub.startsWith('?V')) return reply(ws, `V=${Math.round(state.voltage * 10)}`);
  if (sub === '?DI')  return reply(ws, `DI=${state.estopped ? 0 : 1}:0:0`);

  // actions -------------------------------------------------------------
  if (sub === '^ECHOF 1')  return reply(ws, '+');
  if (sub.startsWith('!R ')) return reply(ws, '+');
  if (sub.startsWith('!B ')) return reply(ws, '+'); // keepalive — feeds the watchdog like anything else
  if (sub.startsWith('!AC ') || sub.startsWith('!DC ')) return reply(ws, '+');
  if (sub.startsWith('!C ')) { state.enc[0] = 0; state.enc[1] = 0; return reply(ws, '+'); }
  if (sub === '!MG') {
    state.motorEnabled = true;
    state.estopped = false;
    log('!MG — motors enabled');
    return reply(ws, '+');
  }
  if (sub === '!EX') { stopMotors('!EX emergency stop'); return reply(ws, '+'); }

  const g = sub.match(/^!G\s+([12])\s+(-?\d+)$/);
  if (g) {
    const ch = Number(g[1]) - 1;
    const val = Math.max(-1000, Math.min(1000, Number(g[2])));
    if (state.motorEnabled && !state.estopped) {
      state.cmd[ch] = val;
      if (ch === 1) log(`!G — cmd left=${state.cmd[0]} right=${state.cmd[1]}`);
    } else {
      log(`ignoring ${sub} — motors not enabled (send !MG)`);
    }
    return reply(ws, '+');
  }

  return reply(ws, '-'); // unrecognized
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  log('connection opened — RWD watchdog (re)armed');
  state.lastCmdAt = Date.now();
  state.estopped = false;
  state.motorEnabled = false;
  state.cmd[0] = state.cmd[1] = 0;

  const decoder = new RoboteqDecoder();
  ws.on('message', (data) => {
    for (const m of decoder.push(new Uint8Array(data))) {
      if (m.type === 'line') for (const sub of m.raw.split('_')) handleSub(ws, sub);
    }
  });
  ws.on('close', () => log('connection closed — RWD watchdog keeps running regardless'));
  ws.on('error', () => {}); // an abrupt/reset connection is expected during the crash test
});

// Fake wheel motion + the load-bearing watchdog. Runs whether or not
// anything is connected.
setInterval(() => {
  state.enc[0] += state.cmd[0] * COUNTS_PER_UNIT_MS * TICK_MS;
  state.enc[1] += state.cmd[1] * COUNTS_PER_UNIT_MS * TICK_MS;

  if (!state.estopped && Date.now() - state.lastCmdAt > RWD_MS) {
    stopMotors(`RWD: no serial command for >${RWD_MS}ms`);
  }
}, TICK_MS);

log(`listening on ws://127.0.0.1:${PORT} (RWD ${RWD_MS}ms)`);
