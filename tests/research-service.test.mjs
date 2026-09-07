import test from 'node:test';
import assert from 'node:assert/strict';
import { researchCustomer } from '../edge-functions/lib/research/service.js';

test('uses the backup provider after two retryable primary timeouts', async () => {
  let primaryAttempts = 0;
  let backupAttempts = 0;

  const result = await researchCustomer({
    customerName: '上海财经大学',
    projectId: 'project-1',
    primarySearch: async () => {
      primaryAttempts += 1;
      throw Object.assign(new Error('upstream timeout'), { code: 'TIMEOUT' });
    },
    backupSearch: async () => {
      backupAttempts += 1;
      return {
        background: '公开资料显示该机构开展高等财经教育。',
        training_relevance: '结合公开资料可关注财经人才培养相关议题。',
        sources: [{
          title: '上海财经大学官网',
          url: 'https://www.sufe.edu.cn/',
          published_at: '',
          content: '官网公开介绍该校办学信息。',
          provider: 'backup'
        }]
      };
    },
    wait: async () => {}
  });

  assert.equal(primaryAttempts, 2);
  assert.equal(backupAttempts, 1);
  assert.equal(result.status, 'succeeded');
  assert.equal(result.provider, 'backup');
  assert.equal(result.sources[0].url, 'https://www.sufe.edu.cn/');
});
