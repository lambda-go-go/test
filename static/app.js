// --- Three.js & WebSocket Multi-user 3D Space ---

// 전역 상태
let scene, camera, renderer;
let myId = null;
let myColor = null;
let myMesh = null;
const players = {}; // id -> { mesh, targetPos, targetRot, isMoving, walkTimer }

// 키 입력 상태
const keys = {
  w: false,
  a: false,
  s: false,
  d: false
};

// 카메라 궤도 회전 컨트롤 변수
let isMouseDown = false;
let previousMousePosition = { x: 0, y: 0 };
let cameraAngleY = 0; // 수평 회전각 (라디안)
let cameraPitch = 0.45; // 수직 시점 (라디안)
let cameraDistance = 8.0; // 카메라 거리

// 웹소켓
let socket = null;
let lastSentTime = 0;
const SEND_INTERVAL = 33; // ~30fps 전송

// 걷기 애니메이션 변수
let localWalkTimer = 0;

// ==========================================
// 1. 초기화 함수
// ==========================================
function init() {
  const container = document.getElementById('canvas-container');

  // 1-1. 씬 생성
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f19);
  scene.fog = new THREE.FogExp2(0x0b0f19, 0.015);

  // 1-2. 카메라 생성 (FOV 60)
  camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );
  camera.position.set(0, 5, 8);

  // 1-3. 렌더러 생성
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // 1-4. 조명 설정
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(20, 40, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 150;
  const d = 30;
  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d;
  dirLight.shadow.camera.bottom = -d;
  dirLight.shadow.bias = -0.0005;
  scene.add(dirLight);

  // 1-5. 바닥 평면 생성
  const groundGeo = new THREE.PlaneGeometry(400, 400);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.85,
    metalness: 0.1
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = 0;
  ground.receiveShadow = true;
  scene.add(ground);

  // 1-6. 세련된 격자 (GridHelper)
  const gridHelper = new THREE.GridHelper(200, 100, 0x38bdf8, 0x1e293b);
  gridHelper.position.y = 0.01; // 바닥 z-fighting 방지
  scene.add(gridHelper);

  // 1-7. 이벤트 리스너 등록
  setupEventListeners();

  // 1-8. 웹소켓 연결
  connectWebSocket();

  // 1-9. 렌더링 루프 시작
  animate();
}

// ==========================================
// 2. 아바타 생성 함수 (기본 도형 조합)
// ==========================================
function createAvatarMesh(colorHex, isSelf, nameText) {
  const avatarGroup = new THREE.Group();

  // 2-1. 몸체 (둥근 캡슐 도형)
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

  // 캡슐 상단 반구
  const headGeo = new THREE.SphereGeometry(0.35, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const head = new THREE.Mesh(headGeo, bodyMat);
  head.position.y = 1.1;
  head.castShadow = true;
  avatarGroup.add(head);

  // 캡슐 하단 반구
  const bottomGeo = new THREE.SphereGeometry(0.35, 16, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  const bottom = new THREE.Mesh(bottomGeo, bodyMat);
  bottom.position.y = 0.2;
  bottom.castShadow = true;
  avatarGroup.add(bottom);

  // 2-2. 앞면 바이저 / 눈 (바라보는 방향 표시)
  const visorGeo = new THREE.BoxGeometry(0.36, 0.16, 0.16);
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x090d16,
    roughness: 0.1,
    metalness: 0.9
  });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.95, 0.28);
  avatarGroup.add(visor);

  // 2-3. 바닥 그림자 (자체 그림자 보조)
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

  // 2-4. 머리 위 닉네임 텍스트 라벨 (Sprite)
  const labelSprite = createTextLabel(nameText, isSelf ? "#38bdf8" : "#ffffff");
  labelSprite.position.set(0, 1.8, 0);
  avatarGroup.add(labelSprite);

  return avatarGroup;
}

// 텍스트 라벨 스프라이트 생성
function createTextLabel(text, textColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // 배경 둥근 사각형
  ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
  roundRect(ctx, 10, 10, 236, 44, 12, true);

  // 텍스트
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.set(1.8, 0.45, 1);
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
// 3. WebSocket 네트워크 동기화
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
    
    // 현재 접속자 생성
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
  if (countEl) {
    countEl.innerText = `온라인: ${count}명`;
  }
}

// 내 위치 서버로 전송
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
// 4. 로컬 플레이어 조작 및 카메라 추적
// ==========================================
function updateLocalPlayer(delta) {
  if (!myMesh) return;

  const moveSpeed = 6.0 * delta;
  let moveX = 0;
  let moveZ = 0;

  if (keys.w) moveZ -= 1;
  if (keys.s) moveZ += 1;
  if (keys.a) moveX -= 1;
  if (keys.d) moveX += 1;

  const isMoving = (moveX !== 0 || moveZ !== 0);

  if (isMoving) {
    // 카메라 수평 방향 기준 이동 벡터 계산
    const length = Math.sqrt(moveX * moveX + moveZ * moveZ);
    moveX /= length;
    moveZ /= length;

    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngleY);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), cameraAngleY);

    const moveDir = new THREE.Vector3()
      .addScaledVector(forward, -moveZ)
      .addScaledVector(right, moveX)
      .normalize();

    myMesh.position.x += moveDir.x * moveSpeed;
    myMesh.position.z += moveDir.z * moveSpeed;

    // 이동 방향으로 부드러운 회전 보간
    const targetAngle = Math.atan2(moveDir.x, moveDir.z);
    myMesh.rotation.y = lerpAngle(myMesh.rotation.y, targetAngle, 0.25);

    // 걷기 통통 튀는 바운스 애니메이션
    localWalkTimer += delta * 14;
    myMesh.position.y = Math.abs(Math.sin(localWalkTimer)) * 0.12;
    myMesh.rotation.z = Math.sin(localWalkTimer) * 0.05;

    // 서버로 좌표 전송
    sendMyMovement();
  } else {
    // 멈췄을 때 원위치 복귀
    myMesh.position.y = THREE.MathUtils.lerp(myMesh.position.y, 0, 0.2);
    myMesh.rotation.z = THREE.MathUtils.lerp(myMesh.rotation.z, 0, 0.2);
  }

  // 3인칭 카메라 추적
  updateCamera();
}

function updateCamera() {
  if (!myMesh) return;

  // 카메라 피치 제한
  cameraPitch = Math.max(0.1, Math.min(Math.PI / 2.3, cameraPitch));

  const targetCenter = new THREE.Vector3(
    myMesh.position.x,
    myMesh.position.y + 1.0,
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

// 각도 보간 (-PI ~ PI 랩핑 대응)
function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

// ==========================================
// 5. 원격 플레이어 부드러운 위치 보간 (Lerp)
// ==========================================
function updateRemotePlayers(delta) {
  for (const id in players) {
    if (id === myId) continue;
    const p = players[id];

    // 위치 Lerp
    const dist = p.mesh.position.distanceTo(p.targetPos);
    p.mesh.position.lerp(p.targetPos, 0.2);

    // 회전 Lerp
    p.mesh.rotation.y = lerpAngle(p.mesh.rotation.y, p.targetRot, 0.2);

    // 원격 유저 걷기 바운스
    if (dist > 0.05) {
      p.walkTimer += delta * 14;
      p.mesh.position.y = Math.abs(Math.sin(p.walkTimer)) * 0.12;
      p.mesh.rotation.z = Math.sin(p.walkTimer) * 0.05;
    } else {
      p.mesh.position.y = THREE.MathUtils.lerp(p.mesh.position.y, 0, 0.2);
      p.mesh.rotation.z = THREE.MathUtils.lerp(p.mesh.rotation.z, 0, 0.2);
    }
  }
}

// ==========================================
// 6. 이벤트 리스너 설정
// ==========================================
function setupEventListeners() {
  // 창 크기 변경 대응
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // 키보드 누름/뗌
  window.addEventListener('keydown', (e) => {
    handleKey(e.code, true);
  });
  window.addEventListener('keyup', (e) => {
    handleKey(e.code, false);
  });

  // 마우스 회전 드래그 & 터치 드래그
  const container = document.getElementById('canvas-container');
  
  container.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener('mouseup', () => {
    isMouseDown = false;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    const deltaX = e.clientX - previousMousePosition.x;
    const deltaY = e.clientY - previousMousePosition.y;

    cameraAngleY -= deltaX * 0.005;
    cameraPitch += deltaY * 0.005;

    previousMousePosition = { x: e.clientX, y: e.clientY };
  });

  // 휠 줌 인/아웃
  window.addEventListener('wheel', (e) => {
    cameraDistance += e.deltaY * 0.005;
    cameraDistance = Math.max(3.0, Math.min(22.0, cameraDistance));
  }, { passive: true });

  // 모바일 D-PAD 버튼
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
  const toast = document.getElementById('toast');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(showToast);
      } else {
        // Fallback
        const tempInput = document.createElement('input');
        tempInput.value = url;
        document.body.appendChild(tempInput);
        tempInput.select();
        document.execCommand('copy');
        document.body.removeChild(tempInput);
        showToast();
      }
    });
  }

  function showToast() {
    if (!toast) return;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }
}

function handleKey(code, isPressed) {
  switch (code) {
    case 'KeyW':
    case 'ArrowUp':
      keys.w = isPressed;
      break;
    case 'KeyS':
    case 'ArrowDown':
      keys.s = isPressed;
      break;
    case 'KeyA':
    case 'ArrowLeft':
      keys.a = isPressed;
      break;
    case 'KeyD':
    case 'ArrowRight':
      keys.d = isPressed;
      break;
  }
}

// ==========================================
// 7. 메인 애니메이션 렌더 루프
// ==========================================
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1); // 최대 0.1초 델타 캡
  lastTime = now;

  // 1. 내 캐릭터 및 카메라 갱신
  updateLocalPlayer(delta);

  // 2. 다른 플레이어들 위치 보간
  updateRemotePlayers(delta);

  // 3. 렌더
  renderer.render(scene, camera);
}

// 페이지 로드 후 시작
window.addEventListener('DOMContentLoaded', init);
