// Placeholder firmware entry point — no target board chosen yet.
//
// The wire protocol (SOF/LEN/CMD/PAYLOAD/CRC16/EOF framing, command bytes,
// 300ms heartbeat watchdog) is prototyped and validated first in
// sim/src (Node.js) — see sim/src/frame.js and sim/src/commands.js as the
// reference implementation. Port that logic here once hardware is picked.
//
// TODO: USB-CDC framing, 1kHz control loop, heartbeat watchdog, E-STOP latch.

void setup() {}
void loop() {}
