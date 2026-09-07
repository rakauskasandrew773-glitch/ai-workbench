function isRetryable(error) {
  const code = String(error?.code || '').toUpperCase();
  const status = Number(error?.status || error?.statusCode || 0);
  return code === 'TIMEOUT' || code === 'ETIMEDOUT' || code === 'ECONNRESET' || status >= 500;
}

function normalizeSources(sources, provider) {
  return (Array.isArray(sources) ? sources : [])
    .filter(source => source && /^https?:\/\//i.test(String(source.url || '')) && String(source.title || '').trim())
    .slice(0, 8)
    .map(source => ({
      title: String(source.title).trim(),
      url: String(source.url).trim(),
      published_at: String(source.published_at || '').trim(),
      content: String(source.content || source.summary || '').trim().slice(0, 800),
      provider
    }));
}

function succeeded(result, provider) {
  const sources = normalizeSources(result?.sources, provider);
  return {
    status: sources.length ? 'succeeded' : 'no_reliable_sources',
    provider,
    background: String(result?.background || '').trim(),
    training_relevance: String(result?.training_relevance || '').trim(),
    sources,
    user_message: sources.length
      ? '客户公开资料调研已完成。'
      : '已完成客户公开资料检索，但暂未获得可保留的可靠来源。'
  };
}

export async function researchCustomer({ customerName, primarySearch, backupSearch, wait = async () => {} }) {
  if (!String(customerName || '').trim()) {
    return { status: 'failed', sources: [], background: '', training_relevance: '', user_message: '未填写客户名称。' };
  }

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return succeeded(await primarySearch(), 'deepseek_web_search');
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) break;
      if (attempt === 0) await wait();
    }
  }

  if (typeof backupSearch === 'function' && isRetryable(lastError)) {
    try {
      return succeeded(await backupSearch(), 'backup');
    } catch {
      // The user-facing result must not disclose provider internals.
    }
  }

  return {
    status: 'retryable_failure',
    provider: '',
    background: '',
    training_relevance: '',
    sources: [],
    user_message: '客户公开资料暂未获取成功，课程方案已继续生成，可点击重新调研客户。'
  };
}
