// Matter.js Aliases
const Engine = Matter.Engine,
      Bodies = Matter.Bodies,
      Composite = Matter.Composite,
      Body = Matter.Body,
      Events = Matter.Events;

let canvas, ctx;
let engine;
let diceResultEl, turnIndicator, instructionEl;

// Geometry State
let cellSize = 0;
let boardSize = 0;
let offsetX = 0;
let offsetY = 0;

// Game State
let diceBody = null;
let isRolling = false;
let currentDiceValue = 1;

// Neon Palette for the 4 Players
const COLORS = {
    p1: '#00d4ff', // Cyan (Bottom Right)
    p2: '#ff007a', // Magenta (Bottom Left)
    p3: '#39ff14', // Neon Green (Top Left)
    p4: '#ffea00', // Yellow (Top Right)
    grid: '#2a2d3e',
    glow: 'rgba(255,255,255,0.1)'
};

// ==========================================
// GEOMETRY & GRID RENDERING
// ==========================================
function initGeometry() {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;

    // Ludo is a 15x15 grid. We want it to fit nicely on the screen.
    const maxBoard = Math.min(canvas.width * 0.95, canvas.height * 0.7);
    cellSize = Math.floor(maxBoard / 15);
    boardSize = cellSize * 15;
    
    offsetX = (canvas.width - boardSize) / 2;
    offsetY = (canvas.height - boardSize) / 2 + 30; // Push down slightly for UI

    buildPhysicsArena();
}

function drawNeonRect(x, y, w, h, color, isFill) {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    if (isFill) {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        ctx.fill();
    } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
        ctx.stroke();
    }
    ctx.shadowBlur = 0; // Reset
}

function drawBoard() {
    // 1. Draw the 4 Home Yards (Corners of the 15x15 grid)
    const yardSize = cellSize * 6;
    
    // Top Left (P3 - Green)
    drawNeonRect(offsetX, offsetY, yardSize, yardSize, COLORS.p3, false);
    // Bottom Left (P2 - Magenta)
    drawNeonRect(offsetX, offsetY + (cellSize * 9), yardSize, yardSize, COLORS.p2, false);
    // Top Right (P4 - Yellow)
    drawNeonRect(offsetX + (cellSize * 9), offsetY, yardSize, yardSize, COLORS.p4, false);
    // Bottom Right (P1 - Cyan)
    drawNeonRect(offsetX + (cellSize * 9), offsetY + (cellSize * 9), yardSize, yardSize, COLORS.p1, false);

    // 2. Draw the Track Grid (Lines)
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.shadowBlur = 0;

    for(let i=0; i<=15; i++) {
        let pos = i * cellSize;
        // Verticals
        ctx.beginPath(); ctx.moveTo(offsetX + pos, offsetY); ctx.lineTo(offsetX + pos, offsetY + boardSize); ctx.stroke();
        // Horizontals
        ctx.beginPath(); ctx.moveTo(offsetX, offsetY + pos); ctx.lineTo(offsetX + boardSize, offsetY + pos); ctx.stroke();
    }

    // 3. Blackout the dead zones (inside the yards, leaving just the tracks)
    ctx.fillStyle = '#050508';
    ctx.fillRect(offsetX + 1, offsetY + 1, yardSize - 2, yardSize - 2);
    ctx.fillRect(offsetX + 1, offsetY + (cellSize * 9) + 1, yardSize - 2, yardSize - 2);
    ctx.fillRect(offsetX + (cellSize * 9) + 1, offsetY + 1, yardSize - 2, yardSize - 2);
    ctx.fillRect(offsetX + (cellSize * 9) + 1, offsetY + (cellSize * 9) + 1, yardSize - 2, yardSize - 2);

    // 4. Draw Center Home Triangle
    let cx = offsetX + (cellSize * 7.5);
    let cy = offsetY + (cellSize * 7.5);
    let hw = cellSize * 1.5;

    ctx.fillStyle = '#12141f';
    ctx.fillRect(cx - hw, cy - hw, hw*2, hw*2);
    
    // X marks the spot
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - hw, cy - hw); ctx.lineTo(cx + hw, cy + hw); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - hw, cy + hw); ctx.lineTo(cx + hw, cy - hw); ctx.stroke();
}

// ==========================================
// PHYSICS DICE ENGINE
// ==========================================
function buildPhysicsArena() {
    if (engine) {
        Composite.clear(engine.world);
        Engine.clear(engine);
    }
    
    engine = Engine.create();
    engine.gravity.y = 0; // Top-down view, no gravity pulling down screen

    let cx = offsetX + (boardSize / 2);
    let cy = offsetY + (boardSize / 2);
    
    // Create an invisible bouncy barrier around the 3x3 center area so the dice doesn't fly away
    const boundsSize = cellSize * 5;
    const wallOpts = { isStatic: true, restitution: 0.8, render: { visible: false } };
    
    Composite.add(engine.world, [
        Bodies.rectangle(cx, cy - boundsSize/2, boundsSize, 20, wallOpts), // Top
        Bodies.rectangle(cx, cy + boundsSize/2, boundsSize, 20, wallOpts), // Bottom
        Bodies.rectangle(cx - boundsSize/2, cy, 20, boundsSize, wallOpts), // Left
        Bodies.rectangle(cx + boundsSize/2, cy, 20, boundsSize, wallOpts)  // Right
    ]);

    // Create the Dice
    const diceSize = cellSize * 1.2;
    diceBody = Bodies.rectangle(cx, cy, diceSize, diceSize, {
        restitution: 0.6,
        frictionAir: 0.02, // Friction to slow it down gradually
        density: 0.05
    });
    
    Composite.add(engine.world, diceBody);
}

function rollDice() {
    if (isRolling) return;
    isRolling = true;
    
    // Hide old result
    diceResultEl.classList.add('hidden');
    // Force a reflow so the animation restarts later
    void diceResultEl.offsetWidth; 

    // Apply a random forceful flick to the dice
    const forceMagnitude = 0.08;
    const angle = Math.random() * Math.PI * 2;
    
    Body.applyForce(diceBody, diceBody.position, {
        x: Math.cos(angle) * forceMagnitude,
        y: Math.sin(angle) * forceMagnitude
    });
    
    // Spin it
    Body.setAngularVelocity(diceBody, (Math.random() > 0.5 ? 1 : -1) * 0.5);
}

// Monitor the dice speed to determine when it "stops"
function checkDiceStatus() {
    if (!isRolling) return;
    
    let speed = Math.hypot(diceBody.velocity.x, diceBody.velocity.y);
    let spin = Math.abs(diceBody.angularVelocity);
    
    if (speed < 0.1 && spin < 0.05) {
        isRolling = false;
        
        // Generate random 1-6
        currentDiceValue = Math.floor(Math.random() * 6) + 1;
        
        // Trigger Hologram Animation
        diceResultEl.textContent = currentDiceValue;
        diceResultEl.classList.remove('hidden');
        
        // Snap dice upright
        Body.setAngle(diceBody, 0);
    }
}

// ==========================================
// CORE LOOP & INPUT
// ==========================================
function gameLoop() {
    if (!ctx || !canvas) return;
    
    Engine.update(engine, 1000 / 60);
    checkDiceStatus();

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    drawBoard();

    // Draw the Physics Dice
    if (diceBody) {
        ctx.save();
        ctx.translate(diceBody.position.x, diceBody.position.y);
        ctx.rotate(diceBody.angle);
        
        // Glowing outline
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.shadowColor = '#fff';
        ctx.shadowBlur = isRolling ? 20 : 5;
        
        let ds = cellSize * 1.2;
        ctx.strokeRect(-ds/2, -ds/2, ds, ds);
        
        // Draw standard dice dots if stopped
        if (!isRolling) {
            ctx.fillStyle = '#fff';
            ctx.shadowBlur = 10;
            ctx.font = "bold " + (ds*0.6) + "px Arial";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(currentDiceValue, 0, 5);
        }
        
        ctx.restore();
    }

    requestAnimationFrame(gameLoop);
}

function handleInput(e) {
    e.preventDefault();
    if (isRolling) return;

    const rect = canvas.getBoundingClientRect();
    const touch = e.touches ? e.touches[0] : e;
    const px = touch.clientX - rect.left;
    const py = touch.clientY - rect.top;

    // Check if tapped near the center area
    let cx = offsetX + (boardSize / 2);
    let cy = offsetY + (boardSize / 2);
    
    let dist = Math.hypot(px - cx, py - cy);
    if (dist < cellSize * 3) {
        rollDice();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('gameCanvas');
    if (canvas) ctx = canvas.getContext('2d');
    
    diceResultEl = document.getElementById('dice-result');
    turnIndicator = document.getElementById('turn-indicator');
    instructionEl = document.getElementById('instruction');

    window.addEventListener('resize', initGeometry);
    
    if(canvas) {
        canvas.addEventListener('mousedown', handleInput);
        canvas.addEventListener('touchstart', handleInput, { passive: false });
    }

    initGeometry();
    requestAnimationFrame(gameLoop);
});