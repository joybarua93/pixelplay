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
function sfxDrop()    { SFX.play({ frequency: 150, type: 'sine',     duration: 0.3,  volume: 0.3,  slide: -80 }); }
function sfxExplode() { SFX.noise({ duration: 0.35, volume: 0.5, lowpass: 500 }); }
function sfxBounce()  { SFX.play({ frequency: 440, type: 'square',  duration: 0.06, volume: 0.2,  slide: 100 }); }
function sfxPickup()  { SFX.play({ frequency: 660, type: 'sine',    duration: 0.1,  volume: 0.25, slide: 220 }); }
function sfxDie() {
    SFX.noise({ duration: 0.4, volume: 0.5, lowpass: 300 });
    setTimeout(() => SFX.play({ frequency: 150, type: 'sawtooth', duration: 0.5, volume: 0.3, slide: -100 }), 100);
}
function sfxWave() {
    [330, 440, 550].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.1, volume: 0.2 }), i * 60));
}

// ─── Pause & localStorage ─────────────────────────────────────────────────
let gamePaused = false;
let pauseStartTime = 0;

const STORAGE_KEY = 'pixelplay_boomer_best';
function getBest()       { return parseInt(localStorage.getItem(STORAGE_KEY) || '0'); }
function saveBest(score) { if (score > getBest()) localStorage.setItem(STORAGE_KEY, String(score)); }

function togglePause() {
    gamePaused = !gamePaused;
    document.getElementById('pause-overlay').style.display = gamePaused ? 'flex' : 'none';
    document.getElementById('pause-btn').style.display = gamePaused ? 'none' : 'flex';
    if (gamePaused) {
        pauseStartTime = performance.now();
    } else {
        lastDropTime += performance.now() - pauseStartTime;
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

// ─── DOM References ───────────────────────────────────────────────────────
let canvas, ctx, scoreEl, livesEl, finalScoreEl, bestScoreEl, titleBestEl,
    startMenu, gameOverScreen, restartBtn;

// ─── Game State ───────────────────────────────────────────────────────────
let score = 0;
let lives = 3;
let isGameOver = false;
let gameRunning = false;
let bombs = [];
let lastDropTime = 0;
let currentDifficulty = 'medium';

const difficultySettings = {
    easy:   { bucketWidth: 90,  bombSpeed: 2.5, bomberSpeed: 4,  dropRate: 1400, erraticness: 0.02, scoreMultiplier: 1, minDropRate: 600, maxBombSpeed:  6 },
    medium: { bucketWidth: 65,  bombSpeed: 4,   bomberSpeed: 6,  dropRate: 900,  erraticness: 0.05, scoreMultiplier: 2, minDropRate: 400, maxBombSpeed:  9 },
    hard:   { bucketWidth: 45,  bombSpeed: 7,   bomberSpeed: 9,  dropRate: 500,  erraticness: 0.1,  scoreMultiplier: 3, minDropRate: 250, maxBombSpeed: 13 }
};

const player = { x: 0, y: 0, width: 75, height: 25 };
const bomber = { x: 0, y: 20, width: 60, height: 40, direction: 1, speed: 5 };

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

    player.y = canvas.height - 40;
    bomber.y  = 60;
    if (!gameRunning) {
        player.x = (canvas.width - player.width) / 2;
        bomber.x = (canvas.width - bomber.width) / 2;
    }
}

function trackInput(e) {
    if (!gameRunning || isGameOver || gamePaused) return;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    let targetX   = clientX - (player.width / 2);
    targetX = Math.max(0, Math.min(targetX, canvas.width - player.width));
    player.x = targetX;
}

class Bomb {
    constructor(x, speed) {
        this.x = x;
        this.y = bomber.y + bomber.height;
        this.radius = 12;
        this.speed = speed + (Math.random() * 2);
        this.isCaught = false;
    }
    update() { this.y += this.speed; }
    draw() {
        ctx.save();
        ctx.shadowColor = '#F97316';
        ctx.shadowBlur  = 20;
        ctx.beginPath();
        ctx.fillStyle = '#F97316';
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        // Fuse
        ctx.beginPath();
        ctx.strokeStyle = '#F5C200';
        ctx.lineWidth = 2;
        ctx.moveTo(this.x, this.y - this.radius);
        ctx.lineTo(this.x + 4, this.y - this.radius - 8);
        ctx.stroke();
    }
}

function startNewGame(difficultySelection) {
    currentDifficulty = difficultySelection;
    const config = difficultySettings[currentDifficulty];
    score      = 0;
    lives      = 3;
    isGameOver = false;
    gameRunning = true;
    gamePaused = false;
    bombs      = [];
    player.width  = config.bucketWidth;
    bomber.speed  = config.bomberSpeed;
    document.getElementById('pause-overlay').style.display = 'none';
    scoreEl.textContent = score;
    livesEl.textContent = `LIVES: ${lives}`;
    startMenu.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';
    resizeCanvas();
    lastDropTime = performance.now();
    sfxWave();
    requestAnimationFrame(gameLoop);
}

function updateBomber(config) {
    bomber.x += bomber.speed * bomber.direction;
    if (bomber.x <= 0) {
        bomber.x = 0;
        bomber.direction = 1;
        sfxBounce();
    } else if (bomber.x + bomber.width >= canvas.width) {
        bomber.x = canvas.width - bomber.width;
        bomber.direction = -1;
        sfxBounce();
    }
    if (Math.random() < config.erraticness) bomber.direction *= -1;
}

function drawBomber() {
    ctx.fillStyle = '#f44336';
    ctx.fillRect(bomber.x, bomber.y, bomber.width, bomber.height);
    ctx.fillStyle = '#fff';
    ctx.fillRect(bomber.x + 10, bomber.y + 10, 10, 10);
    ctx.fillRect(bomber.x + 40, bomber.y + 10, 10, 10);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(bomber.x + 5,  bomber.y + 5);
    ctx.lineTo(bomber.x + 22, bomber.y + 12);
    ctx.moveTo(bomber.x + 55, bomber.y + 5);
    ctx.lineTo(bomber.x + 38, bomber.y + 12);
    ctx.stroke();
}

function drawPlayer() {
    ctx.fillStyle = '#00d4ff';
    for (let i = 0; i < lives; i++) {
        ctx.fillRect(player.x, player.y - (i * 8), player.width, player.height);
        ctx.strokeStyle = '#0088aa';
        ctx.strokeRect(player.x, player.y - (i * 8), player.width, player.height);
    }
}

function triggerScreenShake() {
    canvas.style.transform = `translate(${Math.random() * 10 - 5}px, ${Math.random() * 10 - 5}px)`;
    setTimeout(() => { canvas.style.transform = 'translate(0, 0)'; }, 50);
}

function gameLoop(currentTime) {
    if (!gameRunning || isGameOver) return;
    if (gamePaused) return;
    const config = difficultySettings[currentDifficulty];

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    updateBomber(config);
    drawBomber();

    let currentDropRate = Math.max(config.minDropRate, config.dropRate - (score * 0.8));
    if (currentTime - lastDropTime > currentDropRate) {
        const bombSpeed = Math.min(config.maxBombSpeed, config.bombSpeed + (score * 0.02));
        bombs.push(new Bomb(bomber.x + (bomber.width / 2), bombSpeed));
        lastDropTime = currentTime;
        sfxDrop();
    }

    bombs = bombs.filter(b => {
        let active = true;
        b.update();
        b.draw();

        if (b.y + b.radius >= player.y && b.y - b.radius <= player.y + player.height) {
            if (b.x > player.x && b.x < player.x + player.width) {
                active = false;
                score += 10 * config.scoreMultiplier;
                scoreEl.textContent = score;
                sfxPickup();
            }
        }

        if (active && b.y > canvas.height) {
            active = false;
            lives--;
            livesEl.textContent = `LIVES: ${lives}`;
            sfxExplode();
            triggerScreenShake();
            ctx.fillStyle = 'rgba(255, 62, 62, 0.3)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            if (lives <= 0) {
                isGameOver  = true;
                gameRunning = false;
                sfxDie();
                saveBest(score);
                if (bestScoreEl) bestScoreEl.textContent = getBest();
                finalScoreEl.textContent = score;
                gameOverScreen.classList.remove('hidden');
            }
        }
        return active;
    });

    drawPlayer();
    if (gameRunning) requestAnimationFrame(gameLoop);
}

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    canvas         = document.getElementById('gameCanvas');
    ctx            = canvas.getContext('2d');
    scoreEl        = document.getElementById('score');
    livesEl        = document.getElementById('lives-display');
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
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gameRunning && !isGameOver) togglePause();
    });
    document.getElementById('pause-btn').addEventListener('click', togglePause);

    canvas.addEventListener('mousemove', trackInput);
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); trackInput(e); }, { passive: false });

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
