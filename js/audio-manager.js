class AudioManager {
    constructor() {
        this.soundtrack = new Audio();
        this.soundtrack.preload = "metadata";
        this.currentSong = null;
        this.onSongStateChange = null;
        this.soundtrackInitialized = false;

        // TTS (Narration) State
        this.narration = new Audio();
        this.narration.preload = "metadata";
        this.narrationData = null; // paragraphs JSON
        this.currentChapterId = null;
        this.voiceSpeed = 1.0;

        // Next chapter preload (Cache warming only)
        this.nextNarration = new Audio();
        this.nextNarration.preload = "auto";
        this.isPreloadingNext = false;

        // Callbacks
        this.onTTSStateChange = null;
        this.onParagraphChange = null;

        this.continuous = false; // 是否連續朗讀
        this.pendingContinuousPlayback = false; // 是否正在等待換章後自動播放
        this.currentParagraphIndex = -1;

        // Bind events
        this.narration.addEventListener('timeupdate', () => this.handleNarrationTimeUpdate());
        this.narration.addEventListener('ended', () => this.handleNarrationEnded());
        this.narration.addEventListener('error', (e) => {
            console.error('Audio load error', e);
            if(this.onTTSStateChange) this.onTTSStateChange('error');
        });
        this.narration.addEventListener('play', () => {
            if(this.onTTSStateChange) this.onTTSStateChange('playing');
        });
        this.narration.addEventListener('pause', () => {
            if(this.onTTSStateChange) this.onTTSStateChange('paused');
        });
        this.narration.addEventListener('waiting', () => {
            if(this.onTTSStateChange) this.onTTSStateChange('loading');
        });
        this.narration.addEventListener('canplay', () => {
            if (!this.narration.paused) {
                if(this.onTTSStateChange) this.onTTSStateChange('playing');
            }
        });
    }

    get speed() {
        return this.voiceSpeed;
    }

    set speed(val) {
        this.voiceSpeed = val;
        this.narration.playbackRate = val;
    }

    get isPlayingTTS() {
        return !this.narration.paused && this.narration.currentTime > 0 && !this.narration.ended;
    }

    initSoundtrack() {
        if (this.soundtrackInitialized) return;
        this.soundtrackInitialized = true;
        this.soundtrack.addEventListener('ended', () => {
            if(this.onSongStateChange) this.onSongStateChange('ended');
        });
        this.soundtrack.addEventListener('timeupdate', () => {
            if(this.onSongStateChange) this.onSongStateChange('timeupdate', this.soundtrack.currentTime, this.soundtrack.duration);
        });
    }

    playSong(url, name) {
        if (this.isPlayingTTS) {
            this.pauseTTS();
        }
        if (this.currentSong !== name) {
            this.soundtrack.src = url;
            this.currentSong = name;
        } else if (this.soundtrack.ended) {
            this.soundtrack.currentTime = 0;
        }
        this.soundtrack.play()
            .then(() => {
                if(this.onSongStateChange) this.onSongStateChange('playing', name);
            })
            .catch((e) => {
                console.warn('Soundtrack play failed', e);
                if(this.onSongStateChange) this.onSongStateChange('error', name);
            });
    }

    pauseSong() {
        this.soundtrack.pause();
        if(this.onSongStateChange) this.onSongStateChange('paused', this.currentSong);
    }

    async loadNarration(chapterId) {
        if (this.currentChapterId === chapterId && this.narrationData) return true;

        this.stopTTS();
        this.currentChapterId = chapterId;
        this.narrationData = null;
        this.currentParagraphIndex = -1;
        this.isPreloadingNext = false;

        const voice = document.getElementById('tts-voice-select')?.value || 'male';
        const audioUrl = `audio/narration/${chapterId}_${voice}.mp3`;
        const jsonUrl = `audio/narration/${chapterId}.json`;

        if (this.onTTSStateChange) this.onTTSStateChange('loading');

        try {
            const res = await fetch(jsonUrl);
            if (!res.ok) throw new Error('找不到朗讀資料');
            this.narrationData = await res.json();

            this.narration.src = audioUrl;
            this.narration.load();
            this.narration.playbackRate = this.speed;

            if (this.narration.readyState < 1) {
                await new Promise((resolve, reject) => {
                    const onReady = () => {
                        this.narration.removeEventListener('error', onError);
                        resolve();
                    };
                    const onError = () => {
                        this.narration.removeEventListener('loadedmetadata', onReady);
                        reject(new Error('音檔載入失敗'));
                    };
                    this.narration.addEventListener('loadedmetadata', onReady, { once: true });
                    this.narration.addEventListener('error', onError, { once: true });
                });
            }
            if (this.onTTSStateChange) this.onTTSStateChange('ready');
            return true;
        } catch (e) {
            console.error('TTS Load Error:', e);
            this.currentChapterId = null;
            this.narrationData = null;
            if (this.onTTSStateChange) this.onTTSStateChange('error');
            return false;
        }
    }

    preloadNextNarration(nextChapterId) {
        if (this.isPreloadingNext) return;
        this.isPreloadingNext = true;

        const voice = document.getElementById('tts-voice-select')?.value || 'male';
        const nextUrl = `audio/narration/${nextChapterId}_${voice}.mp3`;
        this.nextNarration.src = nextUrl;
        this.nextNarration.load();
    }

    async playTTS(chapterId) {
        if (chapterId && chapterId !== this.currentChapterId) {
            const ok = await this.loadNarration(chapterId);
            if (!ok) return;
        } else if (!this.narrationData || !this.narration.src) {
            if (this.onTTSStateChange) this.onTTSStateChange('error');
            return;
        }

        if (!this.soundtrack.paused) {
            this.pauseSong();
        }

        try {
            await this.narration.play();
            this.pendingContinuousPlayback = false; // Successfully playing
        } catch (e) {
            console.warn("Play interrupted", e);
        }
    }

    pauseTTS() {
        this.narration.pause();
        this.pendingContinuousPlayback = false;
    }

    stopTTS() {
        this.pauseTTS();
        try {
            this.narration.currentTime = 0;
        } catch (e) {
            console.warn('Unable to reset narration time', e);
        }
        this.currentParagraphIndex = -1;
        this.pendingContinuousPlayback = false;
        if(this.onTTSStateChange) this.onTTSStateChange('stopped');
        if(this.onParagraphChange) this.onParagraphChange(-1);
    }

    seekToParagraph(idx) {
        if (!this.narrationData || !this.narrationData.paragraphs) return;
        const p = this.narrationData.paragraphs.find(p => p.index === idx);
        if (p) {
            this.narration.currentTime = p.start;
            this.playTTS();
        }
    }

    handleNarrationTimeUpdate() {
        if (this.onTTSStateChange) {
            this.onTTSStateChange('timeupdate', this.narration.currentTime, this.narration.duration);
        }

        // Highlight matching paragraph
        if (this.narrationData && this.narrationData.paragraphs) {
            const time = this.narration.currentTime;
            const currentP = this.narrationData.paragraphs.find(p => time >= p.start && time <= p.end);

            if (currentP && currentP.index !== this.currentParagraphIndex) {
                this.currentParagraphIndex = currentP.index;
                if (this.onParagraphChange) this.onParagraphChange(this.currentParagraphIndex);
            }
        }

        // Preload logic (15 seconds before end)
        if (this.continuous && !this.isPreloadingNext && this.narration.duration > 0) {
            if (this.narration.duration - this.narration.currentTime < 15) {
                if (this.onNeedsPreload) {
                    this.onNeedsPreload();
                }
            }
        }
    }

    handleNarrationEnded() {
        if (this.continuous) {
            this.pendingContinuousPlayback = true;
            if(this.onTTSStateChange) this.onTTSStateChange('ended_continuous');
        } else {
            if(this.onTTSStateChange) this.onTTSStateChange('ended');
        }
    }
}

window.AudioManager = AudioManager;
