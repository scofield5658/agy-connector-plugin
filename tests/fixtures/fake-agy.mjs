#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { statSync, realpathSync } from 'node:fs';
import { isAbsolute, dirname } from 'node:path';
// Driver-mode calls must isolate CLI startup, before any agent policy applies.
if (process.argv.includes('--agent')) {
  const index = process.argv.indexOf('--gemini_dir');
  const profile = index < 0 ? undefined : process.argv[index + 1];
  if (
    !profile ||
    !isAbsolute(profile) ||
    realpathSync(dirname(profile)) !== process.cwd() ||
    !statSync(profile).isDirectory()
  ) {
    process.stderr.write('missing request-local CLI profile');
    process.exit(1);
  }
}
const schemaIndex = process.argv.indexOf('--json-schema');
if (schemaIndex >= 0 && JSON.parse(process.argv[schemaIndex + 1]).type !== 'object') {
  process.stderr.write('schema root must specify type object');
  process.exit(1);
}
if (schemaIndex >= 0 && !JSON.parse(process.argv[schemaIndex + 1]).properties?.kind) {
  process.stderr.write('finish requires a flat properties declaration');
  process.exit(1);
}
const scenario = process.env.FAKE_AGY_SCENARIO ?? 'success';
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString();
const message = JSON.parse(raw).message.content;
const event = {
  event: 'result',
  result: {
    conversation_id: 'conversation-1',
    status: 'SUCCESS',
    structured_output: { kind: 'candidate', text: '预计暂停服务30分钟。', notes: [] },
  },
};
if (scenario === 'hang') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (scenario === 'tree') {
  spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], {
    stdio: 'inherit',
  });
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (scenario === 'huge') {
  process.stdout.write('x'.repeat(1024 * 1024 + 1));
} else if (scenario === 'stderr') {
  process.stderr.write('x'.repeat(65537));
} else if (scenario === 'denied') {
  process.stderr.write('Permission denied: tool blocked');
  console.log(JSON.stringify(event));
} else if (scenario === 'bad') {
  console.log('{bad');
} else if (scenario === 'empty') {
  /* EOF without result */
} else if (scenario === 'response') {
  delete event.result.structured_output;
  event.result.response = 'prefix {"text":"猜测正文"}';
  console.log(JSON.stringify(event));
} else if (scenario === 'duplicate') {
  console.log(JSON.stringify(event));
  console.log(JSON.stringify(event));
} else if (scenario === 'exit') {
  console.log(JSON.stringify(event));
  process.exitCode = 2;
} else if (scenario === 'echo') {
  event.result.structured_output.text = message;
  console.log(JSON.stringify(event));
} else {
  const bytes = Buffer.from(JSON.stringify(event));
  for (const byte of bytes) {
    process.stdout.write(Buffer.from([byte]));
  }
}
