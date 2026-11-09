import os
import random
import uuid
import json
from typing import Dict, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI(title="3D Multiplayer Space with Video Call")

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 브라우저 캐시 방지 미들웨어 (새로고침 시 항상 최신 파일 반영)
@app.middleware("http")
async def add_no_cache_headers(request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/static") or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

# 정적 파일 디렉토리
STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(STATIC_DIR):
    os.makedirs(STATIC_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

AVATAR_COLORS = [
    "#38bdf8",  # sky
    "#f43f5e",  # rose
    "#10b981",  # emerald
    "#a855f7",  # purple
    "#f59e0b",  # amber
    "#06b6d4",  # cyan
    "#ec4899",  # pink
    "#84cc16",  # lime
]

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.players: Dict[str, dict] = {}
        self.call_participants: Set[str] = set()

    async def connect(self, websocket: WebSocket) -> str:
        await websocket.accept()
        player_id = f"user_{uuid.uuid4().hex[:6]}"
        color = random.choice(AVATAR_COLORS)
        
        # 바닥 위 랜덤 스폰 위치
        spawn_x = round(random.uniform(-6, 6), 2)
        spawn_z = round(random.uniform(-6, 6), 2)
        
        player_data = {
            "id": player_id,
            "color": color,
            "x": spawn_x,
            "y": 0.0,
            "z": spawn_z,
            "rotation": 0.0,
            "inCall": False
        }
        
        self.active_connections[player_id] = websocket
        self.players[player_id] = player_data
        
        # 1. 새 유저에게 현재 본인 정보 및 전체 접속자 목록 전달
        await websocket.send_json({
            "type": "init",
            "selfId": player_id,
            "players": list(self.players.values())
        })
        
        # 2. 다른 유저들에게 새 유저 접속 브로드캐스트
        await self.broadcast_except(player_id, {
            "type": "player_joined",
            "player": player_data
        })
        
        return player_id

    def disconnect(self, player_id: str):
        if player_id in self.active_connections:
            del self.active_connections[player_id]
        if player_id in self.players:
            del self.players[player_id]
        if player_id in self.call_participants:
            self.call_participants.remove(player_id)

    async def send_to(self, target_id: str, message: dict):
        ws = self.active_connections.get(target_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception:
                self.disconnect(target_id)

    async def broadcast_except(self, sender_id: str, message: dict):
        dead_connections = []
        for pid, ws in list(self.active_connections.items()):
            if pid != sender_id:
                try:
                    await ws.send_json(message)
                except Exception:
                    dead_connections.append(pid)
        for pid in dead_connections:
            self.disconnect(pid)

    async def broadcast_all(self, message: dict):
        dead_connections = []
        for pid, ws in list(self.active_connections.items()):
            try:
                await ws.send_json(message)
            except Exception:
                dead_connections.append(pid)
        for pid in dead_connections:
            self.disconnect(pid)

manager = ConnectionManager()

@app.get("/")
async def get_index():
    index_path = os.path.join(STATIC_DIR, "index.html")
    return FileResponse(index_path)

@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "online_players": len(manager.players),
        "call_participants": len(manager.call_participants)
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    player_id = await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            msg_type = data.get("type")
            
            if msg_type == "move":
                # 좌표 및 회전 업데이트
                if player_id in manager.players:
                    manager.players[player_id]["x"] = data.get("x", 0.0)
                    manager.players[player_id]["y"] = data.get("y", 0.0)
                    manager.players[player_id]["z"] = data.get("z", 0.0)
                    manager.players[player_id]["rotation"] = data.get("rotation", 0.0)
                
                # 다른 유저들에게 이동 브로드캐스트
                await manager.broadcast_except(player_id, {
                    "type": "player_moved",
                    "id": player_id,
                    "x": data.get("x", 0.0),
                    "y": data.get("y", 0.0),
                    "z": data.get("z", 0.0),
                    "rotation": data.get("rotation", 0.0)
                })

            # --- WebRTC 화상통화 시그널링 ---
            elif msg_type == "webrtc_join":
                # 기존 참여자 목록 추출
                existing_callers = list(manager.call_participants)
                manager.call_participants.add(player_id)
                if player_id in manager.players:
                    manager.players[player_id]["inCall"] = True

                # 본인에게 기존 참여자 목록 전달
                await websocket.send_json({
                    "type": "webrtc_existing_peers",
                    "peers": existing_callers
                })

                # 기존 참여자들에게 새 유저 통화 참여 알림
                for peer_id in existing_callers:
                    await manager.send_to(peer_id, {
                        "type": "webrtc_peer_joined",
                        "peerId": player_id
                    })

                # 모든 유저에게 아바타 통화 상태 업데이트 브로드캐스트
                await manager.broadcast_all({
                    "type": "player_call_status",
                    "id": player_id,
                    "inCall": True
                })

            elif msg_type == "webrtc_leave":
                if player_id in manager.call_participants:
                    manager.call_participants.remove(player_id)
                if player_id in manager.players:
                    manager.players[player_id]["inCall"] = False

                for peer_id in list(manager.call_participants):
                    await manager.send_to(peer_id, {
                        "type": "webrtc_peer_left",
                        "peerId": player_id
                    })

                await manager.broadcast_all({
                    "type": "player_call_status",
                    "id": player_id,
                    "inCall": False
                })

            elif msg_type == "webrtc_signal":
                # 1:1 WebRTC 시그널 (Offer, Answer, ICE candidate) 중계
                target_id = data.get("targetId")
                signal = data.get("signal")
                if target_id and signal:
                    await manager.send_to(target_id, {
                        "type": "webrtc_signal",
                        "senderId": player_id,
                        "signal": signal
                    })
                
    except WebSocketDisconnect:
        was_in_call = player_id in manager.call_participants
        manager.disconnect(player_id)
        if was_in_call:
            for peer_id in list(manager.call_participants):
                await manager.send_to(peer_id, {
                    "type": "webrtc_peer_left",
                    "peerId": player_id
                })
        await manager.broadcast_all({
            "type": "player_left",
            "id": player_id
        })
    except Exception as e:
        was_in_call = player_id in manager.call_participants
        manager.disconnect(player_id)
        if was_in_call:
            for peer_id in list(manager.call_participants):
                await manager.send_to(peer_id, {
                    "type": "webrtc_peer_left",
                    "peerId": player_id
                })
        await manager.broadcast_all({
            "type": "player_left",
            "id": player_id
        })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port, reload=False)
