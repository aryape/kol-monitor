// ==========================================================================
// STATE
// ==========================================================================
const state = {
  period: 'monthly',
  campaigns: [],           // hasil terakhir dari /api/campaigns (sesuai period aktif)
  itemsPerPage: 10,
  itemsPerPageDetail: 10,
  activeCampaignId: null,  // campaign yang sedang dibuka (detail / input)
  activeCampaign: null,
};

// ==========================================================================
// HELPERS
// ==========================================================================
const formatNumber = (num) => {
  const n = Number(num) || 0;
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
};

const formatRupiah = (num) => {
  if (num === null || num === undefined) return '–';
  return 'Rp' + Math.round(Number(num)).toLocaleString('id-ID');
};

const formatRupiahJuta = (num) => {
  const n = Number(num) || 0;
  if (n >= 1_000_000) return 'Rp' + Math.round(n / 1_000_000) + ' Jt';
  return formatRupiah(n);
};

const parseRupiahInput = (raw) => {
  // menerima "Rp1.000.000" atau "1000000" -> angka
  const digits = String(raw).replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : NaN;
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request gagal (${res.status})`);
  return data;
}

function exportTableToExcel(tableEl, filenamePrefix) {
  if (!tableEl || !tableEl.rows || tableEl.rows.length <= 1) {
    alert('Tidak ada data valid untuk dieksport.');
    return;
  }
  const wb = XLSX.utils.table_to_book(tableEl, { sheet: 'Performa' });
  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `${filenamePrefix}_${dateStr}.xlsx`);
}

// ==========================================================================
// VIEW ROUTING
// ==========================================================================
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');
}

function setSidebarActive(navKey) {
  document.querySelectorAll('.nav-item[data-nav]').forEach(el => {
    el.classList.toggle('active', el.dataset.nav === navKey);
  });
}

// ==========================================================================
// HOMESCREEN
// ==========================================================================
async function loadHomescreen() {
  const tbody = document.getElementById('campaign-tbody');
  tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Memuat data campaign...</td></tr>`;
  try {
    const data = await api(`/api/campaigns?period=${state.period}`);
    state.campaigns = data;
    renderCampaignTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Gagal memuat data: ${err.message}</td></tr>`;
  }

  loadTopAccounts();
  loadTopContent();
}

function renderCampaignTable() {
  const tbody = document.getElementById('campaign-tbody');
  const rows = state.campaigns.slice(0, state.itemsPerPage);

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Belum ada campaign. Tekan tombol "+" untuk menambah campaign pertamamu.</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(c => {
    const hasData = c.status === 'active' && Number(c.post_count) > 0;
    const dash = '<span class="dash">–</span>';
    return `
      <tr class="${hasData ? '' : 'row-draft'}">
        <td>
          <button class="campaign-row-name" data-id="${c.id}">${escapeHtml(c.campaign_name)} <span>›</span></button>
        </td>
        <td>${hasData ? formatNumber(c.total_views) : dash}</td>
        <td>${hasData ? formatNumber(c.total_likes) : dash}</td>
        <td>${hasData ? formatNumber(c.total_comments) : dash}</td>
        <td>${hasData ? formatNumber(c.total_saves) : dash}</td>
        <td>${hasData ? formatNumber(c.total_shares) : dash}</td>
        <td>${hasData && c.avg_cost_per_view !== null ? formatRupiah(c.avg_cost_per_view) : dash}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.campaign-row-name').forEach(btn => {
    btn.addEventListener('click', () => onCampaignRowClick(parseInt(btn.dataset.id)));
  });
}

function onCampaignRowClick(campaignId) {
  const campaign = state.campaigns.find(c => c.id === campaignId);
  if (!campaign) return;
  const hasData = campaign.status === 'active' && Number(campaign.post_count) > 0;
  if (hasData) {
    openDetail(campaignId);
  } else {
    openInput(campaignId, campaign);
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, s => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[s]));
}

async function loadTopAccounts() {
  const container = document.getElementById('top-account-list');
  try {
    const data = await api('/api/top-accounts?limit=5');
    if (data.length === 0) {
      container.innerHTML = `<div class="empty-cell">Belum ada data akun. Analisa postingan pertama untuk melihat top account.</div>`;
      return;
    }
    container.innerHTML = data.map(a => `
      <div class="list-row">
        <div class="list-avatar"></div>
        <div class="list-info">
          <div class="title">${escapeHtml(a.author || 'Unknown')}</div>
        </div>
        <div class="list-metric">
          <div class="value">${formatRupiahJuta(a.total_gmv)}</div>
          <div class="badge">ER ${a.engagement_rate}%</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-cell">Gagal memuat: ${err.message}</div>`;
  }
}

async function loadTopContent() {
  const container = document.getElementById('top-content-list');
  try {
    const data = await api('/api/top-content?limit=5');
    if (data.length === 0) {
      container.innerHTML = `<div class="empty-cell">Belum ada data konten. Analisa postingan pertama untuk melihat top content.</div>`;
      return;
    }
    container.innerHTML = data.map(c => `
      <div class="list-row">
        <div class="list-avatar"></div>
        <div class="list-info">
          <div class="title">${escapeHtml(c.post_title || 'Tanpa judul')}</div>
          <div class="subtitle">${escapeHtml(c.author || 'Unknown')}</div>
        </div>
        <div class="list-metric">
          <div class="value">${formatNumber(c.views)}</div>
          <div class="badge">Likes: ${formatNumber(c.likes)}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="empty-cell">Gagal memuat: ${err.message}</div>`;
  }
}

// ==========================================================================
// DETAIL POSTINGAN CAMPAIGN
// ==========================================================================
async function openDetail(campaignId) {
  state.activeCampaignId = campaignId;
  switchView('view-detail');
  const tbody = document.getElementById('detail-tbody');
  tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Memuat data postingan...</td></tr>`;
  document.getElementById('detail-campaign-label').textContent = 'Memuat...';

  try {
    const { campaign, posts } = await api(`/api/campaigns/${campaignId}`);
    state.activeCampaign = campaign;
    document.getElementById('detail-campaign-label').textContent =
      `${campaign.campaign_name} - ${campaign.product_name || 'Tanpa produk'}`;

    if (posts.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Belum ada postingan pada campaign ini.</td></tr>`;
      return;
    }

    tbody.innerHTML = posts.map(p => `
      <tr>
        <td>${escapeHtml(p.author || 'Unknown')}</td>
        <td>${formatNumber(p.views)}</td>
        <td>${formatNumber(p.likes)}</td>
        <td>${formatNumber(p.comments)}</td>
        <td>${formatNumber(p.saves)}</td>
        <td>${formatNumber(p.shares)}</td>
        <td>${formatRupiah(p.cpv)}</td>
      </tr>
    `).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-cell">Gagal memuat detail: ${err.message}</td></tr>`;
  }
}

async function handleDeleteCampaign() {
  if (!state.activeCampaignId) return;
  const ok = confirm('Hapus campaign ini beserta seluruh data postingannya? Tindakan ini tidak bisa dibatalkan.');
  if (!ok) return;
  try {
    await api(`/api/campaigns/${state.activeCampaignId}`, { method: 'DELETE' });
    switchView('view-homescreen');
    setSidebarActive('overview');
    loadHomescreen();
  } catch (err) {
    alert(`Gagal menghapus campaign: ${err.message}`);
  }
}

// ==========================================================================
// INPUT DATA
// ==========================================================================
function openInput(campaignId, campaignHint) {
  state.activeCampaignId = campaignId;
  state.activeCampaign = campaignHint || null;
  switchView('view-input');
  document.getElementById('input-campaign-name').textContent = campaignHint ? campaignHint.campaign_name : 'Campaign';
  resetInputForm();
}

function resetInputForm() {
  document.getElementById('url-inputs').value = '';
  document.getElementById('budget-input').value = '';
  document.getElementById('input-result-card').style.display = 'none';
  document.getElementById('input-result-tbody').innerHTML = '';
  setInputLoading(false);
}

function setInputLoading(isLoading) {
  document.getElementById('loading-dots').style.display = isLoading ? 'flex' : 'none';
  document.getElementById('loading-caption').style.display = isLoading ? 'block' : 'none';
  document.getElementById('url-inputs').disabled = isLoading;
  document.getElementById('budget-input').disabled = isLoading;
  const btn = document.getElementById('btn-analisa');
  btn.disabled = isLoading;
  btn.textContent = isLoading ? 'Menganalisis...' : 'Analisa Postingan';
}

async function handleAnalyze() {
  const urlsRaw = document.getElementById('url-inputs').value.trim();
  const budget = parseRupiahInput(document.getElementById('budget-input').value);

  if (!urlsRaw) return alert('Url postingan wajib diisi.');
  if (!budget || isNaN(budget)) return alert('Budget campaign wajib diisi dengan angka yang benar.');

  const urls = urlsRaw.split(',').map(u => u.trim()).filter(Boolean);

  setInputLoading(true);
  try {
    const result = await api(`/api/campaigns/${state.activeCampaignId}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ budget, urls }),
    });

    renderInputResult(result.posts);
    // refresh data homescreen di background supaya update saat kembali
    loadHomescreen();
  } catch (err) {
    alert(`Gagal menganalisa postingan: ${err.message}`);
  } finally {
    setInputLoading(false);
  }
}

function renderInputResult(posts) {
  const card = document.getElementById('input-result-card');
  const tbody = document.getElementById('input-result-tbody');
  card.style.display = 'block';
  tbody.innerHTML = posts.map(p => `
    <tr>
      <td>${escapeHtml(p.author || 'Unknown')}</td>
      <td>${formatNumber(p.views)}</td>
      <td>${formatNumber(p.likes)}</td>
      <td>${formatNumber(p.comments)}</td>
      <td>${formatNumber(p.saves)}</td>
      <td>${formatNumber(p.shares)}</td>
      <td>${formatRupiah(p.cpv)}</td>
    </tr>
  `).join('');
}

// ==========================================================================
// ADD CAMPAIGN MODAL
// ==========================================================================
function toggleAddCampaignModal(show) {
  document.getElementById('modal-add-campaign').classList.toggle('active', show);
  if (show) {
    document.getElementById('new-campaign-name').value = '';
    document.getElementById('new-product-name').value = '';
  }
}

async function handleSubmitCampaign() {
  const campaignName = document.getElementById('new-campaign-name').value.trim();
  const productName = document.getElementById('new-product-name').value.trim();
  if (!campaignName) return alert('Nama Campaign wajib diisi.');
  if (!productName) return alert('Produk wajib diisi.');

  try {
    await api('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify({ campaignName, productName, platform: 'tiktok' }),
    });
    toggleAddCampaignModal(false);
    loadHomescreen();
  } catch (err) {
    alert(`Gagal membuat campaign: ${err.message}`);
  }
}

// ==========================================================================
// SIDEBAR "INPUT DATA" -> pilih campaign draft
// ==========================================================================
function togglePickCampaignModal(show) {
  document.getElementById('modal-pick-campaign').classList.toggle('active', show);
}

async function handleSidebarInputData() {
  try {
    const data = await api(`/api/campaigns?period=${state.period}`);
    const drafts = data.filter(c => c.status === 'draft' || Number(c.post_count) === 0);

    if (drafts.length === 0) {
      toggleAddCampaignModal(true);
      return;
    }
    if (drafts.length === 1) {
      setSidebarActive('input');
      openInput(drafts[0].id, drafts[0]);
      return;
    }

    const listEl = document.getElementById('pick-campaign-list');
    listEl.innerHTML = drafts.map(c => `
      <button class="pick-item" data-id="${c.id}">${escapeHtml(c.campaign_name)} — ${escapeHtml(c.product_name || '')}</button>
    `).join('');
    listEl.querySelectorAll('.pick-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = drafts.find(d => d.id === parseInt(btn.dataset.id));
        togglePickCampaignModal(false);
        setSidebarActive('input');
        openInput(c.id, c);
      });
    });
    togglePickCampaignModal(true);
  } catch (err) {
    alert(`Gagal memuat daftar campaign: ${err.message}`);
  }
}

// ==========================================================================
// EVENT BINDINGS
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  loadHomescreen();

  // Period toggle (Monthly / Weekly)
  document.querySelectorAll('#period-toggle .segmented-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#period-toggle .segmented-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.period = btn.dataset.period;
      loadHomescreen();
    });
  });

  // Items per page
  document.getElementById('items-per-page').addEventListener('change', (e) => {
    state.itemsPerPage = parseInt(e.target.value);
    renderCampaignTable();
  });

  // + Add campaign
  document.getElementById('btn-open-add-campaign').addEventListener('click', () => toggleAddCampaignModal(true));
  document.getElementById('btn-cancel-campaign').addEventListener('click', () => toggleAddCampaignModal(false));
  document.getElementById('btn-submit-campaign').addEventListener('click', handleSubmitCampaign);

  // Pick draft campaign modal
  document.getElementById('btn-cancel-pick').addEventListener('click', () => togglePickCampaignModal(false));

  // Export
  document.getElementById('btn-export-home').addEventListener('click', () => {
    exportTableToExcel(document.querySelector('#view-homescreen .perf-table'), 'Performa_Campaign');
  });
  document.getElementById('btn-export-detail').addEventListener('click', () => {
    exportTableToExcel(document.querySelector('#view-detail .perf-table'), 'Detail_Campaign');
  });

  // Detail view
  document.getElementById('btn-delete-campaign').addEventListener('click', handleDeleteCampaign);
  document.getElementById('btn-add-more-posts').addEventListener('click', () => {
    openInput(state.activeCampaignId, state.activeCampaign);
  });
  document.getElementById('btn-back-from-detail').addEventListener('click', () => {
    switchView('view-homescreen');
    setSidebarActive('overview');
    loadHomescreen();
  });

  // Input view
  document.getElementById('btn-analisa').addEventListener('click', handleAnalyze);
  document.getElementById('btn-back-from-input').addEventListener('click', () => {
    switchView('view-homescreen');
    setSidebarActive('overview');
    loadHomescreen();
  });

  // Sidebar navigation
  document.querySelector('.nav-item[data-nav="overview"]').addEventListener('click', () => {
    setSidebarActive('overview');
    switchView('view-homescreen');
    loadHomescreen();
  });
  document.querySelector('.nav-item[data-nav="input"]').addEventListener('click', handleSidebarInputData);
});