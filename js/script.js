// ==========================================
// 彼岸仍是人間 - 小說閱讀器
// ==========================================

const SUPABASE_URL = 'https://bsydtjjeixvvhfdpiwhk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0xtZoK5DTsAe-gBbCQv17Q_XHiClnpq';
let db = null;
try { db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } catch(e) {}

// 繁簡轉換器
let t2s = null;
try { if (window.OpenCC) t2s = OpenCC.Converter({ from: 'tw', to: 'cn' }); } catch(e) {}

// 字體大小循環：18 → 20 → 22 → 24 → 回到 18
const FONT_SIZES = [18, 20, 22, 24];

// 狀態
let currentChapterId = 1;
let markdownCache = new Map();
let settings = { fontSizeIdx: 0, fontFamily: 'sans', language: 'tw', mode: 'scroll' };
let currentUser = null;
let syncTimer = null;

// DOM
const $ = id => document.getElementById(id);
const contentEl   = $('reader-content');
const titleEl     = $('topbar-title');
const chapterList = $('chapter-list');
const drawer      = $('drawer-menu');
const loginModal  = $('login-modal');
const userModal   = $('user-modal');
const overlay     = $('overlay');
const syncStatus  = $('display-sync-status');

// 工具列按鈕
const btnLang     = $('btn-lang');
const btnFont     = $('btn-font');
const btnPage     = $('btn-page');
const btnFontsize = $('btn-fontsize');

// ---- 初始化 ----
async function init() {
    titleEl.textContent = CONFIG.novelTitle;
    loadSettings();
    applySettings();
    bindEvents();

    currentUser = localStorage.getItem('reader_name');
    if (!currentUser) {
        showModal(loginModal);
    } else {
        $('display-username').textContent = currentUser;
        await pullCloud();
        renderChapterList();
        await loadChapter(currentChapterId);
    }
}

// ---- 繁簡 ----
function convert(text) {
    return (settings.language === 'cn' && t2s) ? t2s(text) : text;
}

// ---- 目錄 ----
function renderChapterList() {
    chapterList.innerHTML = '';
    CONFIG.chapters.forEach(ch => {
        const d = document.createElement('div');
        d.className = 'chapter-item' + (ch.id === currentChapterId ? ' active' : '');
        d.textContent = convert(ch.title);
        d.onclick = () => { loadChapter(ch.id); closeAll(); };
        chapterList.appendChild(d);
    });
}

// ---- 載入章節 ----
async function loadChapter(id) {
    const ch = CONFIG.chapters.find(c => c.id === id);
    if (!ch) return;
    currentChapterId = id;
    contentEl.innerHTML = '<div class="loading-state">' + convert('載入中...') + '</div>';
    try {
        let md = markdownCache.get(id);
        if (!md) {
            const res = await fetch(ch.file);
            if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
            md = await res.text();
            markdownCache.set(id, md);
        }
        contentEl.innerHTML = marked.parse(convert(md));
        window.scrollTo(0, 0);
        contentEl.scrollLeft = 0;
        localStorage.setItem('last_chapter_id', id);
        renderChapterList();
        updateProgress();
        schedulePush();
    } catch (e) {
        contentEl.innerHTML = '<div class="error">' + convert('載入失敗：') + e.message + '</div>';
    }
}

// ---- 設定 ----
function loadSettings() {
    try { const s = JSON.parse(localStorage.getItem('reader_settings')); if(s) settings = {...settings, ...s}; } catch(e){}
    const sid = localStorage.getItem('last_chapter_id');
    if (sid) currentChapterId = parseInt(sid);
}
function saveSettings() { localStorage.setItem('reader_settings', JSON.stringify(settings)); }

function applySettings() {
    // 字體大小
    const fs = FONT_SIZES[settings.fontSizeIdx] || 18;
    document.documentElement.style.setProperty('--reader-font-size', fs + 'px');

    // body class
    document.body.className = 'theme-sepia font-' + settings.fontFamily + ' ' + settings.mode + '-mode';

    // 更新按鈕文字
    btnLang.textContent = settings.language === 'tw' ? '繁' : '簡';
    btnLang.classList.toggle('active', settings.language === 'cn');

    btnFont.textContent = settings.fontFamily === 'sans' ? '黑' : '明';
    btnFont.classList.toggle('active', settings.fontFamily === 'serif');

    btnPage.textContent = settings.mode === 'scroll' ? '滾' : '翻';
    btnPage.classList.toggle('active', settings.mode === 'page');

    // Aa 加上數字
    btnFontsize.textContent = 'Aa ' + fs;
    btnFontsize.classList.toggle('active', settings.fontSizeIdx > 0);

    saveSettings();
}

// ---- 進度 ----
function getProgress() {
    if (settings.mode === 'scroll') {
        const h = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        return h > 0 ? ((document.documentElement.scrollTop || document.body.scrollTop) / h * 100) : 0;
    }
    const w = contentEl.scrollWidth - contentEl.clientWidth;
    return w > 0 ? (contentEl.scrollLeft / w * 100) : 0;
}
function updateProgress() { $('progress-bar').style.width = getProgress() + '%'; }

// ---- 翻頁邏輯 ----
function turnPage(direction) {
    if (settings.mode !== 'page') return;
    const scrollAmount = window.innerWidth;
    
    // 如果是下一頁，且已經到底部，則切換到下一章
    if (direction === 1) {
        const maxScroll = contentEl.scrollWidth - contentEl.clientWidth;
        if (contentEl.scrollLeft >= maxScroll - 10) {
            if (currentChapterId < CONFIG.chapters.length) loadChapter(currentChapterId + 1);
            return;
        }
    }
    // 如果是上一頁，且已經在頂部，則切換到上一章
    if (direction === -1) {
        if (contentEl.scrollLeft <= 0) {
            if (currentChapterId > 1) {
                loadChapter(currentChapterId - 1).then(() => {
                    setTimeout(() => { contentEl.scrollLeft = contentEl.scrollWidth; }, 50);
                });
            }
            return;
        }
    }

    const currentScroll = contentEl.scrollLeft;
    let targetScroll = currentScroll + (direction * scrollAmount);
    
    // 強制對齊到視窗寬度，避免 CSS scroll-snap 算錯
    targetScroll = Math.round(targetScroll / scrollAmount) * scrollAmount;
    contentEl.scrollTo({ left: targetScroll, behavior: 'smooth' });
}

// ---- Supabase ----
async function pullCloud() {
    if (!db || !currentUser) return;
    syncStatus.textContent = '↻ 同步中...';
    try {
        const { data } = await db.from('reading_progress')
            .select('chapter_id, progress, updated_at')
            .eq('reader_name', currentUser).single();
        if (data) {
            const local = parseInt(localStorage.getItem('last_sync_time') || '0');
            const cloud = new Date(data.updated_at).getTime();
            if (cloud > local) {
                currentChapterId = data.chapter_id;
                localStorage.setItem('last_chapter_id', currentChapterId);
                localStorage.setItem('last_sync_time', cloud);
            }
        }
        syncStatus.textContent = '✓ 已同步';
    } catch(e) { syncStatus.textContent = '⚠ 離線模式'; }
}
function schedulePush() {
    if (!db || !currentUser) return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
        try {
            await db.from('reading_progress').upsert({
                reader_name: currentUser, chapter_id: currentChapterId,
                progress: getProgress(), updated_at: new Date().toISOString()
            }, { onConflict: 'reader_name' });
            localStorage.setItem('last_sync_time', Date.now());
            syncStatus.textContent = '✓ 已同步';
        } catch(e) { syncStatus.textContent = '⚠ 同步失敗'; }
    }, 5000);
}

// ---- 事件 ----
function bindEvents() {
    // 登入
    $('btn-login').onclick = async () => {
        const name = $('input-username').value.trim();
        if (!name) return;
        currentUser = name;
        localStorage.setItem('reader_name', name);
        $('display-username').textContent = name;
        closeAll();
        await pullCloud();
        renderChapterList();
        await loadChapter(currentChapterId);
    };
    $('btn-logout').onclick = () => { localStorage.removeItem('reader_name'); location.reload(); };

    // 面板
    $('btn-menu').onclick = () => showModal(drawer);
    $('btn-user').onclick = () => showModal(userModal);
    $('btn-close-menu').onclick = closeAll;
    $('btn-close-user').onclick = closeAll;
    overlay.onclick = closeAll;

    // 章節
    $('btn-prev-chap').onclick = () => { if (currentChapterId > 1) loadChapter(currentChapterId - 1); };
    $('btn-next-chap').onclick = () => { if (currentChapterId < CONFIG.chapters.length) loadChapter(currentChapterId + 1); };

    // 工具列按鈕
    btnFontsize.onclick = () => { settings.fontSizeIdx = (settings.fontSizeIdx + 1) % FONT_SIZES.length; applySettings(); };
    btnLang.onclick = () => { settings.language = (settings.language === 'tw') ? 'cn' : 'tw'; applySettings(); loadChapter(currentChapterId); };
    btnFont.onclick = () => { settings.fontFamily = (settings.fontFamily === 'sans') ? 'serif' : 'sans'; applySettings(); };
    btnPage.onclick = () => { settings.mode = (settings.mode === 'scroll') ? 'page' : 'scroll'; applySettings(); };

    // 翻頁點擊區
    $('zone-left').onclick = () => turnPage(-1);
    $('zone-right').onclick = () => turnPage(1);

    // 鍵盤
    document.addEventListener('keydown', (e) => {
        if (settings.mode !== 'page') return;
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); turnPage(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); turnPage(-1); }
    });

    // 滾動
    window.addEventListener('scroll', () => { updateProgress(); schedulePush(); });
    contentEl.addEventListener('scroll', () => { updateProgress(); schedulePush(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) schedulePush(); });
}

// ---- UI ----
function showModal(el) {
    closeAll();
    if (el.id === 'drawer-menu') el.classList.add('open');
    else el.classList.add('show');
    overlay.classList.add('show');
}
function closeAll() {
    drawer.classList.remove('open');
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('show'));
    if (!currentUser) return;
    overlay.classList.remove('show');
}

init();