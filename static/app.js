// --- 3D Multiplayer Parkour Space with Jump, Directional Dash & Dual Difficulty Courses ---

// Three.js 전역 상태
let scene, camera, renderer;
let myId = null;
let myColor = null;
let myMesh = null;
const players = {}; // id -> { mesh, targetPos, targetRot, isMoving, walkTimer }

// 점프 & 대시 & 물리 상태
let playerVelocityY = 0;
let isGrounded = true;
const GRAVITY = -26.0;
const JUMP_FORCE = 11.2;
const NORMAL_SPEED = 6.2;
const DASH_SPEED = 21.0;
const DASH_DURATION = 0.22; // 대시 지속 시간(초)
const DASH_COOLDOWN = 1.0; // 대시 쿨다운(초)

let isDashing = false;
let dashTimer = 0;
let dashCooldownTimer = 0;
let dashDirection = new THREE.Vector3();

// 점프맵 발판 목록
const parkourPlatforms = [];
let trophyNormalMesh = null;
let trophyHardMesh = null;
let clearedCourses = { normal: false, hard: false };

// 활성화된 이모티콘 애니메이션 목록
const activeEmoteSprites = [];

// 키 입력 상태
const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  space: false,
  shift: false
};

// 카메라 컨트롤 변수
let isMouseDown = false;
let previousMousePosition = { x: 0, y: 0 };
let cameraAngleY = 0;
let cameraPitch = 0.42;
let cameraDistance = 8.5;

// 웹소켓
let socket = null;
let lastSentTime = 0;
const SEND_INTERVAL = 33; // ~30fps

let localWalkTimer = 0;

// ==========================================
// 1. 초기화 함수
// ==========================================
function init() {
  const container = document.getElementById('canvas-container');

  // 1-1. 씬 생성
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x090d16);
  scene.fog = new THREE.FogExp2(0x090d16, 0.010);

  // 1-2. 카메라 생성
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 7, 14);

  // 1-3. 렌더러 생성
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 1-4. 조명 설정
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.72);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(30, 60, 30);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 250;
  const d = 50;
  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d;
  dirLight.shadow.camera.bottom = -d;
  scene.add(dirLight);

  // 노멀 코스 정상 빛 (시안/골드)
  const normalGoalLight = new THREE.PointLight(0x38bdf8, 2.5, 35);
  normalGoalLight.position.set(-16, 16, -45);
  scene.add(normalGoalLight);

  // 하드 코스 정상 빛 (마그마 레드/퍼플)
  const hardGoalLight = new THREE.PointLight(0xef4444, 3.5, 45);
  hardGoalLight.position.set(16, 23, -56);
  scene.add(hardGoalLight);

  // 1-5. 기본 바닥 평면 생성
  const groundGeo = new THREE.PlaneGeometry(500, 500);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0b0f19,
    roughness: 0.85,
    metalness: 0.1
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // 1-6. 네온 블루 바닥 격자
  const gridHelper = new THREE.GridHelper(300, 150, 0x38bdf8, 0x1e293b);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // 1-7. 점프맵 코스들 (Normal & Hard) 생성
  buildAllParkourCourses();

  // 1-8. 이벤트 리스너 등록
  setupEventListeners();

  // 1-9. 웹소켓 연결
  connectWebSocket();

  // 1-10. 렌더 루프 시작
  animate();
}

// ==========================================
// 2. 점프맵 2개 코스 (Normal & Hard) 생성
// ==========================================
function buildAllParkourCourses() {
  // ----------------------------------------------------
  // 코스 1: 🟢 NORMAL COURSE (초·중급 네온 블루 코스)
  // ----------------------------------------------------
  const normalPlatforms = [
    // [x, y, z, width, height, depth, colorHex, isGoal, courseType]
    [-15, 0.4, 0, 5.0, 0.8, 5.0, 0x3b82f6],
    [-15, 1.4, -4.5, 3.6, 0.8, 3.6, 0x06b6d4],
    [-15, 2.5, -9.0, 3.2, 0.8, 3.2, 0x10b981],
    [-18.5, 3.7, -13.0, 2.8, 0.8, 2.8, 0x84cc16],
    [-12.0, 5.0, -17.0, 2.6, 0.8, 2.6, 0xf59e0b],
    [-15.0, 6.4, -21.0, 2.6, 0.8, 2.6, 0xf43f5e],

    // ⚡ 대시 점프 구간 (발판 거리 7m)
    [-15.0, 8.0, -25.5, 3.4, 0.8, 3.2, 0xa855f7],
    [-15.0, 9.3, -32.5, 3.2, 0.8, 3.2, 0xec4899], // 대시 착지

    [-18.5, 11.0, -36.5, 2.6, 0.8, 2.6, 0x38bdf8],
    [-13.0, 12.6, -40.5, 2.6, 0.8, 2.6, 0x10b981],

    // 🏆 노멀 정상 스카이 아일랜드
    [-15.0, 14.5, -45.5, 6.5, 1.0, 6.5, 0xfbbf24, true, "normal"]
  ];

  // ----------------------------------------------------
  // 코스 2: 🔥 HARD COURSE (고난도/마그마 레드 지옥 코스)
  // ----------------------------------------------------
  const hardPlatforms = [
    [15, 0.4, 0, 4.5, 0.8, 4.5, 0xd97706],
    [15, 1.6, -4.5, 1.9, 0.8, 1.9, 0xef4444],
    [15, 3.2, -8.8, 1.7, 0.8, 1.7, 0xb91c1c],
    [19.2, 4.9, -13.0, 1.5, 0.8, 1.5, 0x991b1b],
    [11.5, 6.7, -17.0, 1.5, 0.8, 1.5, 0xd97706],
    [15.0, 8.6, -21.0, 1.4, 0.8, 1.4, 0xf97316],

    // 🔥 1차 롱 대시 점프 (거리 8m)
    [15.0, 10.3, -25.0, 2.4, 0.8, 2.4, 0x831843],
    [15.0, 11.6, -33.0, 2.0, 0.8, 2.0, 0xbe185d], // 대시 착지

    // 좁은 나선형 슬림 계단
    [11.0, 13.4, -37.0, 1.4, 0.8, 1.4, 0x701a75],
    [15.0, 15.2, -41.0, 1.3, 0.8, 1.3, 0x86198f],
    [19.0, 17.0, -45.0, 1.3, 0.8, 1.3, 0xa21caf],

    // 🔥 2차 익스트림 슈퍼 대시 점프 (높이 18.8m -> 21.0m, 거리 9m!)
    [15.0, 18.8, -49.0, 2.2, 0.8, 2.2, 0xd946ef],

    // 👑 하드 정상 지옥의 옥상 (높이 21m 상공)
    [15.0, 21.0, -58.0, 7.5, 1.0, 7.5, 0xff0055, true, "hard"]
  ];

  // 노멀 코스 플랫폼 렌더
  normalPlatforms.forEach(data => addPlatformToScene(data));

  // 하드 코스 플랫폼 렌더
  hardPlatforms.forEach(data => addPlatformToScene(data));

  // 3D 안내 배너 설치
  createBannerSprite("🟢 NORMAL COURSE", -15, 2.8, 0, "#38bdf8");
  createBannerSprite("⚡ DASH JUMP!", -15, 10.5, -25.5, "#f59e0b");
  createBannerSprite("🏆 NORMAL GOAL", -15, 17.8, -45.5, "#fbbf24");

  createBannerSprite("🔥 HARD COURSE (지옥)", 15, 2.8, 0, "#ef4444");
  createBannerSprite("⚠️ EXTREME DASH!", 15, 12.8, -25.0, "#f43f5e");
  createBannerSprite("👑 HARD MASTER GOAL", 15, 24.5, -58.0, "#ff0077");

  // 중앙 스폰 안내 표지판
  createBannerSprite("⬅️ NORMAL   |   HARD ➡️", 0, 2.5, 4, "#ffffff");
}

function addPlatformToScene([px, py, pz, w, h, d, colorHex, isGoal, courseType]) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    roughness: 0.25,
    metalness: 0.35,
    emissive: isGoal ? (courseType === "hard" ? 0x9f1239 : 0x78350f) : 0x0f172a,
    emissiveIntensity: 0.45
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(px, py, pz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // 네온 테두리
  const edges = new THREE.EdgesGeometry(geo);
  const lineMat = new THREE.LineBasicMaterial({
    color: isGoal ? 0xffffff : (courseType === "hard" ? 0xff4d4d : 0x38bdf8),
    transparent: true,
    opacity: 0.55
  });
  const wireframe = new THREE.LineSegments(edges, lineMat);
  mesh.add(wireframe);

  const pObj = {
    x: px,
    y: py,
    z: pz,
    width: w,
    height: h,
    depth: d,
    topY: py + h / 2,
    isGoal: !!isGoal,
    courseType: courseType || "normal",
    mesh: mesh
  };

  parkourPlatforms.push(pObj);

  if (isGoal) {
    if (courseType === "normal") {
      trophyNormalMesh = createTrophy(px, py + h / 2 + 1.2, pz, 0xffd700);
    } else if (courseType === "hard") {
      trophyHardMesh = createCrown(px, py + h / 2 + 1.2, pz);
    }
  }
}

// 3D 텍스트 배너 스프라이트
function createBannerSprite(text, x, y, z, color = "#ffffff") {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
  roundRect(ctx, 10, 10, 492, 108, 24, true);

  ctx.font = 'bold 34px sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.position.set(x, y, z);
  sprite.scale.set(4.2, 1.05, 1);
  scene.add(sprite);
}

// 황금 트로피 3D 모델
function createTrophy(x, y, z, colorHex) {
  const trophyGroup = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.85,
    roughness: 0.15,
    emissive: 0xd97706,
    emissiveIntensity: 0.35
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 0.3, 16), goldMat);
  trophyGroup.add(base);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 16), goldMat);
  stem.position.y = 0.45;
  trophyGroup.add(stem);

  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.25, 0.9, 16), goldMat);
  cup.position.y = 1.1;
  trophyGroup.add(cup);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 8, 32), new THREE.MeshBasicMaterial({ color: 0xfef08a }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 1.2;
  trophyGroup.add(ring);

  trophyGroup.position.set(x, y, z);
  scene.add(trophyGroup);
  return trophyGroup;
}

// 루비/골드 왕관 3D 모델 (하드 코스 정상)
function createCrown(x, y, z) {
  const crownGroup = new THREE.Group();
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0xff0055,
    metalness: 0.9,
    roughness: 0.1,
    emissive: 0xbe123c,
    emissiveIntensity: 0.5
  });

  // 링 베이스
  const baseRing = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.6, 0.3, 16, 1, true), crownMat);
  crownGroup.add(baseRing);

  // 뾰족한 왕관 스파이크 5개
  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 8), crownMat);
    spike.position.set(Math.cos(angle) * 0.65, 0.5, Math.sin(angle) * 0.65);
    crownGroup.add(spike);

    // 보석 구체
    const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfef08a }));
    jewel.position.set(Math.cos(angle) * 0.65, 0.9, Math.sin(angle) * 0.65);
    crownGroup.add(jewel);
  }

  crownGroup.position.set(x, y, z);
  scene.add(crownGroup);
  return crownGroup;
}

// ==========================================
// 3. 아바타 생성 함수
// ==========================================
function createAvatarMesh(colorHex, isSelf, nameText) {
  const avatarGroup = new THREE.Group();

  const bodyGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.9, 16);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(colorHex),
    roughness: 0.3,
    metalness: 0.2
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.65;
  body.castShadow = true;
  avatarGroup.add(body);

  const headGeo = new THREE.SphereGeometry(0.35, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.y = 1.1;
  head.castShadow = true;
  avatarGroup.add(head);

  const bottomGeo = new THREE.SphereGeometry(0.35, 16, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const bottom = new THREE.Mesh(bottomGeo, bodyMat);
  bottom.position.y = 0.2;
  bottom.castShadow = true;
  avatarGroup.add(bottom);

  // 앞면 바이저
  const visorGeo = new THREE.BoxGeometry(0.36, 0.16, 0.16);
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x090d16,
    roughness: 0.1,
    metalness: 0.9
  });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.95, 0.28);
  avatarGroup.add(visor);

  // 바닥 그림자
  const shadowGeo = new THREE.CircleGeometry(0.42, 16);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.4,
    depthWrite: false
  });
  const shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  avatarGroup.add(shadow);

  // 닉네임 라벨
  const labelSprite = createTextLabel(nameText, isSelf ? "#38bdf8" : "#ffffff");
  labelSprite.name = "nameLabel";
  labelSprite.position.set(0, 1.8, 0);
  avatarGroup.add(labelSprite);

  return avatarGroup;
}

function createTextLabel(text, textColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 280;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  roundRect(ctx, 10, 10, 260, 44, 12, true);

  ctx.font = 'bold 20px sans-serif';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 140, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(2.0, 0.46, 1);
  return sprite;
}

function roundRect(ctx, x, y, width, height, radius, fill) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  if (fill) ctx.fill();
}

// ==========================================
// 4. 이모티콘 (Emote) 3D 팝업 시스템
// ==========================================
function spawnEmoteSprite(avatarGroup, emoteText) {
  if (!avatarGroup) return;

  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');

  ctx.font = '72px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoteText, 64, 64);

  const texture = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false
  });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(1.1, 1.1, 1);

  sprite.position.copy(avatarGroup.position);
  sprite.position.y += 2.0;

  scene.add(sprite);

  activeEmoteSprites.push({
    sprite: sprite,
    avatar: avatarGroup,
    lifetime: 0,
    maxLife: 1.6
  });
}

function updateEmoteSprites(delta) {
  for (let i = activeEmoteSprites.length - 1; i >= 0; i--) {
    const item = activeEmoteSprites[i];
    item.lifetime += delta;
    const progress = item.lifetime / item.maxLife;

    item.sprite.position.y += delta * 1.2;

    if (progress < 0.25) {
      const scale = THREE.MathUtils.lerp(0.4, 1.3, progress / 0.25);
      item.sprite.scale.set(scale, scale, 1);
    } else {
      const scale = THREE.MathUtils.lerp(1.3, 1.0, (progress - 0.25) / 0.75);
      item.sprite.scale.set(scale, scale, 1);
    }

    if (progress > 0.6) {
      item.sprite.material.opacity = 1 - (progress - 0.6) / 0.4;
    }

    if (item.lifetime >= item.maxLife) {
      scene.remove(item.sprite);
      item.sprite.geometry.dispose();
      item.sprite.material.dispose();
      activeEmoteSprites.splice(i, 1);
    }
  }
}

function triggerEmote(emote) {
  if (!myMesh || !myId) return;

  spawnEmoteSprite(myMesh, emote);

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({
      type: 'emote',
      emote: emote
    }));
  }
}

// ==========================================
// 5. WebSocket 네트워크 동기화
// ==========================================
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("WebSocket connected to:", wsUrl);
  };

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (err) {
      console.error("Message parse error:", err);
    }
  };

  socket.onclose = () => {
    console.warn("WebSocket disconnected. Retrying in 2 seconds...");
    setTimeout(connectWebSocket, 2000);
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
  };
}

function handleServerMessage(data) {
  const type = data.type;

  if (type === 'init') {
    myId = data.selfId;
    const initialPlayers = data.players || [];
    initialPlayers.forEach(p => {
      addPlayer(p, p.id === myId);
    });
    updatePlayerCount();
  } 
  else if (type === 'player_joined') {
    const p = data.player;
    if (p.id !== myId && !players[p.id]) {
      addPlayer(p, false);
      updatePlayerCount();
    }
  } 
  else if (type === 'player_moved') {
    if (players[data.id] && data.id !== myId) {
      const p = players[data.id];
      p.targetPos.set(data.x, data.y, data.z);
      p.targetRot = data.rotation;
      p.isMoving = true;
    }
  } 
  else if (type === 'player_left') {
    removePlayer(data.id);
    updatePlayerCount();
  }
  else if (type === 'player_emote') {
    if (players[data.id] && data.id !== myId) {
      spawnEmoteSprite(players[data.id].mesh, data.emote);
    }
  }
}

function addPlayer(pData, isSelf) {
  if (players[pData.id]) return;

  const displayName = isSelf ? "나 (You)" : `Player ${pData.id.slice(-4)}`;
  const mesh = createAvatarMesh(pData.color, isSelf, displayName);
  mesh.position.set(pData.x, pData.y, pData.z);
  mesh.rotation.y = pData.rotation || 0;
  scene.add(mesh);

  players[pData.id] = {
    mesh: mesh,
    targetPos: new THREE.Vector3(pData.x, pData.y, pData.z),
    targetRot: pData.rotation || 0,
    isMoving: false,
    walkTimer: 0
  };

  if (isSelf) {
    myMesh = mesh;
    myColor = pData.color;
  }
}

function removePlayer(id) {
  if (players[id]) {
    scene.remove(players[id].mesh);
    delete players[id];
  }
}

function updatePlayerCount() {
  const count = Object.keys(players).length;
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.innerText = `온라인: ${count}명`;
}

function sendMyMovement() {
  if (!socket || socket.readyState !== WebSocket.OPEN || !myMesh || !myId) return;

  const now = performance.now();
  if (now - lastSentTime < SEND_INTERVAL) return;
  lastSentTime = now;

  socket.send(JSON.stringify({
    type: 'move',
    x: parseFloat(myMesh.position.x.toFixed(3)),
    y: parseFloat(myMesh.position.y.toFixed(3)),
    z: parseFloat(myMesh.position.z.toFixed(3)),
    rotation: parseFloat(myMesh.rotation.y.toFixed(3))
  }));
}

// ==========================================
// 6. 점프, 방향키 대시 & 3D 물리/충돌 판정
// ==========================================
function performJump() {
  if (isGrounded) {
    playerVelocityY = JUMP_FORCE;
    isGrounded = false;
  }
}

// ⭐ 사용자가 누르고 있는 키 방향으로 완벽하게 대시!
function performDash() {
  if (dashCooldownTimer <= 0 && !isDashing) {
    // 1. 현재 누르고 있는 키(W, A, S, D) 방향 계산
    let moveX = 0;
    let moveZ = 0;
    if (keys.w) moveZ -= 1;
    if (keys.s) moveZ += 1;
    if (keys.a) moveX -= 1;
    if (keys.d) moveX += 1;

    // 카메라의 수평 방향 기준
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngleY);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngleY);

    if (moveX !== 0 || moveZ !== 0) {
      // 키를 누르고 있는 경우: 해당 키의 합성 벡터 방향으로 대시!
      const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
      moveX /= len;
      moveZ /= len;

      dashDirection.set(0, 0, 0)
        .addScaledVector(forward, -moveZ)
        .addScaledVector(right, moveX)
        .normalize();
    } else {
      // 아무 키도 안 누르고 있다면: 캐릭터가 바라보고 있는 전방으로 대시
      const charHeading = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), myMesh ? myMesh.rotation.y : cameraAngleY);
      dashDirection.copy(charHeading).normalize();
    }

    // 아바타의 시선(회전)도 즉시 대시 방향으로 일치시킴
    if (myMesh) {
      myMesh.rotation.y = Math.atan2(dashDirection.x, dashDirection.z);
    }

    isDashing = true;
    dashTimer = DASH_DURATION;
    dashCooldownTimer = DASH_COOLDOWN;

    showToast("⚡ DASH!");
  }
}

function updateLocalPlayerPhysics(delta) {
  if (!myMesh) return;

  // 1. 대시 쿨다운 타이머
  if (dashCooldownTimer > 0) {
    dashCooldownTimer -= delta;
  }

  let currentSpeed = NORMAL_SPEED;

  if (isDashing) {
    dashTimer -= delta;
    currentSpeed = DASH_SPEED;
    if (dashTimer <= 0) {
      isDashing = false;
    }
  }

  // 2. 이동 입력 계산
  let moveX = 0;
  let moveZ = 0;

  if (keys.w) moveZ -= 1;
  if (keys.s) moveZ += 1;
  if (keys.a) moveX -= 1;
  if (keys.d) moveX += 1;

  const isMoving = (moveX !== 0 || moveZ !== 0);

  if (isMoving && !isDashing) {
    const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
    moveX /= length;
    moveZ /= length;

    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngleY);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngleY);

    const moveDir = new THREE.Vector3()
      .addScaledVector(forward, -moveZ)
      .addScaledVector(right, moveX)
      .normalize();

    myMesh.position.x += moveDir.x * currentSpeed * delta;
    myMesh.position.z += moveDir.z * currentSpeed * delta;

    // 이동 방향 부드러운 회전
    const targetAngle = Math.atan2(moveDir.x, moveDir.z);
    myMesh.rotation.y = lerpAngle(myMesh.rotation.y, targetAngle, 0.25);

    if (isGrounded) {
      localWalkTimer += delta * 14;
      myMesh.rotation.z = Math.sin(localWalkTimer) * 0.05;
    }
  } else if (isDashing) {
    // 대시 중에는 지정된 대시 방향으로 강력하게 돌진!
    myMesh.position.x += dashDirection.x * currentSpeed * delta;
    myMesh.position.z += dashDirection.z * currentSpeed * delta;
    myMesh.rotation.x = 0.25; // 몸체 앞으로 숙임
  } else {
    myMesh.rotation.z = THREE.MathUtils.lerp(myMesh.rotation.z, 0, 0.2);
    myMesh.rotation.x = THREE.MathUtils.lerp(myMesh.rotation.x, 0, 0.2);
  }

  // 3. 중력 & 수직 속도
  playerVelocityY += GRAVITY * delta;
  myMesh.position.y += playerVelocityY * delta;

  // 4. 점프맵 플랫폼 충돌 판정 (AABB Box Collision)
  let landedOnPlatform = false;
  const playerRadius = 0.35;
  const playerFootY = myMesh.position.y;

  for (const plat of parkourPlatforms) {
    const minX = plat.x - plat.width / 2 - playerRadius;
    const maxX = plat.x + plat.width / 2 + playerRadius;
    const minZ = plat.z - plat.depth / 2 - playerRadius;
    const maxZ = plat.z + plat.depth / 2 + playerRadius;

    if (myMesh.position.x >= minX && myMesh.position.x <= maxX &&
        myMesh.position.z >= minZ && myMesh.position.z <= maxZ) {
      
      if (playerFootY <= plat.topY + 0.38 && playerFootY >= plat.topY - 0.65 && playerVelocityY <= 0) {
        myMesh.position.y = plat.topY;
        playerVelocityY = 0;
        isGrounded = true;
        landedOnPlatform = true;

        // 최종 골 플랫폼 클리어 체크!
        if (plat.isGoal) {
          if (plat.courseType === "normal" && !clearedCourses.normal) {
            clearedCourses.normal = true;
            triggerEmote("🏆");
            showToast("🎉 [NORMAL] 초·중급 점프맵을 완주하셨습니다! 🏆");
          } else if (plat.courseType === "hard" && !clearedCourses.hard) {
            clearedCourses.hard = true;
            triggerEmote("👑");
            showToast("🔥 [HARD] 지옥의 하드 점프맵을 정복하셨습니다! 진정한 마스터! 👑");
          }
        }
        break;
      }
    }
  }

  // 5. 기본 바닥(y = 0) 착지 판정
  if (!landedOnPlatform) {
    if (myMesh.position.y <= 0) {
      myMesh.position.y = 0;
      playerVelocityY = 0;
      isGrounded = true;
      // 바닥으로 떨어지면 클리어 상태 리셋 (다시 도전 가능)
      clearedCourses.normal = false;
      clearedCourses.hard = false;
    } else {
      isGrounded = false;
    }
  }

  // 6. 위치 서버 전송
  sendMyMovement();

  // 7. 카메라 추적
  updateCamera();
}

function updateCamera() {
  if (!myMesh) return;

  cameraPitch = Math.max(0.08, Math.min(Math.PI / 2.3, cameraPitch));

  const targetCenter = new THREE.Vector3(
    myMesh.position.x,
    myMesh.position.y + 1.1,
    myMesh.position.z
  );

  const horizontalDist = cameraDistance * Math.cos(cameraPitch);
  const verticalDist = cameraDistance * Math.sin(cameraPitch);

  const targetCamX = targetCenter.x + horizontalDist * Math.sin(cameraAngleY);
  const targetCamY = targetCenter.y + verticalDist;
  const targetCamZ = targetCenter.z + horizontalDist * Math.cos(cameraAngleY);

  camera.position.set(targetCamX, targetCamY, targetCamZ);
  camera.lookAt(targetCenter);
}

function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

// ==========================================
// 7. 원격 플레이어 3D 위치 보간
// ==========================================
function updateRemotePlayers(delta) {
  for (const id in players) {
    if (id === myId) continue;
    const p = players[id];

    p.mesh.position.lerp(p.targetPos, 0.25);
    p.mesh.rotation.y = lerpAngle(p.mesh.rotation.y, p.targetRot, 0.25);
  }
}

// ==========================================
// 8. 이벤트 리스너 설정
// ==========================================
function setupEventListeners() {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 키보드 입력
  window.addEventListener('keydown', (e) => {
    handleKey(e.code, true);

    if (e.key === '1') triggerEmote("👋");
    else if (e.key === '2') triggerEmote("❤️");
    else if (e.key === '3') triggerEmote("😂");
    else if (e.key === '4') triggerEmote("🎉");
    else if (e.key === '5') triggerEmote("🔥");
    else if (e.key === '6') triggerEmote("👑");
  });

  window.addEventListener('keyup', (e) => {
    handleKey(e.code, false);
  });

  // 마우스 회전 & 줌
  const container = document.getElementById('canvas-container');
  container.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', () => { isMouseDown = false; });

  window.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;

    cameraAngleY -= deltaX * 0.005;
    cameraPitch += deltaY * 0.005;
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('wheel', (e) => {
    cameraDistance += e.deltaY * 0.005;
    cameraDistance = Math.max(3.0, Math.min(26.0, cameraDistance));
  }, { passive: true });

  // 이모티콘 바 버튼
  const emoteButtons = document.querySelectorAll('.emote-btn');
  emoteButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const emote = btn.dataset.emote;
      if (emote) triggerEmote(emote);
    });
  });

  // 상단 순간이동 바로가기 버튼들
  const tpNormalBtn = document.getElementById('tp-normal-btn');
  if (tpNormalBtn) {
    tpNormalBtn.addEventListener('click', () => {
      if (myMesh) {
        myMesh.position.set(-15, 1.2, 3);
        playerVelocityY = 0;
        showToast("🟢 노멀 코스 입구로 이동했습니다!");
      }
    });
  }

  const tpHardBtn = document.getElementById('tp-hard-btn');
  if (tpHardBtn) {
    tpHardBtn.addEventListener('click', () => {
      if (myMesh) {
        myMesh.position.set(15, 1.2, 3);
        playerVelocityY = 0;
        showToast("🔥 하드 코스 입구로 이동했습니다! (조심하세요!)");
      }
    });
  }

  const resetBtn = document.getElementById('reset-pos-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (myMesh) {
        myMesh.position.set(0, 1.2, 5);
        playerVelocityY = 0;
        showToast("중앙 스폰 광장으로 이동했습니다!");
      }
    });
  }

  // 모바일 점프 & 대시 버튼
  const mobileJumpBtn = document.getElementById('mobile-jump-btn');
  if (mobileJumpBtn) {
    mobileJumpBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      performJump();
    }, { passive: false });
    mobileJumpBtn.addEventListener('click', performJump);
  }

  const mobileDashBtn = document.getElementById('mobile-dash-btn');
  if (mobileDashBtn) {
    mobileDashBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      performDash();
    }, { passive: false });
    mobileDashBtn.addEventListener('click', performDash);
  }

  // 모바일 D-PAD
  const dpadButtons = document.querySelectorAll('.d-btn');
  dpadButtons.forEach(btn => {
    const key = btn.dataset.key;
    const activate = (e) => { e.preventDefault(); handleKey(key, true); };
    const deactivate = (e) => { e.preventDefault(); handleKey(key, false); };

    btn.addEventListener('touchstart', activate, { passive: false });
    btn.addEventListener('touchend', deactivate, { passive: false });
    btn.addEventListener('mousedown', activate);
    btn.addEventListener('mouseup', deactivate);
    btn.addEventListener('mouseleave', deactivate);
  });

  // 링크 복사 버튼
  const copyBtn = document.getElementById('copy-link-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => showToast("주소가 복사되었습니다!"));
      } else {
        const temp = document.createElement('input');
        temp.value = url;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
        showToast("주소가 복사되었습니다!");
      }
    });
  }
}

function handleKey(code, isPressed) {
  switch (code) {
    case 'KeyW': case 'ArrowUp': keys.w = isPressed; break;
    case 'KeyS': case 'ArrowDown': keys.s = isPressed; break;
    case 'KeyA': case 'ArrowLeft': keys.a = isPressed; break;
    case 'KeyD': case 'ArrowRight': keys.d = isPressed; break;
    case 'Space':
      keys.space = isPressed;
      if (isPressed) performJump();
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      keys.shift = isPressed;
      if (isPressed) performDash();
      break;
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

// ==========================================
// 9. 메인 렌더 루프
// ==========================================
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // 1. 노멀 트로피 & 하드 왕관 회전 연출
  if (trophyNormalMesh) {
    trophyNormalMesh.rotation.y += delta * 1.5;
  }
  if (trophyHardMesh) {
    trophyHardMesh.rotation.y -= delta * 1.8;
  }

  // 2. 내 플레이어 물리/점프/대시 갱신
  updateLocalPlayerPhysics(delta);

  // 3. 다른 플레이어 위치 보간
  updateRemotePlayers(delta);

  // 4. 이모티콘 팝업 애니메이션 갱신
  updateEmoteSprites(delta);

  // 5. 렌더
  renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', init);
