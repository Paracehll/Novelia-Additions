// Web Worker for fetching Hameln pages asynchronously in the background.
// This completely avoids window focus-shifting issues by running in a separate thread.

self.onmessage = async (e) => {
    const { url } = e.data;
    if (!url) {
        self.postMessage({ error: "No URL provided", success: false });
        return;
    }

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const htmlText = await response.text();
        self.postMessage({
            url: url,
            html: htmlText,
            success: true
        });
    } catch (err) {
        self.postMessage({
            url: url,
            error: err.message,
            success: false
        });
    }
};
