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
function sfxHop()    { SFX.play({ frequency: 300, type: 'sine',     duration: 0.08, volume: 0.2, slide: 100 }); }
function sfxSquish() { SFX.noise({ duration: 0.25, volume: 0.45, lowpass: 300 }); }
function sfxHome()   {
    [523, 659, 784].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.12, volume: 0.25 }), i * 80));
}
function sfxWin() {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.15, volume: 0.3 }), i * 100));
}
function sfxDie()    { SFX.play({ frequency: 200, type: 'sawtooth', duration: 0.4, volume: 0.3, slide: -150 }); }

// ─── Pause & localStorage ─────────────────────────────────────────────────
let gamePaused = false;

const STORAGE_KEY = 'pixelplay_froggit_best';
function getBest()       { return parseInt(localStorage.getItem(STORAGE_KEY) || '0'); }
function saveBest(score) { if (score > getBest()) localStorage.setItem(STORAGE_KEY, String(score)); }

function togglePause() {
    gamePaused = !gamePaused;
    document.getElementById('pause-overlay').style.display = gamePaused ? 'flex' : 'none';
    document.getElementById('pause-btn').style.display = gamePaused ? 'none' : 'flex';
    if (!gamePaused) resumeGameLoop();
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

// ─── DOM References (assigned in DOMContentLoaded) ────────────────────────
let canvas, ctx, scoreEl, finalScoreEl, bestScoreEl, titleBestEl,
    startMenu, gameOverScreen, restartBtn;

// ─── Game Metrics ─────────────────────────────────────────────────────────
let gridX, gridY;

function resizeCanvas() {
    if (!canvas) return;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    let newW, newH;
    if (winW / winH > ASPECT) { newH = winH; newW = newH * ASPECT; }
    else                       { newW = winW; newH = newW / ASPECT; }
    canvas.style.width  = newW + 'px';
    canvas.style.height = newH + 'px';
    gridY = GAME_HEIGHT / 11;
    gridX = GAME_WIDTH  / 13;
    if (gameRunning) resetFrogPosition();
}

// ─── Game State ───────────────────────────────────────────────────────────
let score = 0;
let isGameOver = false;
let gameRunning = false;
let vehicles = [];
let targetLilyPads = [];
let currentDifficulty = 'medium';

const difficultySettings = {
    easy:   { speedModifier: 0.7, carSpawnGap: 350, scoreMultiplier: 1, hitboxSizeReduction: 6 },
    medium: { speedModifier: 1.2, carSpawnGap: 240, scoreMultiplier: 2, hitboxSizeReduction: 2 },
    hard:   { speedModifier: 2.0, carSpawnGap: 160, scoreMultiplier: 3, hitboxSizeReduction: 0 }
};

const frog = { x: 0, y: 0, width: 0, height: 0 };

function resetFrogPosition() {
    frog.width  = gridY * 0.65;
    frog.height = gridY * 0.65;
    frog.x = (canvas.width / 2) - (frog.width / 2);
    frog.y = canvas.height - gridY + (gridY - frog.height) / 2;
}

function initLilyPads() {
    targetLilyPads = [];
    const padWidth = gridX * 1.5;
    const count    = 4;
    const spacing  = canvas.width / (count + 1);
    for (let i = 1; i <= count; i++) {
        targetLilyPads.push({
            x: (spacing * i) - (padWidth / 2),
            y: gridY * 0.5,
            width: padWidth,
            height: gridY * 0.8,
            reached: false
        });
    }
}

class Vehicle {
    constructor(row, direction, speed, color) {
        this.row       = row;
        this.direction = direction;
        this.width     = gridX * (1.2 + Math.random() * 0.8);
        this.height    = gridY * 0.65;
        this.y         = (row * gridY) + (gridY - this.height) / 2;
        this.speed     = speed * direction;
        this.color     = color;
        this.x = direction === 1 ? -this.width : canvas.width;
    }
    update() { this.x += this.speed; }
    draw() {
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.width, this.height);
        ctx.fillStyle = '#fff';
        if (this.direction === 1) {
            ctx.fillRect(this.x + this.width - 6, this.y + 4,               6, 6);
            ctx.fillRect(this.x + this.width - 6, this.y + this.height - 10, 6, 6);
        } else {
            ctx.fillRect(this.x, this.y + 4,               6, 6);
            ctx.fillRect(this.x, this.y + this.height - 10, 6, 6);
        }
    }
}

const laneConfigs = [
    { dir:  1, speed: 1.5, color: '#ff3e3e' },
    { dir: -1, speed: 2.2, color: '#ff9800' },
    { dir:  1, speed: 1.8, color: '#e91e63' },
    { dir: -1, speed: 3.0, color: '#00d4ff' },
    { dir:  1, speed: 1.2, color: '#9c27b0' },
    { dir: -1, speed: 2.0, color: '#ffeb3b' },
    { dir:  1, speed: 2.5, color: '#ff5722' },
    { dir: -1, speed: 1.6, color: '#00ffff' },
    { dir:  1, speed: 2.0, color: '#ff3e3e' }
];

function handleSpawning(config) {
    laneConfigs.forEach((lane, index) => {
        const row = index + 1;
        const laneVehicles = vehicles.filter(v => v.row === row);
        let canSpawn = false;
        if (laneVehicles.length === 0) {
            canSpawn = true;
        } else {
            const lastCar = laneVehicles[laneVehicles.length - 1];
            if (lane.dir === 1  && lastCar.x > config.carSpawnGap) canSpawn = true;
            if (lane.dir === -1 && lastCar.x < canvas.width - config.carSpawnGap - lastCar.width) canSpawn = true;
        }
        if (canSpawn && Math.random() < 0.02) {
            vehicles.push(new Vehicle(row, lane.dir, lane.speed * config.speedModifier, lane.color));
        }
    });
}

function moveFrog(dir) {
    if (!gameRunning || isGameOver || gamePaused) return;
    switch(dir) {
        case 'up':    if (frog.y - gridY > 0)                       { frog.y -= gridY; sfxHop(); } break;
        case 'down':  if (frog.y + gridY < canvas.height)            { frog.y += gridY; sfxHop(); } break;
        case 'left':  if (frog.x - gridX > 0)                        { frog.x -= gridX; sfxHop(); } break;
        case 'right': if (frog.x + gridX < canvas.width - frog.width){ frog.x += gridX; sfxHop(); } break;
    }
}

function startNewGame(difficultySelection) {
    currentDifficulty = difficultySelection;
    score      = 0;
    isGameOver = false;
    gameRunning = true;
    gamePaused = false;
    vehicles   = [];
    document.getElementById('pause-overlay').style.display = 'none';
    scoreEl.textContent = score;
    startMenu.classList.add('hidden');
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';
    gameOverScreen.classList.add('hidden');
    resizeCanvas();
    initLilyPads();
    requestAnimationFrame(gameLoop);
}

function gameLoop() {
    if (!gameRunning || isGameOver) return;
    if (gamePaused) return;
    const config = difficultySettings[currentDifficulty];

    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, canvas.height - gridY, canvas.width, gridY);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, gridY);

    targetLilyPads.forEach(pad => {
        ctx.fillStyle = pad.reached ? '#00d4ff' : '#2e7d32';
        ctx.fillRect(pad.x, pad.y, pad.width, pad.height);
    });

    handleSpawning(config);
    vehicles = vehicles.filter(v => v.x > -v.width && v.x < canvas.width + v.width);
    vehicles.forEach(v => {
        v.update();
        v.draw();
        const pad = config.hitboxSizeReduction;
        if (frog.x + pad < v.x + v.width &&
            frog.x + frog.width - pad > v.x &&
            frog.y + pad < v.y + v.height &&
            frog.y + frog.height - pad > v.y) {
            isGameOver  = true;
            gameRunning = false;
            sfxSquish();
            setTimeout(sfxDie, 150);
            saveBest(score);
            if (bestScoreEl) bestScoreEl.textContent = getBest();
            finalScoreEl.textContent = score;
            gameOverScreen.classList.remove('hidden');
        }
    });

    ctx.fillStyle = '#4caf50';
    ctx.fillRect(frog.x, frog.y, frog.width, frog.height);

    if (frog.y <= gridY) {
        let reachedPad = false;
        targetLilyPads.forEach(pad => {
            if (!pad.reached &&
                frog.x + (frog.width / 2) > pad.x &&
                frog.x + (frog.width / 2) < pad.x + pad.width) {
                pad.reached = true;
                reachedPad  = true;
                score += 100 * config.scoreMultiplier;
                scoreEl.textContent = score;
                sfxHome();
            }
        });
        if (reachedPad) {
            const allCleared = targetLilyPads.every(p => p.reached);
            if (allCleared) {
                score += 500 * config.scoreMultiplier;
                scoreEl.textContent = score;
                sfxWin();
                initLilyPads();
            }
        }
        resetFrogPosition();
    }

    if (gameRunning) requestAnimationFrame(gameLoop);
}

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    canvas         = document.getElementById('gameCanvas');
    ctx            = canvas.getContext('2d');
    scoreEl        = document.getElementById('score');
    finalScoreEl   = document.getElementById('final-score');
    bestScoreEl    = document.getElementById('best-score');
    titleBestEl    = document.getElementById('title-best');
    startMenu      = document.getElementById('start-menu');
    gameOverScreen = document.getElementById('game-over-screen');
    restartBtn     = document.getElementById('restart-btn');

    if (titleBestEl) titleBestEl.textContent = getBest();

    canvas.width  = GAME_WIDTH;
    canvas.height = GAME_HEIGHT;

    const diffButtons = document.querySelectorAll('.btn-group .menu-btn');

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);

    document.getElementById('pause-btn').addEventListener('click', togglePause);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gameRunning && !isGameOver) { togglePause(); return; }
        if (['ArrowUp',    'KeyW'].includes(e.code)) moveFrog('up');
        if (['ArrowDown',  'KeyS'].includes(e.code)) moveFrog('down');
        if (['ArrowLeft',  'KeyA'].includes(e.code)) moveFrog('left');
        if (['ArrowRight', 'KeyD'].includes(e.code)) moveFrog('right');
        if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });

    let touchStartX = 0;
    let touchStartY = 0;
    canvas.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });
    canvas.addEventListener('touchend', (e) => {
        if (!touchStartX || !touchStartY) return;
        const diffX = e.changedTouches[0].clientX - touchStartX;
        const diffY = e.changedTouches[0].clientY - touchStartY;
        if (Math.max(Math.abs(diffX), Math.abs(diffY)) > 30) {
            if (Math.abs(diffX) > Math.abs(diffY)) moveFrog(diffX > 0 ? 'right' : 'left');
            else moveFrog(diffY > 0 ? 'down' : 'up');
        }
        touchStartX = 0;
        touchStartY = 0;
    });

    diffButtons.forEach(btn => {
        btn.addEventListener('click', () => startNewGame(btn.getAttribute('data-difficulty')));
    });

    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            if (titleBestEl) titleBestEl.textContent = getBest();
            gameOverScreen.classList.add('hidden');
            startMenu.classList.remove('hidden');
        });
    }

    resizeCanvas();
});
