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
function sfxCue()          { SFX.play({ frequency: 220, type: 'square',   duration: 0.07, volume: 0.2, slide: 80 }); }
function sfxBallHit(speed) {
    const vol = Math.min(0.4, (speed || 10) * 0.015);
    SFX.play({ frequency: 900, type: 'sine', duration: 0.06, volume: vol, slide: -300 });
}
function sfxCushion()      { SFX.play({ frequency: 350, type: 'square',   duration: 0.06, volume: 0.18, slide: -120 }); }
function sfxPocket()       {
    [440, 330, 220].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.09, volume: 0.22 }), i * 55));
}
function sfxScratch()      { SFX.noise({ duration: 0.3, volume: 0.35, lowpass: 500 }); }
function sfxWin()          {
    [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.15, volume: 0.3 }), i * 80));
}

// ─── Pause & localStorage ─────────────────────────────────────────────────
let gamePaused = false;

const STORAGE_KEY = 'pixelplay_pool_best';
function getBest()  { return parseInt(localStorage.getItem(STORAGE_KEY) || '0'); }
function saveBest() {
    const wins = getBest() + 1;
    localStorage.setItem(STORAGE_KEY, String(wins));
}
function displayBest() { const b = getBest(); return b === 0 ? '—' : String(b); }

function togglePause() {
    if (!gameRunning || isGameOver) return;
    gamePaused = !gamePaused;
    document.getElementById('pause-overlay').style.display = gamePaused ? 'flex' : 'none';
    document.getElementById('pause-btn').style.display = gamePaused ? 'none' : 'flex';
    if (gamePaused) {
        clearTimeout(aiTimer);
        aiTimer = null;
    } else {
        if (currentPlayer === 2 && isVsAI && !isTableMoving() && !waitingForTurnEnd) {
            aiTimer = setTimeout(takeAITurn, 1200);
        }
        resumeGameLoop();
    }
}
function resumeGameLoop() { requestAnimationFrame(gameLoop); }
function restartGame() {
    document.getElementById('pause-overlay').style.display = 'none';
    gamePaused = false;
    startNewGame(isVsAI ? '1p' : '2p');
}
function goToTitleScreen() {
    gameRunning = false;
    gamePaused  = false;
    clearTimeout(aiTimer);
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'none';
    document.getElementById('pp-back').style.display = 'flex';
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('start-menu').classList.remove('hidden');
}

// ─── Responsive Canvas Dimensions ────────────────────────────────────────
const GAME_WIDTH  = 1400;
const GAME_HEIGHT = 700;
const ASPECT      = GAME_WIDTH / GAME_HEIGHT;

// ─── Matter.js Aliases ────────────────────────────────────────────────────
const Engine    = Matter.Engine,
      Bodies    = Matter.Bodies,
      Composite = Matter.Composite,
      Body      = Matter.Body,
      Vector    = Matter.Vector;

let canvas, ctx, score1El, score2El, turnIndicator, scratchWarning,
    startMenu, gameOverScreen, restartBtn, winnerText,
    bestScoreEl, titleBestEl, finalP1El, finalP2El;
let engine;

// ─── Match State ──────────────────────────────────────────────────────────
let p1Score = 0;
let p2Score = 0;
let currentPlayer = 1;
let isVsAI = false;
let isGameOver = false;
let gameRunning = false;
let ballsSunkThisTurn = 0;
let isFoul = false;

// ─── Physics Entities ─────────────────────────────────────────────────────
let cueBall;
let balls = [];
let pockets = [];
let walls = [];
const BALL_RADIUS = 12;

// ─── Aiming & AI State ────────────────────────────────────────────────────
let isAiming = false;
let dragCurrent = { x: 0, y: 0 };
const MAX_PULL = 150;
let aiTimer = null;

function initPhysics() {
    engine = Engine.create();
    engine.gravity.y = 0;
}

function buildTable() {
    Composite.clear(engine.world);
    balls = [];
    walls = [];
    pockets = [];

    const w = canvas.width;
    const h = canvas.height;

    const wallOptions = { isStatic: true, restitution: 0.8, friction: 0 };
    const wallThick = 50;

    walls.push(
        Bodies.rectangle(w/2, -wallThick/2,   w,       wallThick, wallOptions),
        Bodies.rectangle(w/2, h + wallThick/2, w,       wallThick, wallOptions),
        Bodies.rectangle(-wallThick/2,  h/2,   wallThick, h,       wallOptions),
        Bodies.rectangle(w + wallThick/2, h/2,  wallThick, h,       wallOptions)
    );
    Composite.add(engine.world, walls);

    const pRad = 24;
    pockets = [
        { x: 0,   y: 0, r: pRad }, { x: w/2, y: 0, r: pRad }, { x: w,   y: 0, r: pRad },
        { x: 0,   y: h, r: pRad }, { x: w/2, y: h, r: pRad }, { x: w,   y: h, r: pRad }
    ];

    const ballOptions = {
        restitution: 0.92,
        friction: 0.005,
        frictionAir: 0.012,
        density: 0.005,
        slop: 0.05
    };

    cueBall = Bodies.circle(w * 0.25, h * 0.5, BALL_RADIUS, ballOptions);
    cueBall.isCue = true;
    cueBall.color = '#ffffff';
    Composite.add(engine.world, cueBall);

    const startX = w * 0.65;
    const startY = h * 0.5;
    const stepX  = BALL_RADIUS * Math.sqrt(3) + 1;
    const stepY  = BALL_RADIUS * 2 + 1;

    let colorAlt = true;
    for (let col = 0; col < 5; col++) {
        for (let row = 0; row <= col; row++) {
            const bx = startX + (col * stepX);
            const by = startY - (col * stepY / 2) + (row * stepY);
            const isEight = (col === 2 && row === 1);

            const ball = Bodies.circle(bx, by, BALL_RADIUS, ballOptions);
            ball.color = isEight ? '#111' : (colorAlt ? '#f44336' : '#ffeb3b');
            colorAlt = !colorAlt;
            balls.push(ball);
        }
    }
    Composite.add(engine.world, balls);
}

function checkOrientation() {
    const warning = document.getElementById('orientation-warning');
    if (!warning) return;
    const isMobile  = window.innerWidth < 768;
    const isPortrait = window.innerHeight > window.innerWidth;
    warning.style.display = (isMobile && isPortrait) ? 'flex' : 'none';
}

function resizeCanvas() {
    if (!canvas) return;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const GAME_W = 1400;
    const GAME_H = 700;

    let dispW, dispH, left, top;

    if (winH > winW) {
        // PORTRAIT — scale to fill width
        dispW = winW;
        dispH = Math.floor(winW * (GAME_H / GAME_W));
        left  = 0;
        top   = Math.floor((winH - dispH) / 2);
    } else {
        // LANDSCAPE — normal fit
        const scale = Math.min(winW / GAME_W, winH / GAME_H);
        dispW = Math.floor(GAME_W * scale);
        dispH = Math.floor(GAME_H * scale);
        left  = Math.floor((winW - dispW) / 2);
        top   = Math.floor((winH - dispH) / 2);
    }

    canvas.style.width    = dispW + 'px';
    canvas.style.height   = dispH + 'px';
    canvas.style.position = 'fixed';
    canvas.style.left     = left + 'px';
    canvas.style.top      = top  + 'px';
}

// ─── Game Logic & Turn Management ────────────────────────────────────────
function isTableMoving() {
    if (Math.hypot(cueBall.velocity.x, cueBall.velocity.y) > 0.1) return true;
    for (const ball of balls) {
        if (Math.hypot(ball.velocity.x, ball.velocity.y) > 0.1) return true;
    }
    return false;
}

function switchTurn() {
    if (ballsSunkThisTurn > 0 && !isFoul) {
        ballsSunkThisTurn = 0;
    } else {
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        ballsSunkThisTurn = 0;
        isFoul = false;

        turnIndicator.textContent = currentPlayer === 1 ? "PLAYER 1'S TURN" : (isVsAI ? "AI'S TURN" : "PLAYER 2'S TURN");
        turnIndicator.style.color = currentPlayer === 1 ? "#00d4ff" : "#ff9800";
    }

    if (currentPlayer === 2 && isVsAI && gameRunning && !isGameOver && !gamePaused) {
        aiTimer = setTimeout(takeAITurn, 1200);
    }
}

// ─── Artificial Intelligence Engine ──────────────────────────────────────
function takeAITurn() {
    if (balls.length === 0 || isGameOver || gamePaused) return;

    const targetBall  = balls[Math.floor(Math.random() * balls.length)];
    let bestPocket    = pockets[0];
    let minPocketDist = Infinity;
    pockets.forEach(p => {
        const d = Math.hypot(targetBall.position.x - p.x, targetBall.position.y - p.y);
        if (d < minPocketDist) { minPocketDist = d; bestPocket = p; }
    });

    const angleToPocket = Math.atan2(bestPocket.y - targetBall.position.y, bestPocket.x - targetBall.position.x);
    const ghostBallX    = targetBall.position.x - Math.cos(angleToPocket) * (BALL_RADIUS * 2);
    const ghostBallY    = targetBall.position.y - Math.sin(angleToPocket) * (BALL_RADIUS * 2);
    const aimAngle      = Math.atan2(ghostBallY - cueBall.position.y, ghostBallX - cueBall.position.x);
    const speed         = 18 + (Math.random() * 8);

    scratchWarning.style.display = 'none';
    sfxCue();
    Body.setVelocity(cueBall, {
        x: Math.cos(aimAngle) * speed,
        y: Math.sin(aimAngle) * speed
    });
}

// ─── Advanced Aiming Geometry ─────────────────────────────────────────────
function calculateAimTrajectory(startX, startY, angle) {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);

    let closestDist = Infinity;
    let targetBall  = null;
    let ghostX = startX + dx * 2000;
    let ghostY = startY + dy * 2000;

    for (const ball of balls) {
        const toBallX   = ball.position.x - startX;
        const toBallY   = ball.position.y - startY;
        const dotProduct = toBallX * dx + toBallY * dy;
        if (dotProduct <= 0) continue;

        const closestX = startX + dx * dotProduct;
        const closestY = startY + dy * dotProduct;
        const distToLineSq  = Math.pow(ball.position.x - closestX, 2) + Math.pow(ball.position.y - closestY, 2);
        const collisionDistSq = Math.pow(BALL_RADIUS * 2, 2);

        if (distToLineSq <= collisionDistSq) {
            const backDist   = Math.sqrt(collisionDistSq - distToLineSq);
            const impactDist = dotProduct - backDist;
            if (impactDist < closestDist) {
                closestDist = impactDist;
                targetBall  = ball;
                ghostX = startX + dx * impactDist;
                ghostY = startY + dy * impactDist;
            }
        }
    }

    let targetPath = null;
    let cuePath    = null;

    if (targetBall) {
        const tDirX = targetBall.position.x - ghostX;
        const tDirY = targetBall.position.y - ghostY;
        const tLen  = Math.hypot(tDirX, tDirY);
        targetPath  = { x: tDirX / tLen, y: tDirY / tLen };

        const dot   = dx * targetPath.x + dy * targetPath.y;
        const cDirX = dx - dot * targetPath.x;
        const cDirY = dy - dot * targetPath.y;
        const cLen  = Math.hypot(cDirX, cDirY);
        cuePath = cLen > 0.001 ? { x: cDirX / cLen, y: cDirY / cLen } : { x: 0, y: 0 };
    }

    return { ghostX, ghostY, targetBall, targetPath, cuePath };
}

// ─── Human Input Controls ─────────────────────────────────────────────────
function getMousePos(e) {
    const rect    = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const scaleX  = GAME_WIDTH  / rect.width;
    const scaleY  = GAME_HEIGHT / rect.height;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top)  * scaleY
    };
}

function handleInputStart(e) {
    if (!gameRunning || isGameOver || gamePaused || isTableMoving() || (currentPlayer === 2 && isVsAI)) return;
    isAiming = true;
    dragCurrent = getMousePos(e);
    scratchWarning.style.display = 'none';
}

function handleInputMove(e) {
    if (!isAiming) return;
    dragCurrent = getMousePos(e);
}

function handleInputEnd() {
    if (!isAiming) return;
    isAiming = false;

    const dx   = cueBall.position.x - dragCurrent.x;
    const dy   = cueBall.position.y - dragCurrent.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) return;

    const angle    = Math.atan2(dy, dx);
    const pullDist = Math.min(dist, MAX_PULL);
    const speed    = pullDist * 0.22;

    sfxCue();
    Body.setVelocity(cueBall, {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed
    });
}

function startNewGame(mode) {
    isVsAI            = (mode === '1p');
    p1Score           = 0;
    p2Score           = 0;
    currentPlayer     = 1;
    isFoul            = false;
    ballsSunkThisTurn = 0;
    isGameOver        = false;
    gameRunning       = true;
    gamePaused        = false;
    clearTimeout(aiTimer);

    score1El.textContent          = p1Score;
    score2El.textContent          = p2Score;
    turnIndicator.textContent     = "PLAYER 1'S TURN";
    turnIndicator.style.color     = "#00d4ff";
    scratchWarning.style.display  = 'none';

    if (titleBestEl) titleBestEl.textContent = displayBest();

    startMenu.classList.add('hidden');
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';
    gameOverScreen.classList.add('hidden');
    document.getElementById('pause-overlay').style.display = 'none';

    resizeCanvas();
    buildTable();
    requestAnimationFrame(gameLoop);
}

function drawCircle(x, y, radius, fill) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
}

let waitingForTurnEnd = false;

function gameLoop() {
    if (!gameRunning || isGameOver) return;
    if (gamePaused) return;

    Engine.update(engine, 1000 / 60);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (isTableMoving()) {
        waitingForTurnEnd = true;
    } else if (waitingForTurnEnd) {
        waitingForTurnEnd = false;
        switchTurn();
    }

    pockets.forEach(p => {
        drawCircle(p.x, p.y, p.r, '#050a05');
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#278f46';
        ctx.lineWidth = 2;
        ctx.stroke();
    });

    const activeBalls = [];
    balls.forEach(ball => {
        let sunk = false;
        pockets.forEach(p => {
            if (Math.hypot(ball.position.x - p.x, ball.position.y - p.y) < p.r) sunk = true;
        });

        if (sunk) {
            Composite.remove(engine.world, ball);
            ballsSunkThisTurn++;
            if (currentPlayer === 1) p1Score++; else p2Score++;
            score1El.textContent = p1Score;
            score2El.textContent = p2Score;
            sfxPocket();
        } else {
            activeBalls.push(ball);
        }
    });
    balls = activeBalls;

    let cueSunk = false;
    pockets.forEach(p => {
        if (Math.hypot(cueBall.position.x - p.x, cueBall.position.y - p.y) < p.r) cueSunk = true;
    });

    if (cueSunk) {
        isFoul = true;
        scratchWarning.style.display = 'inline';
        Body.setVelocity(cueBall, { x: 0, y: 0 });
        Body.setPosition(cueBall, { x: canvas.width * 0.25, y: canvas.height * 0.5 });
        sfxScratch();
    }

    if (isAiming) {
        const dx       = cueBall.position.x - dragCurrent.x;
        const dy       = cueBall.position.y - dragCurrent.y;
        const angle    = Math.atan2(dy, dx);
        const pullDist = Math.min(Math.hypot(dx, dy), MAX_PULL);

        if (pullDist > 10) {
            const aimData = calculateAimTrajectory(cueBall.position.x, cueBall.position.y, angle);

            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.9)';
            ctx.lineWidth = 2;
            ctx.moveTo(cueBall.position.x, cueBall.position.y);
            ctx.lineTo(aimData.ghostX, aimData.ghostY);
            ctx.stroke();

            if (aimData.targetBall) {
                ctx.beginPath();
                ctx.arc(aimData.ghostX, aimData.ghostY, BALL_RADIUS, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(aimData.targetBall.position.x, aimData.targetBall.position.y);
                ctx.lineTo(
                    aimData.targetBall.position.x + aimData.targetPath.x * 60,
                    aimData.targetBall.position.y + aimData.targetPath.y * 60
                );
                ctx.strokeStyle = 'rgba(255,255,255,0.9)';
                ctx.stroke();

                if (aimData.cuePath && (aimData.cuePath.x !== 0 || aimData.cuePath.y !== 0)) {
                    ctx.beginPath();
                    ctx.moveTo(aimData.ghostX, aimData.ghostY);
                    ctx.lineTo(
                        aimData.ghostX + aimData.cuePath.x * 40,
                        aimData.ghostY + aimData.cuePath.y * 40
                    );
                    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
                    ctx.stroke();
                }
            }

            ctx.save();
            ctx.translate(cueBall.position.x, cueBall.position.y);
            ctx.rotate(angle + Math.PI);

            const stickLength = 350;
            const stickThick  = 7;
            const offset      = BALL_RADIUS + 5 + pullDist;

            ctx.fillStyle = '#5c3a21';
            ctx.fillRect(offset + 15, -stickThick / 2, stickLength, stickThick);
            ctx.fillStyle = '#e6c280';
            ctx.fillRect(offset + 4,  -stickThick / 2, 15,          stickThick);
            ctx.fillStyle = '#00bcd4';
            ctx.fillRect(offset,       -stickThick / 2, 4,           stickThick);
            ctx.restore();
        }
    }

    balls.forEach(ball => {
        drawCircle(ball.position.x, ball.position.y, BALL_RADIUS, ball.color);
        drawCircle(ball.position.x - 3, ball.position.y - 3, 3, 'rgba(255,255,255,0.4)');
    });

    drawCircle(cueBall.position.x, cueBall.position.y, BALL_RADIUS, cueBall.color);
    drawCircle(cueBall.position.x - 3, cueBall.position.y - 3, 3, 'rgba(255,255,255,0.6)');

    if (balls.length === 0 && !isTableMoving()) {
        isGameOver  = true;
        gameRunning = false;
        clearTimeout(aiTimer);

        let winnerMsg = "";
        if (p1Score > p2Score) {
            winnerMsg = "PLAYER 1 WINS!";
            saveBest();
            sfxWin();
        } else if (p2Score > p1Score) {
            winnerMsg = isVsAI ? "AI WINS!" : "PLAYER 2 WINS!";
        } else {
            winnerMsg = "IT'S A TIE!";
        }

        winnerText.textContent   = winnerMsg;
        if (finalP1El)  finalP1El.textContent  = p1Score;
        if (finalP2El)  finalP2El.textContent  = p2Score;
        if (bestScoreEl) bestScoreEl.textContent = displayBest();
        gameOverScreen.classList.remove('hidden');
    }

    if (gameRunning) requestAnimationFrame(gameLoop);
}

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    canvas          = document.getElementById('gameCanvas');
    ctx             = canvas.getContext('2d');
    score1El        = document.getElementById('score1');
    score2El        = document.getElementById('score2');
    turnIndicator   = document.getElementById('turn-indicator');
    scratchWarning  = document.getElementById('scratch-warning');
    startMenu       = document.getElementById('start-menu');
    gameOverScreen  = document.getElementById('game-over-screen');
    restartBtn      = document.getElementById('restart-btn');
    winnerText      = document.getElementById('winner-text');
    bestScoreEl     = document.getElementById('best-score');
    titleBestEl     = document.getElementById('title-best');
    finalP1El       = document.getElementById('final-p1');
    finalP2El       = document.getElementById('final-p2');

    if (titleBestEl) titleBestEl.textContent = displayBest();

    canvas.width  = GAME_WIDTH;
    canvas.height = GAME_HEIGHT;

    const modeButtons = document.querySelectorAll('.btn-group .menu-btn');

    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);
    window.addEventListener('resize', checkOrientation);
    window.addEventListener('orientationchange', checkOrientation);

    document.getElementById('pause-btn').addEventListener('click', togglePause);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gameRunning && !isGameOver) togglePause();
    });

    initPhysics();

    Matter.Events.on(engine, 'collisionStart', (event) => {
        if (gamePaused) return;
        event.pairs.forEach(pair => {
            const speed = Math.hypot(pair.bodyA.velocity.x, pair.bodyA.velocity.y) +
                          Math.hypot(pair.bodyB.velocity.x, pair.bodyB.velocity.y);
            if (speed < 0.5) return;
            if (pair.bodyA.isStatic || pair.bodyB.isStatic) {
                sfxCushion();
            } else {
                sfxBallHit(speed);
            }
        });
    });

    canvas.addEventListener('mousedown', handleInputStart);
    window.addEventListener('mousemove', handleInputMove);
    window.addEventListener('mouseup',   handleInputEnd);

    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleInputStart(e); }, { passive: false });
    window.addEventListener('touchmove',  handleInputMove, { passive: false });
    window.addEventListener('touchmove',  (e) => e.preventDefault(), { passive: false });
    window.addEventListener('touchend',   handleInputEnd);

    modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            startNewGame(btn.getAttribute('data-mode'));
        });
    });

    if (restartBtn) {
        restartBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startNewGame(isVsAI ? '1p' : '2p');
        });
    }

    resizeCanvas();
    checkOrientation();
});
