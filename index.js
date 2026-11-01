const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Parsing Utilities ---
function parseGoogleHtml(html) {
    const $ = cheerio.load(html);
    const results = [];
    $('.g').each((i, el) => {
        const title = $(el).find('h3').text().trim();
        const link = $(el).find('a').attr('href');
        if (title && link && link.startsWith('http')) {
            results.push({ title, link });
        }
    });
    return results;
}

function parseDuckDuckGoHtml(html) {
    const $ = cheerio.load(html);
    const results = [];
    $('.links_main').each((i, el) => {
        const title = $(el).find('.links_main_trigger').text().trim();
        const link = $(el).find('.links_main_trigger').attr('href');
        if (title && link) {
            results.push({ title, link });
        }
    });
    return results;
}

// --- Multi-Tier Search Function ---
async function searchWithResilience(query) {
    const googleTargetUrl = `https://google.com{encodeURIComponent(query)}`;
    const encodedGoogleUrl = encodeURIComponent(googleTargetUrl);

    // Tier 1: ScraperAPI
    if (process.env.SCRAPERAPI_KEY) {
        try {
            console.log(`[Tier 1] Trying ScraperAPI...`);
            const url = `https://scraperapi.com?api_key=${process.env.SCRAPERAPI_KEY}&url=${encodedGoogleUrl}`;
            const response = await axios.get(url, { timeout: 15000 });
            return { provider: 'Google (ScraperAPI)', results: parseGoogleHtml(response.data) };
        } catch (error) {
            console.warn(`[Tier 1] ScraperAPI failed: ${error.message}`);
        }
    }

    // Tier 2: ZenRows
    if (process.env.ZENROWS_KEY) {
        try {
            console.log(`[Tier 2] Trying ZenRows...`);
            const url = `https://zenrows.com{process.env.ZENROWS_KEY}&url=${encodedGoogleUrl}`;
            const response = await axios.get(url, { timeout: 15000 });
            return { provider: 'Google (ZenRows)', results: parseGoogleHtml(response.data) };
        } catch (error) {
            console.warn(`[Tier 2] ZenRows failed: ${error.message}`);
        }
    }

    // Tier 3: Emergency DuckDuckGo
    try {
        console.log(`[Tier 3] Proxies exhausted. Falling back to DuckDuckGo...`);
        const ddgUrl = `https://duckduckgo.com{encodeURIComponent(query)}`;
        const response = await axios.get(ddgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000
        });
        return { provider: 'DuckDuckGo (Direct)', results: parseDuckDuckGoHtml(response.data) };
    } catch (error) {
        console.error(`[Tier 3] DuckDuckGo failed: ${error.message}`);
    }

    return { provider: 'None', results: [] };
}

// --- HTML Generation Helper ---
function generateHtmlView(query, source, results) {
    const listItems = results.map(item => `
        <li style="margin-bottom: 16px; list-style-type: none; background: #fff; padding: 15px; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <a href="${item.link}" target="_blank" style="color: #1a0dab; text-decoration: none; font-size: 18px; font-weight: bold;">${item.title}</a>
            <div style="color: #006621; font-size: 14px; word-break: break-all; margin-top: 4px;">${item.link}</div>
        </li>
    `).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Search Results: ${query}</title>
    </head>
    <body style="font-family: Arial, sans-serif; background-color: #f8f9fa; color: #333; margin: 0; padding: 20px;">
        <div style="max-width: 800px; margin: 0 auto;">
            <h1 style="color: #202124;">Results for: <span style="font-style: italic; color: #4285f4;">${query}</span></h1>
            <p style="color: #70757a; font-size: 14px;">Data fetched cleanly via: <strong>${source}</strong></p>
            <hr style="border: 0; border-top: 1px solid #dadce0; margin-bottom: 20px;">
            ${results.length === 0 ? '<p>No results found or an error occurred.</p>' : `<ul style="padding: 0;">${listItems}</ul>`}
        </div>
    </body>
    </html>
    `;
}

// --- Express API Endpoint ---
app.get('/search', async (req, res) => {
    const query = req.query.q;
    const token = req.query.key;
    const expectedToken = process.env.API_PASSWORD;

    // 1. Password Verification
    if (!expectedToken || token !== expectedToken) {
        return res.status(401).json({ error: "Unauthorized access. Invalid or missing '?key=' parameter." });
    }

    // 2. Query Presence Check
    if (!query) {
        return res.status(400).json({ error: "Missing search parameter 'q'. Example: /search?q=query&key=password" });
    }

    console.log(`Executing authenticated request for query: "${query}"`);
    const searchData = await searchWithResilience(query);

    // 3. Smart Output Format Decision
    // If request accepts HTML (like a normal web browser), render the clean visual dashboard
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
        res.setHeader('Content-Type', 'text/html');
        return res.send(generateHtmlView(query, searchData.provider, searchData.results));
    }

    // Default back to regular raw JSON data for other tools/scripts
    res.json({
        query: query,
        source: searchData.provider,
        count: searchData.results.length,
        results: searchData.results
    });
});

app.listen(PORT, () => {
    console.log(`Secure Server running on port ${PORT}`);
});
