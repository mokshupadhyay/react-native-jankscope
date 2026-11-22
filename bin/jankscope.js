#!/usr/bin/env node
'use strict';
// Thin Node wrapper around the CLI in lib/commonjs/cli (built from src/cli).
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let cli;
try {
  cli = require('../lib/commonjs/cli/run.js');
} catch (error) {
  process.stderr.write('jankscope: the CLI is not built; run `npm run build` in the package first.\n');
  process.exit(2);
}

const io = {
  exec(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000 });
    if (result.error) return { code: 127, stdout: '', stderr: String(result.error.message) };
    return { code: result.status == null ? 1 : result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  },
  readFile: (file) => fs.readFileSync(file, 'utf8'),
  writeFile: (file, contents) => fs.writeFileSync(file, contents),
  readDir(dir) {
    try {
      return fs.statSync(dir).isDirectory() ? fs.readdirSync(dir) : null;
    } catch (error) {
      return null;
    }
  },
  mkdir: (dir) => fs.mkdirSync(dir, { recursive: true }),
  copyFile: (from, to) => fs.copyFileSync(from, to),
  join: (...parts) => path.join(...parts),
  out: (text) => process.stdout.write(text + '\n'),
  err: (text) => process.stderr.write(text + '\n'),
};

process.exitCode = cli.run(process.argv.slice(2), io);
