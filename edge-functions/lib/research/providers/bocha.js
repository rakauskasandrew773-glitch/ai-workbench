const BOCHA_WEB_SEARCH_URL = 'https://api.bochaai.com/v1/web-search';

export function createBochaSearch({ apiKey, fetchImpl = fetch }) {
  if (!apiKey) return null;

  return async function searchBocha(query) {
    const response = await fetchImpl(BOCHA_WEB_SEARCH_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, freshness: 'noLimit', summary: true, count: 8 })
    });

    const data = await response.json();
    if (!response.ok || (data?.code != null && data.code !== 200)) {
      throw Object.assign(new Error('Backup search request failed'), { status: response.status });
    }

    const webPages = data?.webPages?.value || data?.data?.webPages?.value;
    return (Array.isArray(webPages) ? webPages : [])
      .filter(item => item && item.name && item.url)
      .map(item => ({
        title: String(item.name).trim(),
        url: String(item.url).trim(),
        published_at: String(item.datePublished || '').trim(),
        content: String(item.summary || item.snippet || '').trim(),
        provider: 'bocha_web_search'
      }));
  };
}
