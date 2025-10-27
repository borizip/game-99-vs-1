/** @type {HTMLCanvasElement} */
const canvas = document.getElementById("game");
/** @type {CanvasRenderingContext2D */
const ctx = canvas.getContext("2d");
const hudTimer = document.getElementById("timer");
const hudScore = document.getElementById("score");
const gameOverPanel = document.getElementById("game-over");
const gameOverTitle = document.getElementById("game-over-title");
const gameOverDetail = document.getElementById("game-over-detail");
const restartButton = document.getElementById("restart");

let canvasWidth = 0;
let canvasHeight = 0;
let dpr = 1;
let transformScale = 1;

const CONFIG = {
  playerSpeed: 3,
  cpuSpeed: 1,
  playerRadius: 14,
  cpuRadius: 10,
  peelRadius: 12,
  dangerTriggerOffset: 90,
  springRestOffset: 40,
  separationPadding: 6,
  edgeRepulsionMargin: 120,
  edgeVelocityClampBand: 30,

  enemyCount: 99,
  roundSeconds: 180,
  peelDropInterval: 6,
  peelDropJitter: 3,
  initialPeelDelay: 4,
  playerStunDuration: 3,
  outerBoundaryRatio: 0.9,
  springStrength: 0.08,
  springDamping: 0.12,
  separationStrength: 0.15,
  edgeRepulsionStrength: 0.75,

  stageRadius: 500,

  enemyColor: "#232424ff",
};

CONFIG.safeRadius = CONFIG.stageRadius * 0.32;
CONFIG.dangerTriggerDistance = CONFIG.safeRadius + CONFIG.dangerTriggerOffset;
CONFIG.springRestDistance = CONFIG.safeRadius + CONFIG.springRestOffset;
CONFIG.separationPadding = Math.max(2, CONFIG.separationPadding);

const BIOMES = [
  { name: "빙결 평원", ground: "#bfdbfe", rim: "#1d4ed8" },
  { name: "자수정 산림", ground: "#c4b5fd", rim: "#6d28d9" },
  { name: "황혼 사막", ground: "#fbbf24", rim: "#c2410c" },
  { name: "심해 분지", ground: "#38bdf8", rim: "#0ea5e9" },
];

const PLAYER_PAIN_MESSAGES = ["으악!", "꽥!", "아야!", "미끄러졌어!", "헉!"];
const CPU_SLIP_TAUNTS = ["깔깔!", "히히!", "낄낄", "푸핫!"];
const PEEL_DROP_MESSAGES = ["하하!", "받아라!", "이거나 먹어라!", "조심해!"];
const CPU_DANGER_MESSAGES = ["안돼!!", "위험해!", "돔황촤!", "살려줘!", "안 돼!"];

const pressed = new Set();
let lastTimestamp = 0;
let player;
let enemies = [];
let timeLeft = CONFIG.roundSeconds;
let score = 0;
let gameOver = false;
let biome;
let playerVelocity = { x: 0, y: 0 };
let peels = [];
let peelDropCountdown = CONFIG.initialPeelDelay;
let playerStunTimer = 0;
let playerBubble = null;
let touchTarget = null;

document.addEventListener("keydown", handleKeydown);
document.addEventListener("keyup", handleKeyup);
window.addEventListener("resize", resizeCanvas);

canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

restartButton.addEventListener("click", resetGame);

resizeCanvas();

resetGame();
requestAnimationFrame(loop);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch((error) => console.error("Service worker registration failed:", error));
  });
}

function resizeCanvas() {
  dpr = window.devicePixelRatio || 1;
  const canvasRect = canvas.getBoundingClientRect();
  canvas.width = canvasWidth = canvasRect.width * dpr;
  canvas.height = canvasHeight = canvasRect.height * dpr;
  transformScale = Math.min(canvasWidth, canvasHeight) / 1024;
}

function randomPointInCircle(radius) {
  const t = Math.random() * Math.PI * 2;
  const r = Math.sqrt(Math.random()) * radius;
  return { x: Math.cos(t) * r, y: Math.sin(t) * r };
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function len(vx, vy) {
  return Math.hypot(vx, vy);
}

function normalize(vx, vy) {
  const l = len(vx, vy);
  if (l === 0) return { x: 0, y: 0 };
  return { x: vx / l, y: vy / l };
}

function resetGame() {
  const center = 0;
  biome = BIOMES[Math.floor(Math.random() * BIOMES.length)];
  player = { x: center, y: center, radius: CONFIG.playerRadius };
  enemies = [];
  peels = [];
  peelDropCountdown = CONFIG.initialPeelDelay + Math.random() * CONFIG.peelDropJitter;
  playerStunTimer = 0;
  playerBubble = null;
  touchTarget = null;
  const maxIdleRadius = CONFIG.stageRadius * CONFIG.outerBoundaryRatio - CONFIG.cpuRadius - 12;
  for (let i = 0; i < CONFIG.enemyCount; i += 1) {
    const isCloseBand = Math.random() < 0.55;
    const closeRadius = Math.min(maxIdleRadius, CONFIG.safeRadius + randomRange(20, 70));
    const farRadius = Math.min(maxIdleRadius, CONFIG.safeRadius + randomRange(80, 160));
    const spawnRadius = isCloseBand ? closeRadius : farRadius;
    const point = randomPointInCircle(spawnRadius);
    enemies.push({
      x: center + point.x,
      y: center + point.y,
      radius: CONFIG.cpuRadius,
      alive: true,
      vx: 0,
      vy: 0,
      bubble: null,
      bubbleCooldown: Math.random(),
    });
  }
  score = 0;
  timeLeft = CONFIG.roundSeconds;
  lastTimestamp = 0;
  gameOver = false;
  playerVelocity = { x: 0, y: 0 };
  hudTimer.textContent = CONFIG.roundSeconds.toString();
  hudScore.textContent = `0 / ${CONFIG.enemyCount}`;
  gameOverPanel.classList.add("hidden");
}

function dropBananaPeel() {
  const aliveEnemies = enemies.filter((enemy) => enemy.alive);
  if (aliveEnemies.length === 0) return;
  const source = randomChoice(aliveEnemies);
  peels.push({
    x: source.x,
    y: source.y,
    radius: CONFIG.peelRadius,
  });
  source.bubble = { text: randomChoice(PEEL_DROP_MESSAGES), ttl: 1.2 };
  source.bubbleCooldown = 3 + Math.random() * 2;
}

function triggerPlayerSlip() {
  playerStunTimer = CONFIG.playerStunDuration;
  playerVelocity = { x: 0, y: 0 };
  playerBubble = {
    text: randomChoice(PLAYER_PAIN_MESSAGES),
    ttl: 1.5,
  };
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    if (Math.random() < 0.2) {
      enemy.bubble = { text: randomChoice(CPU_SLIP_TAUNTS), ttl: 1.2 };
      enemy.bubbleCooldown = 3 + Math.random() * 2;
    }
  }
}

const keyMap = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  a: "left",
  d: "right",
  w: "up",
  s: "down",
  Enter: "enter",
  " ": "enter",
};
function handleKeydown(e) {
  const key = keyMap[e.key];
  if (key) {
    e.preventDefault();
    pressed.add(key);
  }
}

function handleKeyup(e) {
  pressed.delete(keyMap[e.key]);
}

function getTouchPoint(touch) {
  if (!touch) return null;
  return {
    x: (touch.clientX * 2 - canvasWidth / dpr) / transformScale,
    y: (touch.clientY * 2 - canvasHeight / dpr) / transformScale,
  };
}

function handleTouchStart(e) {
  if (e.touches.length === 0) return;
  e.preventDefault();
  const point = getTouchPoint(e.touches[0]);
  if (point) {
    touchTarget = point;
  }
}

function handleTouchMove(e) {
  if (e.touches.length === 0) return;
  e.preventDefault();
  const point = getTouchPoint(e.touches[0]);
  if (point) {
    touchTarget = point;
  }
}

function handleTouchEnd(e) {
  e.preventDefault();
  if (e.touches.length > 0) {
    const point = getTouchPoint(e.touches[0]);
    if (point) {
      touchTarget = point;
    }
  } else {
    touchTarget = null;
  }
}

function update(dt) {
  if (gameOver) return;
  const dt60 = dt * 60; // keep speed values close to design numbers
  const center = 0;

  if (playerStunTimer > 0) {
    playerStunTimer -= dt;
    if (playerStunTimer < 0) {
      playerStunTimer = 0;
    }
  }

  if (playerBubble && playerBubble.ttl > 0) {
    playerBubble.ttl -= dt;
    if (playerBubble.ttl <= 0) {
      playerBubble = null;
    }
  }

  // timer
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0;
    endGame(true);
  }
  hudTimer.textContent = Math.ceil(timeLeft).toString();

  // player movement
  let inputX = 0;
  let inputY = 0;
  if (pressed.has("up")) inputY -= 1;
  if (pressed.has("down")) inputY += 1;
  if (pressed.has("left")) inputX -= 1;
  if (pressed.has("right")) inputX += 1;

  let dirX = 0;
  let dirY = 0;

  if (playerStunTimer > 0) {
    playerVelocity.x = 0;
    playerVelocity.y = 0;
  } else {
    if (inputX !== 0 || inputY !== 0) {
      const dir = normalize(inputX, inputY);
      dirX = dir.x;
      dirY = dir.y;
    } else if (touchTarget) {
      const toTargetX = touchTarget.x - player.x;
      const toTargetY = touchTarget.y - player.y;
      const distToTarget = len(toTargetX, toTargetY);
      if (distToTarget > CONFIG.playerRadius * 0.6) {
        dirX = toTargetX / distToTarget;
        dirY = toTargetY / distToTarget;
      }
    }

    playerVelocity.x = dirX * CONFIG.playerSpeed;
    playerVelocity.y = dirY * CONFIG.playerSpeed;
  }
  player.x += playerVelocity.x * dt60;
  player.y += playerVelocity.y * dt60;

  const playerSpeedNow = playerStunTimer > 0 ? 0 : len(playerVelocity.x, playerVelocity.y);

  const distFromCenter = len(player.x - center, player.y - center);
  if (distFromCenter > CONFIG.stageRadius) {
    endGame(false);
    return;
  }

  let dangerTarget = null;
  if (playerStunTimer <= 0 && playerSpeedNow > 0.2) {
    let nearest = Infinity;
    for (const enemy of enemies) {
      if (!enemy.alive) continue;
      const dist = len(player.x - enemy.x, player.y - enemy.y);
      if (dist < nearest && dist <= CONFIG.dangerTriggerDistance) {
        nearest = dist;
        dangerTarget = enemy;
      }
    }
  }

  if (dangerTarget && (!dangerTarget.bubble || dangerTarget.bubble.ttl <= 0) && dangerTarget.bubbleCooldown <= 0) {
    dangerTarget.bubble = { text: randomChoice(CPU_DANGER_MESSAGES), ttl: 1.2 };
    dangerTarget.bubbleCooldown = 3 + Math.random() * 2;
  }

  const forces = enemies.map(() => ({ x: 0, y: 0 }));
  const springRest = CONFIG.springRestDistance;
  const springStrength = CONFIG.springStrength;
  const dampingFactor = Math.max(0, 1 - CONFIG.springDamping * dt);
  const edgeMargin = CONFIG.edgeRepulsionMargin;
  const edgeStrength = CONFIG.edgeRepulsionStrength;

  enemies.forEach((enemy, index) => {
    if (!enemy.alive) return;

    if (enemy.bubbleCooldown > 0) {
      enemy.bubbleCooldown -= dt;
    }
    if (enemy.bubble && enemy.bubble.ttl > 0) {
      enemy.bubble.ttl -= dt;
      if (enemy.bubble.ttl <= 0) {
        enemy.bubble = null;
      }
    }

    const toPlayer = {
      x: player.x - enemy.x,
      y: player.y - enemy.y,
    };
    const distToPlayer = len(toPlayer.x, toPlayer.y);
    if (distToPlayer > 0.0001) {
      const dirToPlayer = {
        x: toPlayer.x / distToPlayer,
        y: toPlayer.y / distToPlayer,
      };
      const displacement = distToPlayer - springRest;
      const forceMag = springStrength * displacement;
      forces[index].x += dirToPlayer.x * forceMag;
      forces[index].y += dirToPlayer.y * forceMag;
    }

    const distFromCenter = len(enemy.x - center, enemy.y - center);
    if (distFromCenter > CONFIG.stageRadius + enemy.radius) {
      if (enemy.alive) {
        enemy.alive = false;
        score += 1;
        hudScore.textContent = `${score} / ${CONFIG.enemyCount}`;
        if (score >= CONFIG.enemyCount) {
          endGame(true);
          return;
        }
      }
      forces[index].x = 0;
      forces[index].y = 0;
      return;
    }
    if (distFromCenter > CONFIG.stageRadius - edgeMargin) {
      const dirInward = normalize(center - enemy.x, center - enemy.y);
      const penetration = distFromCenter - (CONFIG.stageRadius - edgeMargin);
      const edgeForce = (penetration / edgeMargin) * edgeStrength;
      forces[index].x += dirInward.x * edgeForce;
      forces[index].y += dirInward.y * edgeForce;
    }
  });

  for (let i = 0; i < enemies.length; i += 1) {
    const a = enemies[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < enemies.length; j += 1) {
      const b = enemies[j];
      if (!b.alive) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist === 0) {
        const angle = Math.random() * Math.PI * 2;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        dist = 1;
      }
      const minDist = a.radius + b.radius + CONFIG.separationPadding;
      if (dist < minDist) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        const forceMag = overlap * CONFIG.separationStrength;
        forces[i].x -= nx * forceMag;
        forces[i].y -= ny * forceMag;
        forces[j].x += nx * forceMag;
        forces[j].y += ny * forceMag;
      }
    }
  }

  const accelScale = dt60;
  enemies.forEach((enemy, index) => {
    if (!enemy.alive) return;
    enemy.vx = (enemy.vx + forces[index].x * accelScale) * dampingFactor;
    enemy.vy = (enemy.vy + forces[index].y * accelScale) * dampingFactor;
    const distFromCenter = len(enemy.x - center, enemy.y - center);
    if (distFromCenter > CONFIG.stageRadius - CONFIG.edgeVelocityClampBand) {
      const dirOut = normalize(enemy.x - center, enemy.y - center);
      const radialVel = enemy.vx * dirOut.x + enemy.vy * dirOut.y;
      if (radialVel > 0) {
        enemy.vx -= dirOut.x * radialVel;
        enemy.vy -= dirOut.y * radialVel;
      }
    }
    const speed = len(enemy.vx, enemy.vy);
    if (speed > CONFIG.cpuSpeed) {
      const s = CONFIG.cpuSpeed / Math.max(speed, 0.0001);
      enemy.vx *= s;
      enemy.vy *= s;
    }
    enemy.x += enemy.vx * dt60;
    enemy.y += enemy.vy * dt60;
    const newDist = len(enemy.x - center, enemy.y - center);
    const maxInside = CONFIG.stageRadius - enemy.radius - 2;
    if (newDist > maxInside) {
      const dirOut = normalize(enemy.x - center, enemy.y - center);
      enemy.x = center + dirOut.x * maxInside;
      enemy.y = center + dirOut.y * maxInside;
      const radialVel = enemy.vx * dirOut.x + enemy.vy * dirOut.y;
      if (radialVel > 0) {
        enemy.vx -= dirOut.x * radialVel;
        enemy.vy -= dirOut.y * radialVel;
      }
    }
  });

  peelDropCountdown -= dt;
  if (peelDropCountdown <= 0) {
    dropBananaPeel();
    peelDropCountdown = CONFIG.peelDropInterval + Math.random() * CONFIG.peelDropJitter;
  }

  for (let i = peels.length - 1; i >= 0; i -= 1) {
    const peel = peels[i];
    const dist = len(player.x - peel.x, player.y - peel.y);
    if (dist <= player.radius + peel.radius) {
      peels.splice(i, 1);
      triggerPlayerSlip();
    }
  }

  // capture check
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const dist = len(player.x - enemy.x, player.y - enemy.y);
    if (dist <= player.radius + enemy.radius) {
      enemy.alive = false;
      score += 1;
    }
  }

  hudScore.textContent = `${score} / ${CONFIG.enemyCount}`;

  if (score >= CONFIG.enemyCount) {
    endGame(true);
  }
}

function endGame(isClear) {
  if (gameOver) return;
  gameOver = true;
  touchTarget = null;
  gameOverPanel.classList.remove("hidden");
  const elapsedSeconds = Math.min(Math.max(CONFIG.roundSeconds - timeLeft, 0), CONFIG.roundSeconds);
  const totalSeconds = Math.round(elapsedSeconds);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const formattedElapsed = `${minutes}:${seconds}`;

  if (isClear && score >= CONFIG.enemyCount) {
    gameOverTitle.textContent = "모든 CPU를 잡았습니다!";
  } else if (isClear) {
    gameOverTitle.textContent = "시간 종료!!";
  } else {
    gameOverTitle.textContent = "밖으로 떨어졌습니다..";
  }
  gameOverDetail.innerHTML = `경과 시간: ${formattedElapsed}<br>잡은 CPU: ${score} / ${CONFIG.enemyCount}`;
}

function drawStage() {
  const gradient = ctx.createRadialGradient(0, 0, CONFIG.stageRadius * 0.1, 0, 0, CONFIG.stageRadius);
  gradient.addColorStop(0, biome.ground);
  gradient.addColorStop(1, biome.rim);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, CONFIG.stageRadius, 0, Math.PI * 2);
  ctx.fill();
}

function drawPeels() {
  ctx.fillStyle = "#facc15";
  ctx.strokeStyle = "#854d0e";
  ctx.lineWidth = 2;
  for (const peel of peels) {
    ctx.beginPath();
    ctx.arc(peel.x, peel.y, peel.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawPlayer() {
  ctx.fillStyle = "#6bddb7ff";
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();
}

function drawTouchIndicator() {
  if (!touchTarget || gameOver) return;

  ctx.save();
  ctx.strokeStyle = "rgba(56, 189, 248, 0.7)";
  ctx.lineWidth = Math.max(1.5, CONFIG.playerRadius * 0.18);
  const dashLength = Math.max(4, CONFIG.playerRadius * 0.6);
  ctx.setLineDash([dashLength, dashLength]);
  ctx.beginPath();
  ctx.arc(touchTarget.x, touchTarget.y, CONFIG.playerRadius * 1.8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawPlayerBubble() {
  if (!playerBubble || playerBubble.ttl <= 0) return;

  ctx.save();
  const text = playerBubble.text;
  const padding = 6;
  const height = 26;
  ctx.font = "18px Arial";
  const metrics = ctx.measureText(text);
  const width = metrics.width + padding * 2.5;
  const bubbleX = player.x - width / 2;
  const bubbleY = player.y - player.radius - height - 16;

  ctx.fillStyle = "rgba(169, 14, 14, 0.9)";
  ctx.strokeStyle = "rgba(169, 14, 14, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(bubbleX, bubbleY, width, height);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#ffffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, player.x, bubbleY + height / 2);
  ctx.restore();
}

function drawEnemies() {
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    ctx.fillStyle = CONFIG.enemyColor;
    ctx.beginPath();
    ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSpeechBubble(enemy) {
  if (!enemy.bubble || enemy.bubble.ttl <= 0) return;

  ctx.save();
  const text = enemy.bubble.text;
  const padding = 6;
  const height = 24;
  ctx.font = "16px Arial";
  const metrics = ctx.measureText(text);
  const width = metrics.width + padding * 2.5;
  const bubbleX = enemy.x - width / 2;
  const bubbleY = enemy.y - enemy.radius - height - 12;

  ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
  ctx.strokeStyle = "#f8fafc";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bubbleX, bubbleY, width, height, enemy.radius / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#f8fafc";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, enemy.x, bubbleY + height / 2);
  ctx.restore();
}

function drawEnemyBubbles() {
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    drawSpeechBubble(enemy);
  }
}

function loop(timestamp) {
  if (!lastTimestamp) {
    lastTimestamp = timestamp;
  }
  const dt = (timestamp - lastTimestamp) / 1000;
  lastTimestamp = timestamp;

  update(dt);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.setTransform(transformScale, 0, 0, transformScale, canvasWidth / 2, canvasHeight / 2);

  drawStage();
  drawPeels();
  drawEnemies();
  drawPlayer();
  drawEnemyBubbles();
  drawTouchIndicator();
  drawPlayerBubble();

  ctx.restore();

  requestAnimationFrame(loop);
}
