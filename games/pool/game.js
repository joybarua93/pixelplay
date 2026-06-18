// Simple Vector2D class for all physics calculations
class Vec2 {
    constructor(x, y) { this.x = x; this.y = y; }
    add(v) { return new Vec2(this.x + v.x, this.y + v.y); }
    sub(v) { return new Vec2(this.x - v.x, this.y - v.y); }
    mult(n) { return new Vec2(this.x * n, this.y * n); }
    mag() { return Math.sqrt(this.x * this.x + this.y * this.y); }
    magSq() { return this.x * this.x + this.y * this.y; }
    normalize() {
        const m = this.mag();
        return m === 0 ? new Vec2(0, 0) : new Vec2(this.x / m, this.y / m);
    }
    dot(v) { return this.x * v.x + this.y * v.y; }
    copy() { return new Vec2(this.x, this.y); }
    dist(v) { return this.sub(v).mag(); }
}

const canvas = document.getElementById('pool-canvas');
const ctx = canvas.getContext('2d');

// Game State Variables
let gameMode = 'menu'; // 'menu', 'pvp', 'pve'
let aiLevel = 'medium';
let currentPlayer = 1;
let playerColors = { 1: null, 2: null };
let pottedBallsThisTurn = [];
let scratched = false;
let wins = 0;
let showBallInHandBanner = false;

// PixelPlay session scores and pause state
let gamePaused = false;
let p1Score = 0;
let p2Score = 0;

// --- Audio Synthesizer Engine ---
const SoundEngine = {
    initialized: false,
    ballSynth: null,
    cushionSynth: null,
    pocketSynth: null,

    init() {
        if (this.initialized) return;

        // Ball-to-Ball Collision (Sharp, high-pitched resin click)
        this.ballSynth = new Tone.PolySynth(Tone.FMSynth, {
            harmonicity: 3,
            modulationIndex: 10,
            oscillator: { type: "sine" },
            envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.01 },
            modulation: { type: "square" },
            modulationEnvelope: { attack: 0.001, decay: 0.02, sustain: 0, release: 0 }
        }).toDestination();
        this.ballSynth.volume.value = -12; // Base volume

        // Ball-to-Cushion (Dull, rubbery thump)
        this.cushionSynth = new Tone.MembraneSynth({
            pitchDecay: 0.02,
            octaves: 1.5,
            oscillator: { type: "sine" },
            envelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.1 }
        }).toDestination();
        this.cushionSynth.volume.value = -8;

        // Pocket Drop (Deep resonance)
        this.pocketSynth = new Tone.MembraneSynth({
            pitchDecay: 0.1,
            octaves: 3,
            oscillator: { type: "triangle" },
            envelope: { attack: 0.01, decay: 0.4, sustain: 0, release: 0.2 }
        }).toDestination();
        this.pocketSynth.volume.value = -5;

        this.initialized = true;
    },

    playBallClick(impulseMag) {
        if (!this.initialized) return;
        // Cap the impulse magnitude
        const clampedImpulse = Math.min(Math.max(impulseMag, 0.5), 15);
        // Map impulse to velocity (0 to 1) for Tone.js
        const velocity = clampedImpulse / 15;

        // Slight random detune for organic feel
        const pitch = 2500 + (Math.random() * 200 - 100);

        // Play a very short note. PolySynth handles rapid concurrent hits.
        this.ballSynth.triggerAttackRelease(pitch, "128n", Tone.now(), velocity * 0.8);
    },

    playCushionThump(velocityMag) {
        if (!this.initialized) return;
        const clampedVelocity = Math.min(Math.max(velocityMag, 1), 15);
        const velocity = clampedVelocity / 15;
        this.cushionSynth.triggerAttackRelease("G2", "16n", Tone.now(), velocity * 0.6);
    },

    playPocketDrop() {
        if (!this.initialized) return;
        this.pocketSynth.triggerAttackRelease("C2", "8n", Tone.now(), 0.9);
    }
};

// Initialize Audio Context on first interaction to comply with browser autoplay policies
window.addEventListener('pointerdown', async () => {
    if (!SoundEngine.initialized) {
        await Tone.start();
        SoundEngine.init();
    }
}, { once: true });
// --- End Audio Engine ---

// Game Constants
const R = 11; // Ball Radius
const POCKET_R = 18; // Slightly reduced for perfect balance
const FRICTION = 0.015;
const RESTITUTION = 0.98; // Bounciness
const TABLE_MARGIN = 35; // Size of the wooden rail

const BOUNDS = {
    left: TABLE_MARGIN,
    right: canvas.width - TABLE_MARGIN,
    top: TABLE_MARGIN,
    bottom: canvas.height - TABLE_MARGIN
};

let balls = [];
let state = 'aiming'; // 'aiming', 'shooting', 'rolling'
let ballInHand = false; // Tracks free placement mode independent of aiming
let aimAngle = 0;
let power = 0;
let maxPower = 20;
let isDraggingPower = false;

const pockets = [
    new Vec2(BOUNDS.left, BOUNDS.top),
    new Vec2(BOUNDS.right, BOUNDS.top),
    new Vec2(BOUNDS.left - 5, canvas.height / 2),
    new Vec2(BOUNDS.right + 5, canvas.height / 2),
    new Vec2(BOUNDS.left, BOUNDS.bottom),
    new Vec2(BOUNDS.right, BOUNDS.bottom)
];

class Ball {
    constructor(x, y, color, id) {
        this.pos = new Vec2(x, y);
        this.vel = new Vec2(0, 0);
        this.color = color;
        this.id = id;
        this.isCue = (id === 0);
        this.active = true;
    }
}

function initRack() {
    balls = [];
    // Cue Ball (Placed at the bottom)
    balls.push(new Ball(canvas.width / 2, canvas.height * 0.75, '#ffffff', 0));

    // Standard 8-ball triangle
    const startX = canvas.width / 2;
    const startY = canvas.height * 0.3; // Apex at the top
    const rowSpacing = R * Math.sqrt(3);

    // Lighter Orange & Darker Red
    const ballColors = {
        1: '#fb923c', 2: '#fb923c', 3: '#fb923c', 4: '#fb923c', 5: '#fb923c', 6: '#fb923c', 7: '#fb923c', // Lighter Orange
        8: '#111827', // Black
        9: '#991b1b', 10: '#991b1b', 11: '#991b1b', 12: '#991b1b', 13: '#991b1b', 14: '#991b1b', 15: '#991b1b' // Darker Red
    };

    // Fixed layout for a legal 8-ball rack
    // (1 at apex, 8 in middle, stripe & solid on bottom corners)
    const rackLayout = [
        1,
        9, 2,
        10, 8, 3,
        4, 11, 12, 5,
        13, 6, 14, 15, 7
    ];

    let idx = 0;
    for (let row = 0; row < 5; row++) {
        for (let col = 0; col <= row; col++) {
            const x = startX - (row * R) + (col * R * 2);
            const y = startY - (row * rowSpacing); // Triangle expands upwards

            const ballId = rackLayout[idx++];
            const color = ballColors[ballId];

            balls.push(new Ball(x, y, color, ballId));
        }
    }
}

// This calculates the exact moment of impact (Ghost Ball)
function getGhostBall(origin, dir) {
    let closestT = Infinity;
    let targetBall = null;

    // Check collision with other balls
    for (let i = 1; i < balls.length; i++) {
        const b = balls[i];
        if (!b.active) continue;

        // Vector from origin to target ball
        const w = origin.sub(b.pos);

        // Quadratic equation coefficients for swept circle: at^2 + bt + c = 0
        const a = dir.dot(dir); // always 1 if dir is normalized
        const b_coeff = 2 * w.dot(dir);
        const c = w.dot(w) - 4 * R * R;

        const discriminant = b_coeff * b_coeff - 4 * a * c;

        if (discriminant >= 0) {
            // Intersection occurs
            const t = (-b_coeff - Math.sqrt(discriminant)) / (2 * a);
            if (t > 0 && t < closestT) {
                closestT = t;
                targetBall = b;
            }
        }
    }

    // Check collision with walls (cushions)
    const cushionBounds = {
        left: BOUNDS.left + R,
        right: BOUNDS.right - R,
        top: BOUNDS.top + R,
        bottom: BOUNDS.bottom - R
    };

    let wallT = Infinity;
    if (dir.x > 0) wallT = Math.min(wallT, (cushionBounds.right - origin.x) / dir.x);
    if (dir.x < 0) wallT = Math.min(wallT, (cushionBounds.left - origin.x) / dir.x);
    if (dir.y > 0) wallT = Math.min(wallT, (cushionBounds.bottom - origin.y) / dir.y);
    if (dir.y < 0) wallT = Math.min(wallT, (cushionBounds.top - origin.y) / dir.y);

    if (wallT < closestT && wallT > 0) {
        return { t: wallT, pos: origin.add(dir.mult(wallT)), targetBall: null, hitWall: true };
    }

    if (targetBall) {
        return { t: closestT, pos: origin.add(dir.mult(closestT)), targetBall: targetBall, hitWall: false };
    }

    return null;
}

function updatePhysics() {
    if (gamePaused) return;
    let anyMoving = false;

    // Sub-stepping for stable collisions
    const subSteps = 8;
    for (let step = 0; step < subSteps; step++) {

        // Move balls and apply friction
        for (let b of balls) {
            if (!b.active) continue;
            if (b.vel.magSq() > 0.0001) {
                b.pos = b.pos.add(b.vel.mult(1 / subSteps));

                // Friction applies a constant deceleration
                const speed = b.vel.mag();
                const drop = (FRICTION / subSteps);
                const newSpeed = Math.max(0, speed - drop);
                b.vel = b.vel.mult(newSpeed / speed);
                anyMoving = true;
            } else {
                b.vel = new Vec2(0, 0);
            }

            // Wall Collisions
            if (b.pos.x < BOUNDS.left + R) {
                b.pos.x = BOUNDS.left + R;
                b.vel.x *= -RESTITUTION;
                if (b.vel.mag() > 0.5) SoundEngine.playCushionThump(Math.abs(b.vel.x));
            }
            if (b.pos.x > BOUNDS.right - R) {
                b.pos.x = BOUNDS.right - R;
                b.vel.x *= -RESTITUTION;
                if (b.vel.mag() > 0.5) SoundEngine.playCushionThump(Math.abs(b.vel.x));
            }
            if (b.pos.y < BOUNDS.top + R) {
                b.pos.y = BOUNDS.top + R;
                b.vel.y *= -RESTITUTION;
                if (b.vel.mag() > 0.5) SoundEngine.playCushionThump(Math.abs(b.vel.y));
            }
            if (b.pos.y > BOUNDS.bottom - R) {
                b.pos.y = BOUNDS.bottom - R;
                b.vel.y *= -RESTITUTION;
                if (b.vel.mag() > 0.5) SoundEngine.playCushionThump(Math.abs(b.vel.y));
            }

            // Pocket Collisions & Funnel Effect
            for (let pocket of pockets) {
                const dist = b.pos.dist(pocket);

                // Forgiving Pocket Funnel: Sucks the ball in slightly when it's near the lip
                if (dist < POCKET_R * 1.4 && dist > 0) {
                    const pullDir = pocket.sub(b.pos).normalize();
                    b.vel = b.vel.add(pullDir.mult(0.05)); // Gentle magnetic pull towards center
                }

                if (dist < POCKET_R) {
                    b.active = false;
                    SoundEngine.playPocketDrop();
                    if (b.isCue) {
                        scratched = true; // Flag for penalty
                    } else {
                        pottedBallsThisTurn.push(b); // Track for turn rules
                    }
                }
            }
        }

        // Ball-Ball Collisions
        for (let i = 0; i < balls.length; i++) {
            for (let j = i + 1; j < balls.length; j++) {
                let b1 = balls[i];
                let b2 = balls[j];
                if (!b1.active || !b2.active) continue;

                let delta = b1.pos.sub(b2.pos);
                let distSq = delta.magSq();

                if (distSq < (2 * R) * (2 * R) && distSq > 0) {
                    let dist = Math.sqrt(distSq);
                    let normal = delta.mult(1 / dist);

                    // Separate overlapping balls
                    const overlap = (2 * R - dist) / 2;
                    b1.pos = b1.pos.add(normal.mult(overlap));
                    b2.pos = b2.pos.sub(normal.mult(overlap));

                    // Calculate relative velocity
                    let relVel = b1.vel.sub(b2.vel);
                    let velAlongNormal = relVel.dot(normal);

                    // Do not resolve if moving apart
                    if (velAlongNormal > 0) continue;

                    // 1D Elastic Collision Restitution
                    let jImpulse = -(1 + RESTITUTION) * velAlongNormal;
                    jImpulse /= 2; // (1/mass1 + 1/mass2), assuming equal mass = 1

                    // Trigger Audio based on the calculated physics impulse
                    if (Math.abs(jImpulse) > 0.1) {
                        SoundEngine.playBallClick(Math.abs(jImpulse));
                    }

                    let impulse = normal.mult(jImpulse);
                    b1.vel = b1.vel.add(impulse);
                    b2.vel = b2.vel.sub(impulse);
                }
            }
        }
    }

    // DEBUG: log anyMoving/state every frame while rolling
    if (state === 'rolling') {
        console.log('anyMoving:', anyMoving, 'state:', state);
    }

    // DEBUG: after 300 frames of being stuck in rolling, dump which balls are still moving
    if (!updatePhysics._rollFrames) updatePhysics._rollFrames = 0;
    if (anyMoving && state === 'rolling') {
        updatePhysics._rollFrames++;
        if (updatePhysics._rollFrames > 300) {
            console.warn('[FREEZE DIAG] Still rolling after 300+ frames. Ball report:');
            for (const b of balls) {
                if (!b.active) continue;
                const spd = b.vel.mag();
                if (spd > 0.001) {
                    // find nearest pocket and distance
                    let nearestPocketDist = Infinity;
                    for (const p of pockets) nearestPocketDist = Math.min(nearestPocketDist, b.pos.dist(p));
                    const inFunnel = nearestPocketDist < POCKET_R * 1.4;
                    const inPocket = nearestPocketDist < POCKET_R;
                    console.warn(
                        `  Ball id=${b.id} speed=${spd.toFixed(5)}` +
                        ` pos=(${b.pos.x.toFixed(1)},${b.pos.y.toFixed(1)})` +
                        ` nearestPocket=${nearestPocketDist.toFixed(1)}` +
                        ` inFunnel=${inFunnel} inPocket=${inPocket}`
                    );
                }
            }
            updatePhysics._rollFrames = 0; // reset to avoid spam (reports every ~5s)
        }
    } else {
        updatePhysics._rollFrames = 0;
    }

    if (!anyMoving && state === 'rolling') {
        resolveTurn();
    }
}

function resolveTurn() {
    let keepTurn = false;
    let validPot = false;

    // Check for 8-ball win/loss
    for (let b of pottedBallsThisTurn) {
        if (b.id === 8) {
            const myColor = playerColors[currentPlayer];
            const myRemaining = balls.filter(ball =>
                ball.active && ball.id !== 8 && ball.id !== 0 &&
                ((myColor === 'orange' && ball.id <= 7) || (myColor === 'red' && ball.id >= 9))
            );
            if (myRemaining.length === 0 && myColor !== null && !scratched) {
                // WIN
                if (currentPlayer === 1) p1Score++;
                else p2Score++;
                showMessage("YOU WIN!", `PLAYER ${currentPlayer} WON THE MATCH`);
            } else {
                showMessage("GAME OVER", `PLAYER ${currentPlayer} LOSES`);
            }
            pottedBallsThisTurn = [];
            scratched = false;
            return;
        }
    }

    // Scratch handling
    if (scratched) {
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        state = 'aiming';
        ballInHand = true;
        showBallInHandBanner = true;
        balls[0].active = true;
        balls[0].vel = new Vec2(0, 0);
        balls[0].pos = new Vec2(canvas.width / 2, canvas.height * 0.75);
        pottedBallsThisTurn = [];
        scratched = false;
        updateUIText();

        if (gameMode === 'pve' && currentPlayer === 2) {
            setTimeout(() => {
                for (let yOffset = 0; yOffset < 150; yOffset += 20) {
                    balls[0].pos = new Vec2(canvas.width / 2, canvas.height * 0.75 - yOffset);
                    let clear = true;
                    for (let i = 1; i < balls.length; i++) {
                        if (balls[i].active && balls[i].pos.dist(balls[0].pos) < 2 * R) { clear = false; break; }
                    }
                    if (clear) break;
                }
                updateUIText();
                playAI();
            }, 800);
        }
        return;
    }

    // Normal pot checking
    for (let b of pottedBallsThisTurn) {
        if (playerColors[1] === null) {
            // First ball potted assigns teams
            playerColors[currentPlayer] = b.id <= 7 ? 'orange' : 'red';
            playerColors[currentPlayer === 1 ? 2 : 1] = b.id <= 7 ? 'red' : 'orange';
            validPot = true;
        } else {
            // Keep turn if they potted their own color
            const myColor = playerColors[currentPlayer];
            const bColor = b.id <= 7 ? 'orange' : 'red';
            if (myColor === bColor) validPot = true;
        }
    }

    if (validPot) keepTurn = true;
    pottedBallsThisTurn = [];
    scratched = false;

    if (!keepTurn) currentPlayer = currentPlayer === 1 ? 2 : 1;

    updateUIText();
    state = 'aiming';

    // Trigger AI if it's their turn
    if (gameMode === 'pve' && currentPlayer === 2) {
        setTimeout(playAI, 1000);
    }
}

// Raycasting helper for AI line-of-sight checks
function isPathClear(start, end, ignoreBalls) {
    const dir = end.sub(start);
    const dist = dir.mag();
    const dirNorm = dir.normalize();

    for (let b of balls) {
        if (!b.active || ignoreBalls.includes(b)) continue;
        const w = start.sub(b.pos);
        const b_coeff = 2 * w.dot(dirNorm);
        const c = w.dot(w) - (2 * R) * (2 * R);
        const discriminant = b_coeff * b_coeff - 4 * c; // a=1

        if (discriminant >= 0) {
            const t = (-b_coeff - Math.sqrt(discriminant)) / 2;
            if (t > 0 && t < dist) return false; // Collision detected
        }
    }
    return true;
}

function playAI() {
    if (state !== 'aiming' || gameMode !== 'pve' || currentPlayer !== 2) return;

    const cue = balls[0];
    let bestShot = null;
    let bestScore = -1;

    const myType = playerColors[2];
    let validTargets = balls.filter(b => b.id > 0 && b.id !== 8 && b.active);

    if (myType === 'orange') validTargets = validTargets.filter(b => b.id <= 7);
    if (myType === 'red') validTargets = validTargets.filter(b => b.id >= 9);

    // If only 8 ball remains for AI
    if (validTargets.length === 0) validTargets = balls.filter(b => b.id === 8 && b.active);

    for (let target of validTargets) {
        for (let pocket of pockets) {
            const toPocket = pocket.sub(target.pos);
            const distToPocket = toPocket.mag();
            const dirToPocket = toPocket.normalize();

            // Calculate precise Ghost Ball position needed to hit target into pocket
            const ghostPos = target.pos.sub(dirToPocket.mult(2 * R));

            // Ghost ball must be physically on the table bounds
            if (ghostPos.x < BOUNDS.left + R || ghostPos.x > BOUNDS.right - R || ghostPos.y < BOUNDS.top + R || ghostPos.y > BOUNDS.bottom - R) continue;

            // Verify clear path from target to pocket, and cue to ghost
            if (!isPathClear(target.pos, pocket, [target])) continue;
            if (!isPathClear(cue.pos, ghostPos, [cue, target])) continue;

            const toGhost = ghostPos.sub(cue.pos);
            const cutAngle = Math.abs(Math.acos(toGhost.normalize().dot(dirToPocket)));

            // Avoid shots that are physically impossible (cutting too thin)
            if (cutAngle > Math.PI / 2.2) continue;

            // Prioritize straight shots heavily.
            // The 'cutAngle' (radians) is heavily penalized so the AI prefers easy alignments
            const score = 1000 - distToPocket - (toGhost.mag() * 1.5) - (cutAngle * 600);

            if (score > bestScore) {
                bestScore = score;
                bestShot = { target, pocket, ghostPos, dir: toGhost.normalize() };
            }
        }
    }

    let finalAngle = 0;
    let finalPower = 0;

    if (bestShot) {
        finalAngle = Math.atan2(bestShot.dir.y, bestShot.dir.x);
        // Difficulty Variance Logic
        if (aiLevel === 'easy') finalAngle += (Math.random() - 0.5) * 0.15; // Jitter aim significantly
        if (aiLevel === 'medium') finalAngle += (Math.random() - 0.5) * 0.04; // Slight imperfection
        // Hard mode gets perfect calculated 'finalAngle'

        finalPower = Math.min(maxPower, 8 + bestShot.ghostPos.dist(cue.pos) * 0.02);
    } else {
        // No valid shots, hit something to break the cluster
        if (validTargets.length > 0) {
            const fallback = validTargets[Math.floor(Math.random() * validTargets.length)];
            const toFallback = fallback.pos.sub(cue.pos);
            finalAngle = Math.atan2(toFallback.y, toFallback.x) + (Math.random() - 0.5) * 0.2;
            finalPower = 6 + Math.random() * 6;
        } else {
            finalAngle = Math.random() * Math.PI * 2;
            finalPower = 8;
        }
    }

    aimAngle = finalAngle;
    state = 'shooting'; // Locks UI inputs

    // Visually animate the AI drawing back the power bar
    const chargeInterval = setInterval(() => {
        power += 1.5;
        powerFill.style.height = `${(power / maxPower) * 100}%`;
        powerKnob.style.bottom = `${(power / maxPower) * 100}%`;

        if (power >= finalPower) {
            clearInterval(chargeInterval);
            setTimeout(() => {
                power = 0;
                powerFill.style.height = '0%';
                powerKnob.style.bottom = '0%';
                ballInHand = false; // End AI ball-in-hand mode upon firing
                updateUIText();
                cue.vel = new Vec2(Math.cos(aimAngle), Math.sin(aimAngle)).mult(finalPower);
                state = 'rolling';
            }, 150); // Pause briefly before release
        }
    }, 30);
}

function updateUIText() {
    const turnIndicator = document.getElementById('turn-indicator');
    const matchStatus = document.getElementById('match-status');
    const banner = document.getElementById('ball-in-hand-banner');

    const p2Name = gameMode === 'pve' ? 'AI' : 'PLAYER 2';
    turnIndicator.innerText = currentPlayer === 1 ? "PLAYER 1'S TURN" : `${p2Name}'S TURN`;
    turnIndicator.style.color = currentPlayer === 1 ? '#38bdf8' : '#f87171';

    const p1Color = playerColors[1];
    const p2Color = playerColors[2];
    const p1Remaining = p1Color
        ? balls.filter(b => b.active && b.id !== 0 && b.id !== 8 && (p1Color === 'orange' ? b.id <= 7 : b.id >= 9)).length
        : '-';
    const p2Remaining = p2Color
        ? balls.filter(b => b.active && b.id !== 0 && b.id !== 8 && (p2Color === 'orange' ? b.id <= 7 : b.id >= 9)).length
        : '-';

    matchStatus.innerText = `P1: ${p1Score} | P2: ${p2Score}   (${p1Remaining} vs ${p2Remaining} left)`;

    if (ballInHand && showBallInHandBanner) {
        banner.style.display = 'block';
        banner.style.opacity = '1';
    } else {
        banner.style.opacity = '0';
        setTimeout(() => { if (!showBallInHandBanner) banner.style.display = 'none'; }, 300);
    }
}

function drawAimLine() {
    const cue = balls[0];
    if (!cue.active) return;

    const dir = new Vec2(Math.cos(aimAngle), Math.sin(aimAngle));
    const hit = getGhostBall(cue.pos, dir);

    if (hit) {
        // Main aim line to ghost ball
        ctx.beginPath();
        ctx.moveTo(cue.pos.x, cue.pos.y);
        ctx.lineTo(hit.pos.x, hit.pos.y);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw Ghost Ball
        ctx.beginPath();
        ctx.arc(hit.pos.x, hit.pos.y, R, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();

        if (hit.targetBall) {
            // Collision Normal (Target ball path)
            const normal = hit.targetBall.pos.sub(hit.pos).normalize();
            ctx.beginPath();
            ctx.moveTo(hit.pos.x, hit.pos.y);
            ctx.lineTo(hit.pos.x + normal.x * 350, hit.pos.y + normal.y * 350);
            ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)'; // Bright Green
            ctx.lineWidth = 2.5;
            ctx.stroke();

            // Collision Tangent (Cue ball path)
            const rel = hit.targetBall.pos.sub(hit.pos);
            const cross = dir.x * rel.y - dir.y * rel.x;
            const sign = cross > 0 ? 1 : -1;

            const tangent = new Vec2(-normal.y * sign, normal.x * sign);
            ctx.beginPath();
            ctx.moveTo(hit.pos.x, hit.pos.y);
            ctx.lineTo(hit.pos.x + tangent.x * 150, hit.pos.y + tangent.y * 150);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)'; // Faded white line
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }
    }

    // Draw 3D Cue Stick
    const pullBack = 20 + power * 3;
    const stickStart = cue.pos.sub(dir.mult(pullBack + R));
    const stickEnd = stickStart.sub(dir.mult(150));

    // Cue Stick Shadow
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(stickStart.x + 8, stickStart.y + 12);
    ctx.lineTo(stickEnd.x + 8, stickEnd.y + 12);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.filter = 'blur(4px)';
    ctx.stroke();
    ctx.restore();

    // Cue Stick Base Wood Gradient
    ctx.beginPath();
    ctx.moveTo(stickStart.x, stickStart.y);
    ctx.lineTo(stickEnd.x, stickEnd.y);
    const stickGrad = ctx.createLinearGradient(stickStart.x, stickStart.y, stickEnd.x, stickEnd.y);
    stickGrad.addColorStop(0, '#fcd34d'); // Light maple tip
    stickGrad.addColorStop(0.3, '#d97706'); // Orange/Brown mid
    stickGrad.addColorStop(1, '#451a03'); // Dark handle
    ctx.strokeStyle = stickGrad;
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Specular Highlight (Makes the stick look like a glossy cylinder)
    ctx.beginPath();
    ctx.moveTo(stickStart.x, stickStart.y);
    ctx.lineTo(stickEnd.x, stickEnd.y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Cue stick chalk tip
    ctx.beginPath();
    ctx.moveTo(stickStart.x, stickStart.y);
    ctx.lineTo(stickStart.sub(dir.mult(10)).x, stickStart.sub(dir.mult(10)).y);
    ctx.strokeStyle = '#0ea5e9'; // Bright sky blue chalk
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.stroke();
}

function draw() {
    // 1. Table Outer Wood Frame (Rich 3D gradient)
    const woodGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    woodGrad.addColorStop(0, '#4a2511');
    woodGrad.addColorStop(0.5, '#2e1205');
    woodGrad.addColorStop(1, '#4a2511');
    ctx.fillStyle = woodGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Table Felt (Spotlight Radial Gradient for depth)
    const tableGrad = ctx.createRadialGradient(canvas.width/2, canvas.height/2, 50, canvas.width/2, canvas.height/2, canvas.height * 0.7);
    tableGrad.addColorStop(0, '#16a34a'); // Bright center
    tableGrad.addColorStop(1, '#064e3b'); // Dark corners
    ctx.fillStyle = tableGrad;
    ctx.fillRect(BOUNDS.left, BOUNDS.top, BOUNDS.right - BOUNDS.left, BOUNDS.bottom - BOUNDS.top);

    // 3. Inner Cushion Shadows (Creates the illusion of sunken felt / raised rails)
    const shadowSize = 15;
    // Top Rail Shadow
    let tShadow = ctx.createLinearGradient(0, BOUNDS.top, 0, BOUNDS.top + shadowSize);
    tShadow.addColorStop(0, 'rgba(0,0,0,0.7)'); tShadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = tShadow; ctx.fillRect(BOUNDS.left, BOUNDS.top, BOUNDS.right - BOUNDS.left, shadowSize);
    // Bottom Rail Shadow
    let bShadow = ctx.createLinearGradient(0, BOUNDS.bottom, 0, BOUNDS.bottom - shadowSize);
    bShadow.addColorStop(0, 'rgba(0,0,0,0.7)'); bShadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bShadow; ctx.fillRect(BOUNDS.left, BOUNDS.bottom - shadowSize, BOUNDS.right - BOUNDS.left, shadowSize);
    // Left Rail Shadow
    let lShadow = ctx.createLinearGradient(BOUNDS.left, 0, BOUNDS.left + shadowSize, 0);
    lShadow.addColorStop(0, 'rgba(0,0,0,0.7)'); lShadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lShadow; ctx.fillRect(BOUNDS.left, BOUNDS.top, shadowSize, BOUNDS.bottom - BOUNDS.top);
    // Right Rail Shadow
    let rShadow = ctx.createLinearGradient(BOUNDS.right, 0, BOUNDS.right - shadowSize, 0);
    rShadow.addColorStop(0, 'rgba(0,0,0,0.7)'); rShadow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rShadow; ctx.fillRect(BOUNDS.right - shadowSize, BOUNDS.top, shadowSize, BOUNDS.bottom - BOUNDS.top);

    // 4. Draw Pockets (3D style)
    for (let pocket of pockets) {
        // Outer Leather/Plastic Rim
        ctx.beginPath();
        ctx.arc(pocket.x, pocket.y, POCKET_R + 8, 0, Math.PI * 2);
        const rimGrad = ctx.createRadialGradient(pocket.x, pocket.y, POCKET_R, pocket.x, pocket.y, POCKET_R + 8);
        rimGrad.addColorStop(0, '#222');
        rimGrad.addColorStop(1, '#000');
        ctx.fillStyle = rimGrad;
        ctx.fill();

        // Inner Void
        ctx.beginPath();
        ctx.arc(pocket.x, pocket.y, POCKET_R, 0, Math.PI * 2);
        ctx.fillStyle = '#050505';
        ctx.fill();

        // Inner Drop-off Shadow (Deep hole effect)
        ctx.beginPath();
        ctx.arc(pocket.x, pocket.y, POCKET_R, 0, Math.PI * 2);
        const innerGrad = ctx.createRadialGradient(pocket.x, pocket.y, POCKET_R * 0.4, pocket.x, pocket.y, POCKET_R);
        innerGrad.addColorStop(0, 'rgba(0,0,0,0)');
        innerGrad.addColorStop(1, 'rgba(0,0,0,0.9)');
        ctx.fillStyle = innerGrad;
        ctx.fill();
    }

    if (state === 'aiming' || state === 'shooting') {
        drawAimLine();
    }

    // 5. Draw Cast Shadows for all balls (Drawn first so they sit under the balls)
    for (let b of balls) {
        if (!b.active) continue;
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.pos.x + 4, b.pos.y + 6, R * 0.9, 0, Math.PI * 2); // Offset down-right
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.filter = 'blur(3px)'; // Soft shadow
        ctx.fill();
        ctx.restore();
    }

    // 6. Draw 3D Balls
    for (let b of balls) {
        if (!b.active) continue;

        // Save context to clip textures perfectly
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, R, 0, Math.PI * 2);
        ctx.clip();

        // Base Color
        if (b.isCue) {
            ctx.fillStyle = '#f8f9fa';
        } else {
            ctx.fillStyle = b.color;
        }
        ctx.fillRect(b.pos.x - R, b.pos.y - R, R * 2, R * 2);

        // 8-Ball Detail
        if (b.id === 8) {
            ctx.beginPath();
            ctx.arc(b.pos.x, b.pos.y, R * 0.5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            ctx.fillStyle = '#000000';
            ctx.font = 'bold 9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.id, b.pos.x, b.pos.y + 0.5);
        }

        // Cue Ball Detail
        if (b.isCue) {
            ctx.beginPath();
            ctx.arc(b.pos.x, b.pos.y, R * 0.2, 0, Math.PI * 2);
            ctx.fillStyle = '#dc2626';
            ctx.fill();
        }
        ctx.restore(); // End clipping

        // 3D Spherical Lighting Overlay (Specular + Core Shadow)
        const lighting = ctx.createRadialGradient(
            b.pos.x - R * 0.35, b.pos.y - R * 0.35, R * 0.1, // Specular hot spot (top-left)
            b.pos.x, b.pos.y, R * 1.1 // Outer edge
        );
        lighting.addColorStop(0, 'rgba(255, 255, 255, 0.8)');    // Sharp highlight
        lighting.addColorStop(0.2, 'rgba(255, 255, 255, 0.15)'); // Mid-tone blend
        lighting.addColorStop(0.7, 'rgba(0, 0, 0, 0.1)');        // Form shadow starts
        lighting.addColorStop(1, 'rgba(0, 0, 0, 0.6)');          // Core shadow at edge

        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, R, 0, Math.PI * 2);
        ctx.fillStyle = lighting;
        ctx.fill();

        // Ball-in-hand glowing pulse indicator
        if (b.isCue && ballInHand) {
            ctx.beginPath();
            ctx.arc(b.pos.x, b.pos.y, R + 4 + Math.sin(Date.now() / 150) * 2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(251, 191, 36, 0.8)';
            ctx.lineWidth = 3;
            ctx.stroke();
        }
    }
}

function loop() {
    if (!gamePaused) {
        updatePhysics();
    }
    draw();
    requestAnimationFrame(loop);
}

// --- PixelPlay UI controls ---

function showDifficulty() {
    document.getElementById('primary-buttons').classList.add('hidden');
    document.getElementById('difficulty-buttons').classList.remove('hidden');
}

function startGame(mode, difficulty) {
    gameMode = mode;
    aiLevel = difficulty;
    currentPlayer = 1;
    playerColors = { 1: null, 2: null };
    pottedBallsThisTurn = [];
    scratched = false;
    state = 'aiming';
    ballInHand = false;
    showBallInHandBanner = false;
    gamePaused = false;

    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('ui-layer').style.display = 'block';
    document.getElementById('pp-back').style.display = 'none';
    document.getElementById('pause-btn').style.display = 'block';

    initRack();
    updateUIText();
}

function resetToMenu() {
    gameMode = 'menu';
    gamePaused = false;
    document.getElementById('main-menu').classList.remove('hidden');
    document.getElementById('message-overlay').classList.remove('visible');
    document.getElementById('ui-layer').style.display = 'none';
    document.getElementById('pp-back').style.display = 'block';
    document.getElementById('pause-btn').style.display = 'none';
    document.getElementById('pause-overlay').style.display = 'none';
    document.getElementById('primary-buttons').classList.remove('hidden');
    document.getElementById('difficulty-buttons').classList.add('hidden');
    document.getElementById('p1-menu-score').innerText = p1Score;
    document.getElementById('p2-menu-score').innerText = p2Score;
    initRack();
}

function togglePause() {
    gamePaused = !gamePaused;
    document.getElementById('pause-overlay').style.display = gamePaused ? 'flex' : 'none';
}

function resumeGame() {
    gamePaused = false;
    document.getElementById('pause-overlay').style.display = 'none';
}

function restartGame() {
    gamePaused = false;
    document.getElementById('pause-overlay').style.display = 'none';
    currentPlayer = 1;
    playerColors = { 1: null, 2: null };
    pottedBallsThisTurn = [];
    scratched = false;
    state = 'aiming';
    ballInHand = false;
    showBallInHandBanner = false;
    initRack();
    updateUIText();
}

function goToTitle() {
    resetToMenu();
}

function showMessage(title, subtitle) {
    document.getElementById('message-title').innerText = title;
    document.getElementById('message-subtitle').innerText = subtitle;
    document.getElementById('message-overlay').classList.add('visible');
}

// Aiming Interaction (Canvas)
let isAimingDrag = false;
let isDraggingCue = false;

function updateAim(clientX, clientY) {
    if (state !== 'aiming' && state !== 'shooting') return;
    const rect = canvas.getBoundingClientRect();
    // Scale correctly based on responsive canvas size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    const cue = balls[0];
    if (cue.active) {
        // Angle from cue ball to pointer
        aimAngle = Math.atan2(y - cue.pos.y, x - cue.pos.x);
    }
}

canvas.addEventListener('pointerdown', (e) => {
    if (gameMode === 'menu' || (gameMode === 'pve' && currentPlayer === 2)) return;

    // First-touch dismissal of the banner
    if (showBallInHandBanner) {
        showBallInHandBanner = false;
        updateUIText();
    }

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // Check if user is grabbing the cue ball during ball-in-hand state
    if (ballInHand && new Vec2(x, y).dist(balls[0].pos) < R * 4) { // Generous grab radius
        isDraggingCue = true;
        return;
    }

    if (state !== 'aiming') return;

    isAimingDrag = true;
    updateAim(e.clientX, e.clientY);
});

window.addEventListener('pointermove', (e) => {
    // Handle dragging the cue ball
    if (isDraggingCue) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;

        // Constrain to inside the table cushions
        let newX = Math.max(BOUNDS.left + R, Math.min(BOUNDS.right - R, x));
        let newY = Math.max(BOUNDS.top + R, Math.min(BOUNDS.bottom - R, y));

        // Prevent overlapping with any other balls
        let valid = true;
        for (let i = 1; i < balls.length; i++) {
            if (balls[i].active && balls[i].pos.dist(new Vec2(newX, newY)) < 2 * R) {
                valid = false;
                break;
            }
        }

        if (valid) balls[0].pos = new Vec2(newX, newY);
        return;
    }

    if (isAimingDrag) {
        updateAim(e.clientX, e.clientY);
    }
    if (isDraggingPower) {
        // Update power based on drag distance
        const containerRect = powerContainer.getBoundingClientRect();
        let percentage = 1 - ((e.clientY - containerRect.top) / containerRect.height);
        percentage = Math.max(0, Math.min(1, percentage));
        power = percentage * maxPower;

        powerFill.style.height = `${percentage * 100}%`;
        powerKnob.style.bottom = `${percentage * 100}%`;
    }
});

window.addEventListener('pointerup', () => {
    if (isDraggingCue) {
        isDraggingCue = false;
        // Removed state lock to allow infinite placement adjustments until shot is fired
        return;
    }

    isAimingDrag = false;
    if (isDraggingPower) {
        isDraggingPower = false;
        if (power > 1) {
            // Shoot
            const cue = balls[0];
            if (cue.active) {
                ballInHand = false; // Shooting finalizes placement
                updateUIText();
                cue.vel = new Vec2(Math.cos(aimAngle), Math.sin(aimAngle)).mult(power);
                state = 'rolling';
            }
        }
        // Reset power bar UI
        power = 0;
        powerFill.style.height = '0%';
        powerKnob.style.bottom = '0%';
    }
});

// Power Bar Interaction
const powerContainer = document.getElementById('power-container');
const powerFill = document.getElementById('power-fill');
const powerKnob = document.getElementById('power-knob');

powerContainer.addEventListener('pointerdown', (e) => {
    if (state !== 'aiming' || gameMode === 'menu' || (gameMode === 'pve' && currentPlayer === 2)) return;

    // First-touch dismissal if they go straight for the power bar
    if (showBallInHandBanner) {
        showBallInHandBanner = false;
        updateUIText();
    }

    isDraggingPower = true;
    state = 'shooting'; // Locks aim
});

// --- Init ---
initRack();
loop();
