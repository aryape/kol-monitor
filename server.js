const dotenv = require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ApifyClient } = require('apify-client');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Mengizinkan Express membaca file HTML di dalam folder 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Inisialisasi ApifyClient dengan Token Anda
const client = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

// Endpoint untuk menerima URL dari Frontend dan menjalankan Apify
app.post('/api/analyze', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL postingan wajib dikirim' });
    }

    try {
        console.log(`[LOG] Memulai proses Apify untuk URL: ${url}`);
        
        // Konfigurasi input Apify
        const input = {
            "postURLs": [url], // Memasukkan URL yang dikirim dari HTML
            "resultsPerPage": 1,
            "profileScrapeSections": ["videos"],
            "profileSorting": "latest",
            "excludePinnedPosts": false,
            "maxFollowersPerProfile": 0,
            "maxFollowingPerProfile": 0,
            "searchSection": "",
            "maxProfilesPerQuery": 10,
            "videoSearchSorting": "MOST_RELEVANT",
            "videoSearchDateFilter": "ALL_TIME",
            "scrapeRelatedSearchWords": false,
            "scrapeRelatedVideos": false,
            "scrapeAdditionalAuthorMeta": false,
            "shouldDownloadVideos": false,
            "shouldDownloadCovers": false,
            "shouldDownloadSlideshowImages": false,
            "shouldDownloadAvatars": false,
            "shouldDownloadMusicCovers": false,
            "downloadSubtitlesOptions": "NEVER_DOWNLOAD_SUBTITLES",
            "commentsPerPost": 0,
            "topLevelCommentsPerPost": 0,
            "maxRepliesPerComment": 0,
            "proxyCountryCode": "None"
        };

        // Jalankan Actor (GdWCkxBtKWOsKjdch)
        const run = await client.actor("GdWCkxBtKWOsKjdch").call(input);
        console.log('[LOG] Apify selesai scraping. Mengambil data dari dataset...');

        // Ambil hasil dari dataset Apify
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        
        if (items.length === 0) {
            return res.status(404).json({ error: 'Data metrik tidak ditemukan oleh Apify' });
        }

        // Ambil data dari array pertama (karena kita hanya mencari 1 URL)
        const data = items[0];

        // Format hasil untuk dikirim ke HTML
        const result = {
            views: data.playCount || 0,
            likes: data.diggCount || 0,
            comments: data.commentCount || 0,
            shares: data.shareCount || 0,
            saves: data.collectCount || 0,
            gmv: 0 // Default 0 untuk metrik yang tidak ada
        };

        // Kirim hasil kembali ke HTML
        res.json(result);
        
    } catch (error) {
        console.error('[ERROR]', error);
        res.status(500).json({ error: 'Terjadi kesalahan saat menjalankan scraping Apify' });
    }
});

// Menentukan Port (Bisa dari Cloud Hosting atau default 3000 untuk lokal)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server Backend berjalan dengan baik di port ${PORT}`);
});