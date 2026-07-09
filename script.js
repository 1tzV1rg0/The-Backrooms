(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const coordsEl = document.getElementById("coords");
  const statusEl = document.getElementById("status");
  const restartBtn = document.getElementById("restart");
  const pauseBtn = document.getElementById("pause");

  const TILE = 24;
  const PLAYER_RADIUS = 7;
  const MONSTER_RADIUS = 8;
  const SPEED = 155;
  const SPRINT_SPEED = 245;
  const STAMINA_MAX = 100;
  const STAMINA_DRAIN = 34;
  const STAMINA_RECOVER = 24;
  const MONSTER_SPEED = 118;
  const MONSTER_SEARCH_TIME = 3.2;
  const MONSTER_LOSE_DISTANCE = TILE * 9;
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
    paused: false,
    showCoords: true,
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
      wanderSeed: 1,
      path: [],
      pathGoalX: null,
      pathGoalY: null,
      pathTimer: 0,
      stuckTime: 0,
      searchTime: 0,
      lastSeenX: MONSTER_TILE.x * TILE + TILE / 2,
      lastSeenY: MONSTER_TILE.y * TILE + TILE / 2
    }
  };

  let width = 0;
  let height = 0;
  let dpr = 1;

  function resetGame() {
    state.x = TILE / 2;
    state.y = TILE / 2;
    state.won = false;
    state.caught = false;
    state.paused = false;
    pauseBtn.textContent = "Pause (P)";
    state.stamina = STAMINA_MAX;
    state.sprinting = false;
    state.monster.x = MONSTER_TILE.x * TILE + TILE / 2;
    state.monster.y = MONSTER_TILE.y * TILE + TILE / 2;
    state.monster.awake = false;
    state.monster.wanderX = state.monster.x;
    state.monster.wanderY = state.monster.y;
    state.monster.wanderSeed += 1;
    state.monster.path = [];
    state.monster.pathGoalX = null;
    state.monster.pathGoalY = null;
    state.monster.pathTimer = 0;
    state.monster.stuckTime = 0;
    state.monster.searchTime = 0;
    state.monster.lastSeenX = state.monster.x;
    state.monster.lastSeenY = state.monster.y;
    keys.clear();
    statusEl.textContent = "Find the exit";
  }

  function togglePause() {
    if (state.won || state.caught) return;

    state.paused = !state.paused;
    pauseBtn.textContent = state.paused ? "Resume (P)" : "Pause (P)";
    statusEl.textContent = state.paused ? "Paused" : (state.monster.awake ? "It saw you" : "Find the exit");
    keys.clear();
  }

  function toggleCoordinates() {
    state.showCoords = !state.showCoords;
    coordsEl.hidden = !state.showCoords;
  }

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
    const distance = 24 + (hash(23, -51, 719) % 13);
    return {
      x: Math.round(Math.cos(angle) * distance),
      y: Math.round(Math.sin(angle) * distance)
    };
  }

  function parentOf(cx, cy) {
    if (cx === 0 && cy === 0) return null;

    const currentDistance = Math.hypot(cx, cy);
    const regionSalt = hash(Math.floor(cx / 5), Math.floor(cy / 5), 379);
    const neighbors = [
      { x: cx + 1, y: cy },
      { x: cx - 1, y: cy },
      { x: cx, y: cy + 1 },
      { x: cx, y: cy - 1 }
    ];
    const choices = neighbors
      .map((neighbor) => {
        const distance = Math.hypot(neighbor.x, neighbor.y);
        const noise = hash(cx * 5 + neighbor.x, cy * 5 + neighbor.y, 307) / 0xffffffff;
        const bend = hash(neighbor.x + regionSalt, neighbor.y - regionSalt, 401) % 100 < 30 ? -0.42 : 0;
        const sweep = hash(Math.floor((cx + neighbor.x) / 4), Math.floor((cy + neighbor.y) / 4), 419) % 100 < 24 ? -0.32 : 0;
        return {
          x: neighbor.x,
          y: neighbor.y,
          distance,
          score: distance + noise * 2.85 + bend + sweep
        };
      })
      .filter((neighbor) => neighbor.distance < currentDistance)
      .sort((a, b) => a.score - b.score);

    return choices[0] || { x: cx - Math.sign(cx || 1), y: cy };
  }

  function sideOpening(ax, ay, bx, by) {
    const farFromSpawn = Math.max(Math.hypot(ax, ay), Math.hypot(bx, by)) > 3;
    const region = hash(Math.floor((ax + bx) / 8), Math.floor((ay + by) / 8), 509) % 100;
    const baseChance = region < 20 ? 39 : region < 58 ? 25 : 12;
    const roll = hash(ax * 11 + bx * 7, ay * 11 + by * 7, 521) % 100;
    const longHall = hash(Math.min(ax, bx), Math.min(ay, by), 613) % 29 === 0;
    const crossCut = hash(ax - bx * 3, ay - by * 3, 631) % 100 < 7;
    return farFromSpawn && (roll < baseChance || longHall || crossCut);
  }

  function axisBreak(leftCellX) {
    if (Math.abs(leftCellX) < 3) return false;
    const spaced = hash(leftCellX, 0, 1543) % 100 < 56;
    const neighborA = hash(leftCellX - 1, 0, 1543) % 100 < 56;
    const neighborB = hash(leftCellX + 1, 0, 1543) % 100 < 56;
    return spaced && (!neighborA || !neighborB);
  }

  function axisDetourSide(leftCellX) {
    return hash(leftCellX, 0, 1559) % 2 === 0 ? 1 : -1;
  }

  function axisCellBlock(cellX) {
    if (Math.abs(cellX) < 4) return false;
    const current = hash(cellX, 0, 1601) % 100 < 36;
    const previous = hash(cellX - 1, 0, 1601) % 100 < 36;
    return current && !previous;
  }

  function axisCellDetourSide(cellX) {
    return hash(cellX, 0, 1613) % 2 === 0 ? 1 : -1;
  }

  function horizontalZeroAxisEdge(ax, ay, bx, by) {
    return ay === 0 && by === 0 && Math.abs(ax - bx) === 1;
  }

  function blockedZeroAxisEdge(ax, ay, bx, by) {
    if (!horizontalZeroAxisEdge(ax, ay, bx, by)) return false;
    return axisBreak(Math.min(ax, bx));
  }

  function zeroAxisBypassEdge(ax, ay, bx, by) {
    if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return false;

    if (ay === by && Math.abs(ay) === 1) {
      const left = Math.min(ax, bx);
      return (axisBreak(left) && axisDetourSide(left) === ay) ||
        (axisCellBlock(left) && axisCellDetourSide(left) === ay) ||
        (axisCellBlock(left + 1) && axisCellDetourSide(left + 1) === ay);
    }

    if (ax === bx && ((ay === 0 && Math.abs(by) === 1) || (by === 0 && Math.abs(ay) === 1))) {
      const side = ay === 0 ? by : ay;
      return (axisBreak(ax) && axisDetourSide(ax) === side) ||
        (axisBreak(ax - 1) && axisDetourSide(ax - 1) === side) ||
        (axisCellBlock(ax - 1) && axisCellDetourSide(ax - 1) === side) ||
        (axisCellBlock(ax + 1) && axisCellDetourSide(ax + 1) === side);
    }

    return false;
  }

  function protectedAxisWall(tx, ty) {
    if (ty !== 0) return false;
    if (tx % 2 === 0) return axisCellBlock(tx / 2);
    return axisBreak(Math.floor(tx / 2));
  }

  function connected(ax, ay, bx, by) {
    if (blockedZeroAxisEdge(ax, ay, bx, by)) return false;
    if (zeroAxisBypassEdge(ax, ay, bx, by)) return true;

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

  function baseFloorNeighborCount(tx, ty) {
    const neighbors = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];
    return neighbors.reduce((count, offset) => {
      return count + (baseTileKind(tx + offset[0], ty + offset[1]) === "floor" ? 1 : 0);
    }, 0);
  }

  function thickWallBulge(tx, ty) {
    if (Math.hypot(tx, ty) < 8) return false;
    if (protectedAxisWall(tx, ty)) return true;
    if (baseTileKind(tx, ty) !== "floor") return false;

    const coreCell = tx % 2 === 0 && ty % 2 === 0;
    if (coreCell) return false;

    const wallRegion = hash(Math.floor(tx / 6), Math.floor(ty / 6), 1709) % 100;
    const enoughRoom = baseFloorNeighborCount(tx, ty) >= 3;
    const nearWall = baseTileKind(tx + 1, ty) === "wall" ||
      baseTileKind(tx - 1, ty) === "wall" ||
      baseTileKind(tx, ty + 1) === "wall" ||
      baseTileKind(tx, ty - 1) === "wall";
    if (!enoughRoom || !nearWall) return false;

    const local = hash(tx, ty, 1721) % 100;
    const clump = hash(Math.floor(tx / 2), Math.floor(ty / 2), 1733) % 100;
    const chance = wallRegion < 22 ? 34 : wallRegion < 68 ? 18 : 7;
    return local < chance || clump < 9;
  }

  function tileKind(tx, ty) {
    if (protectedAxisWall(tx, ty) || thickWallBulge(tx, ty)) return "wall";
    if (baseTileKind(tx, ty) === "floor") return "floor";

    const nearHorizontal = baseTileKind(tx, ty - 1) === "floor" || baseTileKind(tx, ty + 1) === "floor";
    const nearVertical = baseTileKind(tx - 1, ty) === "floor" || baseTileKind(tx + 1, ty) === "floor";
    const alcove = baseTileKind(tx - 1, ty - 1) === "floor" ||
      baseTileKind(tx + 1, ty - 1) === "floor" ||
      baseTileKind(tx - 1, ty + 1) === "floor" ||
      baseTileKind(tx + 1, ty + 1) === "floor";
    const widthRegion = hash(Math.floor(tx / 7), Math.floor(ty / 7), 967) % 100;
    const horizontalWidth = widthRegion < 20 ? 55 : widthRegion < 62 ? 36 : 18;
    const verticalWidth = widthRegion > 72 ? 52 : widthRegion > 35 ? 32 : 20;
    const alcoveWidth = widthRegion > 45 && widthRegion < 78 ? 20 : 7;

    if (nearHorizontal && widenChance(tx, ty, 941) < horizontalWidth) return "floor";
    if (nearVertical && widenChance(tx, ty, 947) < verticalWidth) return "floor";
    if (alcove && widenChance(tx, ty, 953) < alcoveWidth) return "floor";
    if ((nearHorizontal || nearVertical) && hash(tx, ty, 977) % 100 < 5) return "floor";

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

    for (let oy = -9; oy <= 9; oy += 1) {
      for (let ox = -9; ox <= 9; ox += 1) {
        const distance = Math.abs(ox) + Math.abs(oy);
        if (distance < 4 || distance > 13) continue;
        const cx = tx + ox;
        const cy = ty + oy;
        if (isMonsterFloor(cx, cy)) {
          candidates.push({
            x: cx,
            y: cy,
            score: hash(cx, cy, state.monster.wanderSeed) - distance * 58
          });
        }
      }
    }

    state.monster.wanderSeed += 1;
    candidates.sort((a, b) => a.score - b.score);
    const target = candidates[0] || { x: tx, y: ty };
    state.monster.wanderX = target.x * TILE + TILE / 2;
    state.monster.wanderY = target.y * TILE + TILE / 2;
  }

  function monsterTile() {
    return {
      x: Math.floor(state.monster.x / TILE),
      y: Math.floor(state.monster.y / TILE)
    };
  }

  function playerTile() {
    return {
      x: Math.floor(state.x / TILE),
      y: Math.floor(state.y / TILE)
    };
  }

  function tileCenter(tx, ty) {
    return {
      x: tx * TILE + TILE / 2,
      y: ty * TILE + TILE / 2
    };
  }

  function isMonsterFloor(tx, ty) {
    const center = tileCenter(tx, ty);
    return tileKind(tx, ty) === "floor" && !collides(center.x, center.y, MONSTER_RADIUS);
  }

  function closestWalkableTile(tx, ty, maxRadius = 5) {
    if (isMonsterFloor(tx, ty)) return { x: tx, y: ty };

    let best = null;
    for (let radius = 1; radius <= maxRadius; radius += 1) {
      for (let oy = -radius; oy <= radius; oy += 1) {
        for (let ox = -radius; ox <= radius; ox += 1) {
          if (Math.abs(ox) !== radius && Math.abs(oy) !== radius) continue;
          const cx = tx + ox;
          const cy = ty + oy;
          if (!isMonsterFloor(cx, cy)) continue;
          const score = Math.abs(ox) + Math.abs(oy) + (hash(cx, cy, 1319) % 10) * 0.01;
          if (!best || score < best.score) best = { x: cx, y: cy, score };
        }
      }
      if (best) return best;
    }

    return null;
  }

  function findMonsterPath(goalX, goalY, limit = 2200) {
    const startTile = closestWalkableTile(Math.floor(state.monster.x / TILE), Math.floor(state.monster.y / TILE), 2);
    const goal = closestWalkableTile(Math.floor(goalX / TILE), Math.floor(goalY / TILE), 6);
    if (!startTile || !goal) return [];
    if (startTile.x === goal.x && startTile.y === goal.y) return [];

    const key = (x, y) => x + "," + y;
    const heuristic = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
    const open = [{ x: startTile.x, y: startTile.y, g: 0, f: heuristic(startTile.x, startTile.y) }];
    const cameFrom = new Map();
    const best = new Map([[key(startTile.x, startTile.y), 0]]);
    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 }
    ];
    let searched = 0;

    while (open.length > 0 && searched < limit) {
      let bestIndex = 0;
      for (let i = 1; i < open.length; i += 1) {
        if (open[i].f < open[bestIndex].f) bestIndex = i;
      }
      const current = open.splice(bestIndex, 1)[0];
      searched += 1;

      if (current.x === goal.x && current.y === goal.y) {
        const path = [];
        let cursor = key(current.x, current.y);
        while (cameFrom.has(cursor)) {
          const [x, y] = cursor.split(",").map(Number);
          path.push(tileCenter(x, y));
          cursor = cameFrom.get(cursor);
        }
        path.reverse();
        return path.slice(0, 28);
      }

      for (const direction of directions) {
        const nx = current.x + direction.x;
        const ny = current.y + direction.y;
        if (!isMonsterFloor(nx, ny)) continue;

        const nextKey = key(nx, ny);
        const nextG = current.g + 1;
        if (best.has(nextKey) && best.get(nextKey) <= nextG) continue;

        best.set(nextKey, nextG);
        cameFrom.set(nextKey, key(current.x, current.y));
        open.push({
          x: nx,
          y: ny,
          g: nextG,
          f: nextG + heuristic(nx, ny) + (hash(nx, ny, 1201) % 7) * 0.015
        });
      }
    }

    return [];
  }

  function setMonsterPath(goalX, goalY, force = false) {
    const goalTile = closestWalkableTile(Math.floor(goalX / TILE), Math.floor(goalY / TILE), 6);
    if (!goalTile) {
      state.monster.path = [];
      return;
    }
    if (!force && state.monster.pathGoalX === goalTile.x && state.monster.pathGoalY === goalTile.y && state.monster.path.length > 0) return;

    state.monster.path = findMonsterPath(goalTile.x * TILE + TILE / 2, goalTile.y * TILE + TILE / 2);
    state.monster.pathGoalX = goalTile.x;
    state.monster.pathGoalY = goalTile.y;
  }

  function moveMonsterAxis(targetX, targetY, speed, dt) {
    const dx = targetX - state.monster.x;
    const dy = targetY - state.monster.y;
    if (Math.hypot(dx, dy) < TILE * 0.16) return true;

    const horizontalFirst = Math.abs(dx) > Math.abs(dy);
    const axes = horizontalFirst ? ["x", "y"] : ["y", "x"];
    let moved = false;

    for (const axis of axes) {
      const delta = axis === "x" ? dx : dy;
      if (Math.abs(delta) < 0.8) continue;
      const step = Math.sign(delta) * Math.min(Math.abs(delta), speed * dt);
      const nextX = axis === "x" ? state.monster.x + step : state.monster.x;
      const nextY = axis === "y" ? state.monster.y + step : state.monster.y;
      if (!collides(nextX, nextY, MONSTER_RADIUS)) {
        state.monster.x = nextX;
        state.monster.y = nextY;
        moved = true;
      }
    }

    state.monster.stuckTime = moved ? 0 : state.monster.stuckTime + dt;
    return Math.hypot(targetX - state.monster.x, targetY - state.monster.y) < TILE * 0.18 || state.monster.stuckTime > 0.45;
  }

  function snapMonsterToCurrentTile() {
    const current = closestWalkableTile(Math.floor(state.monster.x / TILE), Math.floor(state.monster.y / TILE), 2);
    if (!current) return;
    const center = tileCenter(current.x, current.y);
    state.monster.x = center.x;
    state.monster.y = center.y;
    state.monster.stuckTime = 0;
  }

  function followMonsterPath(goalX, goalY, speed, dt) {
    state.monster.pathTimer -= dt;
    if (state.monster.pathTimer <= 0 || state.monster.path.length === 0) {
      setMonsterPath(goalX, goalY, true);
      state.monster.pathTimer = 0.28;
    }

    const next = state.monster.path[0];
    if (!next) return false;

    const reached = moveMonsterAxis(next.x, next.y, speed, dt);
    if (reached) {
      if (state.monster.stuckTime > 0.45) snapMonsterToCurrentTile();
      state.monster.path.shift();
      state.monster.pathTimer = 0;
    }
    return reached;
  }

  function wanderMonster(dt) {
    const distance = Math.hypot(state.monster.wanderX - state.monster.x, state.monster.wanderY - state.monster.y);
    if (distance < TILE * 0.24 || collides(state.monster.wanderX, state.monster.wanderY, MONSTER_RADIUS)) {
      setWanderTarget();
    }

    followMonsterPath(state.monster.wanderX, state.monster.wanderY, MONSTER_SPEED * 0.68, dt);
    if (Math.hypot(state.monster.wanderX - state.monster.x, state.monster.wanderY - state.monster.y) < TILE * 0.28) {
      setWanderTarget();
      state.monster.path = [];
    }
  }

  function moveMonster(dt) {
    if (state.caught || state.won || state.paused) return;

    const canSeePlayer = sameCorridor();

    if (!state.monster.awake && canSeePlayer) {
      state.monster.awake = true;
      state.monster.path = [];
      state.monster.pathTimer = 0;
      state.monster.searchTime = 0;
      state.monster.lastSeenX = state.x;
      state.monster.lastSeenY = state.y;
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

    if (canSeePlayer) {
      state.monster.searchTime = 0;
      state.monster.lastSeenX = state.x;
      state.monster.lastSeenY = state.y;
      statusEl.textContent = "It saw you";
      followMonsterPath(state.x, state.y, MONSTER_SPEED, dt);
      return;
    }

    state.monster.searchTime += dt;
    statusEl.textContent = "It is searching";
    followMonsterPath(state.monster.lastSeenX, state.monster.lastSeenY, MONSTER_SPEED * 0.92, dt);

    const distanceFromPlayer = Math.hypot(state.x - state.monster.x, state.y - state.monster.y);
    const distanceFromLastSeen = Math.hypot(state.monster.lastSeenX - state.monster.x, state.monster.lastSeenY - state.monster.y);
    if ((state.monster.searchTime > MONSTER_SEARCH_TIME && distanceFromPlayer > MONSTER_LOSE_DISTANCE) ||
        distanceFromLastSeen < TILE * 0.55) {
      state.monster.awake = false;
      state.monster.searchTime = 0;
      state.monster.path = [];
      state.monster.pathTimer = 0;
      state.monster.wanderX = state.monster.x;
      state.monster.wanderY = state.monster.y;
      setWanderTarget();
      statusEl.textContent = "You lost it";
    }
  }

  function move(dt) {
    let dx = 0;
    let dy = 0;
    if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
    if (keys.has("arrowright") || keys.has("d")) dx += 1;
    if (keys.has("arrowup") || keys.has("w")) dy -= 1;
    if (keys.has("arrowdown") || keys.has("s")) dy += 1;

    if (state.caught || state.paused) return;

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
    if (state.showCoords) {
      coordsEl.textContent = "Player " + playerX + ", " + playerY +
        " | Monster " + monsterX + ", " + monsterY +
        " | Stamina " + Math.round(state.stamina) + "%";
    }
  }

  function frame(now) {
    const dt = Math.min(0.035, (now - state.lastTime) / 1000);
    state.lastTime = now;
    state.pulse += dt;
    move(dt);
    render();
    requestAnimationFrame(frame);
  }

  pauseBtn.addEventListener("click", togglePause);
  restartBtn.addEventListener("click", resetGame);
  window.addEventListener("resize", resize);
  function keyName(event) {
    const key = (event.key || "").toLowerCase();
    if (key && key !== "unidentified") return key;

    const code = (event.code || "").toLowerCase();
    if (code === "keyp") return "p";
    if (code === "keyr") return "r";
    if (code === "keyc") return "c";
    if (code === "keyw") return "w";
    if (code === "keya") return "a";
    if (code === "keys") return "s";
    if (code === "keyd") return "d";
    if (code === "shiftleft" || code === "shiftright") return "shift";
    return key;
  }

  function handleKeyDown(event) {
    const key = keyName(event);
    const shortcuts = ["p", "r", "c"];

    if (event.repeat && shortcuts.includes(key)) {
      event.preventDefault();
      return;
    }
    if (key === "p") {
      togglePause();
      event.preventDefault();
      return;
    }
    if (key === "r") {
      resetGame();
      event.preventDefault();
      return;
    }
    if (key === "c") {
      toggleCoordinates();
      event.preventDefault();
      return;
    }

    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "shift"].includes(key)) {
      keys.add(key);
      event.preventDefault();
    }
  }

  document.addEventListener("keydown", handleKeyDown, true);
  window.addEventListener("keyup", (event) => {
    keys.delete(keyName(event));
  });
  window.addEventListener("blur", () => keys.clear());

  canvas.focus();
  resize();
  requestAnimationFrame(frame);
})();
