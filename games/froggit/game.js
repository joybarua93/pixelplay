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


// ─── DOM References (assigned in DOMContentLoaded) ────────────────────────
let canvas, ctx, scoreEl, finalScoreEl, bestScoreEl, titleBestEl,
    startMenu, gameOverScreen, restartBtn;

// ─── Game Metrics ─────────────────────────────────────────────────────────
let gridX, gridY;

function resizeCanvas() {
    if (!canvas) return;
    const winW = window.innerWidth;
    const winH = window.innerHeight;

    canvas.width  = winW;
    canvas.height = winH;
    canvas.style.width    = winW + 'px';
    canvas.style.height   = winH + 'px';
    canvas.style.position = 'fixed';
    canvas.style.left     = '0px';
    canvas.style.top      = '0px';

    gridY = canvas.height / 11;
    gridX = canvas.width  / 13;

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
        const x = this.x, y = this.y, w = this.width, h = this.height;
        ctx.save();

        // Car body
        ctx.beginPath();
        ctx.roundRect(x, y + h * 0.15, w, h * 0.7, 4);
        ctx.fillStyle = this.color;
        ctx.fill();

        // Cabin/roof
        const roofX = this.direction === 1 ? x + w * 0.2 : x + w * 0.1;
        ctx.beginPath();
        ctx.roundRect(roofX, y, w * 0.7, h * 0.55, 4);
        ctx.fillStyle = this.color;
        ctx.fill();

        // Windshield
        const windX = this.direction === 1 ? x + w * 0.55 : x + w * 0.15;
        ctx.beginPath();
        ctx.roundRect(windX, y + h * 0.05, w * 0.25, h * 0.42, 2);
        ctx.fillStyle = 'rgba(180,230,255,0.7)';
        ctx.fill();

        // Headlights (yellow-white)
        ctx.fillStyle = '#fffde7';
        if (this.direction === 1) {
            ctx.fillRect(x + w - 5, y + h * 0.2,  5, 6);
            ctx.fillRect(x + w - 5, y + h * 0.65, 5, 6);
        } else {
            ctx.fillRect(x, y + h * 0.2,  5, 6);
            ctx.fillRect(x, y + h * 0.65, 5, 6);
        }

        // Taillights (red)
        ctx.fillStyle = '#ff1744';
        if (this.direction === 1) {
            ctx.fillRect(x, y + h * 0.2,  4, 5);
            ctx.fillRect(x, y + h * 0.65, 4, 5);
        } else {
            ctx.fillRect(x + w - 4, y + h * 0.2,  4, 5);
            ctx.fillRect(x + w - 4, y + h * 0.65, 4, 5);
        }

        ctx.restore();
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

function drawFrog() {
    const x = frog.x, y = frog.y, w = frog.width, h = frog.height;
    const cx = x + w / 2, cy = y + h / 2;
    ctx.save();

    // Back legs
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.32, cy + h * 0.22, w * 0.14, h * 0.12, -0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#2da856'; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.32, cy + h * 0.22, w * 0.14, h * 0.12,  0.3, 0, Math.PI * 2);
    ctx.fillStyle = '#2da856'; ctx.fill();

    // Front legs
    ctx.beginPath();
    ctx.ellipse(cx - w * 0.36, cy - h * 0.02, w * 0.1, h * 0.1, -0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#2da856'; ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.36, cy - h * 0.02, w * 0.1, h * 0.1,  0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#2da856'; ctx.fill();

    // Body
    ctx.beginPath();
    ctx.ellipse(cx, cy + h * 0.05, w * 0.38, h * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#3DC46A'; ctx.fill();
    ctx.strokeStyle = '#1a7a40'; ctx.lineWidth = 1.5; ctx.stroke();

    // Eyes
    const eyeR = w * 0.11, eyeY = cy - h * 0.18;
    [cx - w * 0.18, cx + w * 0.18].forEach(ex => {
        ctx.beginPath(); ctx.arc(ex, eyeY, eyeR, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.beginPath(); ctx.arc(ex, eyeY, eyeR * 0.55, 0, Math.PI * 2);
        ctx.fillStyle = '#111'; ctx.fill();
    });

    // Smile
    ctx.beginPath();
    ctx.arc(cx, cy + h * 0.02, w * 0.15, 0.2, Math.PI - 0.2);
    ctx.strokeStyle = '#1a7a40'; ctx.lineWidth = 1.5; ctx.stroke();

    ctx.restore();
}

function gameLoop() {
    if (!gameRunning || isGameOver) return;
    if (gamePaused) return;
    const config = difficultySettings[currentDifficulty];

    // Full background
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Road lanes (rows 1–9) with alternating dark stripes
    for (let row = 1; row <= 9; row++) {
        ctx.fillStyle = row % 2 === 0 ? '#1a1a2e' : '#16213e';
        ctx.fillRect(0, row * gridY, canvas.width, gridY);
        if (row < 9) {
            ctx.setLineDash([gridX * 0.4, gridX * 0.4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, (row + 1) * gridY);
            ctx.lineTo(canvas.width, (row + 1) * gridY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // Water zone (top row)
    ctx.fillStyle = '#0f3460';
    ctx.fillRect(0, 0, canvas.width, gridY);

    // Safe zone (bottom row)
    ctx.fillStyle = '#1e3a1e';
    ctx.fillRect(0, canvas.height - gridY, canvas.width, gridY);

    // Lily pads — circles with notch and flower
    targetLilyPads.forEach(pad => {
        const cx = pad.x + pad.width / 2;
        const cy = pad.y + pad.height / 2;
        const r  = Math.min(pad.width, pad.height) / 2;

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = pad.reached ? '#00d4ff' : '#2e7d32';
        ctx.fill();
        ctx.strokeStyle = pad.reached ? '#0099bb' : '#1a5c1a';
        ctx.lineWidth = 2; ctx.stroke();

        if (!pad.reached) {
            // V-notch
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx - r * 0.35, cy - r);
            ctx.lineTo(cx + r * 0.35, cy - r);
            ctx.closePath();
            ctx.fillStyle = '#1a6b32'; ctx.fill();
            // Flower
            ctx.beginPath();
            ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
            ctx.fillStyle = '#F5C200'; ctx.fill();
        }
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

    drawFrog();

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

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

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

    let touchStartX = 0, touchStartY = 0;
    const SWIPE_MIN  = 30;
    const SWIPE_COOL = 200;
    let lastSwipeTime = 0;

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const now = Date.now();
        if (now - lastSwipeTime < SWIPE_COOL) return;
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        const absDx = Math.abs(dx), absDy = Math.abs(dy);
        if (Math.max(absDx, absDy) < SWIPE_MIN) return;
        lastSwipeTime = now;
        if (absDx > absDy) moveFrog(dx > 0 ? 'right' : 'left');
        else               moveFrog(dy > 0 ? 'down' : 'up');
    }, { passive: false });

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
