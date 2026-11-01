const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Parsing Utilities ---
function parseGoogleHtml(html) {
    const $ = cheerio.load(html);
    const results = [];

    // Array of selectors Google uses across different devices, experiments, and updates
    const googleResultSelectors = [
        '.g',               // Classic container
        '.tF2Cxc',          // Modern web container
        'div.yuRUbf',       // Link/Title block wrapper
        '.MjjYid',          // Alternative card wrapper
        'div[data-sved]'    // Attribute-based fallback
    ];

    // Find the first selector that actually returns elements on this page payload
    let activeSelector = '.g';
    for (const selector of googleResultSelectors) {
        if ($(selector).length > 0) {
            activeSelector = selector;
            break;
        }
    }

    console.log(`[Parser] Extracting Google elements using selector: "${activeSelector}"`);

    $(activeSelector).each((i, el) => {
        // Multi-tier title and link lookup depending on structural changes
        const titleEl = $(el).find('h3, h1, .LC20lb').first();
        const linkEl = $(el).find('a[href^="http"]').first();

        const title = titleEl.text().trim();
        const link = linkEl.attr('href');

        if (title && link) {
            results.push({ title, link });
        }
    });

    // Emergency direct tag fallback if container blocks were entirely obfuscated
    if (results.length === 0) {
        console.warn(`[Parser] Structural containers hidden. Attempting direct anchor parsing fallback.`);
        $('h3').each((i, el) => {
            const title = $(el).text().trim();
            const link = $(el).closest('a').attr('href') || $(el).find('a').attr('href');
            if (title && link && link.startsWith('http')) {
                results.push({ title, link });
            }
        });
    }

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
    // FIX 1: Corrected string template interpolation and added standard search parameter formatting
    const googleTargetUrl = `https://google.com{encodeURIComponent(query)}`;
    const encodedGoogleUrl = encodeURIComponent(googleTargetUrl);

    // Tier 1: ScraperAPI (Kept commented as per original code, but fixed syntax for whenever you uncomment it)
    /*
    if (process.env.SCRAPERAPI_KEY) {
        try {
            console.log(`[Tier 1] Trying ScraperAPI...`);
            const url = `https://scraperapi.com{process.env.SCRAPERAPI_KEY}&url=${encodedGoogleUrl}`;
            const response = await axios.get(url, { timeout: 15000 });
            return { provider: 'Google (ScraperAPI)', results: parseGoogleHtml(response.data) };
        } catch (error) {
            console.warn(`[Tier 1] ScraperAPI failed: ${error.message}`);
        }
    }
    */

    // Tier 2: ZenRows
    if (process.env.ZENROWS_KEY) {
        try {
            console.log(`[Tier 2] Trying ZenRows...`);
            // FIX 2: Fixed missing `$` and matched standard ZenRows API endpoint format
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
        // FIX 3: Fixed missing `$` sign and updated to the scrape-friendly static HTML endpoint
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

// --- Root Directory Landing Page ---
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Search Engine Scraper API</title>
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; margin-top: 100px; background: #f8f9fa;">
            <h1 style="color: #333;">🔍 Secure Search Engine Proxy Running</h1>
            <p style="color: #666; font-size: 16px;">The API is live and healthy.</p>
            <div style="background: #fff; display: inline-block; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); margin-top: 20px;">
                <strong style="color: #d93025;">How to use it:</strong>
                <p style="font-family: monospace; background: #eee; padding: 10px; border-radius: 4px; margin-top: 10px;">
                    /search?q=YOUR_QUERY&key=YOUR_PASSWORD
                </p>
            </div>
        </body>
        </html>
    `);
});

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
