export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

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
    // Try fetching with browser-like headers
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      res.status(response.status).json({ 
        error: `Source returned status ${response.status}`,
        hint: 'The source website may be temporarily unavailable'
      });
      return;
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      res.status(400).json({ error: 'Source is not an HTML page' });
      return;
    }

    let html = await response.text();

    // Clean up the HTML to remove framing restrictions
    html = html
      // Remove X-Frame-Options meta tags
      .replace(/<meta[^>]*http-equiv\s*=\s*["']X-Frame-Options["'][^>]*>/gi, '')
      // Remove CSP meta tags that block framing
      .replace(/<meta[^>]*http-equiv\s*=\s*["']Content-Security-Policy["'][^>]*>/gi, '')
      // Remove frame-ancestors directive
      .replace(/frame-ancestors\s+[^;]*/gi, '')
      // Remove any JavaScript that checks for framing
      .replace(/if\s*\(\s*window\.top\s*!==\s*window\.self\s*\)[^}]*}/gi, '')
      .replace(/if\s*\(\s*self\s*!==\s*top\s*\)[^}]*}/gi, '')
      .replace(/if\s*\(\s*top\.location\s*!==\s*self\.location\s*\)[^}]*}/gi, '');

    // Inject base tag for relative URLs
    const baseTag = `<base href="${parsedUrl.origin}${parsedUrl.pathname.replace(/[^/]*$/, '')}" target="_blank">`;
    
    if (html.includes('<head>')) {
      html = html.replace('<head>', `<head>\n${baseTag}`);
    } else if (/<head\s[^>]*>/.test(html)) {
      html = html.replace(/<head\s[^>]*>/, (match) => `${match}\n${baseTag}`);
    } else if (html.includes('<html>')) {
      html = html.replace('<html>', `<html>\n<head>${baseTag}</head>`);
    } else {
      html = `<!DOCTYPE html><html><head>${baseTag}</head><body>${html}</body></html>`;
    }

    // Add styles for better readability in iframe
    const customStyles = `
      <style>
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
          line-height: 1.6 !important;
          color: #e5e7eb !important;
          background: #111827 !important;
          padding: 1rem !important;
        }
        a { color: #a78bfa !important; }
        pre, code { 
          background: #1f2937 !important; 
          color: #f3f4f6 !important;
          border-radius: 0.5rem !important;
          padding: 0.5rem !important;
        }
      </style>
    `;
    html = html.replace('</head>', `${customStyles}\n</head>`);

    // Add script to open links in new tab
    const linkScript = `
      <script>
        document.addEventListener('click', function(e) {
          var a = e.target.closest('a');
          if (a && a.href) {
            e.preventDefault();
            window.open(a.href, '_blank', 'noopener,noreferrer');
          }
        });
        // Prevent frame-busting scripts
        window.top = window;
        window.parent = window;
      </script>
    `;
    html = html.replace('</body>', `${linkScript}\n</body>`);

    // Send cleaned HTML without framing restrictions
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Explicitly remove any framing restrictions
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.status(200).send(html);

  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch the page',
      details: error.message,
      hint: 'Try opening the original link directly'
    });
  }
}
