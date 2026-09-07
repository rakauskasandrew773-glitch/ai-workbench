import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPost } from '../edge-functions/api/chat.js';

test('returns a safe research status instead of exposing missing server configuration', async () => {
  const response = await onRequestPost({
    env: {},
    request: new Request('https://example.test/api/chat', {
      method: 'POST',
      body: JSON.stringify({ action: 'research_customer', customer_name: '示例客户' })
    })
  });
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.status, 'failed');
  assert.equal(data.error, undefined);
  assert.match(data.user_message, /尚未启用/);
});
