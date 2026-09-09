// ==========================================
// 彼岸仍是人間 - 小說閱讀器
// 版本：功能修復版 v2.1
// ==========================================

// ---- Supabase 初始化 ----
const SUPABASE_URL = 'https://bsydtjjeixvvhfdpiwhk.supabase.co';
const SUPABASE_KEY = 'sb_publishable_0xtZoK5DTsAe-gBbCQv17Q_XHiClnpq';
let db = null;
try { db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); } catch(e) {
    console.warn('[Supabase] 初始化失敗，將使用離線模式', e);
}

// ---- OpenCC 繁簡轉換 ----
let t2s = null;
try { if (window.OpenCC) t2s = OpenCC.Converter({ from: 'tw', to: 'cn' }); } catch(e) {}

// ---- 常數 ----
const FONT_SIZES = [18, 20, 22, 24];

// ---- 應用程式狀態 ----
let currentChapterId = 1;
let markdownCache = new Map();
let settings = { fontSizeIdx: 0, fontFamily: 'sans', language: 'tw', mode: 'scroll' };
let currentUser = null;
let syncTimer = null;

// ---- Page Mode 狀態 ----
let pages = [];
let currentPage = 0;
let isAnimating = false;
let animSafetyTimer = null;

// ---- DOM 輔助函式（不快取，每次動態查詢以避免 DOM 重建後引用失效）----
const $ = id => document.getElementById(id);

// 只快取永遠不會被重建的靜態元素
const readerContainer = $('reader-container');
const titleEl         = $('topbar-title');
const chapterListEl   = $('chapter-list');
const drawer          = $('drawer-menu');
const loginModal      = $('login-modal');
const userModal       = $('user-modal');
const overlay         = $('overlay');
const btnLang         = $('btn-lang');
const btnFont         = $('btn-font');
const btnPage         = $('btn-page');
const btnFontsize     = $('btn-fontsize');

// 動態元素：每次使用前重新查詢
function getContentEl()  { return $('reader-content'); }
function getBookEl()     { return $('book-view'); }
function getSyncStatus() { return $('display-sync-status'); }

// ==========================================
// 初始化流程
// ==========================================
async function init() {
    console.log('[Init] 開始初始化...');

    // Step 1: 載入設定（包含上次章節）
    loadSettings();
    applySettings();

    // Step 2: 標題
    titleEl.textContent = CONFIG.novelTitle;

    // Step 3: 綁定所有事件
    bindEvents();

    // Step 4: 確保章節 ID 有效
    if (!CONFIG.chapters.find(c => c.id === currentChapterId)) {
        currentChapterId = CONFIG.chapters[0].id;
    }

    // Step 5: 渲染目錄
    renderChapterList();

    // Step 6: 檢查讀者暱稱 (若未設定、為空字串或為預設的「訪客」，皆須彈窗要求輸入)
    const savedName = localStorage.getItem('reader_name');
    const isValid = savedName && savedName.trim().length > 0 && savedName.trim() !== '訪客';

    if (!isValid) {
        console.log('[Init] 讀者未登入或暱稱無效，阻斷章節載入，彈出歡迎視窗');
        currentUser = null;
        localStorage.removeItem('reader_name');
        $('display-username').textContent = '訪客';

        // 確保 DOM 渲染穩定後彈出 loginModal
        showModal(loginModal);
        const input = $('input-username');
        if (input) {
            input.value = '';
            setTimeout(() => input.focus(), 80);
        }

        // 【重大阻斷】：未輸入暱稱前，絕不在此載入章節內容！
        return;
    }

    currentUser = savedName.trim();
    $('display-username').textContent = currentUser;
    console.log('[Init] 讀者暱稱:', currentUser);

    await continueInit();
}

// 暱稱確認後繼續
async function continueInit() {
    console.log('[Init] 繼續初始化，載入章節...');

    await loadChapter(currentChapterId);

    // Supabase 背景同步（不阻塞閱讀器）
    if (currentUser && currentUser !== '訪客') {
        pullCloud()
            .then(() => {
                const cloudId = parseInt(localStorage.getItem('last_chapter_id'));
                if (cloudId && cloudId !== currentChapterId) {
                    loadChapter(cloudId);
                }
            })
            .catch(e => console.warn('[Supabase] 背景同步失敗:', e));
    }

    console.log('[Init] 初始化完成');
}

// ==========================================
// 設定管理
// ==========================================
function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem('reader_settings'));
        if (s) settings = { ...settings, ...s };
    } catch(e) {}

    const sid = localStorage.getItem('last_chapter_id');
    if (sid && !isNaN(parseInt(sid))) {
        currentChapterId = parseInt(sid);
    }
}

function saveSettings() {
    localStorage.setItem('reader_settings', JSON.stringify(settings));
}

function applySettings() {
    const fs = FONT_SIZES[settings.fontSizeIdx] || 18;
    document.documentElement.style.setProperty('--reader-font-size', fs + 'px');

    const modeClass = settings.mode === 'page' ? 'page-mode' : 'scroll-mode';
    document.body.className = `theme-sepia font-${settings.fontFamily} ${modeClass}`;

    btnLang.textContent = settings.language === 'tw' ? '繁' : '簡';
    btnLang.classList.toggle('active', settings.language === 'cn');
    btnFont.textContent = settings.fontFamily === 'sans' ? '黑' : '明';
    btnFont.classList.toggle('active', settings.fontFamily === 'serif');
    // 手機與電腦皆可切換：「滾 (上下滾動)」與「卷 (左右卷軸)」
    btnPage.textContent = settings.mode === 'scroll' ? '滾' : '卷';
    btnPage.classList.toggle('active', settings.mode === 'page');
    btnPage.style.display = ''; // 保持顯示，供使用者自由切換

    btnFontsize.textContent = 'Aa ' + fs;
    btnFontsize.classList.toggle('active', settings.fontSizeIdx > 0);

    saveSettings();
}

// ==========================================
// 語言轉換
// ==========================================
function convert(text) {
    return (settings.language === 'cn' && t2s) ? t2s(text) : text;
}

// ==========================================
// 章節目錄
// ==========================================
function renderChapterList() {
    chapterListEl.innerHTML = '';
    CONFIG.chapters.forEach(ch => {
        const d = document.createElement('div');
        d.className = 'chapter-item' + (ch.id === currentChapterId ? ' active' : '');
        d.textContent = convert(ch.title);
        d.onclick = () => { loadChapter(ch.id); closeAll(); };
        chapterListEl.appendChild(d);
    });
}

// ==========================================
// 章節載入（核心函式）
// ==========================================
async function loadChapter(id) {
    const ch = CONFIG.chapters.find(c => c.id === id);
    if (!ch) {
        console.error('[loadChapter] 找不到章節 id:', id);
        return;
    }

    console.log('[loadChapter] 載入章節:', id, ch.title);
    currentChapterId = id;

    // 顯示載入狀態
    showLoadingState();

    try {
        // 取得 Markdown（快取優先）
        let md = markdownCache.get(id);
        if (!md) {
            console.log('[loadChapter] fetch:', ch.file);
            const res = await fetch(ch.file);
            if (!res.ok) throw new Error('HTTP ' + res.status + ' (' + ch.file + ')');
            md = await res.text();
            markdownCache.set(id, md);
            console.log('[loadChapter] fetch 完成，', md.length, 'bytes');
        } else {
            console.log('[loadChapter] 使用快取');
        }

        // 語言轉換 + Markdown 解析
        const html = marked.parse(convert(md));

        // 根據模式渲染 (桌面與手機皆依據 settings.mode)
        if (settings.mode === 'page') {
            await initPageMode(html);
        } else {
            renderScrollMode(html);
        }

        // 儲存進度
        localStorage.setItem('last_chapter_id', id);
        renderChapterList();
        updateProgress();
        schedulePush();

    } catch(e) {
        console.error('[loadChapter] 錯誤:', e);
        showErrorState(e.message, id);
    }
}

// 顯示載入中
function showLoadingState() {
    if (settings.mode === 'page') {
        const bookEl = getBookEl();
        if (bookEl) {
            bookEl.innerHTML = `
                <div class="page-loading">
                    <div class="loading-spinner"></div>
                    <p>正在準備書頁……</p>
                </div>`;
        }
    } else {
        const el = getContentEl();
        if (el) {
            el.innerHTML = `<div class="loading-state">${convert('章節載入中...')}</div>`;
        }
        window.scrollTo(0, 0);
    }
}

// 顯示錯誤
function showErrorState(msg, id) {
    const errHTML = `
        <div class="error">
            <p>${convert('無法載入章節內容。')}</p>
            <small style="color:#888;">${msg}</small>
            <br>
            <button class="btn" onclick="reloadCurrentChapter()" style="margin-top:15px;">
                ${convert('重新嘗試')}
            </button>
        </div>`;

    if (settings.mode === 'page') {
        const bookEl = getBookEl();
        if (bookEl) bookEl.innerHTML = errHTML;
    } else {
        const el = getContentEl();
        if (el) el.innerHTML = errHTML;
    }
}

function reloadCurrentChapter() {
    markdownCache.delete(currentChapterId);
    loadChapter(currentChapterId);
}

// Scroll Mode 渲染
function renderScrollMode(html) {
    ensureScrollView();
    const el = getContentEl();
    if (el) {
        el.innerHTML = html;
        window.scrollTo(0, 0);
    } else {
        console.error('[renderScrollMode] #reader-content 找不到！');
    }
    updateChapterNavState();
}

function updateChapterNavState() {
    const prevBtn = $('btn-prev-chap');
    const nextBtn = $('btn-next-chap');
    if (prevBtn) {
        const isFirst = currentChapterId <= 1;
        prevBtn.disabled = isFirst;
        prevBtn.style.opacity = isFirst ? '0.35' : '1';
        prevBtn.style.pointerEvents = isFirst ? 'none' : 'auto';
    }
    if (nextBtn) {
        const isLast = currentChapterId >= CONFIG.chapters.length;
        nextBtn.disabled = isLast;
        nextBtn.style.opacity = isLast ? '0.35' : '1';
        nextBtn.style.pointerEvents = isLast ? 'none' : 'auto';
    }
}

// ==========================================
// DOM 結構管理
// ==========================================

// 確保 Scroll Mode 的 DOM 結構存在
function ensureScrollView() {
    if (!getContentEl()) {
        console.log('[ensureScrollView] 重建 Scroll Mode DOM');
        readerContainer.innerHTML = `
            <article id="reader-content"></article>
            <nav class="bottom-nav">
                <button id="btn-prev-chap" class="btn">上一章</button>
                <button id="btn-next-chap" class="btn">下一章</button>
            </nav>`;
        // 重新綁定章節按鈕
        $('btn-prev-chap').onclick = () => { if (currentChapterId > 1) loadChapter(currentChapterId - 1); };
        $('btn-next-chap').onclick = () => { if (currentChapterId < CONFIG.chapters.length) loadChapter(currentChapterId + 1); };
    }
}

// 確保 Page Mode 的 book-view 存在
function ensureBookView() {
    let bookEl = getBookEl();
    if (!bookEl) {
        console.log('[ensureBookView] 建立 book-view 容器');
        // 隱藏 Scroll Mode 元素，加入 book-view
        const scrollContent = getContentEl();
        if (scrollContent) scrollContent.style.display = 'none';
        const bottomNav = readerContainer.querySelector('.bottom-nav');
        if (bottomNav) bottomNav.style.display = 'none';

        bookEl = document.createElement('div');
        bookEl.id = 'book-view';
        readerContainer.appendChild(bookEl);
    }
    return bookEl;
}

// 進入 Scroll Mode 時，移除 book-view 並恢復 scroll 元素
function cleanupPageMode() {
    const bookEl = getBookEl();
    if (bookEl) bookEl.remove();

    // 恢復 Scroll Mode 元素
    const scrollContent = getContentEl();
    if (scrollContent) scrollContent.style.display = '';
    const bottomNav = readerContainer.querySelector('.bottom-nav');
    if (bottomNav) bottomNav.style.display = '';
}

// ==========================================
// 進度追蹤
// ==========================================
function getProgress() {
    if (settings.mode === 'page') {
        return pages.length > 1 ? (currentPage / (pages.length - 1) * 100) : 0;
    }
    const h = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    return h > 0 ? ((document.documentElement.scrollTop || document.body.scrollTop) / h * 100) : 0;
}

function updateProgress() {
    const bar = $('progress-bar');
    if (bar) bar.style.width = getProgress() + '%';
}

// ==========================================
// Page Mode 核心
// ==========================================

async function initPageMode(html) {
    console.log('[PageMode] 開始初始化');

    // 確保 book-view 存在
    const bookEl = ensureBookView();

    // 顯示載入狀態
    bookEl.innerHTML = `
        <div class="page-loading">
            <div class="loading-spinner"></div>
            <p>正在計算分頁……</p>
        </div>`;

    // 用 setTimeout 讓瀏覽器先渲染 loading 畫面，再執行分頁計算
    await new Promise(resolve => setTimeout(resolve, 50));

    // 分頁計算
    pages = buildPages(html);
    console.log('[PageMode] 共', pages.length, '頁');

    if (pages.length === 0) {
        bookEl.innerHTML = `
            <div class="page-error">
                <p>章節內容為空或分頁失敗。</p>
                <button class="btn" onclick="reloadCurrentChapter()">重新載入</button>
            </div>`;
        return;
    }

    // 恢復閱讀頁碼
    const savedPage = parseInt(localStorage.getItem('last_page_' + currentChapterId) || '0');
    currentPage = Math.max(0, Math.min(savedPage, pages.length - 1));

    // 渲染
    renderPage(currentPage);
    console.log('[PageMode] 初始化完成，頁:', currentPage, '/', pages.length - 1);
}

// ==========================================
// 分頁演算法
// ==========================================
function buildPages(html) {
    console.log('[buildPages] 開始分頁計算...');

    const isMobile = window.innerWidth < 800;
    const pageH = getPageHeight(isMobile);
    const pageW = getPageContentWidth(isMobile);
    
    // 精確對應 CSS 中的實體尺寸
    const headerH = 34; // .book-page-header 高度
    const footerH = 34; // .book-page-footer 高度
    
    // .book-page-content 的 margin (10+6=16px) 與 padding (16+16=32px) 與 border (2px)
    const contentBoxInsetV = 16 + 32 + 2; 
    
    // 安全緩衝 (預留約 1 行高度，避免字體行距與不同瀏覽器渲染誤差導致最後一行被截半)
    const safetyBuffer = 30;

    const availableH = pageH - headerH - footerH - contentBoxInsetV - safetyBuffer;
    // 扣除 .book-page-content 的左右 margin (12+12=24px)、padding (16+16=32px)、border (2px)
    const availableW = Math.max(100, pageW - 24 - 32 - 2);

    console.log('[buildPages] isMobile:', isMobile, 'pageH:', pageH, 'pageW:', pageW, 'availableH:', availableH, 'availableW:', availableW);

    // 建立測量容器
    const measurer = document.createElement('div');
    measurer.setAttribute('aria-hidden', 'true');
    const fsVal = getComputedStyle(document.documentElement).getPropertyValue('--reader-font-size').trim() || '18px';
    const fontVal = parseFloat(fsVal) || 18;
    
    measurer.style.cssText = [
        'position:fixed',
        'top:-9999px',
        'left:-9999px',
        'visibility:hidden',
        'pointer-events:none',
        `width:${availableW}px`,
        `font-size:${fsVal}`,
        'line-height:2.0',
        `font-family:${settings.fontFamily === 'serif' ? '"Songti TC","PMingLiU","SimSun",serif' : 'system-ui,-apple-system,sans-serif'}`,
        'text-align:justify',
        'letter-spacing:0.03em',
        'text-indent:2em',
        'word-break:break-word',
    ].join(';');
    document.body.appendChild(measurer);

    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    const blocks = Array.from(tempDiv.children);

    if (blocks.length === 0) {
        document.body.removeChild(measurer);
        return [html];
    }

    const result = [];
    let currentPageBlocks = [];
    let currentHeight = 0;

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const blockHTML = block.outerHTML;

        measurer.innerHTML = blockHTML;
        // 段落自帶 1.5em margin-bottom，需一併計入高度測量
        const pMarginBottom = fontVal * 1.5;
        const blockH = measurer.scrollHeight + pMarginBottom;

        if (blockH === 0) continue;

        if (currentPageBlocks.length > 0 && currentHeight + blockH > availableH) {
            result.push(currentPageBlocks.join(''));
            currentPageBlocks = [];
            currentHeight = 0;
        }

        if (blockH > availableH && currentPageBlocks.length === 0) {
            const subPages = splitLongBlock(block, availableH, measurer);
            result.push(...subPages);
            currentHeight = 0;
            continue;
        }

        currentPageBlocks.push(blockHTML);
        currentHeight += blockH;
    }

    if (currentPageBlocks.length > 0) {
        result.push(currentPageBlocks.join(''));
    }

    document.body.removeChild(measurer);
    console.log('[buildPages] 分頁完成:', result.length, '頁');
    return result.length > 0 ? result : [html];
}

// 超長段落切分（字元級）
function splitLongBlock(block, availableH, measurer) {
    const text = block.textContent || '';
    const tag = block.tagName.toLowerCase();
    const result = [];
    let current = '';
    const fsVal = getComputedStyle(document.documentElement).getPropertyValue('--reader-font-size').trim() || '18px';
    const pMargin = tag === 'p' ? parseFloat(fsVal) * 1.5 : 0;

    for (let i = 0; i < text.length; i++) {
        const test = current + text[i];
        measurer.innerHTML = `<${tag}>${test}</${tag}>`;
        if (measurer.scrollHeight + pMargin > availableH && current.length > 0) {
            result.push(`<${tag}>${current}</${tag}>`);
            current = text[i];
        } else {
            current = test;
        }
    }
    if (current) result.push(`<${tag}>${current}</${tag}>`);
    return result.length > 0 ? result : [block.outerHTML];
}

// 頁面可用高度 (以 DOM 實際尺寸優先，確保 100% 精準)
function getPageHeight(isMobile) {
    const bookEl = getBookEl();
    if (bookEl && bookEl.clientHeight > 0) {
        return bookEl.clientHeight;
    }
    if (isMobile) {
        return Math.min(window.innerHeight - 56 - 3 - 44, 720);
    }
    return Math.min(window.innerHeight - 56 - 3 - 20, 860);
}

// 單頁內容寬度
function getPageContentWidth(isMobile) {
    const bookEl = getBookEl();
    if (bookEl && bookEl.clientWidth > 0) {
        return isMobile ? bookEl.clientWidth : Math.floor(bookEl.clientWidth / 2);
    }
    if (isMobile) {
        return Math.min(window.innerWidth - 32, 440);
    }
    const bookWidth = Math.min(window.innerWidth * 0.88, 1100);
    return Math.floor(bookWidth / 2);
}

// ==========================================
// 頁面渲染
// ==========================================
function renderPage(pageIdx) {
    const bookEl = getBookEl();
    if (!bookEl) {
        console.error('[renderPage] book-view 不存在！');
        return;
    }
    if (!pages || pages.length === 0) {
        console.error('[renderPage] pages 為空');
        bookEl.innerHTML = '<div class="page-error"><p>無頁面資料，請重新整理。</p></div>';
        return;
    }

    pageIdx = Math.max(0, Math.min(pageIdx, pages.length - 1));
    currentPage = pageIdx;

    const isMobile = window.innerWidth < 800;
    if (isMobile) {
        renderMobilePage(bookEl, pageIdx);
    } else {
        renderDesktopPages(bookEl, pageIdx);
    }

    // 重設容器滾動位置，確保每一頁皆從天頭頂部整齊排版
    bookEl.scrollTop = 0;
    bookEl.scrollLeft = 0;

    updateProgress();
    updatePageNavState();
    localStorage.setItem('last_page_' + currentChapterId, pageIdx);
}

function getPageHTML(pageIdx) {
    const isMobile = window.innerWidth < 800;
    const ch = CONFIG.chapters.find(c => c.id === currentChapterId);
    const chapterTitle = ch ? convert(ch.title) : '';
    const bookTitle = convert(CONFIG.novelTitle);

    // 古風暗朱砂殘印 (首頁引首章「彼岸」、末頁壓角章「人間」)
    const openingSeal = `<div class="antique-seal seal-opening" aria-hidden="true"><span>彼</span><span>岸</span></div>`;
    const closingSeal = `<div class="antique-seal seal-closing" aria-hidden="true"><span>人</span><span>間</span></div>`;

    if (isMobile) {
        const isFirst = pageIdx === 0;
        const isLast = pageIdx === pages.length - 1;
        const sealMarkup = (isFirst ? openingSeal : '') + (isLast ? closingSeal : '');

        return `
            <div class="book-single-page">
                <div class="book-page-header">
                    <span class="header-book-title">${bookTitle}</span>
                    <span class="header-chapter-title">${chapterTitle}</span>
                </div>
                <div class="book-page-content">${pages[pageIdx] || ''}${sealMarkup}</div>
                <div class="book-page-footer">
                    <span class="page-info">${pageIdx + 1} / ${pages.length}</span>
                </div>
            </div>`;
    } else {
        const leftIdx = pageIdx % 2 === 0 ? pageIdx : pageIdx - 1;
        const rightIdx = leftIdx + 1;
        const leftContent  = leftIdx < pages.length ? pages[leftIdx] : '';
        const rightContent = rightIdx < pages.length ? pages[rightIdx] : '';

        const leftIsFirst = leftIdx === 0;
        const leftIsLast  = leftIdx === pages.length - 1 && rightIdx >= pages.length;
        const rightIsLast = rightIdx === pages.length - 1;

        const leftSealMarkup = (leftIsFirst ? openingSeal : '') + (leftIsLast ? closingSeal : '');
        const rightSealMarkup = rightIsLast ? closingSeal : '';

        return `
            <div class="book-spread">
                <div class="book-page book-page-left">
                    <div class="book-page-header">
                        <span class="header-book-title">${bookTitle}</span>
                        <span class="header-chapter-title"></span>
                    </div>
                    <div class="book-page-content">${leftContent}${leftSealMarkup}</div>
                    <div class="book-page-footer">
                        <span class="page-info">${leftIdx + 1}</span>
                    </div>
                </div>
                <div class="book-spine"></div>
                <div class="book-page book-page-right">
                    <div class="book-page-header">
                        <span class="header-book-title"></span>
                        <span class="header-chapter-title">${chapterTitle}</span>
                    </div>
                    <div class="book-page-content">${rightContent}${rightSealMarkup}</div>
                    <div class="book-page-footer">
                        <span class="page-info">${rightIdx < pages.length ? rightIdx + 1 : ''} / ${pages.length}</span>
                    </div>
                </div>
            </div>`;
    }
}

function renderMobilePage(bookEl, pageIdx) {
    bookEl.innerHTML = getPageHTML(pageIdx);
}

function renderDesktopPages(bookEl, pageIdx) {
    bookEl.innerHTML = getPageHTML(pageIdx);
}

function updatePageNavState() {
    const isMobile = window.innerWidth < 800;
    const leftIdx = isMobile ? currentPage : (currentPage % 2 === 0 ? currentPage : currentPage - 1);

    const isFirst = leftIdx <= 0;
    const isLast  = isMobile
        ? currentPage >= pages.length - 1
        : leftIdx + 1 >= pages.length - 1;

    const zL = $('zone-left');
    const zR = $('zone-right');
    if (zL) {
        zL.style.opacity = isFirst ? '0.2' : '1';
        zL.style.pointerEvents = isFirst ? 'none' : 'auto';
    }
    if (zR) {
        zR.style.opacity = isLast ? '0.2' : '1';
        zR.style.pointerEvents = isLast ? 'none' : 'auto';
    }
}

// ==========================================
// 翻頁控制
// ==========================================
function turnPage(direction) {
    if (settings.mode !== 'page') return;
    if (isAnimating) {
        console.log('[turnPage] 動畫中，忽略');
        return;
    }

    const isMobile = window.innerWidth < 800;
    let newPage;

    if (isMobile) {
        newPage = currentPage + direction;
    } else {
        const leftIdx = currentPage % 2 === 0 ? currentPage : currentPage - 1;
        newPage = leftIdx + direction * 2;
    }

    // 邊界處理 (換章)
    if (newPage < 0) {
        if (currentChapterId > 1) {
            loadChapter(currentChapterId - 1);
        }
        return;
    }
    if (newPage >= pages.length) {
        if (currentChapterId < CONFIG.chapters.length) {
            loadChapter(currentChapterId + 1);
        }
        return;
    }

    newPage = Math.max(0, Math.min(newPage, pages.length - 1));
    animateTurnPage(newPage, direction);
}

// 古風真·經摺裝翻頁系統
// 手機：3D 經摺翻折；桌面雙頁：宣紙層次淡入
function animateTurnPage(toPage, direction) {
    console.log('[animateTurnPage Fold]', currentPage, '→', toPage, 'dir:', direction);
    isAnimating = true;

    if (animSafetyTimer) clearTimeout(animSafetyTimer);
    animSafetyTimer = setTimeout(() => {
        console.warn('[animateTurnPage] 安全超時解鎖');
        isAnimating = false;
        currentPage = toPage;
        renderPage(toPage);
    }, 900);

    const bookEl = getBookEl();
    if (!bookEl) {
        isAnimating = false;
        clearTimeout(animSafetyTimer);
        return;
    }

    const fromHTML = getPageHTML(currentPage);
    const toHTML = getPageHTML(toPage);
    const isNext = direction > 0;
    const isMobile = window.innerWidth < 800;

    if (isMobile) {
        // ============================================================
        // 【手機版】古風 3D 經摺翻折
        // fold-shadow 作為 fold-leaf 的子節點，隨葉片一同旋轉
        // ============================================================
        bookEl.innerHTML = `
            <div class="fold-stage">
                <div class="fold-base" id="fold-base">${isNext ? toHTML : fromHTML}</div>
                <div class="fold-leaf" id="fold-leaf">
                    ${isNext ? fromHTML : toHTML}
                    <div class="fold-shadow" id="fold-shadow"></div>
                </div>
            </div>`;

        const leaf = $('fold-leaf');
        const shadow = $('fold-shadow');
        const base = $('fold-base');

        if (leaf) {
            const animDuration = 480;
            const bezier = 'cubic-bezier(0.25, 1, 0.5, 1)';
            const easeCSS = `${animDuration}ms ${bezier}`;

            if (isNext) {
                // 下一頁：舊頁以左側為軸微向左後翻折並淡出
                leaf.style.zIndex = '2';
                leaf.style.transformOrigin = 'left center';
                leaf.style.transform = 'rotateY(0deg) scale(1)';
                leaf.style.opacity = '1';

                if (base) {
                    base.style.transform = 'scale(0.98)';
                    base.style.filter = 'brightness(0.94)';
                    base.style.transition = 'none';
                }

                void leaf.offsetHeight; // Force Reflow

                requestAnimationFrame(() => {
                    leaf.style.transition = `transform ${easeCSS}, opacity ${animDuration * 0.8}ms ease-in`;
                    leaf.style.transform = 'rotateY(-32deg) scale(0.95)';
                    leaf.style.opacity = '0';

                    // 陰影在葉片內部，隨葉片旋轉：加深時呈現紙面背光
                    if (shadow) {
                        shadow.style.transition = `opacity ${animDuration * 0.5}ms ease`;
                        shadow.style.opacity = '1';
                    }

                    if (base) {
                        base.style.transition = `transform ${easeCSS}, filter ${easeCSS}`;
                        base.style.transform = 'scale(1)';
                        base.style.filter = 'brightness(1)';
                    }
                });

            } else {
                // 上一頁：新頁從左側微折狀態向右展開鋪平
                leaf.style.zIndex = '2';
                leaf.style.transformOrigin = 'left center';
                leaf.style.transform = 'rotateY(-32deg) scale(0.95)';
                leaf.style.opacity = '0';

                if (shadow) {
                    shadow.style.opacity = '0.85';
                    shadow.style.transition = 'none';
                }

                void leaf.offsetHeight; // Force Reflow

                requestAnimationFrame(() => {
                    leaf.style.transition = `transform ${easeCSS}, opacity ${animDuration * 0.7}ms ease-out`;
                    leaf.style.transform = 'rotateY(0deg) scale(1)';
                    leaf.style.opacity = '1';

                    if (shadow) {
                        shadow.style.transition = `opacity ${animDuration}ms ease`;
                        shadow.style.opacity = '0';
                    }

                    if (base) {
                        base.style.transition = `filter ${easeCSS}`;
                        base.style.filter = 'brightness(0.92)';
                    }
                });
            }
        }

        // 經摺翻動 480ms，510ms 後正式交接 DOM
        setTimeout(() => {
            currentPage = toPage;
            renderPage(toPage);
            clearTimeout(animSafetyTimer);
            isAnimating = false;
            updateProgress();
            schedulePush();
        }, 510);

    } else {
        // ============================================================
        // 【桌面版】優雅宣紙翻頁（書脊紋絲不動，僅左右雙頁平滑切換）
        // ============================================================
        const currentSpread = bookEl.querySelector('.book-spread');
        
        if (!currentSpread) {
            renderPage(toPage);
            currentPage = toPage;
            clearTimeout(animSafetyTimer);
            isAnimating = false;
            updateProgress();
            schedulePush();
            return;
        }

        const leftContent = currentSpread.querySelector('.book-page-left .book-page-content');
        const rightContent = currentSpread.querySelector('.book-page-right .book-page-content');

        const animDuration = 320;
        const easeCSS = `opacity ${animDuration}ms cubic-bezier(0.25, 1, 0.5, 1), transform ${animDuration}ms cubic-bezier(0.25, 1, 0.5, 1)`;

        // 第一階段：舊文字溫潤微退（微移 8px）
        if (leftContent) {
            leftContent.style.transition = easeCSS;
            leftContent.style.opacity = '0';
            leftContent.style.transform = isNext ? 'translateX(-8px)' : 'translateX(8px)';
        }
        if (rightContent) {
            rightContent.style.transition = easeCSS;
            rightContent.style.opacity = '0';
            rightContent.style.transform = isNext ? 'translateX(-8px)' : 'translateX(8px)';
        }

        // 第二階段：替換為新頁內容並浮現
        setTimeout(() => {
            renderPage(toPage);
            currentPage = toPage;

            const newSpread = bookEl.querySelector('.book-spread');
            if (newSpread) {
                const newLeft = newSpread.querySelector('.book-page-left .book-page-content');
                const newRight = newSpread.querySelector('.book-page-right .book-page-content');

                [newLeft, newRight].forEach(el => {
                    if (el) {
                        el.style.opacity = '0';
                        el.style.transform = isNext ? 'translateX(8px)' : 'translateX(-8px)';
                        el.style.transition = 'none';
                    }
                });

                void newSpread.offsetHeight; // Force Reflow

                [newLeft, newRight].forEach(el => {
                    if (el) {
                        el.style.transition = easeCSS;
                        el.style.opacity = '1';
                        el.style.transform = 'translateX(0)';
                    }
                });
            }

            clearTimeout(animSafetyTimer);
            isAnimating = false;
            updateProgress();
            schedulePush();
        }, animDuration + 20);
    }
}

// ==========================================
// 模式切換
// ==========================================
function switchMode(newMode) {
    if (settings.mode === newMode) return;
    console.log('[switchMode]', settings.mode, '→', newMode);

    settings.mode = newMode;
    applySettings();

    if (newMode === 'page') {
        // Scroll → Page
        const cachedMd = markdownCache.get(currentChapterId);
        if (cachedMd) {
            initPageMode(marked.parse(convert(cachedMd)));
        } else {
            loadChapter(currentChapterId);
        }
    } else {
        // Page → Scroll
        cleanupPageMode();
        ensureScrollView();

        const cachedMd = markdownCache.get(currentChapterId);
        if (cachedMd) {
            const el = getContentEl();
            if (el) el.innerHTML = marked.parse(convert(cachedMd));
        } else {
            loadChapter(currentChapterId);
        }
        updateChapterNavState();
        window.scrollTo(0, 0);
    }
}

// ==========================================
// Supabase 同步
// ==========================================
async function pullCloud() {
    if (!db || !currentUser || currentUser === '訪客') return;
    const ss = getSyncStatus();
    if (ss) ss.textContent = '↻ 同步中...';
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
                console.log('[Supabase] 雲端進度還原，章節:', currentChapterId);
            }
        }
        if (ss) ss.textContent = '✓ 已同步';
    } catch(e) {
        console.warn('[Supabase] 同步失敗:', e.message);
        if (ss) ss.textContent = '⚠ 離線模式';
    }
}

function schedulePush() {
    if (!db || !currentUser || currentUser === '訪客') return;
    if (syncTimer) clearTimeout(syncTimer);
    syncTimer = setTimeout(async () => {
        try {
            await db.from('reading_progress').upsert({
                reader_name: currentUser,
                chapter_id:  currentChapterId,
                progress:    getProgress(),
                updated_at:  new Date().toISOString()
            }, { onConflict: 'reader_name' });
            localStorage.setItem('last_sync_time', Date.now());
            const ss = getSyncStatus();
            if (ss) ss.textContent = '✓ 已同步';
        } catch(e) {
            const ss = getSyncStatus();
            if (ss) ss.textContent = '⚠ 同步失敗';
        }
    }, 5000);
}

// ==========================================
// 事件綁定
// ==========================================
function bindEvents() {
    // ---- 讀者暱稱登入 ----
    $('btn-login').onclick = async () => {
        const input = $('input-username');
        const name = input ? input.value.trim() : '';
        if (!name || name === '訪客') {
            if (input) {
                input.focus();
                input.style.borderColor = '#c44';
            }
            return;
        }
        if (input) input.style.borderColor = '';
        currentUser = name;
        localStorage.setItem('reader_name', name);
        $('display-username').textContent = name;
        closeAll();
        await continueInit();
    };

    // Enter 鍵確認
    $('input-username').addEventListener('keydown', e => {
        if (e.key === 'Enter') $('btn-login').click();
    });

    // ---- 更換暱稱 ----
    $('btn-logout').onclick = () => {
        localStorage.removeItem('reader_name');
        currentUser = null;
        $('display-username').textContent = '訪客';
        const input = $('input-username');
        if (input) input.value = '';
        closeAll();
        showModal(loginModal);
        if (input) setTimeout(() => input.focus(), 80);
    };

    // ---- 目錄 / 使用者面板 ----
    $('btn-menu').onclick  = () => showModal(drawer);
    $('btn-user').onclick  = () => showModal(userModal);
    $('btn-close-menu').onclick = closeAll;
    $('btn-close-user').onclick = closeAll;
    overlay.onclick = () => {
        // 若尚未登入且登入彈窗正在顯示，禁止點擊遮罩關閉跳過
        if (!currentUser && loginModal && loginModal.classList.contains('show')) {
            const input = $('input-username');
            if (input) {
                input.focus();
                input.style.borderColor = '#c44';
                setTimeout(() => { input.style.borderColor = ''; }, 600);
            }
            return;
        }
        closeAll();
    };

    // ---- 章節導覽（Scroll Mode 底部按鈕）----
    const prevChapBtn = $('btn-prev-chap');
    const nextChapBtn = $('btn-next-chap');
    if (prevChapBtn) prevChapBtn.onclick = () => { if (currentChapterId > 1) loadChapter(currentChapterId - 1); };
    if (nextChapBtn) nextChapBtn.onclick = () => { if (currentChapterId < CONFIG.chapters.length) loadChapter(currentChapterId + 1); };

    // ---- 工具列 ----
    btnFontsize.onclick = () => {
        settings.fontSizeIdx = (settings.fontSizeIdx + 1) % FONT_SIZES.length;
        applySettings();
        if (settings.mode === 'page') {
            const md = markdownCache.get(currentChapterId);
            if (md) initPageMode(marked.parse(convert(md)));
        }
    };

    btnLang.onclick = () => {
        settings.language = settings.language === 'tw' ? 'cn' : 'tw';
        applySettings();
        markdownCache.delete(currentChapterId); // 語言轉換需重新渲染
        loadChapter(currentChapterId);
    };

    btnFont.onclick = () => {
        settings.fontFamily = settings.fontFamily === 'sans' ? 'serif' : 'sans';
        applySettings();
        if (settings.mode === 'page') {
            const md = markdownCache.get(currentChapterId);
            if (md) initPageMode(marked.parse(convert(md)));
        }
    };

    btnPage.onclick = () => {
        switchMode(settings.mode === 'scroll' ? 'page' : 'scroll');
    };

    // ---- 翻頁點擊區 ----
    $('zone-left').addEventListener('click', e => {
        e.stopPropagation();
        if (settings.mode !== 'page') return;
        turnPage(-1);
    });
    $('zone-right').addEventListener('click', e => {
        e.stopPropagation();
        if (settings.mode !== 'page') return;
        turnPage(1);
    });

    // ---- 鍵盤翻頁 ----
    document.addEventListener('keydown', e => {
        if (settings.mode !== 'page') return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
            e.preventDefault();
            turnPage(1);
        } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
            e.preventDefault();
            turnPage(-1);
        }
    });

    // ---- 觸控滑動（僅 Page Mode）----
    let touchStartX = 0;
    let touchStartY = 0;

    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].clientX;
        touchStartY = e.changedTouches[0].clientY;
    }, { passive: true });

    document.addEventListener('touchend', e => {
        if (settings.mode !== 'page') return;
        const diffX = e.changedTouches[0].clientX - touchStartX;
        const diffY = e.changedTouches[0].clientY - touchStartY;
        // 橫向滑動 > 50px 且橫向大於縱向
        if (Math.abs(diffX) > 50 && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX < 0) turnPage(1);
            else           turnPage(-1);
        }
    }, { passive: true });

    // ---- 滾動進度（Scroll Mode）----
    window.addEventListener('scroll', () => {
        if (settings.mode === 'scroll') {
            updateProgress();
            schedulePush();
        }
    });

    // ---- 視窗大小改變：Page Mode 重新分頁 ----
    let resizeTimer = null;
    window.addEventListener('resize', () => {
        if (settings.mode !== 'page') return;
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            const md = markdownCache.get(currentChapterId);
            if (md) initPageMode(marked.parse(convert(md)));
        }, 400);
    });
}

// ==========================================
// Modal / Drawer
// ==========================================
function showModal(el) {
    if (!el) return;
    closeAll();
    overlay.classList.add('show');
    if (el.id === 'drawer-menu') {
        el.classList.add('open');
    } else {
        el.style.display = 'block'; // 明確顯示
        void el.offsetHeight;       // 強制重繪 (Force Reflow)，確保 display: block 咬合
        el.classList.add('show');
    }
    const input = el.querySelector('input');
    if (input) setTimeout(() => input.focus(), 60);
}

function closeAll() {
    drawer.classList.remove('open');
    document.querySelectorAll('.modal').forEach(m => {
        m.classList.remove('show');
        m.style.display = 'none'; // 徹底關閉，不參與圖層合成
    });
    overlay.classList.remove('show');
}

// ==========================================
// 啟動
// ==========================================
init();