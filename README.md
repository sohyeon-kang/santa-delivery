# P3 Starter Pack

P3에서 3D 작품을 만들 때 출발점으로 쓰는 팩입니다. 들어 있는 것:

- **에셋:** Kenney 키트 7개(모델 622개), HDRI 3장, PBR 텍스처 4세트, 효과음 22개(게임에 사용)와 효과음 라이브러리 489개(`assets/sounds/library/SOUNDS.md`)
- **실행되는 예제 장면:** 도로로 둘러싸인 공원, 양옆 주택가, 동서쪽 상점가가 있는 작은 마을입니다. 캐릭터를 움직이면 강아지가 다가와 반갑게 인사하고, 공을 던지면 물어 옵니다. 마우스로 물체를 고르거나 땅을 눌러 걸어갈 수 있고, 집과 나무에 부딪힙니다. 오른쪽 위에는 미니맵이 있습니다
- **두 가지 구현:** Python + OpenGL 트랙과 three.js(WebGL) 트랙. 둘 중 프로젝트에 맞는 쪽을 고르세요

| Python + PyOpenGL | three.js |
|---|---|
| ![python](docs/python.png) | ![web](docs/web.png) |

## 1. 트랙 고르기

두 트랙은 같은 `scene.json`을 읽고, 같은 기능과 같은 강아지 행동을 구현합니다. 중간에 트랙을 바꿔도 장면은 그대로 옮겨집니다.

| | Python + PyOpenGL (`python/`) | three.js (`web/`) |
|---|---|---|
| 렌더링 | 직접 작성한 GLSL 셰이더 (Blinn-Phong, shadow map, skinning) | three.js가 처리 (PBR, HDRI 환경광, 그림자) |
| 장점 | 파이프라인 전체가 내 코드. 수업에서 배운 알고리즘을 직접 구현하기 좋음 | 적은 코드로 보기 좋은 결과. 브라우저 링크로 바로 시연 |
| 이런 프로젝트에 | 셰이더 효과, 직접 만든 shadow/texture/BVH/CSG, 렌더링 기법 비교 | 상호작용이 많은 작품, 게임, 웹 전시, 많은 에셋과 애니메이션 |
| 필요한 것 | Python 3.10 이상, uv | 웹 브라우저, 로컬 서버(Python 하나면 됨), 인터넷(three.js를 CDN에서 받음) |

## 2. 실행

### Python 트랙

```bash
cd python
uv sync          # 처음 한 번: pygame-ce, PyOpenGL, numpy 설치
uv run main.py
```

### three.js 트랙

브라우저는 보안 때문에 `file://`로 연 페이지에서 모델 파일을 읽지 못합니다. 그래서 로컬 서버가 필요합니다.

```bash
# P3-Starter-Pack 폴더(이 README가 있는 곳)에서
python -m http.server 8000
```

브라우저에서 http://localhost:8000/web/ 을 엽니다. VS Code Live Server를 써도 됩니다. 이때도 서버의 루트는 `P3-Starter-Pack` 폴더여야 합니다(`web/`은 `../assets`, `../scene.json`을 읽습니다).

### 조작 (두 트랙 같음)

| 키 | 동작 |
|---|---|
| W A S D | 이동 (카메라 기준 방향) |
| Shift | 달리기 |
| F | 공 던지기 (카메라가 보는 쪽으로) |
| E | 손 흔들기 |
| 마우스 왼쪽 클릭 | 물체 선택(노랗게 빛남), 땅이나 미니맵을 누르면 그곳으로 걸어감 |
| 마우스 왼쪽 드래그 | 카메라 회전 |
| 휠 | 확대, 축소 |
| B | 충돌 영역(collider) 보기 |
| M | 소리 끄기, 켜기 |
| F12 | 스크린샷 |
| Esc | 종료 (Python) |

## 3. 기본으로 구현된 것

- **glTF(GLB) 불러오기:** 노드 계층, base color(색 값과 텍스처). Python 트랙은 `gltf.py`에 로더를 직접 구현했습니다(외부 라이브러리 없음).
- **애니메이션:** 노드 TRS keyframe 보간(위치, 크기는 선형, 회전은 slerp), 동작 사이 cross-fade
- **GPU skinning:** 사람 캐릭터는 skinned mesh입니다(관절 7개). 강아지는 부위별 rigid 애니메이션입니다.
- **조명:** 태양(directional light), 거리 안개, ACES tone mapping. 주변광은 Python 트랙이 하늘과 땅 색의 hemisphere ambient와 Blinn-Phong, three.js 트랙이 HDRI 환경광과 PBR(MeshStandardMaterial)
- **그림자:** 플레이어를 따라다니는 shadow map(2048²). Python 트랙은 3×3 PCF를 셰이더에 직접 구현, three.js 트랙은 PCFSoftShadowMap
- **3인칭 카메라:** 플레이어를 부드럽게 따라가는 orbit 카메라
- **충돌:** 집, 차, 울타리는 AABB를 바닥에 투영한 사각형, 나무는 줄기 크기의 원. 캐릭터(원)를 밀어내는 방식이라 벽을 따라 미끄러집니다(`physics.py` `push_out`, `physics.js` `pushOut`). 꽃, 풀, 길처럼 낮은 물체는 막지 않습니다.
- **공:** 중력과 semi-implicit Euler 적분, 땅과 벽에서 튀기(반발 계수), 굴러가며 느려지기(마찰)
- **마우스 picking:** 화면 좌표에서 카메라 ray를 만들고 모든 물체의 AABB와 slab 방법으로 교차 검사. 가장 가까운 물체를 고르고, 땅이 더 가까우면 그 점으로 걸어갑니다(클릭 이동). 벽에 막혀 0.6초 동안 못 가면 멈춥니다.
- **미니맵 HUD:** 위에서 내려다보는 직교 카메라로 장면을 한 번 더 그려 오른쪽 위 viewport(240×240 px, 가로세로 48 m)에 넣습니다. `glViewport`와 `glScissor`(three.js는 `setViewport`, `setScissor`)로 그리는 영역을 제한하고, 북쪽이 위입니다. 노란 화살표는 플레이어, 흰 선은 카메라 시야, 주황 점은 강아지, 빨간 점은 공, 초록 고리는 클릭 이동 목표입니다. Python 트랙은 지도 안에 걸치는 물체만 그리고(AABB culling), three.js는 frustum culling이 자동입니다.
- **효과음:** 발소리(잔디와 포장도로를 구별), 공 던지기, 공 튀기기(땅, 벽), 강아지 짖기, 선택과 이동 클릭. 소리마다 세계 좌표가 있어 거리에 따라 작아지고(inverse 거리 모델) 좌우로 나뉩니다(equal-power panning). 귀는 캐릭터 머리에 두고 카메라 방향으로 돌립니다. 소리 목록과 음량은 `assets/sounds/sounds.json`.
- **강아지 행동:** 아래 상태 기계

### 강아지 상태 기계 (`python/actors.py`, `web/actors.js`)

```
WANDER ──플레이어가 6 m 안──▶ NOTICE ──0.5초──▶ APPROACH ──1.5 m까지 접근──▶ GREET ──2.6초──▶ FOLLOW
  ▲  (집 주변 산책)          (멈춰서 쳐다봄)      (달려옴)                (깡충 3번, 춤추며 한 바퀴)   (졸졸 따라옴)
  │                                                                                              │
  └────────────────────────── 플레이어가 11 m 넘게 멀어짐 (Shift로 달려 따돌리기) ───────────────────┘

공을 던지면 (어느 상태에서든, 플레이어가 11 m 안에 있으면)
  CHASE ──공이 멈추고 입이 닿음──▶ RETURN ──플레이어 앞 1.5 m──▶ DROP ──1초──▶ FOLLOW
  (공을 쫓아 달림)                 (입에 물고 달려옴)              (내려놓고 꼬리 흔들기)
```

- 반경과 속도는 `Dog` 클래스 맨 위 상수입니다. 바꿔 가며 느낌을 조절해 보세요.
- 이벤트는 observer 패턴으로 연결합니다. 강아지가 인사를 시작하면 `on_greet`(JS는 `onGreet`), 플레이어가 공을 던지면 `on_throw`(`onThrow`)에 등록된 함수가 불립니다. 예제는 이것으로 플레이어가 손을 흔들게 하고, 강아지가 공을 쫓게 합니다.
- 효과음도 같은 방식입니다. `on_step`, `on_hit`(공), `on_bark`에 소리를 내는 함수를 등록했을 뿐이라, 게임 코드는 소리를 모릅니다. 새 소리를 붙이려면 이벤트에 함수 하나를 더 등록하면 됩니다.
- 한 번 인사한 뒤에는 따라다니기만 합니다. 멀리 떠났다가 다시 오면 또 인사합니다.

## 4. 장면 바꾸기: `scene.json`

```jsonc
{
  "kitScale": { "mini-characters": 2.2, "cube-pets": 0.55, "city-kit-suburban": 6.0, "car-kit": 1.4,
                "nature-kit": 3.0, "city-kit-roads": 8.0, "city-kit-commercial": 8.0 },
  "ground": { "size": 160, "color": "#7cb85a" },          // 색은 sRGB hex
  "sun": { "direction": [-0.45, -1.0, -0.35], "color": [1.0, 0.95, 0.85], "intensity": 2.0 },
  "player": { "model": "mini-characters/character-female-b.glb", "pos": [0, 0, 6], "rotY": 0 },
  "dog": { "model": "cube-pets/animal-dog.glb", "pos": [10, 0, -6], "home": [10, 0, -6], "wanderRadius": 4 },
  "props": [
    { "model": "city-kit-roads/road-straight.glb", "pos": [-8, -0.08, -16], "rotY": 0 },
    { "model": "city-kit-suburban/building-type-a.glb", "pos": [-48, 0, -27], "rotY": 0 },
    { "model": "nature-kit/tree_oak.glb", "pos": [12, 0, 3], "rotY": 40, "scale": 1.1 }
  ]
}
```

- 단위는 미터, y가 위쪽입니다. `rotY`는 y축 회전(도), `scale`은 키트 배율에 곱해집니다.
- 모델 경로는 `assets/models/` 아래 상대 경로입니다. 각 키트의 `Preview.png`에서 모델을 고르세요.
- **마을 격자:** 도로 타일 한 장이 8 m입니다. 타일 중심을 8의 배수 좌표에 두면 이어집니다. 차도 높이를 땅과 맞추려고 도로 타일은 `y = -0.08`에 둡니다(인도는 8 cm 높게 올라옵니다). `road-straight`는 `rotY` 0이면 동서 방향, 90이면 남북 방향입니다.
- **충돌 규칙:** 길, 타일처럼 낮은 것은 막지 않고, 나무, 가로등, 표지판, 파라솔은 줄기나 기둥만 막습니다(`physics.py`의 `SKIP`, `POLES`).
- **다른 장면 파일:** `CG_SCENE=my_scene.json uv run main.py`, 웹은 `?scene=my_scene.json`. 팩 폴더 기준 경로입니다.
- 캐릭터는 `mini-characters/character-*.glb` 20명 중에서, 강아지 자리에는 `cube-pets/animal-*.glb` 24종 중 아무거나 넣을 수 있습니다(애니메이션 이름이 같습니다).

## 5. 코드 구조

### `python/`

| 파일 | 내용 |
|---|---|
| `main.py` | 창, 입력, 게임 루프 |
| `gltf.py` | GLB 파서, 노드 계층, skin, 애니메이션 샘플링과 cross-fade (GL 코드 없음) |
| `renderer.py` | OpenGL 3.3 core: VAO 업로드, 셰이더, shadow map, AABB 선 그리기 |
| `scene.py` | `scene.json` 읽기, `Instance`(위치, 회전, 크기, AABB), collider 만들기, 코드로 만든 바닥과 공 |
| `physics.py` | 충돌(원 밀어내기), 공 물리, 마우스 ray와 AABB, 땅 교차 |
| `minimap.py` | 미니맵: 두 번째 카메라, viewport와 scissor, 아이콘, 지도 클릭 |
| `sound.py` | 효과음: pygame.mixer, 거리 감쇠, 좌우 패닝, 녹화용 믹스 |
| `camera.py` | perspective, look-at, ortho 행렬과 3인칭 카메라 |
| `actors.py` | `Player`, `Dog` (상태 기계) |

### `web/`

| 파일 | 내용 |
|---|---|
| `index.html` | import map(three.js 0.170.0), 화면 안내 |
| `main.js` | 렌더러, 조명, HDRI, 모델 배치, 카메라, 입력, picking, 루프 |
| `actors.js` | `Animator`(AnimationMixer 감싸기), `Player`, `Dog` |
| `physics.js` | `physics.py`와 같은 충돌, 공, picking |
| `minimap.js` | `minimap.py`와 같은 미니맵. 아이콘은 layer 1에 두어 미니맵 카메라만 그림 |
| `sound.js` | `sound.py`와 같은 효과음. `THREE.AudioListener`, `THREE.PositionalAudio`. 브라우저는 첫 클릭이나 키 입력 뒤에 소리를 켭니다 |

### 시연 각본 `docs/demo.json`

시간별 동작 목록입니다. 두 트랙 모두 이 각본을 재생할 수 있습니다. 같은 입력에 대한 결과를 비교하거나 시연 영상을 만들 때 씁니다.

- Python: `CG_DEMO=../docs/demo.json uv run main.py` (Windows PowerShell은 `$env:CG_DEMO="../docs/demo.json"; uv run main.py`). `CG_REC=demo.mp4`를 더하면 ffmpeg로 영상을 저장합니다.
- three.js: http://localhost:8000/web/?demo=../docs/demo.json

## 6. 확장 아이디어 (수업 내용과 연결)

| 주제 | 해 볼 만한 것 |
|---|---|
| 텍스처 (W99 Texture Mapping) | `assets/textures`의 PBR 세트로 바닥에 albedo, normal, roughness 입히기. tangent space normal map 직접 구현 |
| 조명과 재질 (W12) | 낮과 밤 전환, 가로등 point light 여러 개, HDRI 바꾸기, cascaded shadow map |
| 가시성과 BVH (W10, W11) | AABB로 view frustum culling, 마우스 클릭 picking(ray와 AABB 교차), BVH로 가속 |
| 게임 패턴 (W13) | 강아지 여러 마리, 쓰다듬기(근접 트리거), 겁 많은 고양이(같은 상태 기계로 반대 행동), 꽃 모으기와 점수, 저장과 불러오기 |
| CSG와 SDF (W14) | SDF로 만든 오브젝트를 장면에 섞기, 레이마칭 하늘이나 물 |
| 애니메이션 | 발이 땅에 맞는 걸음(속도와 동작 재생 속도 맞추기), 점프와 중력, 자동차 운전(`drive` 동작, 바퀴 노드 회전) |
| 충돌과 길 찾기 | 회전된 물체의 OBB 충돌, 공과 캐릭터의 충돌, 클릭 이동에 A* 길 찾기(지금은 직선으로 가다 막히면 멈춤) |
| 소리 | 배경 소리(새, 바람, 차 소리)를 구역별로, 강아지 발소리, 소리가 벽에 가려지면 작아지기(ray로 가림 검사), 도플러 효과 |
| 미니맵 | 카메라 방향으로 돌아가는 지도, 원형 마스크, 확대와 축소, 지나간 길 표시, 안개 낀 미탐험 지역 |
| 선택 | AABB 대신 삼각형 단위 ray 교차(정확한 picking), 선택한 물체 드래그로 옮기기, 장면 편집기 |

## 7. 알아 둘 점

- **Python 트랙 성능:** 물체가 아주 많아지면 Python의 draw call 비용이 커집니다. 같은 모델을 많이 쓰면 instancing(`glDrawElementsInstanced`)을 해 보세요. GL 오류를 추적할 때는 `main.py` 위쪽의 `OpenGL.ERROR_CHECKING`을 `True`로 바꾸세요(대신 느려집니다).
- **Python 트랙 재질:** base color만 씁니다. normal, roughness 맵은 확장 과제로 남겨 두었습니다.
- **three.js 트랙:** 같은 skinned 캐릭터를 여러 번 배치할 때는 `SkeletonUtils.clone`을 써야 합니다(예제 `place()`가 이미 그렇게 합니다).
- **에셋 라이선스:** `ASSETS.md`를 보세요. 코드로 만든 던지기 소리 두 개(earshot, MIT)를 빼면 모두 CC0입니다.
