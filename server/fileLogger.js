import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Create a new log file for this session
const now = new Date();
const filename = `${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}.log`;
const logPath = path.join(LOGS_DIR, filename);
const stream = fs.createWriteStream(logPath, { flags: 'a' });

console.log(`[FileLogger] Logging to ${logPath}`);

const startTime = Date.now();

export function fileLog(entry) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const sec = String(elapsed % 60).padStart(2, '0');
  const ts = `${min}:${sec}`;
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false });
  const line = `[${ts}] [${time}] [${entry.type}] ${entry.message}\n`;
  stream.write(line);
}

export function fileLogRaw(message) {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const sec = String(elapsed % 60).padStart(2, '0');
  stream.write(`[${min}:${sec}] ${message}\n`);
}
