// --- Three.js & WebSocket & WebRTC Video Call ---

// 3D 전역 상태
let scene, camera, renderer;
let myId = null;
let myColor = null;
let myMesh = null;
const players = {}; // id -> { mesh, targetPos, targetRot, isMoving, walkTimer, inCall }

// 키 입력 상태
const keys = { w: false, a: false, s: false, d: false };

// 카메라 컨트롤 변수
let isMouseDown = false;
let previousMousePosition = { x: 0, y: 0 };
let cameraAngleY = 0;
let cameraPitch = 0.45;
let cameraDistance = 8.0;

// 웹소켓
let socket = null;
let lastSentTime = 0;
const SEND_INTERVAL = 33; // ~30fps

// 걷기 애니메이션 변수
let localWalkTimer = 0;

// ==========================================
// WebRTC 화상통화 상태
// ==========================================
let localStream = null;
let isInCall = false;
let isMicMuted = false;
let isCamOff = false;
const rtcPeers = {}; // peerId -> { pc, remoteStream, candidateQueue, isRemoteSet }

// 무료 공개 Google STUN 서버
const rtcConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

// ==========================================
// 1. 초기화 함수
// ==========================================
function init() {
  const container = document.getElementById('canvas-container');

  // 1-1. Three.js 씬 생성
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f19);
  scene.fog = new THREE.FogExp2(0x0b0f19, 0.015);

  // 1-2. 카메라 생성
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
  const d = 30;
  dirLight.shadow.camera.left = -d;
  dirLight.shadow.camera.right = d;
  dirLight.shadow.camera.top = d;
  dirLight.shadow.camera.bottom = -d;
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
  ground.receiveShadow = true;
  scene.add(ground);

  // 1-6. 격자 (GridHelper)
  const gridHelper = new THREE.GridHelper(200, 100, 0x38bdf8, 0x1e293b);
  gridHelper.position.y = 0.01;
  scene.add(gridHelper);

  // 1-7. 이벤트 리스너 등록
  setupEventListeners();
  setupCallEventListeners();

  // 1-8. 웹소켓 연결
  connectWebSocket();

  // 1-9. 렌더링 루프 시작
  animate();
}

// ==========================================
// 2. 아바타 생성 함수
// ==========================================
function createAvatarMesh(colorHex, isSelf, nameText, inCall = false) {
  const avatarGroup = new THREE.Group();

  // 몸체
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
  const labelText = inCall ? `🎥 ${nameText}` : nameText;
  const labelSprite = createTextLabel(labelText, isSelf ? "#38bdf8" : (inCall ? "#10b981" : "#ffffff"));
  labelSprite.name = "nameLabel";
  labelSprite.position.set(0, 1.8, 0);
  avatarGroup.add(labelSprite);

  return avatarGroup;
}

function updateAvatarLabel(player) {
  if (!player || !player.mesh) return;
  const isSelf = (player.mesh === myMesh);
  const baseName = isSelf ? "나 (You)" : `Player ${player.mesh.userData.id.slice(-4)}`;
  const labelText = player.inCall ? `🎥 ${baseName}` : baseName;
  const color = isSelf ? "#38bdf8" : (player.inCall ? "#10b981" : "#ffffff");

  const oldLabel = player.mesh.getObjectByName("nameLabel");
  if (oldLabel) player.mesh.remove(oldLabel);

  const newLabel = createTextLabel(labelText, color);
  newLabel.name = "nameLabel";
  newLabel.position.set(0, 1.8, 0);
  player.mesh.add(newLabel);
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
// 3. WebSocket 네트워크 동기화 & WebRTC 시그널링
// ==========================================
function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("WebSocket connected:", wsUrl);
  };

  socket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      await handleServerMessage(data);
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

async function handleServerMessage(data) {
  const type = data.type;

  // 1) 3D 공간 기본 동기화
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
    closePeerConnection(data.id);
    removeRemoteVideo(data.id);
    updatePlayerCount();
  }
  else if (type === 'player_call_status') {
    if (players[data.id]) {
      players[data.id].inCall = data.inCall;
      updateAvatarLabel(players[data.id]);
    }
    updateCallCount();
  }

  // 2) WebRTC 화상통화 시그널링
  else if (type === 'webrtc_existing_peers') {
    const existingPeers = data.peers || [];
    for (const peerId of existingPeers) {
      if (peerId !== myId) {
        await initiatePeerConnection(peerId);
      }
    }
  }
  else if (type === 'webrtc_peer_joined') {
    console.log("New peer joined call:", data.peerId);
  }
  else if (type === 'webrtc_signal') {
    const senderId = data.senderId;
    const signal = data.signal;

    if (signal.sdp) {
      if (signal.sdp.type === 'offer') {
        await handleReceiveOffer(senderId, signal.sdp);
      } else if (signal.sdp.type === 'answer') {
        await handleReceiveAnswer(senderId, signal.sdp);
      }
    } else if (signal.candidate) {
      await handleReceiveCandidate(senderId, signal.candidate);
    }
  }
  else if (type === 'webrtc_peer_left') {
    closePeerConnection(data.peerId);
    removeRemoteVideo(data.peerId);
  }
}

function addPlayer(pData, isSelf) {
  if (players[pData.id]) return;

  const displayName = isSelf ? "나 (You)" : `Player ${pData.id.slice(-4)}`;
  const mesh = createAvatarMesh(pData.color, isSelf, displayName, pData.inCall || false);
  mesh.userData = { id: pData.id };
  mesh.position.set(pData.x, pData.y, pData.z);
  mesh.rotation.y = pData.rotation || 0;
  scene.add(mesh);

  players[pData.id] = {
    mesh: mesh,
    targetPos: new THREE.Vector3(pData.x, pData.y, pData.z),
    targetRot: pData.rotation || 0,
    isMoving: false,
    walkTimer: 0,
    inCall: pData.inCall || false
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

function updateCallCount() {
  const inCallCount = Object.values(players).filter(p => p.inCall).length;
  const badge = document.getElementById('call-count');
  if (badge) {
    if (inCallCount > 0) {
      badge.style.display = 'inline-block';
      badge.innerText = `📞 통화 중: ${inCallCount}명`;
    } else {
      badge.style.display = 'none';
    }
  }
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
// 4. WebRTC 실시간 화상통화 로직 (강화된 P2P)
// ==========================================
async function startVideoCall() {
  try {
    // 1. 카메라 & 마이크 권한 요청 (제약조건 실패 시 유연하게 재시도하는 Fallback 구현)
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          facingMode: "user"
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
    } catch (e1) {
      console.warn("Retrying getUserMedia with relaxed constraints...", e1);
      localStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
    }

    // 2. 내 로컬 비디오 화면에 표시
    const localVideo = document.getElementById('local-video');
    if (localVideo) {
      localVideo.srcObject = localStream;
      localVideo.muted = true; // 본인 하울링 방지
      localVideo.setAttribute('playsinline', 'true');
      localVideo.setAttribute('webkit-playsinline', 'true');
      localVideo.play().catch(e => console.warn("Local video play:", e));
    }

    // 3. UI 활성화
    document.getElementById('join-call-btn').style.display = 'none';
    document.getElementById('active-call-panel').style.display = 'flex';
    isInCall = true;

    // 4. 서버에 통화 참여 전송
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'webrtc_join' }));
    }

    showToast("화상통화에 참여했습니다! 📹");
  } catch (err) {
    console.error("Camera access failed:", err);
    alert("카메라 또는 마이크 권한을 허용해 주세요. (다른 앱에서 카메라를 사용 중인지도 확인해 보세요)");
  }
}

function leaveVideoCall() {
  if (!isInCall) return;

  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }

  for (const peerId in rtcPeers) {
    closePeerConnection(peerId);
    removeRemoteVideo(peerId);
  }

  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'webrtc_leave' }));
  }

  document.getElementById('active-call-panel').style.display = 'none';
  document.getElementById('join-call-btn').style.display = 'flex';
  isInCall = false;

  showToast("통화를 종료했습니다.");
}

// RTCPeerConnection 생성 및 트랙 관리
function getOrCreatePeer(peerId) {
  if (rtcPeers[peerId]) return rtcPeers[peerId];

  const pc = new RTCPeerConnection(rtcConfiguration);
  const remoteStream = new MediaStream();

  const peerEntry = {
    pc: pc,
    remoteStream: remoteStream,
    candidateQueue: [],
    isRemoteSet: false
  };
  rtcPeers[peerId] = peerEntry;

  // 로컬 트랙 추가
  if (localStream) {
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });
  }

  // ICE Candidate 이벤트
  pc.onicecandidate = (event) => {
    if (event.candidate && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'webrtc_signal',
        targetId: peerId,
        signal: { candidate: event.candidate }
      }));
    }
  };

  // 트랙 수신 시 (오디오/비디오 각각 처리)
  pc.ontrack = (event) => {
    console.log(`Received track from ${peerId}:`, event.track.kind);
    remoteStream.addTrack(event.track);
    addOrUpdateRemoteVideo(peerId, remoteStream);
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state with ${peerId}:`, pc.connectionState);
    if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      closePeerConnection(peerId);
      removeRemoteVideo(peerId);
    }
  };

  return peerEntry;
}

// 내가 Offer를 생성해 상대방에게 연결 요청
async function initiatePeerConnection(peerId) {
  const peer = getOrCreatePeer(peerId);
  try {
    const offer = await peer.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peer.pc.setLocalDescription(offer);

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'webrtc_signal',
        targetId: peerId,
        signal: { sdp: peer.pc.localDescription }
      }));
    }
  } catch (err) {
    console.error("Error creating offer:", err);
  }
}

// 상대방의 Offer 수신 처리
async function handleReceiveOffer(senderId, offerSdp) {
  const peer = getOrCreatePeer(senderId);
  try {
    await peer.pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
    peer.isRemoteSet = true;
    await processCandidateQueue(peer);

    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({
        type: 'webrtc_signal',
        targetId: senderId,
        signal: { sdp: peer.pc.localDescription }
      }));
    }
  } catch (err) {
    console.error("Error handling offer:", err);
  }
}

// Answer 수신 처리
async function handleReceiveAnswer(senderId, answerSdp) {
  const peer = rtcPeers[senderId];
  if (peer && peer.pc) {
    try {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
      peer.isRemoteSet = true;
      await processCandidateQueue(peer);
    } catch (err) {
      console.error("Error setting remote description from answer:", err);
    }
  }
}

// ICE Candidate 수신 처리 (RemoteDescription 대기 큐 지원)
async function handleReceiveCandidate(senderId, candidateData) {
  const peer = rtcPeers[senderId] || getOrCreatePeer(senderId);
  if (!peer.isRemoteSet) {
    peer.candidateQueue.push(candidateData);
  } else {
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (err) {
      console.error("Error adding ice candidate:", err);
    }
  }
}

async function processCandidateQueue(peer) {
  while (peer.candidateQueue.length > 0) {
    const candidateData = peer.candidateQueue.shift();
    try {
      await peer.pc.addIceCandidate(new RTCIceCandidate(candidateData));
    } catch (err) {
      console.error("Error adding queued candidate:", err);
    }
  }
}

function closePeerConnection(peerId) {
  if (rtcPeers[peerId]) {
    try {
      rtcPeers[peerId].pc.close();
    } catch (e) {}
    delete rtcPeers[peerId];
  }
}

// 상대방 비디오 화면 DOM 생성 및 재생 (iOS / Safari / Chrome 완벽 대응)
function addOrUpdateRemoteVideo(peerId, stream) {
  let card = document.getElementById(`video-card-${peerId}`);
  let video;

  if (!card) {
    const grid = document.getElementById('video-grid');
    card = document.createElement('div');
    card.id = `video-card-${peerId}`;
    card.className = 'video-card';

    video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('autoplay', 'true');
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');

    card.appendChild(video);

    const label = document.createElement('div');
    label.className = 'video-label';
    label.innerText = `Player ${peerId.slice(-4)}`;
    card.appendChild(label);

    grid.appendChild(card);
  } else {
    video = card.querySelector('video');
  }

  if (video && video.srcObject !== stream) {
    video.srcObject = stream;
  }

  // 모바일/패드 Autoplay 정책 방어:
  const playVideo = () => {
    if (!video) return;
    video.play().catch(err => {
      console.warn("Autoplay was blocked by browser policy. Retrying muted...", err);
      // 브라우저가 소리 때문에 비디오를 막은 경우, 일단 muted로 재생시켜 화면이 나오게 함
      video.muted = true;
      video.play().catch(e => console.warn("Retry failed:", e));

      // 사용자가 화면을 터치/클릭하면 소리가 켜지도록 바인딩
      const unmuteOnClick = () => {
        video.muted = false;
        window.removeEventListener('click', unmuteOnClick);
        window.removeEventListener('touchstart', unmuteOnClick);
      };
      window.addEventListener('click', unmuteOnClick, { once: true });
      window.addEventListener('touchstart', unmuteOnClick, { once: true });
    });
  };

  playVideo();
}

function removeRemoteVideo(peerId) {
  const card = document.getElementById(`video-card-${peerId}`);
  if (card && card.parentNode) {
    card.parentNode.removeChild(card);
  }
}

// ==========================================
// 5. 로컬 플레이어 이동 & 카메라 추적
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

    const targetAngle = Math.atan2(moveDir.x, moveDir.z);
    myMesh.rotation.y = lerpAngle(myMesh.rotation.y, targetAngle, 0.25);

    localWalkTimer += delta * 14;
    myMesh.position.y = Math.abs(Math.sin(localWalkTimer)) * 0.12;
    myMesh.rotation.z = Math.sin(localWalkTimer) * 0.05;

    sendMyMovement();
  } else {
    myMesh.position.y = THREE.MathUtils.lerp(myMesh.position.y, 0, 0.2);
    myMesh.rotation.z = THREE.MathUtils.lerp(myMesh.rotation.z, 0, 0.2);
  }

  updateCamera();
}

function updateCamera() {
  if (!myMesh) return;

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

function lerpAngle(a, b, t) {
  let diff = (b - a) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return a + diff * t;
}

// ==========================================
// 6. 원격 플레이어 보간
// ==========================================
function updateRemotePlayers(delta) {
  for (const id in players) {
    if (id === myId) continue;
    const p = players[id];

    const dist = p.mesh.position.distanceTo(p.targetPos);
    p.mesh.position.lerp(p.targetPos, 0.2);
    p.mesh.rotation.y = lerpAngle(p.mesh.rotation.y, p.targetRot, 0.2);

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
// 7. 이벤트 리스너 설정
// ==========================================
function setupEventListeners() {
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  window.addEventListener('keydown', (e) => handleKey(e.code, true));
  window.addEventListener('keyup', (e) => handleKey(e.code, false));

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
    cameraDistance = Math.max(3.0, Math.min(22.0, cameraDistance));
  }, { passive: true });

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

  // 주소 복사 버튼
  const copyBtn = document.getElementById('copy-link-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      const url = window.location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(showToast);
      } else {
        const temp = document.createElement('input');
        temp.value = url;
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        document.body.removeChild(temp);
        showToast();
      }
    });
  }
}

// 화상통화 컨트롤 리스너
function setupCallEventListeners() {
  const joinBtn = document.getElementById('join-call-btn');
  if (joinBtn) {
    joinBtn.addEventListener('click', startVideoCall);
  }

  const leaveBtn = document.getElementById('leave-call-btn');
  if (leaveBtn) {
    leaveBtn.addEventListener('click', leaveVideoCall);
  }

  const micBtn = document.getElementById('toggle-mic-btn');
  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (!localStream) return;
      isMicMuted = !isMicMuted;
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !isMicMuted;
      });
      micBtn.classList.toggle('off', isMicMuted);
      micBtn.querySelector('.icon').innerText = isMicMuted ? '🔇' : '🎙️';
      showToast(isMicMuted ? "마이크를 음소거했습니다." : "마이크를 켰습니다.");
    });
  }

  const camBtn = document.getElementById('toggle-cam-btn');
  if (camBtn) {
    camBtn.addEventListener('click', () => {
      if (!localStream) return;
      isCamOff = !isCamOff;
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !isCamOff;
      });
      camBtn.classList.toggle('off', isCamOff);
      camBtn.querySelector('.icon').innerText = isCamOff ? '🚫' : '📷';
      showToast(isCamOff ? "카메라를 껐습니다." : "카메라를 켰습니다.");
    });
  }
}

function handleKey(code, isPressed) {
  switch (code) {
    case 'KeyW': case 'ArrowUp': keys.w = isPressed; break;
    case 'KeyS': case 'ArrowDown': keys.s = isPressed; break;
    case 'KeyA': case 'ArrowLeft': keys.a = isPressed; break;
    case 'KeyD': case 'ArrowRight': keys.d = isPressed; break;
  }
}

function showToast(msg = "접속 주소가 복사되었습니다!") {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerText = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2500);
}

// ==========================================
// 8. 렌더 루프
// ==========================================
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  updateLocalPlayer(delta);
  updateRemotePlayers(delta);
  renderer.render(scene, camera);
}

window.addEventListener('DOMContentLoaded', init);
