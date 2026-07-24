require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ApifyClient } = require('apify-client');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Konfigurasi Database (PostgreSQL)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Wajib untuk sebagian besar cloud DB
});

// 2. Inisialisasi Apify
const client = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

// 3. ENDPOINT READ: Menarik agregasi data untuk Homescreen
app.get('/api/campaigns', async (req, res) => {
    try {
        // Kueri agregasi untuk menggabungkan metrik post ke level campaign
        const query = `
            SELECT 
                c.id, c.campaign_name, c.total_budget,
                COALESCE(SUM(p.views), 0) as total_views,
                COALESCE(SUM(p.likes), 0) as total_likes,
                COALESCE(SUM(p.comments), 0) as total_comments,
                COALESCE(SUM(p.shares), 0) as total_shares,
                COALESCE(SUM(p.saves), 0) as total_saves
            FROM campaigns c
            LEFT JOIN campaign_posts p ON c.id = p.campaign_id
            GROUP BY c.id, c.campaign_name, c.total_budget
            ORDER BY c.created_at DESC;
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (error) {
        console.error("DB Error:", error);
        res.status(500).json({ error: 'Gagal mengambil data database' });
    }
});

// 4. ENDPOINT ETL: Scraping Apify & Insert ke Database
app.post('/api/analyze-and-save', async (req, res) => {
    const { campaignName, productName, budget, urls } = req.body;

    if (!campaignName || !urls || urls.length === 0) {
        return res.status(400).json({ error: 'Data tidak lengkap' });
    }

    let dbClient;

    try {
        console.log(`[LOG] Memulai proses ETL untuk Campaign: ${campaignName}`);
        
        // --- EXTRACT (Apify) ---
        const input = {
            "postURLs": urls,
            "hashtags": [],
            "resultsPerPage": urls.length,
            "profileScrapeSections": ["videos"],
            "profileSorting": "latest"
        };

        const run = await client.actor("GdWCkxBtKWOsKjdch").call(input);
        const { items } = await client.dataset(run.defaultDatasetId).listItems();
        
        if (items.length === 0) throw new Error("Apify tidak menemukan data.");

        // --- TRANSFORM & LOAD (Database Transaction) ---
        dbClient = await pool.connect();
        await dbClient.query('BEGIN'); // Mulai transaksi database

        // Insert ke tabel master
        const campaignInsert = await dbClient.query(
            `INSERT INTO campaigns (campaign_name, product_name, total_budget) 
             VALUES ($1, $2, $3) RETURNING id`,
            [campaignName, productName || 'Unknown', budget]
        );
        const campaignId = campaignInsert.rows[0].id;

        // Distribusi budget sederhana untuk menghitung CPV
        const budgetPerPost = budget / items.length;

        // Insert metrik tiap URL ke tabel transaksi
        for (const data of items) {
            const views = data.playCount || 0;
            const cpv = views > 0 ? (budgetPerPost / views) : 0;

            await dbClient.query(
                `INSERT INTO campaign_posts (campaign_id, author, post_url, views, likes, comments, shares, saves, cpv) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    campaignId, 
                    data.authorMeta?.name || 'Unknown', 
                    data.webVideoUrl || '', 
                    views, 
                    data.diggCount || 0, 
                    data.commentCount || 0, 
                    data.shareCount || 0, 
                    data.collectCount || 0, 
                    cpv
                ]
            );
        }

        await dbClient.query('COMMIT'); // Simpan transaksi permanen
        res.json({ message: 'Data berhasil ditarik dan disimpan ke Database', campaignId });

    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK'); // Batalkan DB jika error
        console.error('[ERROR]', error);
        res.status(500).json({ error: error.message || 'Terjadi kesalahan sistem' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});