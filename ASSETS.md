# 에셋 목록과 라이선스

이 팩의 에셋은 던지기 소리 두 개(아래 효과음 표 참고)를 빼면 모두 **CC0 (Creative Commons Zero, public domain)** 입니다.
출처 표기 없이 수정하고, 공개하고, 상업적으로도 쓸 수 있습니다.
그래도 보고서와 발표 자료에 출처를 적어 주면 좋습니다.

## 3D 모델 (Kenney, kenney.nl)

| 폴더 | 키트 (버전) | 개수 | 내용 | 받은 곳 |
|---|---|---:|---|---|
| `assets/models/mini-characters` | Mini Characters (2.0) | 43 | 캐릭터 20명(skinned, 애니메이션 32개), 무기, 방패, 보조기구 | https://kenney.nl/assets/mini-characters |
| `assets/models/cube-pets` | Cube Pets (2.0) | 24 | 동물 24종(부위별 rigid 애니메이션 8개: idle, walk, run, eat, dance, gesture 등) | https://kenney.nl/assets/cube-pets |
| `assets/models/city-kit-suburban` | City Kit Suburban (2.0) | 40 | 주택 21종, 진입로, 울타리, 길, 나무 | https://kenney.nl/assets/city-kit-suburban |
| `assets/models/car-kit` | Car Kit (3.1) | 50 | 승용차, 트럭, 카트, 바퀴, 부서진 부품 | https://kenney.nl/assets/car-kit |
| `assets/models/nature-kit` | Nature Kit (2.1) | 329 | 나무, 바위, 꽃, 절벽, 다리, 텐트, 캠프파이어 | https://kenney.nl/assets/nature-kit |
| `assets/models/city-kit-roads` | City Kit Roads (2.2) | 95 | 도로 타일(직선, 교차로, 횡단보도, 곡선, 다리), 가로등, 신호등, 표지판, 전봇대 | https://kenney.nl/assets/city-kit-roads |
| `assets/models/city-kit-commercial` | City Kit Commercial (2.1) | 41 | 상가 건물, 고층 빌딩, 차양, 파라솔 | https://kenney.nl/assets/city-kit-commercial |

- 키트마다 `Preview.png`(전체 미리보기)와 원본 `License.txt`가 들어 있습니다.
- 원본 키트에는 FBX, OBJ 형식도 있습니다. 이 팩에는 GLB만 넣었습니다.
- **Nature Kit 보정:** 원본 GLB는 색 값(baseColorFactor)을 sRGB로 저장하고 metallic을 1로 두어 glTF 규격과 맞지 않습니다. 그대로 쓰면 three.js에서 금속처럼 어둡게 보입니다. 이 팩의 파일은 색 값을 linear로 바꾸고 metallic을 0으로 고친 것입니다. 각 파일의 `asset.extras.p3_fixed`에 그 기록이 있습니다.
- **크기 단위가 키트마다 다릅니다.** 도로와 상가 키트는 타일 한 장이 1 단위라 배율 8(타일 8 m)을 씁니다. `scene.json`의 `kitScale`이 키트별 기본 배율입니다(캐릭터 키 약 1.7 m 기준).

## 효과음 (`assets/sounds`)

모두 mono 44.1 kHz WAV이고, 피크를 -3 dBFS로 맞추고 앞쪽 무음을 잘랐습니다. 역할별 파일과 음량은 `sounds.json`입니다.

| 파일 | 역할 | 원본 | 라이선스 |
|---|---|---|---|
| `step_grass_0..4.wav` | 잔디 위 발소리 | Kenney Impact Sounds `footstep_grass_000..004` (https://kenney.nl/assets/impact-sounds) | CC0 |
| `step_hard_0..2.wav` | 포장도로 발소리 | Kenney Impact Sounds `footstep_concrete_001..003` | CC0 |
| `bounce_0..4.wav` | 공이 땅에 튐 | Kenney Impact Sounds `impactGeneric_light_000..004` | CC0 |
| `wall_0..1.wav` | 공이 벽에 부딪힘 | Kenney Impact Sounds `impactSoft_medium_000..001` | CC0 |
| `select_0.wav` | 물체 선택 | Kenney Interface Sounds `tick_001` (https://kenney.nl/assets/interface-sounds) | CC0 |
| `move_0.wav` | 클릭 이동 | Kenney Interface Sounds `toggle_001` | CC0 |
| `bark_0..1.wav` | 강아지 짖기 | OpenGameArt "dog barking mono" by HaelDB, 0.49-0.80 s와 1.65-2.03 s 구간 (https://opengameart.org/content/dog-barking-mono) | CC0 (OGA-BY 3.0과 이중 라이선스, CC0 쪽을 따름) |
| `throw_0..1.wav` | 공 던지기 | earshot 0.4.1 소리 은행 `swish/cane`, `swish/stick`을 코드로 렌더링 (https://github.com/Leonxlnx/earshot) | earshot 코드는 MIT. 녹음이 아니라 코드로 만든 소리 |

소리는 earshot(소리를 직접 들을 수 없는 AI용 분석 도구)으로 후보를 비교해 골랐습니다. 예: 짖기 구간은 "a dog barking" 일치도 z 3.4와 3.9, 던지기는 "a fast whoosh" z 5.0. 아주 짧은 소리(발소리, 클릭)는 분류 모델이 잘 구별하지 못해 Kenney 원래 분류를 따랐습니다.

### 효과음 라이브러리 (`assets/sounds/library`, 489개, 모두 CC0)

게임에서 쓰지 않는 소리까지 원본 그대로 넣었습니다. 목록과 쓰는 법은 `assets/sounds/library/SOUNDS.md`.

| 폴더 | 원본 | 개수 |
|---|---|---:|
| `kenney-impact-sounds` | Kenney Impact Sounds, https://kenney.nl/assets/impact-sounds | 130 |
| `kenney-interface-sounds` | Kenney Interface Sounds, https://kenney.nl/assets/interface-sounds | 100 |
| `kenney-music-jingles` | Kenney Music Jingles, https://kenney.nl/assets/music-jingles | 85 |
| `kenney-digital-audio` | Kenney Digital Audio, https://kenney.nl/assets/digital-audio | 62 |
| `kenney-rpg-audio` | Kenney RPG Audio, https://kenney.nl/assets/rpg-audio | 51 |
| `kenney-ui-audio` | Kenney UI Audio, https://kenney.nl/assets/ui-audio | 51 |
| `opengameart-dog-sounds` | OpenGameArt "dog sounds" (pauliuw), "dog barking mono" (HaelDB) | 10 |

## HDRI (Poly Haven, polyhaven.com)

| 파일 | 내용 | 받은 곳 |
|---|---|---|
| `assets/hdri/kloofendal_48d_partly_cloudy_puresky_1k.hdr` | 맑은 하늘 (web 트랙 기본 환경광) | https://polyhaven.com/a/kloofendal_48d_partly_cloudy_puresky |
| `assets/hdri/venice_sunset_1k.hdr` | 해 질 녘 | https://polyhaven.com/a/venice_sunset |
| `assets/hdri/studio_small_09_1k.hdr` | 작은 스튜디오 | https://polyhaven.com/a/studio_small_09 |

## PBR 텍스처 (ambientCG, ambientcg.com)

각 폴더에 Color, NormalGL(OpenGL 방향 normal map), Roughness, AmbientOcclusion 네 장이 있습니다(1K JPG).

| 폴더 | 받은 곳 |
|---|---|
| `assets/textures/Grass001` | https://ambientcg.com/view?id=Grass001 |
| `assets/textures/PavingStones070` | https://ambientcg.com/view?id=PavingStones070 |
| `assets/textures/Planks021` | https://ambientcg.com/view?id=Planks021 |
| `assets/textures/Bricks090` | https://ambientcg.com/view?id=Bricks090 |

## 에셋을 더 쓰고 싶다면

- Kenney에는 이 밖에도 CC0 3D 키트가 많습니다(가구, 우주, 성, 음식, 플랫포머 등). 같은 스타일이라 섞어 쓰기 좋습니다.
- 다른 곳의 에셋을 쓸 때는 라이선스를 확인하고 보고서에 출처를 적으세요. CC-BY는 출처 표기가 필수입니다.
