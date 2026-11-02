const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const app = express();
const PORT = process.env.PORT || 3000;

// --- Helpers ---
function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// DDG result links look like //duckduckgo.com/l/?uddg=<encoded real url>&rut=...
function decodeDdgLink(href = '') {
    try {
        const full = href.startsWith('//') ? `https:${href}` : href;
        const uddg = new URL(full).searchParams.get('uddg'); // already URL-decoded
        return uddg || full;
    } catch {
        return href;
    }
}

// --- Parsing Utilities ---
function parseGoogleHtml(html) {
    const $ = cheerio.load(html);
    const results = [];
    const googleResultSelectors = ['.g', '.tF2Cxc', 'div.yuRUbf', '.MjjYid', 'div[data-sved]'];

    let activeSelector = '.g';
    for (const selector of googleResultSelectors) {
        if ($(selector).length > 0) { activeSelector = selector; break; }
    }

    $(activeSelector).each((i, el) => {
        const titleEl = $(el).find('h3, h1, .LC20lb').first();
        const linkEl = $(el).find('a[href^="http"]').first();
        const title = titleEl.text().trim();
        const link = linkEl.attr('href');
        if (title && link) { results.push({ title, link, snippet: '' }); }
    });

    if (results.length === 0) {
        $('h3').each((i, el) => {
            const title = $(el).text().trim();
            const link = $(el).closest('a').attr('href') || $(el).find('a').attr('href');
            if (title && link && link.startsWith('http')) { results.push({ title, link, snippet: '' }); }
        });
    }
    return results;
}

function parseDuckDuckGoHtml(html) {
    const $ = cheerio.load(html);
    const results = [];

    $('.result').each((i, el) => {
        if ($(el).hasClass('result--ad')) return; // skip ads

        // Title and link live in a.result__a (NOT .result__url, which is just the display URL)
        const titleEl = $(el).find('a.result__a').first();
        const title = titleEl.text().trim();
        const link = decodeDdgLink(titleEl.attr('href'));
        const snippet = $(el).find('.result__snippet').first().text().trim(); // .text() strips <b> tags

        if (title && link) { results.push({ title, link, snippet }); }
    });
    return results;
}

// --- Multi-Tier Search Function ---
async function searchWithResilience(query) {
    const googleTargetUrl = `https://google.com/search?q=${encodeURIComponent(query)}`;

    const browserHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
    };

    // Tier 1: ZenRows (Google)
    if (process.env.ZENROWS_KEY) {
        try {
            console.log('[Tier 1] Trying ZenRows...');
            const response = await axios({
                url: 'https://api.zenrows.com/v1/', // full API endpoint (was missing in your code)
                method: 'GET',
                headers: browserHeaders,
                params: {
                    'url': googleTargetUrl,
                    'apikey': process.env.ZENROWS_KEY,
                    'mode': 'auto'
                },
                timeout: 15000
            });
            const results = parseGoogleHtml(response.data);
            if (results.length === 0) throw new Error('ZenRows returned no parseable results');
            return { provider: 'Google (ZenRows)', results };
        } catch (error) {
            console.warn(`[Tier 1] ZenRows failed: ${error.message}`);
        }
    }

    // Tier 2: DuckDuckGo HTML
    try {
        console.log('[Tier 2] Trying DuckDuckGo HTML...');

        const browserHeadersForDD = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'Referer': 'https://html.duckduckgo.com/',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-User': '?1'
        };

        const response = await axios.get('https://html.duckduckgo.com/html/', {
            params: { q: query },
            headers: browserHeadersForDD,
            timeout: 10000
        });

        if (typeof response.data !== 'string' || response.data.includes('anomaly-modal')) {
            throw new Error('DuckDuckGo bot challenge triggered');
        }

        const results = parseDuckDuckGoHtml(response.data);
        console.log(`[Tier 2] DuckDuckGo parsed ${results.length} results`);
        if (results.length === 0) throw new Error('DuckDuckGo returned no parseable results');
        return { provider: 'DuckDuckGo (Direct fallback)', results };
    } catch (error) {
        console.error(`[Tier 2] DuckDuckGo failed: ${error.message}`);
    }

    // Tier 3: Tavily API (works from datacenter IPs, no scraping)
    if (process.env.TAVILY_API_KEY) {
        try {
            console.log('[Tier 3] Trying Tavily...');
            const response = await axios.post(
                'https://api.tavily.com/search',
                { query, max_results: 10 },
                {
                    headers: { Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
                    timeout: 10000
                }
            );
            const results = (response.data.results || []).map(r => ({
                title: r.title,
                link: r.url,
                snippet: r.content || ''
            }));
            if (results.length === 0) throw new Error('Tavily returned no results');
            return { provider: 'Tavily API', results };
        } catch (error) {
            console.error(`[Tier 3] Tavily failed: ${error.message}`);
        }
    } else {
        console.warn('[Tier 3] TAVILY_API_KEY not set, skipping');
    }

    return { provider: 'None', results: [] };
}

// --- ROOT DIRECTORY: Interactive Search Dashboard ---
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Search Engine Proxy Dashboard</title>
        </head>
        <body style="font-family: Arial, sans-serif; background-color: #f8f9fa; color: #333; margin: 0; padding: 50px 20px; text-align: center;">
            <div style="max-width: 500px; margin: 0 auto; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.08);">
                <h1 style="color: #202124; margin-bottom: 5px;">🔍 Secure Search Engine Proxy</h1>
                <p style="color: #666; font-size: 14px; margin-bottom: 25px;">Enter your search query and authorization key below</p>

                <form action="/search" method="GET" style="text-align: left;">
                    <div style="margin-bottom: 15px;">
                        <label for="q" style="display: block; font-weight: bold; margin-bottom: 5px; font-size: 14px;">Search Query</label>
                        <input type="text" id="q" name="q" placeholder="e.g., best free online GPU" required
                               style="width: 100%; padding: 10px; border: 1px solid #dadce0; border-radius: 4px; box-sizing: border-box; font-size: 15px;">
                    </div>

                    <div style="margin-bottom: 25px;">
                        <label for="key" style="display: block; font-weight: bold; margin-bottom: 5px; font-size: 14px;">API Password Key</label>
                        <input type="password" id="key" name="key" placeholder="Enter security key" required
                               style="width: 100%; padding: 10px; border: 1px solid #dadce0; border-radius: 4px; box-sizing: border-box; font-size: 15px;">
                    </div>

                    <button type="submit"
                            style="width: 100%; padding: 12px; background-color: #1a73e8; color: white; border: none; border-radius: 4px; font-size: 16px; font-weight: bold; cursor: pointer;">
                        Execute Search
                    </button>
                </form>
            </div>
        </body>
        </html>
    `);
});

// --- Express API Search Endpoint ---
app.get('/search', async (req, res) => {
    const query = req.query.q;
    const token = req.query.key;
    const expectedToken = process.env.API_PASSWORD;

    if (!expectedToken || token !== expectedToken) {
        return res.status(401).json({ error: "Unauthorized access. Invalid or missing security key." });
    }
    if (!query) {
        return res.status(400).json({ error: "Missing parameter 'q'." });
    }

    console.log(`Executing request for query: "${query}"`);
    const searchData = await searchWithResilience(query);

    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        const listItems = searchData.results
            .filter(item => /^https?:\/\//i.test(item.link)) // only render http(s) links
            .map(item => `
            <li style="margin-bottom:16px; background:#fff; padding:15px; border-radius:6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); list-style-type: none;">
                <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" style="font-weight:bold; font-size: 18px; color:#1a0dab; text-decoration: none;">${escapeHtml(item.title)}</a>
                <div style="color:#006621; font-size:13px; word-break: break-all; margin-top: 4px;">${escapeHtml(item.link)}</div>
                ${item.snippet ? `<div style="color:#4d5156; font-size:14px; margin-top: 6px;">${escapeHtml(item.snippet)}</div>` : ''}
            </li>`).join('');

        res.setHeader('Content-Type', 'text/html');
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Results: ${escapeHtml(query)}</title>
            </head>
            <body style="font-family:Arial, sans-serif; background:#f8f9fa; padding:30px; color: #333;">
                <div style="max-width: 800px; margin: 0 auto;">
                    <a href="/" style="text-decoration: none; color: #1a73e8; font-size: 14px;">← Back to Search</a>
                    <h2 style="margin-top: 15px;">Results for: <span style="font-style: italic; color: #1a73e8;">${escapeHtml(query)}</span></h2>
                    <p style="color: #666; font-size: 14px;">Source: <strong>${escapeHtml(searchData.provider)}</strong></p>
                    <hr style="border: 0; border-top: 1px solid #dadce0; margin-bottom: 20px;">
                    <ul style="padding: 0;">${listItems || '<p>No data returned from any provider.</p>'}</ul>
                </div>
            </body>
            </html>`);
    }

    res.json({ query, source: searchData.provider, count: searchData.results.length, results: searchData.results });
});

app.listen(PORT, () => {
    console.log(`Secure Server running on port ${PORT}`);
});
