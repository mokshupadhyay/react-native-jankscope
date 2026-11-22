| platform | run | scenario | expected | primary | match | frames | janky % | hitch ms/s | hitch share js / mount / other / render / unknown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| android | 1 | idle | none | render-gpu | NO | 343 | 5.5 | 33.2 | 30 / 0 / 6 / 64 / 0 |
| android | 1 | js-blocked | js | js | yes | 349 | 28.4 | 234.4 | 94 / 0 / 0 / 6 / 0 |
| android | 1 | main-blocked | ui-other | ui-other | yes | 265 | 8.7 | 240.5 | 5 / 0 / 93 / 2 / 0 |
| android | 1 | rerender-storm | - | js |  | 327 | 40.1 | 257.1 | 86 / 9 / 2 / 3 / 0 |
| android | 1 | heavy-mount | ui-mount | js | NO | 278 | 25.9 | 383.8 | 57 / 10 / 30 / 4 / 0 |
| android | 1 | many-animated | - | js |  | 274 | 43.1 | 180.7 | 52 / 5 / 37 / 6 / 0 |
| android | 1 | heavy-mount-styled | - | ui-other |  | 198 | 40.9 | 704.1 | 25 / 0 / 74 / 0 / 0 |
| android | 2 | idle | none | render-gpu | NO | 353 | 2.5 | 2.1 | 0 / 0 / 0 / 100 / 0 |
| android | 2 | js-blocked | js | js | yes | 349 | 23.5 | 210.9 | 89 / 0 / 1 / 10 / 0 |
| android | 2 | main-blocked | ui-other | ui-other | yes | 253 | 12.3 | 246.5 | 4 / 0 / 89 / 7 / 0 |
| android | 2 | rerender-storm | - | js |  | 288 | 53.5 | 331.3 | 73 / 8 / 3 / 17 / 0 |
| android | 2 | heavy-mount | ui-mount | js | NO | 281 | 23.1 | 308.6 | 45 / 9 / 40 / 6 / 0 |
| android | 2 | many-animated | - | js |  | 283 | 39.6 | 192.2 | 65 / 4 / 15 / 16 / 0 |
| android | 2 | heavy-mount-styled | - | ui-other |  | 202 | 45.5 | 824.8 | 49 / 1 / 50 / 1 / 0 |
| android | 3 | idle | none | js | NO | 351 | 3.4 | 17.7 | 57 / 0 / 2 / 41 / 0 |
| android | 3 | js-blocked | js | js | yes | 350 | 22.9 | 194.2 | 96 / 0 / 1 / 2 / 0 |
| android | 3 | main-blocked | ui-other | ui-other | yes | 266 | 7.5 | 239.5 | 7 / 0 / 92 / 1 / 0 |
| android | 3 | rerender-storm | - | js |  | 325 | 45.2 | 306.1 | 88 / 6 / 0 / 6 / 0 |
| android | 3 | heavy-mount | ui-mount | js | NO | 296 | 20.9 | 289.8 | 54 / 0 / 44 / 1 / 0 |
| android | 3 | many-animated | - | js |  | 295 | 36.6 | 176.9 | 69 / 6 / 16 / 9 / 0 |
| android | 3 | heavy-mount-styled | - | ui-other |  | 181 | 38.7 | 653.1 | 27 / 0 / 72 / 1 / 0 |
| ios | 1 | idle | none | none | yes | 361 | 0.0 | 0.0 | 0 / 0 / 0 / 0 / 0 |
| ios | 1 | js-blocked | js | js | yes | 361 | 23.5 | 234.8 | 100 / 0 / 0 / 0 / 0 |
| ios | 1 | main-blocked | ui-other | ui-other | yes | 272 | 1.8 | 247.6 | 0 / 0 / 100 / 0 / 0 |
| ios | 1 | rerender-storm | - | none |  | 361 | 0.0 | 0.0 | 0 / 0 / 0 / 0 / 0 |
| ios | 1 | heavy-mount | ui-mount | ui-mount | yes | 320 | 3.4 | 140.1 | 0 / 96 / 0 / 4 / 0 |
| ios | 1 | many-animated | - | js |  | 360 | 1.4 | 15.6 | 52 / 0 / 48 / 0 / 0 |
| ios | 1 | heavy-mount-styled | - | ui-mount |  | 215 | 6.5 | 528.0 | 3 / 97 / 0 / 0 / 0 |
| ios | 2 | idle | none | none | yes | 361 | 0.0 | 0.0 | 0 / 0 / 0 / 0 / 0 |
| ios | 2 | js-blocked | js | js | yes | 361 | 23.3 | 232.0 | 100 / 0 / 0 / 0 / 0 |
| ios | 2 | main-blocked | ui-other | ui-other | yes | 272 | 1.8 | 247.4 | 0 / 0 / 100 / 0 / 0 |
| ios | 2 | rerender-storm | - | none |  | 361 | 0.0 | 0.0 | 0 / 0 / 0 / 0 / 0 |
| ios | 2 | heavy-mount | ui-mount | ui-mount | yes | 319 | 3.4 | 144.3 | 0 / 96 / 0 / 4 / 0 |
| ios | 2 | many-animated | - | js |  | 361 | 1.4 | 15.5 | 70 / 0 / 30 / 0 / 0 |
| ios | 2 | heavy-mount-styled | - | ui-mount |  | 215 | 6.5 | 529.0 | 2 / 97 / 0 / 0 / 0 |
| ios | 3 | idle | none | none | yes | 361 | 0.0 | 0.0 | 0 / 0 / 0 / 0 / 0 |
| ios | 3 | js-blocked | js | js | yes | 360 | 22.8 | 227.2 | 100 / 0 / 0 / 0 / 0 |
| ios | 3 | main-blocked | ui-other | ui-other | yes | 270 | 1.9 | 251.1 | 0 / 0 / 100 / 0 / 0 |
| ios | 3 | rerender-storm | - | none |  | 360 | 0.0 | 0.0 | 0 / 0 / 0 / 0 / 0 |
| ios | 3 | heavy-mount | ui-mount | ui-mount | yes | 320 | 3.1 | 139.1 | 0 / 97 / 0 / 3 / 0 |
| ios | 3 | many-animated | - | js |  | 361 | 1.4 | 15.0 | 73 / 0 / 27 / 0 / 0 |
| ios | 3 | heavy-mount-styled | - | ui-mount |  | 221 | 6.3 | 510.3 | 3 / 97 / 0 / 0 / 0 |

| platform | run | device | build | arch | UI-thread ms/frame | FrameMetrics thread ms/frame | heartbeat JS ms/s | heartbeat lateness p50 / p95 ms | overlay JS ms/update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| android | 1 | sdk_gphone64_arm64 (17 (API 37)) | release | new | 0.0102 | 0.0176 | 2.3364 | 34.648 / 92.307 | 3.3647 (52 updates) |
| android | 2 | sdk_gphone64_arm64 (17 (API 37)) | release | new | 0.0102 | 0.0183 | 3.0196 | 34.798 / 106.95 | 3.1783 (51 updates) |
| android | 3 | sdk_gphone64_arm64 (17 (API 37)) | release | new | 0.0148 | 0.0157 | 2.9337 | 34.391 / 80.083 | 2.3824 (51 updates) |
| ios | 1 | iPhone18,1 (Simulator) (26.2) | release | new | 0.0018 | - | 2.0175 | 0.67 / 9.645 | 0.4241 (52 updates) |
| ios | 2 | iPhone18,1 (Simulator) (26.2) | release | new | 0.0015 | - | 2.0145 | 0.669 / 6.241 | 0.4112 (52 updates) |
| ios | 3 | iPhone18,1 (Simulator) (26.2) | release | new | 0.0015 | - | 2.0954 | 0.668 / 1.202 | 0.3982 (52 updates) |
