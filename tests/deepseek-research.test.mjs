import test from 'node:test';
import assert from 'node:assert/strict';
import { callDeepSeekWebResearch } from '../edge-functions/api/chat.js';

test('marks an aborted DeepSeek research request as retryable timeout', async () => {
  await assert.rejects(
    callDeepSeekWebResearch('test-key', '示例客户', {
      timeoutMs: 1,
      fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      })
    }),
    error => error.code === 'TIMEOUT'
  );
});
