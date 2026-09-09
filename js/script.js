// ==========================================
// 彼岸仍是人間 - 小說閱讀器
// ==========================================

const SUPABASE_URL = 'https://bsydtjjeixvvhfdpiwhk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0xtZoK5DTsAe-gBbCQv17Q_XHiClnpq';
let db = null;
try { db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } catch(e) {}

let t2s = null;
try { if (window.OpenCC) t2s = OpenCC.Converter({ from: 'tw', to: 'cn' }); } catch(e) {}

const FONT_SIZES = [18, 20, 22, 24];
let currentChapterId = 1;
let markdownCache = new Map();
let settings = { fontSizeIdx: 0, fontFamily: 'sans', language: 'tw', mode: 'page' };
let currentUser = null;
let syncTimer = null;
let isFlipping = false;

const $ = id => document.getElementById(id);
const contentEl   = $('reader-content');
const titleEl     = $('topbar-title');
const chapterList = $('chapter-list');
const drawer      = $('drawer-menu');
const loginModal  = $('login-modal');
const userModal   = $('user-modal');
const overlay     = $('overlay');
const syncStatus  = $('display-sync-status');
const btnLang     = $('btn-lang');
const btnFont     = $('btn-font');
const btnPage     = $('btn-page');
const btnFontsize = $('btn-fontsize');

// ---- 初始化 (保證秒開，絕對不卡載入) ----
async function init() {
    titleEl.textContent = CONFIG.novelTitle;
    loadSettings(); 
    applySettings(); 
    bindEvents();
    
    // 預設讀者暱稱，絕不強制彈出登入框卡死閱讀
    currentUser = localStorage.getItem('reader_name') || '讀者';
    $('display-username').textContent = currentUser;
    
    // 確保當前章節有效
    if (!CONFIG.chapters.find(c => c.id === currentChapterId)) {
        currentChapterId = CONFIG.chapters[0].id;
    }
    
    renderChapterList();
    
    // 第一時間立即載入本地章節，渲染小說正文
    await loadChapter(currentChapterId);
    
    // 若使用者曾輸入過自訂暱稱，於背景靜默同步進度
    if (localStorage.getItem('reader_name')) {
        pullCloud().then(() => {
            const cloudId = parseInt(localStorage.getItem('last_chapter_id'));
            if (cloudId && cloudId !== currentChapterId) {
                loadChapter(cloudId);
            }
        }).catch(() => {});
    }
}

function convert(text) { return (settings.language === 'cn' && t2s) ? t2s(text) : text; }

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

// ---- 載入章節正文 ----
async function loadChapter(id) {
    const ch = CONFIG.chapters.find(c => c.id === id);
    if (!ch) return;
    
    currentChapterId = id;
    contentEl.style.visibility = 'visible';
    contentEl.innerHTML = '<div class="loading-state">' + convert('章節載入中...') + '</div>';
    
    try {
        let md = markdownCache.get(id);
        if (!md) {
            const res = await fetch(ch.file);
            if (!res.ok) throw new Error('HTTP ' + res.status);
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
        console.error(e);
        contentEl.innerHTML = '<div class="error">' + 
            convert('無法載入章節內容。') + '<br><small style="color:#888;">' + e.message + '</small>' +
            '<br><button class="btn" onclick="loadChapter(' + id + ')" style="margin-top:15px;">' + convert('重新嘗試') + '</button></div>'; 
    }
}

function loadSettings() {
    try { const s = JSON.parse(localStorage.getItem('reader_settings')); if(s) settings = {...settings, ...s}; } catch(e){}
    const sid = localStorage.getItem('last_chapter_id'); 
    if (sid && !isNaN(parseInt(sid))) {
        currentChapterId = parseInt(sid);
    }
}
function saveSettings() { localStorage.setItem('reader_settings', JSON.stringify(settings)); }

function applySettings() {
    const fs = FONT_SIZES[settings.fontSizeIdx] || 18;
    document.documentElement.style.setProperty('--reader-font-size', fs + 'px');
    document.body.className = 'theme-sepia font-' + settings.fontFamily + ' ' + settings.mode + '-mode';
    btnLang.textContent = settings.language === 'tw' ? '繁' : '簡'; btnLang.classList.toggle('active', settings.language === 'cn');
    btnFont.textContent = settings.fontFamily === 'sans' ? '黑' : '明'; btnFont.classList.toggle('active', settings.fontFamily === 'serif');
    btnPage.textContent = settings.mode === 'scroll' ? '滾' : '書'; btnPage.classList.toggle('active', settings.mode === 'page');
    btnFontsize.textContent = 'Aa ' + fs; btnFontsize.classList.toggle('active', settings.fontSizeIdx > 0);
    saveSettings();
}

function getProgress() {
    if (settings.mode === 'scroll') {
        const h = document.documentElement.scrollHeight - document.documentElement.clientHeight;
        return h > 0 ? ((document.documentElement.scrollTop || document.body.scrollTop) / h * 100) : 0;
    }
    const w = contentEl.scrollWidth - contentEl.clientWidth;
    return w > 0 ? (contentEl.scrollLeft / w * 100) : 0;
}
function updateProgress() { $('progress-bar').style.width = getProgress() + '%'; }

// ---- 真正的 3D 翻頁物理引擎 (像素級切片定位，絕不串頁) ----
function turnPage(direction) {
    if (settings.mode !== 'page' || isFlipping) return;
    const container = $('reader-container');
    const bookWidth = container.clientWidth;
    const isMobile = window.innerWidth < 800;
    
    const maxScroll = Math.max(0, contentEl.scrollWidth - bookWidth);
    
    // 如果在章節末尾且按下一頁 -> 進入下一章
    if (direction === 1 && contentEl.scrollLeft >= maxScroll - 8) {
        if (currentChapterId < CONFIG.chapters.length) {
            loadChapter(currentChapterId + 1);
        }
        return;
    }
    // 如果在章節頂部且按上一頁 -> 進入上一章
    if (direction === -1 && contentEl.scrollLeft <= 8) {
        if (currentChapterId > 1) {
            loadChapter(currentChapterId - 1).then(() => {
                setTimeout(() => { contentEl.scrollLeft = contentEl.scrollWidth; }, 80);
            });
        }
        return;
    }

    const currentScroll = contentEl.scrollLeft;
    let targetScroll = currentScroll + (direction * bookWidth);
    targetScroll = Math.max(0, Math.min(maxScroll, Math.round(targetScroll / bookWidth) * bookWidth));

    if (targetScroll === currentScroll) return;

    do3DFlip(direction, currentScroll, targetScroll, isMobile, bookWidth);
}

// 建立無失真像素切片
function createSlice(leftOffset, sliceWidth) {
    const mask = document.createElement('div');
    mask.style.cssText = 'position:relative;width:' + sliceWidth + 'px;height:100%;overflow:hidden;background-color:var(--bg-color);';
    
    const inner = document.createElement('div');
    inner.className = 'slice-wrapper theme-sepia font-' + settings.fontFamily;
    inner.innerHTML = contentEl.innerHTML;
    
    const comp = window.getComputedStyle(contentEl);
    inner.style.width = contentEl.scrollWidth + 'px';
    inner.style.height = contentEl.clientHeight + 'px';
    inner.style.columnWidth = comp.columnWidth;
    inner.style.fontSize = comp.fontSize;
    inner.style.lineHeight = comp.lineHeight;
    inner.style.textAlign = comp.textAlign;
    inner.style.letterSpacing = comp.letterSpacing;
    inner.style.left = (-leftOffset) + 'px';
    
    mask.appendChild(inner);
    return mask;
}

function do3DFlip(direction, currentScroll, targetScroll, isMobile, bookWidth) {
    isFlipping = true;
    const container = $('reader-container');
    
    // 安全定時器：確保 isFlipping 絕對不會被卡死
    const safetyTimer = setTimeout(() => { isFlipping = false; }, 1200);

    const stage = document.createElement('div');
    stage.className = 'flip-stage';

    let leaf = document.createElement('div');
    let frontFace = document.createElement('div');
    frontFace.className = 'leaf-face front';
    let backFace = document.createElement('div');
    backFace.className = 'leaf-face back';

    if (!isMobile) {
        // 電腦版雙頁模式 (書本左右對開)
        const halfWidth = Math.floor(bookWidth / 2);

        // 1. 底層靜止頁面
        const staticLeft = document.createElement('div');
        staticLeft.className = 'static-page left';
        const staticRight = document.createElement('div');
        staticRight.className = 'static-page right';

        if (direction === 1) { // 向前翻頁 (右頁向左掀起)
            staticLeft.appendChild(createSlice(currentScroll, halfWidth));
            staticRight.appendChild(createSlice(targetScroll + halfWidth, halfWidth));

            leaf.className = 'flipping-leaf turn-next';
            frontFace.appendChild(createSlice(currentScroll + halfWidth, halfWidth));
            backFace.appendChild(createSlice(targetScroll, halfWidth));
        } else { // 向後翻頁 (左頁向右掀回)
            staticLeft.appendChild(createSlice(targetScroll, halfWidth));
            staticRight.appendChild(createSlice(currentScroll + halfWidth, halfWidth));

            leaf.className = 'flipping-leaf turn-prev';
            frontFace.appendChild(createSlice(currentScroll, halfWidth));
            backFace.appendChild(createSlice(targetScroll + halfWidth, halfWidth));
        }

        stage.appendChild(staticLeft);
        stage.appendChild(staticRight);
    } else {
        // 手機版單頁模式
        const staticFull = document.createElement('div');
        staticFull.className = 'static-page full';
        staticFull.appendChild(createSlice(targetScroll, bookWidth));
        stage.appendChild(staticFull);

        leaf.className = 'flipping-leaf ' + (direction === 1 ? 'mobile-next' : 'mobile-prev');
        frontFace.appendChild(createSlice(currentScroll, bookWidth));
        backFace.appendChild(createSlice(targetScroll, bookWidth));
    }

    leaf.appendChild(frontFace);
    leaf.appendChild(backFace);
    stage.appendChild(leaf);
    container.appendChild(stage);

    // 隱藏原始排版容器，展示 3D 舞台
    contentEl.style.visibility = 'hidden';

    // 啟動 3D 旋轉動畫
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            leaf.classList.add('flipped');
            leaf.style.transform = direction === 1 ? 'rotateY(-180deg)' : 'rotateY(180deg)';
        });
    });

    // 動畫結束，無縫落頁
    setTimeout(() => {
        contentEl.scrollLeft = targetScroll;
        contentEl.style.visibility = 'visible';
        stage.remove();
        isFlipping = false;
        clearTimeout(safetyTimer);
        updateProgress(); 
        schedulePush();
    }, 560);
}

// ---- Supabase 雲端進度同步 ----
async function pullCloud() {
    if (!db || !currentUser || currentUser === '讀者') return;
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
    if (!db || !currentUser || currentUser === '讀者') return;
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

// ---- 事件監聽 ----
function bindEvents() {
    // 登入彈窗
    $('btn-login').onclick = async () => {
        const name = $('input-username').value.trim(); 
        if (!name) return;
        currentUser = name; 
        localStorage.setItem('reader_name', name); 
        $('display-username').textContent = name;
        closeAll(); 
        pullCloud();
    };
    $('btn-logout').onclick = () => { 
        localStorage.removeItem('reader_name'); 
        currentUser = '讀者';
        $('display-username').textContent = '讀者';
        closeAll();
    };

    // 目錄與使用者彈窗
    $('btn-menu').onclick = () => showModal(drawer);
    $('btn-user').onclick = () => showModal(userModal);
    $('btn-close-menu').onclick = closeAll; 
    $('btn-close-user').onclick = closeAll; 
    overlay.onclick = closeAll;
    
    // 傳統按鈕
    $('btn-prev-chap').onclick = () => { if (currentChapterId > 1) loadChapter(currentChapterId - 1); };
    $('btn-next-chap').onclick = () => { if (currentChapterId < CONFIG.chapters.length) loadChapter(currentChapterId + 1); };

    // 工具列
    btnFontsize.onclick = () => { settings.fontSizeIdx = (settings.fontSizeIdx + 1) % FONT_SIZES.length; applySettings(); };
    btnLang.onclick = () => { settings.language = (settings.language === 'tw') ? 'cn' : 'tw'; applySettings(); loadChapter(currentChapterId); };
    btnFont.onclick = () => { settings.fontFamily = (settings.fontFamily === 'sans') ? 'serif' : 'sans'; applySettings(); };
    btnPage.onclick = () => { settings.mode = (settings.mode === 'scroll') ? 'page' : 'scroll'; applySettings(); };

    // 全螢幕點擊翻頁（左 50% 上一頁，右 50% 下一頁）
    $('zone-left').onclick = () => turnPage(-1); 
    $('zone-right').onclick = () => turnPage(1);

    // 鍵盤導引翻頁
    document.addEventListener('keydown', (e) => {
        if (settings.mode !== 'page') return;
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { 
            e.preventDefault(); 
            turnPage(1); 
        }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { 
            e.preventDefault(); 
            turnPage(-1); 
        }
    });

    // 觸控滑動翻頁 (Touch Swipe)
    let touchStartX = 0;
    let touchStartY = 0;
    document.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });
    document.addEventListener('touchend', (e) => {
        if (settings.mode !== 'page') return;
        const diffX = e.changedTouches[0].screenX - touchStartX;
        const diffY = e.changedTouches[0].screenY - touchStartY;
        // 橫向滑動距離大於 50px 且橫向位移大於縱向位移
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX < 0) turnPage(1);
            else turnPage(-1);
        }
    }, { passive: true });

    window.addEventListener('scroll', () => { updateProgress(); schedulePush(); });
    contentEl.addEventListener('scroll', () => { updateProgress(); schedulePush(); });
}

function showModal(el) { 
    closeAll(); 
    if (el.id === 'drawer-menu') el.classList.add('open'); 
    else el.classList.add('show'); 
    overlay.classList.add('show'); 
}
function closeAll() { 
    drawer.classList.remove('open'); 
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('show')); 
    overlay.classList.remove('show'); 
}

init();