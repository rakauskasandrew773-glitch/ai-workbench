import test from 'node:test';
import assert from 'node:assert/strict';
import { createBochaSearch } from '../edge-functions/lib/research/providers/bocha.js';

test('maps Bocha web-search results into traceable research sources', async () => {
  let request;
  const search = createBochaSearch({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({
        code: 200,
        data: { webPages: { value: [{
          name: '客户官网',
          url: 'https://example.com/news',
          summary: '公开信息摘要',
          datePublished: '2026-09-01T08:00:00+08:00'
        }] } }
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });

  const result = await search('示例客户 近期重点工作');

  assert.equal(request.url, 'https://api.bochaai.com/v1/web-search');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  assert.deepEqual(JSON.parse(request.options.body), {
    query: '示例客户 近期重点工作', freshness: 'noLimit', summary: true, count: 8
  });
  assert.deepEqual(result, [{
    title: '客户官网',
    url: 'https://example.com/news',
    published_at: '2026-09-01T08:00:00+08:00',
    content: '公开信息摘要',
    provider: 'bocha_web_search'
  }]);
});

test('accepts the official top-level Bocha Web Search response shape', async () => {
  const search = createBochaSearch({
    apiKey: 'bocha-key',
    fetchImpl: async () => new Response(JSON.stringify({
      _type: 'SearchResponse',
      webPages: {
        value: [{
          name: '上海财经大学官网',
          url: 'https://www.sufe.edu.cn/',
          datePublished: '2026-01-01T00:00:00+08:00',
          summary: '官网公开介绍办学信息。'
        }]
      }
    }), { status: 200 })
  });

  const results = await search('上海财经大学');

  assert.equal(results.length, 1);
  assert.equal(results[0].title, '上海财经大学官网');
  assert.equal(results[0].url, 'https://www.sufe.edu.cn/');
});
