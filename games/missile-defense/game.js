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
function sfxFire()      { SFX.play({ frequency: 800, type: 'sawtooth', duration: 0.12, volume: 0.25, slide: 400 }); }
function sfxExplode()   { SFX.noise({ duration: 0.3, volume: 0.45, lowpass: 700 }); }
function sfxIntercept() {
    SFX.noise({ duration: 0.15, volume: 0.4, lowpass: 500 });
    setTimeout(() => SFX.play({ frequency: 220, type: 'sine', duration: 0.2, volume: 0.2, slide: 440 }), 100);
}
function sfxCityHit() {
    SFX.noise({ duration: 0.5, volume: 0.6, lowpass: 300 });
    setTimeout(() => SFX.play({ frequency: 80, type: 'sawtooth', duration: 0.4, volume: 0.35, slide: -60 }), 200);
}
function sfxWave() {
    [220, 277, 330, 440].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.15, volume: 0.2 }), i * 100));
}
function sfxGameOver() { SFX.play({ frequency: 110, type: 'sawtooth', duration: 1.0, volume: 0.35, slide: -80 }); }

// ─── Pause & localStorage ─────────────────────────────────────────────────
let gamePaused = false;
let pauseStartTime = 0;

const STORAGE_KEY = 'pixelplay_missiledefense_best';
function getBest()       { return parseInt(localStorage.getItem(STORAGE_KEY) || '0'); }
function saveBest(score) { if (score > getBest()) localStorage.setItem(STORAGE_KEY, String(score)); }

function togglePause() {
    gamePaused = !gamePaused;
    document.getElementById('pause-overlay').style.display = gamePaused ? 'flex' : 'none';
    document.getElementById('pause-btn').style.display = gamePaused ? 'none' : 'flex';
    if (gamePaused) {
        pauseStartTime = performance.now();
    } else {
        lastSpawnTime += performance.now() - pauseStartTime;
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


// ─── DOM References (assigned in DOMContentLoaded) ────────────────────────
let canvas, ctx, scoreEl, finalScoreEl, bestScoreEl, titleBestEl,
    startMenu, gameOverScreen, restartBtn;

// ─── Game State ───────────────────────────────────────────────────────────
let score = 0;
let isGameOver = false;
let gameRunning = false;
let enemyMissiles = [];
let playerMissiles = [];
let explosions = [];
let lastSpawnTime = 0;
let cities = [];
let currentDifficulty = 'medium';

const difficultySettings = {
    easy:   { spawnRate: 2200, speedModifier: 0.6, hitboxRadius: 8,   scoreMultiplier: 1 },
    medium: { spawnRate: 1500, speedModifier: 1.1, hitboxRadius: 4.5, scoreMultiplier: 2 },
    hard:   { spawnRate: 1000, speedModifier: 1.8, hitboxRadius: 3,   scoreMultiplier: 3 }
};

const battery = { x: 0, y: 0 };

// ─── Title Animation ──────────────────────────────────────────────────────
let radarAngle = 0;
let titleAnimFrame = null;

function drawTitleAnimation() {
    if (gameRunning) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Fine green grid
    ctx.strokeStyle = 'rgba(0,80,0,0.3)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 40) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 40) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
    }

    // Radar sweep
    const cx = canvas.width / 2;
    const cy = canvas.height * 0.38;
    const radius = Math.min(canvas.width * 0.38, canvas.height * 0.32);
    radarAngle += 0.022;
    for (let i = 0; i < 30; i++) {
        const a = radarAngle - (i * 0.05);
        const alpha = (1 - i / 30) * 0.45;
        ctx.strokeStyle = `rgba(57,255,20,${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
        ctx.stroke();
    }

    // City silhouettes at bottom
    const cityCount = 4;
    const spacing = canvas.width / (cityCount + 1);
    for (let i = 1; i <= cityCount; i++) {
        const cx2 = spacing * i;
        ctx.fillStyle = 'rgba(57,255,20,0.25)';
        ctx.fillRect(cx2 - 20, canvas.height - 40, 40, 20);
        ctx.fillRect(cx2 - 8,  canvas.height - 58, 16, 18);
    }

    if (!gameRunning) titleAnimFrame = requestAnimationFrame(drawTitleAnimation);
}

// ─── Game Functions ───────────────────────────────────────────────────────
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

    battery.x = canvas.width  / 2;
    battery.y = canvas.height - 30;

    if (!gameRunning) buildCities();
}

function buildCities() {
    cities = [];
    const count = 4;
    const spacing = canvas.width / (count + 1);
    for (let i = 1; i <= count; i++) {
        cities.push({ x: spacing * i, y: canvas.height - 20, width: 40, height: 20, alive: true });
    }
}

class EnemyMissile {
    constructor(settings) {
        this.startX = Math.random() * canvas.width;
        this.startY = 0;
        this.x = this.startX;
        this.y = this.startY;
        this.hitboxRadius = settings.hitboxRadius;
        const targets = cities.filter(c => c.alive).concat([battery]);
        const target = targets[Math.floor(Math.random() * targets.length)];
        this.targetX = target ? target.x : Math.random() * canvas.width;
        this.targetY = canvas.height;
        const angle = Math.atan2(this.targetY - this.startY, this.targetX - this.startX);
        this.speed = (1 + Math.random() * 1.2) * settings.speedModifier + (score * 0.02);
        this.dx = Math.cos(angle) * this.speed;
        this.dy = Math.sin(angle) * this.speed;
    }
    update() { this.x += this.dx; this.y += this.dy; }
    draw() {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255,62,62,0.35)';
        ctx.lineWidth = 1.5;
        ctx.moveTo(this.startX, this.startY);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = '#ff3e3e';
        ctx.arc(this.x, this.y, this.hitboxRadius, 0, Math.PI * 2);
        ctx.fill();
    }
}

class PlayerMissile {
    constructor(targetX, targetY) {
        this.startX = battery.x;
        this.startY = battery.y;
        this.x = this.startX;
        this.y = this.startY;
        this.targetX = targetX;
        this.targetY = targetY;
        const angle = Math.atan2(targetY - this.startY, targetX - this.startX);
        this.speed = 8;
        this.dx = Math.cos(angle) * this.speed;
        this.dy = Math.sin(angle) * this.speed;
        this.exploded = false;
    }
    update() {
        this.x += this.dx;
        this.y += this.dy;
        const dist = Math.hypot(this.targetX - this.x, this.targetY - this.y);
        if (dist < this.speed) {
            this.exploded = true;
            sfxExplode();
            explosions.push(new Explosion(this.targetX, this.targetY));
        }
    }
    draw() {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0,212,255,0.3)';
        ctx.lineWidth = 1;
        ctx.moveTo(this.startX, this.startY);
        ctx.lineTo(this.x, this.y);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = '#00d4ff';
        ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

class Explosion {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.radius = 1;
        this.maxRadius = 45;
        this.growthRate = 1.6;
        this.isDone = false;
    }
    update() {
        if (this.radius < this.maxRadius && this.growthRate > 0) {
            this.radius += this.growthRate;
        } else {
            this.growthRate = -1.2;
            this.radius += this.growthRate;
            if (this.radius <= 0) { this.radius = 0; this.isDone = true; }
        }
    }
    draw() {
        ctx.beginPath();
        ctx.fillStyle = `rgba(0,212,255,${0.15 + (this.radius / this.maxRadius) * 0.4})`;
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.stroke();
    }
}

function fireMissile(e) {
    if (!gameRunning || isGameOver || gamePaused) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const targetX = clientX - rect.left;
    const targetY = clientY - rect.top;
    if (targetY < canvas.height - 40) {
        playerMissiles.push(new PlayerMissile(targetX, targetY));
        sfxFire();
    }
}

function startNewGame(difficultySelection) {
    currentDifficulty = difficultySelection;
    score          = 0;
    isGameOver     = false;
    gameRunning    = true;
    gamePaused     = false;
    enemyMissiles  = [];
    playerMissiles = [];
    explosions     = [];
    resizeCanvas();
    buildCities();
    document.getElementById('pause-overlay').style.display = 'none';
    scoreEl.textContent = score;
    startMenu.classList.add('hidden');
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';
    gameOverScreen.classList.add('hidden');
    if (titleAnimFrame) { cancelAnimationFrame(titleAnimFrame); titleAnimFrame = null; }
    lastSpawnTime = performance.now();
    sfxWave();
    requestAnimationFrame(gameLoop);
}

function gameLoop(currentTime) {
    if (!gameRunning || isGameOver) return;
    if (gamePaused) return;
    const config = difficultySettings[currentDifficulty];

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (currentTime - lastSpawnTime > Math.max(300, config.spawnRate - (score * 10))) {
        enemyMissiles.push(new EnemyMissile(config));
        lastSpawnTime = currentTime;
    }

    cities.forEach(city => {
        if (city.alive) {
            ctx.fillStyle = '#2e7d32';
            ctx.fillRect(city.x - city.width / 2, city.y, city.width, city.height);
        }
    });
    ctx.fillStyle = '#00d4ff';
    ctx.fillRect(battery.x - 15, battery.y, 30, 10);

    playerMissiles = playerMissiles.filter(pm => !pm.exploded);
    playerMissiles.forEach(pm => { pm.update(); pm.draw(); });

    explosions = explosions.filter(exp => !exp.isDone);
    explosions.forEach(exp => { exp.update(); exp.draw(); });

    enemyMissiles.forEach(em => em.update());
    enemyMissiles = enemyMissiles.filter(em => {
        let destroyed = false;
        explosions.forEach(exp => {
            const dist = Math.hypot(exp.x - em.x, exp.y - em.y);
            if (dist < exp.radius + em.hitboxRadius) {
                destroyed = true;
                score += 10 * config.scoreMultiplier;
                scoreEl.textContent = score;
                sfxIntercept();
            }
        });
        if (em.y >= canvas.height - 20) {
            destroyed = true;
            cities.forEach(city => {
                if (city.alive && Math.abs(em.x - city.x) < city.width) {
                    city.alive = false;
                    sfxCityHit();
                }
            });
            explosions.push(new Explosion(em.x, em.y));
        }
        return !destroyed;
    });
    enemyMissiles.forEach(em => em.draw());

    const activeCities = cities.filter(c => c.alive).length;
    if (activeCities === 0) {
        isGameOver  = true;
        gameRunning = false;
        sfxGameOver();
        saveBest(score);
        if (bestScoreEl) bestScoreEl.textContent = getBest();
        finalScoreEl.textContent = score;
        gameOverScreen.classList.remove('hidden');
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

    const diffButtons = document.querySelectorAll('.btn-group .menu-btn');

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);
    document.getElementById('pause-btn').addEventListener('click', togglePause);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gameRunning && !isGameOver) togglePause();
    });

    canvas.addEventListener('mousedown', fireMissile);
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); fireMissile(e); }, { passive: false });

    diffButtons.forEach(btn => {
        btn.addEventListener('click', () => startNewGame(btn.getAttribute('data-difficulty')));
    });

    if (restartBtn) {
        restartBtn.addEventListener('click', () => {
            if (titleBestEl) titleBestEl.textContent = getBest();
            gameOverScreen.classList.add('hidden');
            startMenu.classList.remove('hidden');
            if (!titleAnimFrame) drawTitleAnimation();
        });
    }

    resizeCanvas();
    drawTitleAnimation();

});
