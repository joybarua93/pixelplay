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
function sfxPutt()  { SFX.play({ frequency: 200, type: 'sine',    duration: 0.15, volume: 0.3, slide: 80 }); }
function sfxHole()  {
    [523, 659, 784, 1047].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.15, volume: 0.3 }), i * 100));
}
function sfxWin()   {
    [523, 659, 784, 1047, 1319, 1568].forEach((f, i) =>
        setTimeout(() => SFX.play({ frequency: f, type: 'sine', duration: 0.18, volume: 0.3 }), i * 90));
}


// ─── Matter.js Aliases ────────────────────────────────────────────────────
const Engine    = Matter.Engine;
const Bodies    = Matter.Bodies;
const Composite = Matter.Composite;
const Body      = Matter.Body;
const Vector    = Matter.Vector;

// ─── Pause & localStorage ─────────────────────────────────────────────────
let gamePaused = false;

const STORAGE_KEY = 'pixelplay_minigolf_best';
function getBest()        { return parseInt(localStorage.getItem(STORAGE_KEY) || '9999'); }
function saveBest(strokes) { if (strokes < getBest()) localStorage.setItem(STORAGE_KEY, String(strokes)); }
function displayBest()    { return getBest() >= 9999 ? '—' : String(getBest()); }

function togglePause() {
    gamePaused = !gamePaused;
    document.getElementById('pause-overlay').style.display = gamePaused ? 'flex' : 'none';
    document.getElementById('pause-btn').style.display = gamePaused ? 'none' : 'flex';
    if (gamePaused) {
        isAiming = false;
        const info = document.getElementById('pause-info');
        if (info) info.textContent = `Hole ${currentHoleIndex + 1} / ${TOTAL_HOLES}  •  Strokes: ${totalStrokes}`;
    } else {
        resumeGameLoop();
    }
}
function resumeGameLoop() { requestAnimationFrame(gameLoop); }
function restartGame() {
    document.getElementById('pause-overlay').style.display = 'none';
    gamePaused = false;
    startNewGame();
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
let canvas, ctx, scoreEl, holeEl, startMenu, gameOverScreen, restartBtn, finalScoreEl,
    bestScoreEl, titleBestEl;
let engine;

// ─── Game State ───────────────────────────────────────────────────────────
const TOTAL_HOLES = 18;
let totalStrokes    = 0;
let currentHoleIndex = 0;
let isGameOver      = false;
let gameRunning     = false;

let golfBall;
let walls    = [];
let sandTraps = [];
let bumpers   = [];
let hole      = { x: 0, y: 0, r: 16 };
const BALL_RADIUS = 8;

let isAiming    = false;
let dragCurrent = { x: 0, y: 0 };
const MAX_PULL  = 260;

function buildLevel(index) {
    Composite.clear(engine.world);
    walls     = [];
    sandTraps = [];
    bumpers   = [];

    const w = canvas.width;
    const h = canvas.height;

    const wallOpts   = { isStatic: true, restitution: 0.5, friction: 0,   renderColor: '#8d6e63' };
    const bumperOpts = { isStatic: true, restitution: 1.3, friction: 0,   renderColor: '#f44336' };

    // Outer boundaries
    const thick = 50;
    walls.push(Bodies.rectangle(w/2,         -thick/2,    w,     thick,  wallOpts));
    walls.push(Bodies.rectangle(w/2,          h+thick/2,  w,     thick,  wallOpts));
    walls.push(Bodies.rectangle(-thick/2,     h/2,        thick, h,      wallOpts));
    walls.push(Bodies.rectangle(w+thick/2,    h/2,        thick, h,      wallOpts));

    let startPos = { x: w * 0.5, y: h * 0.85 };

    if (index === 0) {
        // Hole 1: The Straightaway
        hole = { x: w * 0.5, y: h * 0.15, r: 16 };
    }
    else if (index === 1) {
        // Hole 2: The Bank Shot
        hole = { x: w * 0.5, y: h * 0.15, r: 16 };
        walls.push(Bodies.rectangle(w * 0.5, h * 0.5, w * 0.6, 20, wallOpts));
    }
    else if (index === 2) {
        // Hole 3: The Bumper Alley
        hole = { x: w * 0.5, y: h * 0.15, r: 16 };
        bumpers.push(Bodies.circle(w * 0.35, h * 0.5, 30, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.65, h * 0.5, 30, bumperOpts));
    }
    else if (index === 3) {
        // Hole 4: The Sand Trap Island
        hole = { x: w * 0.5, y: h * 0.15, r: 16 };
        sandTraps.push({ x: w * 0.5, y: h * 0.5, w: w * 0.8, h: h * 0.2 });
        walls.push(Bodies.rectangle(w * 0.85, h * 0.5, w * 0.3, 20, wallOpts));
    }
    else if (index === 4) {
        // Hole 5: The Gauntlet
        startPos = { x: w * 0.2, y: h * 0.85 };
        hole = { x: w * 0.8, y: h * 0.15, r: 16 };
        walls.push(Bodies.rectangle(w * 0.4, h * 0.7, 20, h * 0.4, wallOpts));
        walls.push(Bodies.rectangle(w * 0.6, h * 0.3, 20, h * 0.4, wallOpts));
        sandTraps.push({ x: w * 0.2, y: h * 0.4, w: w * 0.3, h: 100 });
        bumpers.push(Bodies.circle(w * 0.8, h * 0.6, 25, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.6, h * 0.8, 25, bumperOpts));
    }
    else if (index === 5) {
        // Hole 6: L-Shaped Fairway — navigate around the corner wall
        startPos = { x: w * 0.8, y: h * 0.85 };
        hole = { x: w * 0.2, y: h * 0.15, r: 16 };
        walls.push(Bodies.rectangle(w * 0.5, h * 0.5, 20, h * 0.55, wallOpts));
    }
    else if (index === 6) {
        // Hole 7: Winding Corridor — two staggered blockers create an S-route
        startPos = { x: w * 0.5, y: h * 0.88 };
        hole = { x: w * 0.5, y: h * 0.12, r: 16 };
        walls.push(Bodies.rectangle(w * 0.25, h * 0.65, w * 0.5, 20, wallOpts));
        walls.push(Bodies.rectangle(w * 0.75, h * 0.38, w * 0.5, 20, wallOpts));
    }
    else if (index === 7) {
        // Hole 8: Open Green — large central bumper forces curved approach
        startPos = { x: w * 0.5, y: h * 0.88 };
        hole = { x: w * 0.5, y: h * 0.12, r: 16 };
        bumpers.push(Bodies.circle(w * 0.5,  h * 0.5,  40, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.25, h * 0.3,  22, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.75, h * 0.3,  22, bumperOpts));
    }
    else if (index === 8) {
        // Hole 9: Dogleg Left — wall forces indirect left-corner route + sand hazard
        startPos = { x: w * 0.75, y: h * 0.85 };
        hole = { x: w * 0.2, y: h * 0.15, r: 16 };
        walls.push(Bodies.rectangle(w * 0.5, h * 0.38, w * 0.5, 20, wallOpts));
        sandTraps.push({ x: w * 0.38, y: h * 0.65, w: w * 0.4, h: h * 0.12 });
    }
    else if (index === 9) {
        // Hole 10: The Pinball — three bumpers in a triangle
        startPos = { x: w * 0.5, y: h * 0.88 };
        hole = { x: w * 0.5, y: h * 0.12, r: 16 };
        bumpers.push(Bodies.circle(w * 0.5,  h * 0.45, 28, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.28, h * 0.62, 22, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.72, h * 0.62, 22, bumperOpts));
    }
    else if (index === 10) {
        // Hole 11: The Corridor — tight channel, hole at far end
        startPos = { x: w * 0.5, y: h * 0.88 };
        hole = { x: w * 0.5, y: h * 0.12, r: 16 };
        walls.push(Bodies.rectangle(w * 0.25, h * 0.5, 20, h * 0.7, wallOpts));
        walls.push(Bodies.rectangle(w * 0.75, h * 0.5, 20, h * 0.7, wallOpts));
    }
    else if (index === 11) {
        // Hole 12: The Ricochet — bank off right wall to reach top-left hole
        startPos = { x: w * 0.2, y: h * 0.88 };
        hole = { x: w * 0.2, y: h * 0.12, r: 16 };
        walls.push(Bodies.rectangle(w * 0.6, h * 0.5, 20, h * 0.5, wallOpts));
        sandTraps.push({ x: w * 0.25, y: h * 0.5, w: w * 0.35, h: h * 0.15 });
    }
    else if (index === 12) {
        // Hole 13: Double Bumper Gates — bumpers form two gates to thread
        startPos = { x: w * 0.5, y: h * 0.88 };
        hole = { x: w * 0.5, y: h * 0.12, r: 16 };
        bumpers.push(Bodies.circle(w * 0.28, h * 0.65, 24, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.72, h * 0.65, 24, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.28, h * 0.38, 24, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.72, h * 0.38, 24, bumperOpts));
    }
    else if (index === 13) {
        // Hole 14: The Maze — two walls create a Z-shaped path
        startPos = { x: w * 0.15, y: h * 0.85 };
        hole = { x: w * 0.85, y: h * 0.15, r: 16 };
        walls.push(Bodies.rectangle(w * 0.35, h * 0.62, w * 0.7, 18, wallOpts));
        walls.push(Bodies.rectangle(w * 0.65, h * 0.38, w * 0.7, 18, wallOpts));
    }
    else if (index === 14) {
        // Hole 15: Sand Gauntlet — wide sand trap with bumper guards
        startPos = { x: w * 0.5, y: h * 0.88 };
        hole = { x: w * 0.5, y: h * 0.12, r: 16 };
        sandTraps.push({ x: w * 0.5, y: h * 0.5, w: w * 0.7, h: h * 0.18 });
        bumpers.push(Bodies.circle(w * 0.2, h * 0.5, 20, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.8, h * 0.5, 20, bumperOpts));
    }
    else if (index === 15) {
        // Hole 16: The Spiral — walls create a narrowing target zone
        startPos = { x: w * 0.5, y: h * 0.88 };
        hole = { x: w * 0.5, y: h * 0.12, r: 16 };
        walls.push(Bodies.rectangle(w * 0.5,  h * 0.72, w * 0.8, 18, wallOpts));
        walls.push(Bodies.rectangle(w * 0.3,  h * 0.55, 18, h * 0.35, wallOpts));
        walls.push(Bodies.rectangle(w * 0.7,  h * 0.55, 18, h * 0.35, wallOpts));
        walls.push(Bodies.rectangle(w * 0.5,  h * 0.38, w * 0.4, 18, wallOpts));
    }
    else if (index === 16) {
        // Hole 17: Bumper Storm — 5 bumpers scattered, open hole
        startPos = { x: w * 0.5, y: h * 0.88 };
        hole = { x: w * 0.5, y: h * 0.12, r: 16 };
        bumpers.push(Bodies.circle(w * 0.5,  h * 0.5,  26, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.2,  h * 0.38, 18, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.8,  h * 0.38, 18, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.3,  h * 0.65, 18, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.7,  h * 0.65, 18, bumperOpts));
    }
    else if (index === 17) {
        // Hole 18: The Finale — everything combined
        startPos = { x: w * 0.8, y: h * 0.85 };
        hole = { x: w * 0.2, y: h * 0.15, r: 16 };
        walls.push(Bodies.rectangle(w * 0.5,  h * 0.55, 18, h * 0.4, wallOpts));
        walls.push(Bodies.rectangle(w * 0.5,  h * 0.28, w * 0.6, 18, wallOpts));
        sandTraps.push({ x: w * 0.75, y: h * 0.4, w: w * 0.35, h: h * 0.14 });
        bumpers.push(Bodies.circle(w * 0.25, h * 0.55, 22, bumperOpts));
        bumpers.push(Bodies.circle(w * 0.75, h * 0.72, 22, bumperOpts));
    }

    Composite.add(engine.world, walls);
    Composite.add(engine.world, bumpers);

    const ballOpts = { restitution: 0.45, friction: 0.015, frictionAir: 0.028, density: 0.04 };
    golfBall = Bodies.circle(startPos.x, startPos.y, BALL_RADIUS, ballOpts);
    Composite.add(engine.world, golfBall);

    holeEl.textContent = `${index + 1} / ${TOTAL_HOLES}`;
}

function initPhysics() {
    engine = Engine.create();
    engine.gravity.y = 0;
}

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

    if (gameRunning) buildLevel(currentHoleIndex);
}

function getMousePos(e) {
    const rect   = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function isBallMoving() {
    return Math.hypot(golfBall.velocity.x, golfBall.velocity.y) > 0.08;
}

function handleInputStart(e) {
    if (!gameRunning || isGameOver || isBallMoving() || gamePaused) return;
    isAiming = true;
    dragCurrent = getMousePos(e);
}

function handleInputMove(e) {
    if (!isAiming) return;
    dragCurrent = getMousePos(e);
}

function handleInputEnd() {
    if (!isAiming) return;
    isAiming = false;
    const dx   = golfBall.position.x - dragCurrent.x;
    const dy   = golfBall.position.y - dragCurrent.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 10) return;
    const angle    = Math.atan2(dy, dx);
    const pullDist = Math.min(dist, MAX_PULL);
    const t        = pullDist / MAX_PULL;
    const power    = t * t * (3 - 2 * t);    // smoothstep
    const speed    = 4 + power * 22;         // min 4, max 26
    Body.setVelocity(golfBall, { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed });
    totalStrokes++;
    scoreEl.textContent = totalStrokes;
    sfxPutt();
}

function startNewGame() {
    totalStrokes     = 0;
    currentHoleIndex = 0;
    isGameOver       = false;
    gameRunning      = true;
    gamePaused       = false;
    isAiming         = false;
    document.getElementById('pause-overlay').style.display = 'none';
    scoreEl.textContent = totalStrokes;
    startMenu.classList.add('hidden');
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'flex';
    gameOverScreen.classList.add('hidden');
    resizeCanvas();
    buildLevel(currentHoleIndex);
    requestAnimationFrame(gameLoop);
}

// ─── Rendering helpers ────────────────────────────────────────────────────
function drawRect(body) {
    const bw = body.bounds.max.x - body.bounds.min.x;
    const bh = body.bounds.max.y - body.bounds.min.y;
    ctx.fillStyle = body.renderColor;
    ctx.fillRect(body.position.x - bw/2, body.position.y - bh/2, bw, bh);
    ctx.strokeStyle = '#5d4037';
    ctx.lineWidth = 4;
    ctx.strokeRect(body.position.x - bw/2, body.position.y - bh/2, bw, bh);
}

function drawCircleCanvas(x, y, radius, fill, stroke, lineWidth = 2) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function gameLoop() {
    if (!gameRunning || isGameOver) return;
    if (gamePaused) return;

    Engine.update(engine, 1000 / 60);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw fairway background
    ctx.fillStyle = '#2d7a3e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Sand traps
    let inSand = false;
    sandTraps.forEach(trap => {
        if (golfBall.position.x > trap.x - trap.w/2 && golfBall.position.x < trap.x + trap.w/2 &&
            golfBall.position.y > trap.y - trap.h/2 && golfBall.position.y < trap.y + trap.h/2) {
            inSand = true;
        }
        ctx.fillStyle = '#eadd81';
        ctx.fillRect(trap.x - trap.w/2, trap.y - trap.h/2, trap.w, trap.h);
    });
    if (inSand) Body.setVelocity(golfBall, { x: golfBall.velocity.x * 0.9, y: golfBall.velocity.y * 0.9 });

    // Hole & flag
    drawCircleCanvas(hole.x, hole.y, hole.r, '#000', '#388e3c', 2);
    ctx.fillStyle = '#ccc';
    ctx.fillRect(hole.x - 2, hole.y - 35, 4, 35);
    ctx.fillStyle = '#f44336';
    ctx.beginPath();
    ctx.moveTo(hole.x, hole.y - 35);
    ctx.lineTo(hole.x + 18, hole.y - 25);
    ctx.lineTo(hole.x, hole.y - 15);
    ctx.fill();

    // Walls & bumpers
    walls.forEach(drawRect);
    bumpers.forEach(b => {
        drawCircleCanvas(b.position.x, b.position.y, 30, b.renderColor, '#b71c1c', 4);
        drawCircleCanvas(b.position.x, b.position.y, 15, '#ffcdd2');
    });

    // Aiming guide
    if (isAiming) {
        const dx       = golfBall.position.x - dragCurrent.x;
        const dy       = golfBall.position.y - dragCurrent.y;
        const angle    = Math.atan2(dy, dx);
        const pullDist = Math.min(Math.hypot(dx, dy), MAX_PULL);
        if (pullDist > 10) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 2;
            ctx.moveTo(golfBall.position.x, golfBall.position.y);
            ctx.lineTo(
                golfBall.position.x + Math.cos(angle) * (pullDist * 2),
                golfBall.position.y + Math.sin(angle) * (pullDist * 2)
            );
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.save();
            ctx.translate(golfBall.position.x, golfBall.position.y);
            ctx.rotate(angle + Math.PI);
            const offset = BALL_RADIUS + 10 + pullDist;
            ctx.fillStyle = '#cfd8dc';
            ctx.fillRect(offset, -2, 60, 4);
            ctx.fillStyle = '#455a64';
            ctx.fillRect(offset - 5, -15, 10, 30);
            ctx.restore();
        }
    }

    // Ball
    drawCircleCanvas(golfBall.position.x, golfBall.position.y, BALL_RADIUS, '#fff');
    drawCircleCanvas(golfBall.position.x - 2, golfBall.position.y - 2, 2, 'rgba(0,0,0,0.1)');

    // Win condition
    const distToHole = Math.hypot(golfBall.position.x - hole.x, golfBall.position.y - hole.y);
    const speed      = Math.hypot(golfBall.velocity.x, golfBall.velocity.y);
    if (distToHole < hole.r * 0.85 && speed < 8) {
        currentHoleIndex++;
        if (currentHoleIndex >= TOTAL_HOLES) {
            isGameOver  = true;
            gameRunning = false;
            sfxWin();
            saveBest(totalStrokes);
            if (bestScoreEl) bestScoreEl.textContent = displayBest();
            finalScoreEl.textContent = totalStrokes;
            gameOverScreen.classList.remove('hidden');
        } else {
            sfxHole();
            buildLevel(currentHoleIndex);
        }
    }

    if (speed > 0 && speed < 0.08) Body.setVelocity(golfBall, { x: 0, y: 0 });
    if (gameRunning) requestAnimationFrame(gameLoop);
}

// ─── Init ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    canvas         = document.getElementById('gameCanvas');
    ctx            = canvas ? canvas.getContext('2d') : null;
    scoreEl        = document.getElementById('score');
    holeEl         = document.getElementById('hole-display');
    startMenu      = document.getElementById('start-menu');
    gameOverScreen = document.getElementById('game-over-screen');
    restartBtn     = document.getElementById('restart-btn');
    finalScoreEl   = document.getElementById('final-score');
    bestScoreEl    = document.getElementById('best-score');
    titleBestEl    = document.getElementById('title-best');
    const playBtn  = document.getElementById('play-btn');

    if (titleBestEl) titleBestEl.textContent = displayBest();

    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;

    initPhysics();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);
    document.getElementById('pause-btn').addEventListener('click', togglePause);
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && gameRunning && !isGameOver) togglePause();
    });

    canvas.addEventListener('mousedown',  handleInputStart);
    window.addEventListener('mousemove',  handleInputMove);
    window.addEventListener('mouseup',    handleInputEnd);

    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); handleInputStart(e); }, { passive: false });
    window.addEventListener('touchmove',  handleInputMove, { passive: false });
    window.addEventListener('touchend',   handleInputEnd);

    if (playBtn)    playBtn.addEventListener('click', startNewGame);
    if (restartBtn) restartBtn.addEventListener('click', () => {
        if (titleBestEl) titleBestEl.textContent = displayBest();
        startNewGame();
    });

    resizeCanvas();
});
