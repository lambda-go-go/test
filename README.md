# 🌐 3D Multiplayer Virtual Space (웹 3D 가상 공간)

Three.js와 Python(FastAPI + WebSocket)으로 제작된 미니멀한 3D 멀티플레이어 가상 공간입니다.  
아무것도 없는 끝없는 공간에 바닥만 펼쳐져 있으며, 생성된 웹 주소를 다른 사람에게 공유하면 서로의 아바타를 보고 실시간으로 움직일 수 있습니다.

---

## ✨ 주요 기능

* **미니멀 3D 공간**: Three.js 기반의 무한 평면 바닥 및 네온 그리드.
* **기본 도형 아바타**: 캡슐/실린더 형태의 기본 도형 아바타, 시선 방향(바이저), 고유 색상 및 머리 위 닉네임 라벨.
* **실시간 멀티플레이**: Python FastAPI의 WebSocket을 통한 초당 30회 위치/회전 실시간 동기화 및 부드러운 위치 보간(Lerp).
* **간편한 공유**: 상단의 **"링크 복사"** 버튼을 눌러 생성된 URL을 친구에게 바로 공유 가능.
* **조작 편의성**:
  * 키보드 `WASD` 또는 `방향키`로 이동.
  * 마우스 드래그로 360도 카메라 시점 회전 및 휠 줌 인/아웃.
  * 스마트폰/태블릿을 위한 화면 터치 D-PAD 지원.

---

## 🚀 로컬 실행 방법

### 1. 패키지 설치
```bash
pip install -r requirements.txt
```

### 2. 서버 실행
```bash
python server.py
```
브라우저에서 [http://localhost:8000](http://localhost:8000) 으로 접속합니다. (여러 창을 띄워 실시간 동기화를 테스트해 보세요!)

---

## ☁️ Render에 배포하기 (무료 호스팅)

이 프로젝트는 Render 배포 설정(`render.yaml`, `Procfile`)이 완료되어 있습니다.

### 1단계: GitHub에 코드 푸시
```bash
git add .
git commit -m "Initial commit: 3D multiplayer space"
git push origin main
```

### 2단계: Render 웹 대시보드 설정
1. [Render.com](https://render.com)에 로그인합니다.
2. 대시보드 우측 상단의 **[New +]** 버튼을 클릭하고 **[Web Service]**를 선택합니다.
3. GitHub 계정을 연동한 후 `lambda-go-go/test` 리포지토리를 선택하고 **[Connect]**를 누릅니다.
4. 아래 설정값을 확인합니다 (대부분 자동으로 감지됩니다):
   * **Name**: 원하는 서비스 이름 (예: `my-3d-space`)
   * **Runtime**: `Python 3`
   * **Build Command**: `pip install -r requirements.txt`
   * **Start Command**: `uvicorn server:app --host 0.0.0.0 --port $PORT`
   * **Instance Type**: `Free`
5. 최하단의 **[Create Web Service]** 버튼을 클릭합니다.

### 3단계: 링크 공유
배포가 완료되면 상단에 `https://my-3d-space.onrender.com` 같은 공개 주소가 발급됩니다.  
이 주소를 친구들에게 보내면 누구나 브라우저로 들어와 같은 3D 공간에서 함께 움직일 수 있습니다!
