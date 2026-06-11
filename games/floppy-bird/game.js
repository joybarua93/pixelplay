// ─── PixelPlay Sound Engine ───────────────────────────────────────────────
const SFX = (() => {
    let ctx = null;
    function getCtx() {
        if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
        return ctx;
    }
    function play({ frequency = 440, type = 'square', duration = 0.1,
                    volume = 0.3, slide = 0, attack = 0.01, decay = 0.05,
                    vibrato = 0, vibratoSpeed = 10 }) {
        try {
            const c = getCtx();
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.connect(gain);
            gain.connect(c.destination);
            osc.type = type;
            const t = c.currentTime;
            osc.frequency.setValueAtTime(frequency, t);
            if (slide) osc.frequency.linearRampToValueAtTime(frequency + slide, t + duration);
            if (vibrato) {
                const lfo = c.createOscillator();
                const lfoGain = c.createGain();
                lfo.connect(lfoGain);
                lfoGain.connect(osc.frequency);
                lfo.frequency.value = vibratoSpeed;
                lfoGain.gain.value = vibrato;
                lfo.start(t); lfo.stop(t + duration);
            }
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(volume, t + attack);
            gain.gain.setValueAtTime(volume, t + duration - decay);
            gain.gain.linearRampToValueAtTime(0, t + duration);
            osc.start(t); osc.stop(t + duration);
        } catch(e) {}
    }
    function noise({ duration = 0.1, volume = 0.2, lowpass = 800 }) {
        try {
            const c = getCtx();
            const bufSize = c.sampleRate * duration;
            const buf = c.createBuffer(1, bufSize, c.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufSize; i++) data[i] = Math.random() * 2 - 1;
            const src = c.createBufferSource();
            src.buffer = buf;
            const filter = c.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = lowpass;
            const gain = c.createGain();
            gain.gain.setValueAtTime(volume, c.currentTime);
            gain.gain.linearRampToValueAtTime(0, c.currentTime + duration);
            src.connect(filter); filter.connect(gain); gain.connect(c.destination);
            src.start(); src.stop(c.currentTime + duration);
        } catch(e) {}
    }
    document.addEventListener('click',      () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: true });
    document.addEventListener('keydown',    () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: true });
    document.addEventListener('touchstart', () => { if (ctx && ctx.state === 'suspended') ctx.resume(); }, { once: true });
    return { play, noise };
})();

// ─── Sound Functions ──────────────────────────────────────────────────────
function sfxFlap()  { SFX.play({ frequency: 800, type: 'sine',     duration: 0.06, volume: 0.2, slide: -200 }); }
function sfxScore() { SFX.play({ frequency: 660, type: 'sine',     duration: 0.12, volume: 0.25, slide: 220 }); }
function sfxHit()   { SFX.noise({ duration: 0.15, volume: 0.4, lowpass: 600 }); }
function sfxDie()   { SFX.play({ frequency: 300, type: 'sawtooth', duration: 0.4, volume: 0.3, slide: -250 }); }
function sfxStart() { SFX.play({ frequency: 523, type: 'sine',     duration: 0.1, volume: 0.2 }); }

// ─── Pause & localStorage ─────────────────────────────────────────────────
let gamePaused = false;
let pauseStartTime = 0;

const STORAGE_KEY = 'pixelplay_floppybird_best';
function getBest()       { return parseInt(localStorage.getItem(STORAGE_KEY) || '0'); }
function saveBest(score) { if (score > getBest()) localStorage.setItem(STORAGE_KEY, String(score)); }

function togglePause() {
    gamePaused = !gamePaused;
    document.getElementById('pause-overlay').style.display = gamePaused ? 'flex' : 'none';
    document.getElementById('pause-btn').style.display = gamePaused ? 'none' : 'flex';
    if (gamePaused) {
        pauseStartTime = performance.now();
    } else {
        lastPipeSpawnTime += performance.now() - pauseStartTime;
        resumeGameLoop();
    }
}
function resumeGameLoop() { requestAnimationFrame(gameLoop); }
function restartGame() {
    document.getElementById('pause-overlay').style.display = 'none';
    gamePaused = false;
    startNewGame(currentDifficulty);
}
function goToTitleScreen() {
    gameRunning = false;
    gamePaused  = false;
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'none';
    document.getElementById('pp-back').style.display = 'flex';
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('start-menu').classList.remove('hidden');
}

// ─── Responsive Canvas Dimensions ────────────────────────────────────────
const GAME_WIDTH  = 480;
const GAME_HEIGHT = 640;
const ASPECT      = GAME_WIDTH / GAME_HEIGHT;

// ─── Keep these declared globally so all functions can use them ───────────
let canvas, ctx, scoreEl, finalScoreEl, bestScoreEl, titleBestEl,
    startMenu, gameOverScreen, restartBtn;

let score = 0;
let isGameOver = false;
let gameRunning = false;
let pipes = [];
let lastPipeSpawnTime = 0;
let currentDifficulty = 'medium';

const difficultySettings = {
    easy:   { gravity: 0.25, jumpStrength: -5.5, pipeGap: 190, pipeSpeed: 2.2, spawnInterval: 1800, scoreMultiplier: 1 },
    medium: { gravity: 0.38, jumpStrength: -7.0, pipeGap: 145, pipeSpeed: 3.5, spawnInterval: 1300, scoreMultiplier: 2 },
    hard:   { gravity: 0.52, jumpStrength: -8.5, pipeGap: 115, pipeSpeed: 4.8, spawnInterval: 950,  scoreMultiplier: 3 }
};

const bird = { x: 0, y: 0, radius: 14, velocity: 0 };

function resizeCanvas() {
    if (!canvas) return;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    let newW, newH;
    if (winW / winH > ASPECT) {
        newH = winH;
        newW = newH * ASPECT;
    } else {
        newW = winW;
        newH = newW / ASPECT;
    }
    canvas.style.width  = newW + 'px';
    canvas.style.height = newH + 'px';
    bird.x = GAME_WIDTH * 0.25;
    if (!gameRunning && !isGameOver) bird.y = GAME_HEIGHT * 0.5;
}

class PipePair {
    constructor(config) {
        this.x = canvas.width;
        this.width = 65;
        this.gap = config.pipeGap;
        this.passed = false;
        this.speed = config.pipeSpeed;
        const minHeight = 50;
        const maxHeight = canvas.height - this.gap - minHeight - 40;
        this.topHeight = minHeight + Math.random() * (maxHeight - minHeight);
        this.bottomY = this.topHeight + this.gap;
        this.bottomHeight = canvas.height - this.bottomY;
    }
    update() { this.x -= this.speed; }
    draw() {
        ctx.fillStyle = '#2e7d32';
        ctx.strokeStyle = '#1b5e20';
        ctx.lineWidth = 3;
        ctx.fillRect(this.x, 0, this.width, this.topHeight);
        ctx.strokeRect(this.x, -5, this.width, this.topHeight + 5);
        ctx.fillRect(this.x, this.bottomY, this.width, this.bottomHeight);
        ctx.strokeRect(this.x, this.bottomY, this.width, this.bottomHeight + 5);
        ctx.fillStyle = '#388e3c';
        ctx.fillRect(this.x - 4, this.topHeight - 18, this.width + 8, 18);
        ctx.strokeRect(this.x - 4, this.topHeight - 18, this.width + 8, 18);
        ctx.fillRect(this.x - 4, this.bottomY, this.width + 8, 18);
        ctx.strokeRect(this.x - 4, this.bottomY, this.width + 8, 18);
    }
}

function flap() {
    if (!gameRunning || isGameOver || gamePaused) return;
    bird.velocity = difficultySettings[currentDifficulty].jumpStrength;
    sfxFlap();
}

function startNewGame(difficultySelection) {
    currentDifficulty = difficultySelection;
    score       = 0;
    isGameOver  = false;
    gameRunning = true;
    gamePaused  = false;
    pipes       = [];
    bird.velocity = 0;
    document.getElementById('pause-overlay').style.display = 'none';
    scoreEl.textContent = score;
    startMenu.classList.add('hidden');
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';
    gameOverScreen.classList.add('hidden');
    resizeCanvas();
    bird.y = canvas.height * 0.4;
    lastPipeSpawnTime = performance.now();
    sfxStart();
    requestAnimationFrame(gameLoop);
}

function gameLoop(currentTime) {
    if (!gameRunning || isGameOver) return;
    if (gamePaused) return;

    const config = difficultySettings[currentDifficulty];
    bird.velocity += config.gravity;
    bird.y += bird.velocity;

    let skyGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    skyGrad.addColorStop(0, '#4facfe');
    skyGrad.addColorStop(1, '#00f2fe');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (currentTime - lastPipeSpawnTime > config.spawnInterval) {
        pipes.push(new PipePair(config));
        lastPipeSpawnTime = currentTime;
    }

    pipes = pipes.filter(p => p.x > -p.width);
    pipes.forEach(p => {
        p.update();
        p.draw();
        if (!p.passed && p.x + p.width < bird.x) {
            p.passed = true;
            score += 10 * config.scoreMultiplier;
            scoreEl.textContent = score;
            sfxScore();
        }
        if (bird.x + bird.radius > p.x && bird.x - bird.radius < p.x + p.width) {
            if (bird.y - bird.radius < p.topHeight || bird.y + bird.radius > p.bottomY) {
                triggerGameOver();
            }
        }
    });

    ctx.beginPath();
    ctx.fillStyle = '#ffeb3b';
    ctx.strokeStyle = '#f57f17';
    ctx.lineWidth = 2;
    ctx.arc(bird.x, bird.y, bird.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.fillStyle = '#fff';
    ctx.arc(bird.x + 6, bird.y - 4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#000';
    ctx.arc(bird.x + 7, bird.y - 4, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#ff5722';
    ctx.moveTo(bird.x + 12, bird.y);
    ctx.lineTo(bird.x + 22, bird.y + 3);
    ctx.lineTo(bird.x + 11, bird.y + 6);
    ctx.closePath();
    ctx.fill();

    if (bird.y + bird.radius >= canvas.height || bird.y - bird.radius <= 0) triggerGameOver();
    if (gameRunning) requestAnimationFrame(gameLoop);
}

function triggerGameOver() {
    isGameOver  = true;
    gameRunning = false;
    sfxHit();
    setTimeout(sfxDie, 100);
    saveBest(score);
    if (bestScoreEl) bestScoreEl.textContent = getBest();
    finalScoreEl.textContent = score;
    gameOverScreen.classList.remove('hidden');
}

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    canvas        = document.getElementById('gameCanvas');
    ctx           = canvas.getContext('2d');
    scoreEl       = document.getElementById('score');
    finalScoreEl  = document.getElementById('final-score');
    bestScoreEl   = document.getElementById('best-score');
    titleBestEl   = document.getElementById('title-best');
    startMenu     = document.getElementById('start-menu');
    gameOverScreen = document.getElementById('game-over-screen');
    restartBtn    = document.getElementById('restart-btn');

    if (titleBestEl) titleBestEl.textContent = getBest();

    canvas.width  = GAME_WIDTH;
    canvas.height = GAME_HEIGHT;

    const diffButtons = document.querySelectorAll('.btn-group .menu-btn');

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);

    document.getElementById('pause-btn').addEventListener('click', togglePause);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gameRunning && !isGameOver) { togglePause(); return; }
        if (e.code === 'Space' || e.code === 'ArrowUp') { flap(); e.preventDefault(); }
    });

    canvas.addEventListener('mousedown', flap);
    canvas.addEventListener('touchstart', (e) => { flap(); e.preventDefault(); }, { passive: false });

    diffButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            startNewGame(btn.getAttribute('data-difficulty'));
        });
    });

    if (restartBtn) {
        restartBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (titleBestEl) titleBestEl.textContent = getBest();
            gameOverScreen.classList.add('hidden');
            startMenu.classList.remove('hidden');
        });
    }

    resizeCanvas();
});
