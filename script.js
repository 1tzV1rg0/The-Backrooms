(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const coordsEl = document.getElementById("coords");
  const statusEl = document.getElementById("status");

  const TILE = 24;
  const PLAYER_RADIUS = 7;
  const MONSTER_RADIUS = 8;
  const SPEED = 155;
  const SPRINT_SPEED = 245;
  const STAMINA_MAX = 100;
  const STAMINA_DRAIN = 34;
  const STAMINA_RECOVER = 24;
  const MONSTER_SPEED = 118;
  const EXIT_CELL = pickExitCell();
  const EXIT_TILE = { x: EXIT_CELL.x * 2, y: EXIT_CELL.y * 2 };
  const MONSTER_CELL = pickMonsterCell();
  const MONSTER_TILE = { x: MONSTER_CELL.x * 2, y: MONSTER_CELL.y * 2 };
  const keys = new Set();
  const state = {
    x: TILE / 2,
    y: TILE / 2,
    won: false,
    caught: false,
    stamina: STAMINA_MAX,
    sprinting: false,
    lastTime: performance.now(),
    pulse: 0,
    monster: {
      x: MONSTER_TILE.x * TILE + TILE / 2,
      y: MONSTER_TILE.y * TILE + TILE / 2,
      awake: false,
      wanderX: MONSTER_TILE.x * TILE + TILE / 2,
      wanderY: MONSTER_TILE.y * TILE + TILE / 2,
      wanderSeed: 1
    }
  };

  let width = 0;
  let height = 0;
  let dpr = 1;

  function resize() {
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    width = Math.floor(window.innerWidth);
    height = Math.floor(window.innerHeight);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function hash(x, y, salt = 0) {
    let h = Math.imul(x ^ 0x9e3779b9, 374761393);
    h = Math.imul((h ^ y) ^ 0x85ebca6b, 668265263);
    h = Math.imul(h ^ salt, 2246822519);
    return (h ^ (h >>> 13)) >>> 0;
  }

  function pickExitCell() {
    const angle = (hash(17, -31, 90) / 0xffffffff) * Math.PI * 2;
    const distance = 54 + (hash(-7, 11, 44) % 18);
    return {
      x: Math.round(Math.cos(angle) * distance),
      y: Math.round(Math.sin(angle) * distance)
    };
  }

  function pickMonsterCell() {
    const angle = (hash(41, 19, 707) / 0xffffffff) * Math.PI * 2;
    const distance = 28 + (hash(23, -51, 719) % 15);
    return {
      x: Math.round(Math.cos(angle) * distance),
      y: Math.round(Math.sin(angle) * distance)
    };
  }

  function parentOf(cx, cy) {
    if (cx === 0 && cy === 0) return null;

    const currentDistance = Math.hypot(cx, cy);
    const neighbors = [
      { x: cx + 1, y: cy },
      { x: cx - 1, y: cy },
      { x: cx, y: cy + 1 },
      { x: cx, y: cy - 1 }
    ];
    const choices = neighbors
      .map((neighbor) => ({
        x: neighbor.x,
        y: neighbor.y,
        distance: Math.hypot(neighbor.x, neighbor.y),
        noise: hash(cx * 3 + neighbor.x, cy * 3 + neighbor.y, 307) / 0xffffffff
      }))
      .filter((neighbor) => neighbor.distance < currentDistance)
      .sort((a, b) => (a.distance + a.noise * 1.65) - (b.distance + b.noise * 1.65));

    return choices[0] || { x: cx - Math.sign(cx || 1), y: cy };
  }

  function sideOpening(ax, ay, bx, by) {
    const farFromSpawn = Math.max(Math.hypot(ax, ay), Math.hypot(bx, by)) > 3;
    const roll = hash(ax + bx, ay + by, 509) % 100;
    const longHall = hash(Math.min(ax, bx), Math.min(ay, by), 613) % 37 === 0;
    return farFromSpawn && (roll < 24 || longHall);
  }

  function connected(ax, ay, bx, by) {
    const aParent = parentOf(ax, ay);
    const bParent = parentOf(bx, by);
    return (aParent && aParent.x === bx && aParent.y === by) ||
      (bParent && bParent.x === ax && bParent.y === ay) ||
      sideOpening(ax, ay, bx, by);
  }

  function baseTileKind(tx, ty) {
    const evenX = tx % 2 === 0;
    const evenY = ty % 2 === 0;

    if (evenX && evenY) return "floor";
    if (!evenX && !evenY) return "wall";

    if (!evenX) {
      const left = Math.floor(tx / 2);
      const cy = ty / 2;
      return connected(left, cy, left + 1, cy) ? "floor" : "wall";
    }

    const cx = tx / 2;
    const top = Math.floor(ty / 2);
    return connected(cx, top, cx, top + 1) ? "floor" : "wall";
  }

  function widenChance(tx, ty, salt) {
    return hash(Math.floor(tx / 2), Math.floor(ty / 2), salt) % 100;
  }

  function tileKind(tx, ty) {
    if (baseTileKind(tx, ty) === "floor") return "floor";

    const nearHorizontal = baseTileKind(tx, ty - 1) === "floor" || baseTileKind(tx, ty + 1) === "floor";
    const nearVertical = baseTileKind(tx - 1, ty) === "floor" || baseTileKind(tx + 1, ty) === "floor";
    const alcove = baseTileKind(tx - 1, ty - 1) === "floor" ||
      baseTileKind(tx + 1, ty - 1) === "floor" ||
      baseTileKind(tx - 1, ty + 1) === "floor" ||
      baseTileKind(tx + 1, ty + 1) === "floor";

    if (nearHorizontal && widenChance(tx, ty, 941) < 34) return "floor";
    if (nearVertical && widenChance(tx, ty, 947) < 34) return "floor";
    if (alcove && widenChance(tx, ty, 953) < 10) return "floor";

    return "wall";
  }

  function isWallAt(px, py) {
    return tileKind(Math.floor(px / TILE), Math.floor(py / TILE)) === "wall";
  }

  function collides(px, py, radius = PLAYER_RADIUS) {
    const samples = [
      [0, 0],
      [radius, 0],
      [-radius, 0],
      [0, radius],
      [0, -radius],
      [radius * 0.72, radius * 0.72],
      [-radius * 0.72, radius * 0.72],
      [radius * 0.72, -radius * 0.72],
      [-radius * 0.72, -radius * 0.72]
    ];

    return samples.some(([sx, sy]) => isWallAt(px + sx, py + sy));
  }

  function sameCorridor() {
    const playerTileX = Math.floor(state.x / TILE);
    const playerTileY = Math.floor(state.y / TILE);
    const monsterTileX = Math.floor(state.monster.x / TILE);
    const monsterTileY = Math.floor(state.monster.y / TILE);

    if (Math.abs(state.x - state.monster.x) < TILE * 0.72) {
      const fromY = Math.min(playerTileY, monsterTileY);
      const toY = Math.max(playerTileY, monsterTileY);
      for (let ty = fromY; ty <= toY; ty += 1) {
        if (tileKind(monsterTileX, ty) === "wall") return false;
      }
      return true;
    }

    if (Math.abs(state.y - state.monster.y) < TILE * 0.72) {
      const fromX = Math.min(playerTileX, monsterTileX);
      const toX = Math.max(playerTileX, monsterTileX);
      for (let tx = fromX; tx <= toX; tx += 1) {
        if (tileKind(tx, monsterTileY) === "wall") return false;
      }
      return true;
    }

    return false;
  }

  function setWanderTarget() {
    const tx = Math.floor(state.monster.x / TILE);
    const ty = Math.floor(state.monster.y / TILE);
    const candidates = [];

    for (let oy = -5; oy <= 5; oy += 1) {
      for (let ox = -5; ox <= 5; ox += 1) {
        const distance = Math.abs(ox) + Math.abs(oy);
        if (distance < 2 || distance > 7) continue;
        const cx = tx + ox;
        const cy = ty + oy;
        if (tileKind(cx, cy) === "floor") candidates.push({ x: cx, y: cy, score: hash(cx, cy, state.monster.wanderSeed) });
      }
    }

    state.monster.wanderSeed += 1;
    candidates.sort((a, b) => a.score - b.score);
    const target = candidates[0] || { x: tx, y: ty };
    state.monster.wanderX = target.x * TILE + TILE / 2;
    state.monster.wanderY = target.y * TILE + TILE / 2;
  }

  function stepMonsterToward(targetX, targetY, speed, dt) {
    const dx = targetX - state.monster.x;
    const dy = targetY - state.monster.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1) return true;

    const stepX = (dx / distance) * speed * dt;
    const stepY = (dy / distance) * speed * dt;
    let moved = false;

    if (!collides(state.monster.x + stepX, state.monster.y, MONSTER_RADIUS)) {
      state.monster.x += stepX;
      moved = true;
    }
    if (!collides(state.monster.x, state.monster.y + stepY, MONSTER_RADIUS)) {
      state.monster.y += stepY;
      moved = true;
    }

    return distance < TILE * 0.28 || !moved;
  }

  function wanderMonster(dt) {
    const distance = Math.hypot(state.monster.wanderX - state.monster.x, state.monster.wanderY - state.monster.y);
    if (distance < TILE * 0.32 || collides(state.monster.wanderX, state.monster.wanderY, MONSTER_RADIUS)) {
      setWanderTarget();
    }

    if (stepMonsterToward(state.monster.wanderX, state.monster.wanderY, MONSTER_SPEED * 0.52, dt)) {
      setWanderTarget();
    }
  }

  function moveMonster(dt) {
    if (state.caught || state.won) return;

    if (!state.monster.awake && sameCorridor()) {
      state.monster.awake = true;
      statusEl.textContent = "It saw you";
    }

    if (!state.monster.awake) {
      wanderMonster(dt);
      return;
    }

    const distance = Math.hypot(state.x - state.monster.x, state.y - state.monster.y);
    if (distance < PLAYER_RADIUS + MONSTER_RADIUS) {
      state.caught = true;
      statusEl.textContent = "Caught in the halls";
      return;
    }

    stepMonsterToward(state.x, state.y, MONSTER_SPEED, dt);
  }

  function move(dt) {
    let dx = 0;
    let dy = 0;
    if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
    if (keys.has("arrowright") || keys.has("d")) dx += 1;
    if (keys.has("arrowup") || keys.has("w")) dy -= 1;
    if (keys.has("arrowdown") || keys.has("s")) dy += 1;

    if (state.caught) return;

    const moving = dx !== 0 || dy !== 0;
    const wantsSprint = keys.has("shift") && moving && state.stamina > 0;
    state.sprinting = wantsSprint;

    if (moving) {
      const speed = wantsSprint ? SPRINT_SPEED : SPEED;
      const length = Math.hypot(dx, dy);
      dx = (dx / length) * speed * dt;
      dy = (dy / length) * speed * dt;

      if (!collides(state.x + dx, state.y)) state.x += dx;
      if (!collides(state.x, state.y + dy)) state.y += dy;
    }

    if (state.sprinting) {
      state.stamina = Math.max(0, state.stamina - STAMINA_DRAIN * dt);
    } else {
      state.stamina = Math.min(STAMINA_MAX, state.stamina + STAMINA_RECOVER * dt);
    }

    const exitX = EXIT_TILE.x * TILE + TILE / 2;
    const exitY = EXIT_TILE.y * TILE + TILE / 2;
    if (!state.won && Math.hypot(state.x - exitX, state.y - exitY) < TILE * 0.55) {
      state.won = true;
      statusEl.textContent = "Exit found";
    }

    moveMonster(dt);
  }

  function floorColor(tx, ty) {
    const n = hash(tx, ty, 31) % 18;
    return n < 7 ? "#806915" : n < 13 ? "#8f7618" : "#9c821d";
  }

  function wallColor(tx, ty) {
    const n = hash(tx, ty, 71) % 16;
    return n < 5 ? "#dfcf7d" : n < 12 ? "#eadb8c" : "#f1e29a";
  }

  function drawTile(tx, ty, sx, sy) {
    if (tileKind(tx, ty) === "wall") {
      ctx.fillStyle = wallColor(tx, ty);
      ctx.fillRect(sx, sy, TILE, TILE);
      ctx.fillStyle = "rgba(107, 83, 8, 0.22)";
      ctx.fillRect(sx, sy + TILE - 4, TILE, 4);
      ctx.fillStyle = "rgba(255, 251, 199, 0.16)";
      ctx.fillRect(sx, sy, TILE, 3);
      if (hash(tx, ty, 811) % 11 === 0) {
        ctx.fillStyle = "rgba(115, 94, 20, 0.32)";
        ctx.fillRect(sx + 2, sy + 5, TILE - 4, 3);
      }
      if (hash(tx, ty, 829) % 19 === 0) {
        ctx.fillStyle = "rgba(246, 236, 152, 0.28)";
        ctx.fillRect(sx + 5, sy + 2, 5, TILE - 5);
      }
      return;
    }

    ctx.fillStyle = floorColor(tx, ty);
    ctx.fillRect(sx, sy, TILE, TILE);
    if (hash(tx, ty, 101) % 9 === 0) {
      ctx.fillStyle = "rgba(65, 48, 5, 0.18)";
      ctx.fillRect(sx + 3, sy + 4, TILE - 6, 2);
    }
    if (hash(tx, ty, 733) % 23 === 0) {
      ctx.fillStyle = "rgba(48, 35, 4, 0.16)";
      ctx.fillRect(sx + 4, sy + 4, TILE - 8, TILE - 8);
    }
  }

  function drawExit(cameraX, cameraY) {
    const x = EXIT_TILE.x * TILE - cameraX;
    const y = EXIT_TILE.y * TILE - cameraY;
    const glow = 0.5 + Math.sin(state.pulse * 5) * 0.25;

    ctx.save();
    ctx.shadowColor = "rgba(226, 255, 186, " + glow + ")";
    ctx.shadowBlur = 18;
    ctx.fillStyle = "#d9f7c2";
    ctx.fillRect(x + 5, y + 3, TILE - 10, TILE - 6);
    ctx.fillStyle = "#7fa15a";
    ctx.fillRect(x + TILE - 9, y + TILE / 2 - 1, 3, 3);
    ctx.restore();
  }

  function drawMonster(cameraX, cameraY) {
    const x = state.monster.x - cameraX;
    const y = state.monster.y - cameraY;

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = state.monster.awake ? "rgba(0, 0, 0, 0.34)" : "rgba(0, 0, 0, 0.18)";
    ctx.beginPath();
    ctx.arc(0, 0, MONSTER_RADIUS + (state.monster.awake ? 8 : 3), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#050505";
    ctx.beginPath();
    ctx.arc(0, 0, MONSTER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.fillStyle = "rgba(31, 122, 255, 0.23)";
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS + 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1f7aff";
    ctx.beginPath();
    ctx.arc(0, 0, PLAYER_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#8dc1ff";
    ctx.beginPath();
    ctx.arc(-2, -2, 2.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawVignette() {
    const gradient = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.18,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.7
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
    gradient.addColorStop(1, "rgba(31, 23, 3, 0.55)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  function render() {
    const cameraX = state.x - width / 2;
    const cameraY = state.y - height / 2;
    const startX = Math.floor(cameraX / TILE) - 1;
    const startY = Math.floor(cameraY / TILE) - 1;
    const endX = Math.ceil((cameraX + width) / TILE) + 1;
    const endY = Math.ceil((cameraY + height) / TILE) + 1;

    for (let ty = startY; ty <= endY; ty += 1) {
      for (let tx = startX; tx <= endX; tx += 1) {
        drawTile(tx, ty, tx * TILE - cameraX, ty * TILE - cameraY);
      }
    }

    drawExit(cameraX, cameraY);
    drawMonster(cameraX, cameraY);
    drawPlayer();
    drawVignette();

    const playerX = Math.floor(state.x / TILE);
    const playerY = Math.floor(state.y / TILE);
    const monsterX = Math.floor(state.monster.x / TILE);
    const monsterY = Math.floor(state.monster.y / TILE);
    coordsEl.textContent = "Player " + playerX + ", " + playerY +
      " | Monster " + monsterX + ", " + monsterY +
      " | Stamina " + Math.round(state.stamina) + "%";
  }

  function frame(now) {
    const dt = Math.min(0.035, (now - state.lastTime) / 1000);
    state.lastTime = now;
    state.pulse += dt;
    move(dt);
    render();
    requestAnimationFrame(frame);
  }

  window.addEventListener("resize", resize);
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "shift"].includes(key)) {
      keys.add(key);
      event.preventDefault();
    }
  });
  window.addEventListener("keyup", (event) => {
    keys.delete(event.key.toLowerCase());
  });
  window.addEventListener("blur", () => keys.clear());

  resize();
  requestAnimationFrame(frame);
})();
