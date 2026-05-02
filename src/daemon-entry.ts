#!/usr/bin/env node
/**
 * Daemon entry point.
 *
 * This is the script spawned as a detached background process by `tac start`.
 * It creates a Daemon instance and starts it.
 */

import { Daemon } from "./daemon.js";

const daemon = new Daemon();

daemon.start().catch((err: unknown) => {
  process.stderr.write(
    `[terminal-autocorrect] FATAL: daemon failed to start: ${String(err)}\n`
  );
  process.exit(1);
});
