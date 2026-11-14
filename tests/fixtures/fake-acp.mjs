#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const send = (e) => console.log(JSON.stringify({ jsonrpc: '2.0', ...e }));
let cwd = '';
const sessionId = 'acp-test-session';
let promptId;
const scenario = JSON.parse(readFileSync('scenario.json', 'utf8'));
if (scenario.linger) {
  setInterval(() => {}, 1000);
  process.on('SIGTERM', () => {});
}
const toolPath = () =>
  scenario.path === 'symlink' ? join(cwd, 'symlink') : (scenario.path ?? join(cwd, 'artifact.txt'));
createInterface({ input: process.stdin }).on('line', (line) => {
  const e = JSON.parse(line);
  if (e.method === 'initialize')
    send({ id: e.id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
  else if (e.method === 'session/new' || e.method === 'session/load') {
    cwd = e.params.cwd;
    send({ id: e.id, result: { sessionId } });
  } else if (e.method === 'session/prompt') {
    promptId = e.id;
    const toolCall = {
      toolCallId: 'write-1',
      name: 'write_file',
      kind: scenario.kind ?? 'edit',
      title: 'write artifact',
      locations: [{ path: toolPath() }],
      rawInput: { Path: toolPath(), Content: 'SYNTHETIC' },
    };
    if (scenario.incremental)
      send({
        method: 'session/update',
        params: { sessionId, update: { sessionUpdate: 'tool_call', ...toolCall } },
      });
    send({
      id: 90,
      method: 'session/request_permission',
      params: {
        sessionId: scenario.sessionId ?? sessionId,
        toolCall:
          scenario.incremental || scenario.missingDetails
            ? { toolCallId: 'write-1', rawInput: null }
            : toolCall,
        options: [
          ...(scenario.onlyAlways ? [] : [{ optionId: 'once', kind: 'allow_once' }]),
          { optionId: 'always', kind: 'allow_always' },
          { optionId: 'deny', kind: 'reject_once' },
        ],
      },
    });
  } else if (e.id === 90 && e.result) {
    if (e.result.outcome.optionId === 'once') {
      writeFileSync(join(cwd, 'artifact.txt'), 'SYNTHETIC');
      if (scenario.linger) return;
      send({
        method: 'session/update',
        params: {
          sessionId,
          update: scenario.incremental
            ? { sessionUpdate: 'tool_call_update', toolCallId: 'write-1', status: 'completed' }
            : {
                sessionUpdate: 'tool_call_update',
                toolCallId: 'write-1',
                name: 'write_file',
                kind: 'edit',
                title: 'artifact written',
                status: 'completed',
                locations: [{ path: join(cwd, 'artifact.txt') }],
              },
        },
      });
      send({
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: '已写入合成制品。' },
          },
        },
      });
      send({ id: promptId, result: { stopReason: 'end_turn' } });
    } else if (!scenario.linger) send({ id: promptId, result: { stopReason: 'cancelled' } });
  }
});
