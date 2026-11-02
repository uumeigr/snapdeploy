const express = require('express'); 
const axios = require('axios'); 
const cheerio = require('cheerio'); 
const app = express(); 
const PORT = process.env.PORT || 3000; 

// --- Parsing Utilities --- 
function parseGoogleHtml(html) { 
    const $ = cheerio.load(html); 
    const results = []; 
    const googleResultSelectors = ['.g', '.tF2Cxc', 'div.yuRUbf', '.MjjYid', 'div[data-sved]']; 

    let activeSelector = '.g'; 
    for (const selector of googleResultSelectors) { 
        if ($(selector).length > 0) {  activeSelector = selector; break; } 
    } 

    $(activeSelector).each((i, el) => { 
        const titleEl = $(el).find('h3, h1, .LC20lb').first(); 
        const linkEl = $(el).find('a[href^="http"]').first(); 
        const title = titleEl.text().trim(); 
        const link = linkEl.attr('href'); 
        if (title && link) { results.push({ title, link }); } 
    }); 

    if (results.length === 0) { 
        $('h3').each((i, el) => { 
            const title = $(el).text().trim(); 
            const link = $(el).closest('a').attr('href') || $(el).find('a').attr('href'); 
            if (title && link && link.startsWith('http')) { results.push({ title, link }); } 
        }); 
    } 
    return results; 
} 

function parseDuckDuckGoHtml(html) { 
    const $ = cheerio.load(html); 
    const results = []; 

    $('.result__body').each((i, el) => { 
        const titleEl = $(el).find('.result__title .result__url').first();
        const title = titleEl.text().trim(); 
        let link = titleEl.attr('href'); 

        if (link && link.includes('uddg=')) {
            link = decodeURIComponent(link.split('uddg='));
        }

        if (title && link) { results.push({ title, link }); } 
    }); 
    return results; 
} 

// --- Multi-Tier Search Function --- 
async function searchWithResilience(query) { 
    // const googleTargetUrl = `https://google.com{encodeURIComponent(query)}`;
    const params = new URLSearchParams({
      q: query
    });

    console.log("query:--------------------J10----------------------")
    console.log(query);
    console.log("--------------------------J10----------------------")

    console.log("params:--------------------J10----------------------")
    console.log(params);
    console.log("---------------------------J10----------------------")

    // const googleTargetUrl = `https://google.com/search?${params.toString()}`;
    const googleTargetUrl = `https://google.com/search?q=${encodeURIComponent(query)}`;
    
    console.log("Google Search URL:--------------------J10----------------------")
    console.log(googleTargetUrl);
    console.log("--------------------------------------J10----------------------")

    const browserHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
    };

    // Tier 1: ZenRows
    if (process.env.ZENROWS_KEY) { 
        try { 
            console.log(`[Tier 1] Trying ZenRows with clean params config...`); 
            const response = await axios({
                url: 'https://zenrows.com',
                method: 'GET',
                headers: browserHeaders,
                params: {
                    'url': googleTargetUrl,
                    'apikey': process.env.ZENROWS_KEY,
                    'mode': 'auto'
                },
                timeout: 15000
            });
            console.log("ZenRows params:--------------------J10----------------------")
            console.log(process.env.ZENROWS_KEY);
            console.log(browserHeaders);
            console.log(googleTargetUrl);
            console.log("response data:--------------");
            console.log(response.data);
            console.log("---------------------------J10----------------------")
            return { provider: 'Google (ZenRows)', results: parseGoogleHtml(response.data) }; 
        } catch (error) { 
            console.warn(`[Tier 1] ZenRows failed: ${error.message}`); 
        } 
    } 

    // Tier 2: Emergency DuckDuckGo Fallback
    try { 
        console.log(`[Tier 2] ZenRows bypassed/missing. Falling back to DuckDuckGo HTML...`); 

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

        // tried in chrome, this work
        // https://html.duckduckgo.com/html/?q=best+free+serverless
        // https://html.duckduckgo.com/html?q=best+free+serverless
        // this does not work
        // https://html.duckduckgo.com/html/q=best+free+serverless
        // https://html.duckduckgo.com/html/best+free+serverless
        /*
        const response = await axios({
            url: 'https://html.duckduckgo.com/html/',
            method: 'POST',
            headers: browserHeadersForDD,
            data: new URLSearchParams({ q: query }).toString(), // Send query in the body
            timeout: 10000
        });
        */
        /*
        const response = await axios({
            url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
            method: 'GET',
            headers: browserHeadersForDD,
            timeout: 10000
        });
        */
        // claude suggest
        const response = await axios.get('https://html.duckduckgo.com/html/', {
            params: { q: query },          // axios encodes this for you
            headers: browserHeadersForDD,
            timeout: 10000
        });

        if (response.data.includes('anomaly-modal')) {
            throw new Error('DuckDuckGo bot challenge triggered');
        }
        console.log("DuckDuckGo response data:--------------------J10----------------------")
        console.log(browserHeadersForDD);
        console.log(query);
        console.log(response.data);
        console.log("---------------------------J10----------------------")
        return { provider: 'DuckDuckGo (Direct fallback)', results: parseDuckDuckGoHtml(response.data) }; 
    } catch (error) { 
        console.error(`[Tier 2] DuckDuckGo failed: ${error.message}`); 
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
                
                <!-- The action handles mapping form inputs directly into the /search route via GET parameters -->
                <form action="/search" method="GET" style="text-align: left;">
                    <div style="margin-bottom: 15px;">
                        <label for="q" style="display: block; font-weight: bold; margin-bottom: 5px; font-size: 14px;">Search Query</label>
                        <input type="text" id="q" name="q" placeholder="e.g., best free online GPU" required 
                               style="width: 100%; padding: 10px; border: 1px solid #dadce0; border-radius: 4px; box-sizing: border-radius; font-size: 15px;">
                    </div>
                    
                    <div style="margin-bottom: 25px;">
                        <label for="key" style="display: block; font-weight: bold; margin-bottom: 5px; font-size: 14px;">API Password Key</label>
                        <input type="password" id="key" name="key" placeholder="Enter security key" required 
                               style="width: 100%; padding: 10px; border: 1px solid #dadce0; border-radius: 4px; box-sizing: border-radius; font-size: 15px;">
                    </div>
                    
                    <button type="submit" 
                            style="width: 100%; padding: 12px; background-color: #1a73e8; color: white; border: none; border-radius: 4px; font-size: 16px; font-weight: bold; cursor: pointer; transition: background 0.2s;">
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
        const listItems = searchData.results.map(item => `
            <li style="margin-bottom:16px; background:#fff; padding:15px; border-radius:6px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); list-style-type: none;">
                <a href="${item.link}" target="_blank" style="font-weight:bold; font-size: 18px; color:#1a0dab; text-decoration: none;">${item.title}</a>
                <div style="color:#006621; font-size:13px; word-break: break-all; margin-top: 4px;">${item.link}</div>
            </li>`).join('');
            
        res.setHeader('Content-Type', 'text/html'); 
        return res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>Results: ${query}</title></head>
            <body style="font-family:Arial, sans-serif; background:#f8f9fa; padding:30px; color: #333;">
                <div style="max-width: 800px; margin: 0 auto;">
                    <a href="/" style="text-decoration: none; color: #1a73e8; font-size: 14px;">← Back to Search</a>
                    <h2 style="margin-top: 15px;">Results for: <span style="font-style: italic; color: #1a73e8;">${query}</span></h2>
                    <p style="color: #666; font-size: 14px;">Source: <strong>${searchData.provider}</strong></p>
                    <hr style="border: 0; border-top: 1px solid #dadce0; margin-bottom: 20px;">
                    <ul style="padding: 0;">${listItems.length ? listItems : '<p>No data returned from provider.</p>'}</ul>
                </div>
            </body>
            </html>`);
    } 
    
    res.json({ query, source: searchData.provider, count: searchData.results.length, results: searchData.results }); 
}); 

app.listen(PORT, () => { 
    console.log(`Secure Server running on port ${PORT}`); 
});
