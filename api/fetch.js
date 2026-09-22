export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'Parameter "url" is required' });
    return;
  }

  // Validate URL
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      res.status(400).json({ error: 'Only http and https URLs are allowed' });
      return;
    }
  } catch {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  try {
    // Fetch the page with browser-like headers
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      res.status(response.status).json({ 
        error: `Source returned status ${response.status}` 
      });
      return;
    }

    const html = await response.text();

    // Remove X-Frame-Options and CSP meta tags
    let cleanedHtml = html
      .replace(/<meta[^>]*http-equiv=["']X-Frame-Options["'][^>]*>/gi, '')
      .replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
      .replace(/frame-ancestors[^;]*/gi, '');

    // Inject base tag for relative URLs
    const baseTag = `<base href="${parsedUrl.origin}/" target="_blank">`;
    
    if (cleanedHtml.includes('<head>')) {
      cleanedHtml = cleanedHtml.replace('<head>', `<head>${baseTag}`);
    } else if (cleanedHtml.includes('<head ')) {
      cleanedHtml = cleanedHtml.replace(/<head\s[^>]*>/, (match) => `${match}${baseTag}`);
    } else {
      cleanedHtml = baseTag + cleanedHtml;
    }

    // Add script to open links in new tab
    const linkScript = `<script>document.addEventListener('click',function(e){var a=e.target.closest('a');if(a){e.preventDefault();window.open(a.href,'_blank')}});</script>`;
    cleanedHtml = cleanedHtml.replace('</body>', `${linkScript}</body>`);

    // Return cleaned HTML
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(cleanedHtml);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to fetch the page',
      details: error.message 
    });
  }
}
