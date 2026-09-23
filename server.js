require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const { ApifyClient } = require('apify-client');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------------
// 1. Koneksi Database (Supabase Postgres)
// ------------------------------------------------------------------
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Wajib untuk Supabase / cloud DB kebanyakan
});

// ------------------------------------------------------------------
// 2. Inisialisasi Apify (dipakai untuk scraping metrik postingan)
// ------------------------------------------------------------------
const apify = new ApifyClient({
    token: process.env.APIFY_TOKEN,
});

// Actor id per platform. Ganti sesuai actor Apify yang kamu pakai.
const APIFY_ACTORS = {
    tiktok: process.env.APIFY_ACTOR_TIKTOK || 'GdWCkxBtKWOsKjdch',
    instagram: process.env.APIFY_ACTOR_INSTAGRAM || 'apify/instagram-post-scraper',
};

// Helper: tentukan awal periode (bulan berjalan / minggu berjalan - Senin s.d sekarang)
function getPeriodStart(period) {
    const now = new Date();
    if (period === 'weekly') {
        const day = (now.getDay() + 6) % 7; // Senin = 0
        const monday = new Date(now);
        monday.setDate(now.getDate() - day);
        monday.setHours(0, 0, 0, 0);
        return monday;
    }
    // default: monthly
    return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

// ------------------------------------------------------------------
// 3. ENDPOINT: List campaign + agregasi metrik (Homescreen)
//    ?period=monthly|weekly (default monthly)
// ------------------------------------------------------------------
app.get('/api/campaigns', async (req, res) => {
    try {
        const { start, end } = req.query;
        
        // Amankan dan format tanggal (end date diset ke 23:59:59 agar mencakup seluruh hari terakhir)
        const startDate = start ? new Date(start) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        const endDate = end ? new Date(end) : new Date();
        endDate.setHours(23, 59, 59, 999);

        const query = `
            SELECT
                c.id,
                c.campaign_name,
                c.product_name,
                c.platform,
                c.status,
                c.total_budget,
                c.created_at,
                COALESCE(SUM(p.views), 0)::bigint    AS total_views,
                COALESCE(SUM(p.likes), 0)::bigint     AS total_likes,
                COALESCE(SUM(p.comments), 0)::bigint  AS total_comments,
                COALESCE(SUM(p.saves), 0)::bigint     AS total_saves,
                COALESCE(SUM(p.shares), 0)::bigint    AS total_shares,
                COUNT(p.id)::int                      AS post_count
            FROM campaigns c
            LEFT JOIN campaign_posts p 
                ON c.id = p.campaign_id 
                -- Terapkan batas bawah dan batas atas
                AND COALESCE(p.created_at, c.created_at) >= $1 
                AND COALESCE(p.created_at, c.created_at) <= $2
            -- Hanya tampilkan campaign yang relevan di rentang waktu tersebut
            WHERE (c.created_at >= $1 AND c.created_at <= $2) OR p.id IS NOT NULL
            GROUP BY c.id
            ORDER BY c.created_at DESC;
        `;
        const result = await pool.query(query, [startDate.toISOString(), endDate.toISOString()]);

        const rows = result.rows.map(r => {
            const totalViews = Number(r.total_views);
            const avgCostPerView = totalViews > 0 ? Number(r.total_budget) / totalViews : null;
            return { ...r, avg_cost_per_view: avgCostPerView };
        });

        res.json(rows);
    } catch (error) {
        console.error('DB Error [GET /api/campaigns]:', error);
        res.status(500).json({ error: 'Gagal mengambil data campaign' });
    }
});

// ------------------------------------------------------------------
// 4. ENDPOINT: Detail 1 campaign + list post-nya (Detail Postingan Campaign)
// ------------------------------------------------------------------
app.get('/api/campaigns/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const campaignResult = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
        if (campaignResult.rows.length === 0) {
            return res.status(404).json({ error: 'Campaign tidak ditemukan' });
        }

        const postsResult = await pool.query(
            `SELECT * FROM campaign_posts WHERE campaign_id = $1 ORDER BY scraped_at DESC`,
            [id]
        );

        res.json({ campaign: campaignResult.rows[0], posts: postsResult.rows });
    } catch (error) {
        console.error('DB Error [GET /api/campaigns/:id]:', error);
        res.status(500).json({ error: 'Gagal mengambil detail campaign' });
    }
});

// ------------------------------------------------------------------
// 5. ENDPOINT: Buat group campaign baru (Add Campaign Overlay)
//    Campaign dibuat dulu sebagai "pool" kosong (status: draft),
//    baru nanti diisi post lewat /analyze-and-save
// ------------------------------------------------------------------
app.post('/api/campaigns', async (req, res) => {
    try {
        const { campaignName, productName, platform } = req.body;
        if (!campaignName) {
            return res.status(400).json({ error: 'Nama Campaign wajib diisi' });
        }

        const result = await pool.query(
            `INSERT INTO campaigns (campaign_name, product_name, platform, status, total_budget)
             VALUES ($1, $2, $3, 'draft', 0) RETURNING *`,
            [campaignName, productName || null, platform || 'tiktok']
        );

        res.json(result.rows[0]);
    } catch (error) {
        console.error('DB Error [POST /api/campaigns]:', error);
        res.status(500).json({ error: 'Gagal membuat campaign' });
    }
});

// ------------------------------------------------------------------
// 6. ENDPOINT: Hapus campaign (tombol Delete Campaign)
// ------------------------------------------------------------------
app.delete('/api/campaigns/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM campaigns WHERE id = $1', [id]);
        res.json({ message: 'Campaign berhasil dihapus' });
    } catch (error) {
        console.error('DB Error [DELETE /api/campaigns/:id]:', error);
        res.status(500).json({ error: 'Gagal menghapus campaign' });
    }
});

app.post('/api/campaign_posts/delete', async (req, res) => {
    try {
        const { postIds } = req.body;
        if (!postIds || postIds.length === 0) return res.json({ message: 'Tidak ada yang dihapus' });
        await pool.query('DELETE FROM campaign_posts WHERE id = ANY($1::int[])', [postIds]);
        res.json({ message: 'Postingan berhasil dihapus' });
    } catch (error) {
        res.status(500).json({ error: 'Gagal menghapus postingan' });
    }
});

// ------------------------------------------------------------------
// 7. ENDPOINT ETL: Scraping Apify & simpan hasil ke campaign (Input Data)
//    Dipanggil oleh tombol "Analisa Postingan"
// ------------------------------------------------------------------
app.post('/api/campaigns/:id/analyze', async (req, res) => {
    const { id } = req.params;
    const { budget, urls } = req.body;

    if (!budget || !urls || urls.length === 0) {
        return res.status(400).json({ error: 'Url postingan dan budget wajib diisi' });
    }

    let dbClient;
    try {
        const campaignResult = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
        if (campaignResult.rows.length === 0) {
            return res.status(404).json({ error: 'Campaign tidak ditemukan' });
        }
        const campaign = campaignResult.rows[0];
        const platform = campaign.platform || 'tiktok';

        console.log(`[LOG] Memulai proses ETL utk Campaign #${id} (${campaign.campaign_name})`);

        // --- EXTRACT (Apify) ---
        const input = {
            postURLs: urls,
            hashtags: [],
            resultsPerPage: urls.length,
            profileScrapeSections: ['videos'],
            profileSorting: 'latest',
        };

        const run = await apify.actor(APIFY_ACTORS[platform] || APIFY_ACTORS.tiktok).call(input);
        const { items } = await apify.dataset(run.defaultDatasetId).listItems();

        if (!items || items.length === 0) {
            throw new Error('Apify tidak menemukan data dari URL yang diberikan.');
        }

        // --- TRANSFORM & LOAD ---
        dbClient = await pool.connect();
        await dbClient.query('BEGIN');

        const budgetPerPost = Number(budget) / items.length;
        const insertedPosts = [];

        for (const data of items) {
            const views = data.playCount || 0;
            const likes = data.diggCount || 0;
            const comments = data.commentCount || 0;
            const shares = data.shareCount || 0;
            const saves = data.collectCount || 0;
            const gmv = data.gmv || 0; 
            const cpv = views > 0 ? budgetPerPost / views : 0;
            const avatar = data['authorMeta.avatar'] || data.authorMeta?.avatar || '';
            const postCreatedAt = data.createTimeISO || new Date().toISOString();

            const inserted = await dbClient.query(
                `INSERT INTO campaign_posts
                    (campaign_id, platform, author, post_url, post_title, views, likes, comments, shares, saves, gmv, cpv, author_avatar, created_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                RETURNING *`,
                [
                    id, 
                    platform, 
                    data.authorMeta?.name || data.ownerUsername || 'Unknown', 
                    data.webVideoUrl || data.url || '', 
                    data.text || data.caption || '', 
                    views, 
                    likes, 
                    comments, 
                    shares, 
                    saves, 
                    gmv, 
                    cpv, 
                    avatar, 
                    postCreatedAt
                ]
            );
            insertedPosts.push(inserted.rows[0]);
        }

        // Update campaign: budget total + status jadi 'active' (sudah ada data)
        await dbClient.query(
            `UPDATE campaigns SET total_budget = total_budget + $1, status = 'active' WHERE id = $2`,
            [budget, id]
        );

        await dbClient.query('COMMIT');

        res.json({
            message: 'Data berhasil ditarik dan disimpan',
            campaignId: id,
            posts: insertedPosts,
        });
    } catch (error) {
        if (dbClient) await dbClient.query('ROLLBACK');
        console.error('[ERROR] /api/campaigns/:id/analyze', error);
        res.status(500).json({ error: error.message || 'Terjadi kesalahan sistem saat scraping' });
    } finally {
        if (dbClient) dbClient.release();
    }
});

// ------------------------------------------------------------------
// 8. ENDPOINT: Top Account (berdasarkan GMV) & Top Content (views + likes)
// ------------------------------------------------------------------
app.get('/api/top-accounts', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const query = `
            SELECT
                author,
                MAX(author_avatar) AS author_avatar,
                SUM(gmv)::numeric AS total_gmv,
                SUM(views)::bigint AS total_views,
                SUM(likes + comments + shares + saves)::bigint AS total_engagement,
                CASE WHEN SUM(views) > 0
                    THEN ROUND(100.0 * SUM(likes + comments + shares + saves) / SUM(views), 1)
                    ELSE 0 END AS engagement_rate
            FROM campaign_posts
            GROUP BY author
            ORDER BY total_gmv DESC, total_views DESC
            LIMIT $1;
        `;
        const result = await pool.query(query, [limit]);
        res.json(result.rows);
    } catch (error) {
        console.error('DB Error [GET /api/top-accounts]:', error);
        res.status(500).json({ error: 'Gagal mengambil top account' });
    }
});

app.get('/api/top-content', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 5;
        const query = `
            SELECT post_title, 
            author, 
            author_avatar, 
            views, 
            likes, 
            post_url
            FROM campaign_posts
            ORDER BY (views + likes) DESC
            LIMIT $1;
        `;
        const result = await pool.query(query, [limit]);
        res.json(result.rows);
    } catch (error) {
        console.error('DB Error [GET /api/top-content]:', error);
        res.status(500).json({ error: 'Gagal mengambil top content' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server berjalan di port ${PORT}`);
});