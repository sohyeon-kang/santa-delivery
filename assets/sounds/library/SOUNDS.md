# 효과음 라이브러리

총 489개.
게임에 쓰지 않은 효과음까지 원본 그대로 모아 둔 곳입니다. 모두 **CC0**입니다. 각 폴더에 원본 `License.txt`가 있습니다.

쓰는 법: `sounds.json`에 역할을 하나 추가하고 파일을 `assets/sounds/` 기준 경로로 적습니다(예: `"coin": { "files": ["library/kenney-rpg-audio/handleCoins.ogg"], "gain": 0.5 }`). 그다음 코드의 이벤트에서 `sound.play("coin", 위치)`를 부르면 됩니다. 파일 이름이 소리 종류를 말해 줍니다(예: `impactWood_heavy_002`).

형식은 Ogg Vorbis입니다. pygame과 대부분의 브라우저에서 재생됩니다. 재생되지 않는 브라우저가 있으면 ffmpeg로 바꾸세요: `ffmpeg -i in.ogg out.wav`

## `kenney-digital-audio/` (62개)

Kenney Digital Audio, https://kenney.nl/assets/digital-audio

레이저, 파워업, 점프, 전자음, 우주 효과음 (아케이드 느낌)

`highDown` 1, `highUp` 1, `laser` 9, `lowDown` 1, `lowRandom` 1, `lowThreeTone` 1, `pepSound` 5, `phaseJump` 5, `phaserDown` 3, `phaserUp` 7, `powerUp` 12, `spaceTrash` 5, `threeTone` 2, `tone` 1, `twoTone` 2, `zap` 2, `zapThreeToneDown` 1, `zapThreeToneUp` 1, `zapTwoTone` 2

## `kenney-impact-sounds/` (130개)

Kenney Impact Sounds, https://kenney.nl/assets/impact-sounds

발소리(잔디, 콘크리트, 나무, 눈, 카펫), 충돌음(나무, 금속, 유리, 판자, 종, 주먹, 부드러운 것)

`footstep_carpet` 5, `footstep_concrete` 5, `footstep_grass` 5, `footstep_snow` 5, `footstep_wood` 5, `impactBell_heavy` 5, `impactGeneric_light` 5, `impactGlass_heavy` 5, `impactGlass_light` 5, `impactGlass_medium` 5, `impactMetal_heavy` 5, `impactMetal_light` 5, `impactMetal_medium` 5, `impactMining` 5, `impactPlank_medium` 5, `impactPlate_heavy` 5, `impactPlate_light` 5, `impactPlate_medium` 5, `impactPunch_heavy` 5, `impactPunch_medium` 5, `impactSoft_heavy` 5, `impactSoft_medium` 5, `impactTin_medium` 5, `impactWood_heavy` 5, `impactWood_light` 5, `impactWood_medium` 5

## `kenney-interface-sounds/` (100개)

Kenney Interface Sounds, https://kenney.nl/assets/interface-sounds

클릭, 선택, 확인, 오류, 토글, 열기와 닫기, 창 크기 바꾸기, 스크롤

`back` 4, `bong` 1, `click` 5, `close` 4, `confirmation` 4, `drop` 4, `error` 8, `glass` 6, `glitch` 4, `maximize` 9, `minimize` 9, `open` 4, `pluck` 2, `question` 4, `scratch` 5, `scroll` 5, `select` 8, `switch` 7, `tick` 3, `toggle` 4

## `kenney-music-jingles/` (85개)

Kenney Music Jingles, https://kenney.nl/assets/music-jingles

짧은 음악 신호: 8bit, hit, pizzicato, sax, steel 다섯 가지 악기로 승리, 실패, 시작 같은 징글

`8bit/jingles_NES` 17, `hit/jingles_HIT` 17, `pizzicato/jingles_PIZZI` 17, `sax/jingles_SAX` 17, `steel/jingles_STEEL` 17

## `kenney-rpg-audio/` (51개)

Kenney RPG Audio, https://kenney.nl/assets/rpg-audio

문, 책, 동전, 천, 칼 뽑기, 손잡이, 금속 냄비, 발소리

`beltHandle` 2, `bookClose` 1, `bookFlip` 3, `bookOpen` 1, `bookPlace` 3, `chop` 1, `cloth` 4, `clothBelt` 2, `creak` 3, `doorClose` 4, `doorOpen` 2, `drawKnife` 3, `dropLeather` 1, `footstep` 10, `handleCoins` 2, `handleSmallLeather` 2, `knifeSlice` 2, `metalClick` 1, `metalLatch` 1, `metalPot` 3

## `kenney-ui-audio/` (51개)

Kenney UI Audio, https://kenney.nl/assets/ui-audio

스위치, 클릭, 마우스 오버, 롤오버

`click` 5, `mouseclick` 1, `mouserelease` 1, `rollover` 6, `switch` 38

## `opengameart-dog-sounds/` (10개)

OpenGameArt dog sounds (pauliuw), dog barking mono (HaelDB), https://opengameart.org/content/dog-sounds

짖기, 으르렁, 낑낑 (집에서 녹음, 잡음이 조금 있음)

`dog` 3, `dog_bark` 4, `dog_barking_mono` 1, `sad_dog` 2
