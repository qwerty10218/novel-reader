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
let settings = { fontSizeIdx: 0, fontFamily: 'sans', language: 'tw', mode: 'scroll' };
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

async function init() {
    titleEl.textContent = CONFIG.novelTitle;
    loadSettings(); applySettings(); bindEvents();
    currentUser = localStorage.getItem('reader_name');
    if (!currentUser) { showModal(loginModal); } else {
        $('display-username').textContent = currentUser;
        await pullCloud(); renderChapterList(); await loadChapter(currentChapterId);
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

async function loadChapter(id) {
    const ch = CONFIG.chapters.find(c => c.id === id);
    if (!ch) return;
    currentChapterId = id;
    contentEl.innerHTML = '<div class="loading-state">' + convert('載入中...') + '</div>';
    try {
        let md = markdownCache.get(id);
        if (!md) {
            const res = await fetch(ch.file);
            if (!res.ok) throw new Error(res.status);
            md = await res.text();
            markdownCache.set(id, md);
        }
        contentEl.innerHTML = marked.parse(convert(md));
        window.scrollTo(0, 0); contentEl.scrollLeft = 0;
        localStorage.setItem('last_chapter_id', id);
        renderChapterList(); updateProgress(); schedulePush();
    } catch (e) { contentEl.innerHTML = '<div class="error">' + convert('載入失敗') + '</div>'; }
}

function loadSettings() {
    try { const s = JSON.parse(localStorage.getItem('reader_settings')); if(s) settings = {...settings, ...s}; } catch(e){}
    const sid = localStorage.getItem('last_chapter_id'); if (sid) currentChapterId = parseInt(sid);
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

// ---- 真正的 3D 翻頁引擎 ----
function turnPage(direction) {
    if (settings.mode !== 'page' || isFlipping) return;
    const container = $('reader-container');
    const bookWidth = container.clientWidth;
    const isMobile = window.innerWidth < 800;
    
    const maxScroll = contentEl.scrollWidth - bookWidth;
    if (direction === 1 && contentEl.scrollLeft >= maxScroll - 5) {
        if (currentChapterId < CONFIG.chapters.length) loadChapter(currentChapterId + 1);
        return;
    }
    if (direction === -1 && contentEl.scrollLeft <= 5) {
        if (currentChapterId > 1) {
            loadChapter(currentChapterId - 1).then(() => { setTimeout(() => { contentEl.scrollLeft = contentEl.scrollWidth; }, 50); });
        }
        return;
    }

    const currentScroll = contentEl.scrollLeft;
    let targetScroll = currentScroll + (direction * bookWidth);
    targetScroll = Math.round(targetScroll / bookWidth) * bookWidth;

    do3DFlip(direction, currentScroll, targetScroll, isMobile, bookWidth);
}

function do3DFlip(direction, currentScroll, targetScroll, isMobile, bookWidth) {
    isFlipping = true;
    const container = $('reader-container');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'flip-wrapper';
    
    const createFace = (scroll, shift) => {
        const face = document.createElement('div');
        face.className = 'flip-face';
        const clone = contentEl.cloneNode(true);
        clone.removeAttribute('id');
        clone.className = 'clone-content';
        clone.style.columnWidth = isMobile ? `${bookWidth}px` : `${bookWidth / 2}px`;
        clone.style.transform = `translateX(-${shift}px)`;
        face.appendChild(clone);
        return { face, clone };
    };

    let flippingPage = document.createElement('div');
    flippingPage.className = `flipping-page ${isMobile ? (direction === 1 ? 'mobile-forward' : 'mobile-backward') : (direction === 1 ? 'desktop-forward' : 'desktop-backward')}`;
    
    let partsToScroll = [];

    if (!isMobile) {
        const halfWidth = bookWidth / 2;
        
        const underLeft = document.createElement('div'); underLeft.className = 'flip-part under-left';
        const cl1 = contentEl.cloneNode(true); cl1.className = 'clone-content'; cl1.style.columnWidth = `${halfWidth}px`;
        underLeft.appendChild(cl1); partsToScroll.push({ el: cl1, val: direction === 1 ? currentScroll : targetScroll });
        
        const underRight = document.createElement('div'); underRight.className = 'flip-part under-right';
        const cl2 = contentEl.cloneNode(true); cl2.className = 'clone-content'; cl2.style.columnWidth = `${halfWidth}px`; cl2.style.transform = `translateX(-${halfWidth}px)`;
        underRight.appendChild(cl2); partsToScroll.push({ el: cl2, val: direction === 1 ? targetScroll : currentScroll });

        wrapper.appendChild(underLeft); wrapper.appendChild(underRight);

        const face1 = createFace(currentScroll, direction === 1 ? halfWidth : 0);
        const face2 = createFace(targetScroll, direction === 1 ? 0 : halfWidth);
        face2.face.classList.add('back');
        flippingPage.appendChild(face1.face); flippingPage.appendChild(face2.face);
        
        partsToScroll.push({ el: face1.clone, val: currentScroll });
        partsToScroll.push({ el: face2.clone, val: targetScroll });
    } else {
        const under = document.createElement('div'); under.className = 'flip-part mobile-under';
        const cl1 = contentEl.cloneNode(true); cl1.className = 'clone-content'; cl1.style.columnWidth = `${bookWidth}px`;
        under.appendChild(cl1); partsToScroll.push({ el: cl1, val: targetScroll });
        wrapper.appendChild(under);

        const face1 = createFace(currentScroll, 0);
        const face2 = createFace(targetScroll, 0);
        face2.face.classList.add('back');
        flippingPage.appendChild(face1.face); flippingPage.appendChild(face2.face);
        
        partsToScroll.push({ el: face1.clone, val: currentScroll });
        partsToScroll.push({ el: face2.clone, val: targetScroll });
    }

    wrapper.appendChild(flippingPage);
    container.appendChild(wrapper);

    partsToScroll.forEach(p => p.el.scrollLeft = p.val);
    contentEl.style.visibility = 'hidden';

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            flippingPage.classList.add('animating');
            flippingPage.style.transform = direction === 1 ? 'rotateY(-180deg)' : 'rotateY(180deg)';
        });
    });

    setTimeout(() => {
        contentEl.scrollLeft = targetScroll;
        contentEl.style.visibility = 'visible';
        wrapper.remove();
        isFlipping = false;
        updateProgress(); schedulePush();
    }, 650);
}

// ---- Supabase & Events ----
async function pullCloud() { /* unchanged */ }
function schedulePush() { /* unchanged */ }

function bindEvents() {
    $('btn-login').onclick = async () => {
        const name = $('input-username').value.trim(); if (!name) return;
        currentUser = name; localStorage.setItem('reader_name', name); $('display-username').textContent = name;
        closeAll(); await pullCloud(); renderChapterList(); await loadChapter(currentChapterId);
    };
    $('btn-logout').onclick = () => { localStorage.removeItem('reader_name'); location.reload(); };

    $('btn-menu').onclick = () => showModal(drawer);
    $('btn-user').onclick = () => showModal(userModal);
    $('btn-close-menu').onclick = closeAll; $('btn-close-user').onclick = closeAll; overlay.onclick = closeAll;
    $('btn-prev-chap').onclick = () => { if (currentChapterId > 1) loadChapter(currentChapterId - 1); };
    $('btn-next-chap').onclick = () => { if (currentChapterId < CONFIG.chapters.length) loadChapter(currentChapterId + 1); };

    btnFontsize.onclick = () => { settings.fontSizeIdx = (settings.fontSizeIdx + 1) % FONT_SIZES.length; applySettings(); };
    btnLang.onclick = () => { settings.language = (settings.language === 'tw') ? 'cn' : 'tw'; applySettings(); loadChapter(currentChapterId); };
    btnFont.onclick = () => { settings.fontFamily = (settings.fontFamily === 'sans') ? 'serif' : 'sans'; applySettings(); };
    btnPage.onclick = () => { settings.mode = (settings.mode === 'scroll') ? 'page' : 'scroll'; applySettings(); };

    $('zone-left').onclick = () => turnPage(-1); $('zone-right').onclick = () => turnPage(1);

    document.addEventListener('keydown', (e) => {
        if (settings.mode !== 'page') return;
        if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); turnPage(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); turnPage(-1); }
    });

    window.addEventListener('scroll', () => { updateProgress(); schedulePush(); });
    contentEl.addEventListener('scroll', () => { updateProgress(); schedulePush(); });
}

function showModal(el) { closeAll(); if (el.id === 'drawer-menu') el.classList.add('open'); else el.classList.add('show'); overlay.classList.add('show'); }
function closeAll() { drawer.classList.remove('open'); document.querySelectorAll('.modal').forEach(m => m.classList.remove('show')); if (currentUser) overlay.classList.remove('show'); }

init();