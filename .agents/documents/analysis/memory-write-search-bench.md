# Memory Write+Search Benchmark — TASK-478

- Task: TASK-478
- Seed: 0x478
- Commit: 77508e5c5c81dabd5929a4fb4500cda1cae91b0d
- Node: v24.18.0
- better-sqlite3: 12.9.0
- SQLite: 3.53.0
- Page size: 4096
- Owner/Repo: bench / bench-repo
- Scales: 1000, 10000, 100000
- Iterations: 30
- Vector backend: stub (TF cosine, no ONNX)
- Date: 2026-08-22T11:14:25.207Z

## Write Latency (per insert)

| Scale | p50 (ms) | p95 (ms) | p99 (ms) | Mean (ms) | Throughput | Errors |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | 0.117 | 0.436 | 1.551 | 0.202 | 4120.9 ops/s | 0/1000 |
| 10000 | 0.128 | 0.359 | 1.037 | 0.226 | 4249.8 ops/s | 0/10000 |
| 100000 | 0.168 | 0.423 | 0.954 | 0.238 | 4079.1 ops/s | 0/100000 |

## Search Latency (per query)

| Scale | Mode | p50 (ms) | p95 (ms) | p99 (ms) | Throughput | Errors | Avg results |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1000 | fts | 0.766 | 2.439 | 7.609 | 876.3 ops/s | 0/720 | 7.1 |
| 1000 | semantic | 3.144 | 8.012 | 15.973 | 247.3 ops/s | 0/720 | 10.0 |
| 1000 | hybrid | 13.391 | 35.360 | 52.530 | 61.3 ops/s | 0/720 | 4.2 |
| 10000 | fts | 4.358 | 21.266 | 32.282 | 160.2 ops/s | 0/720 | 7.1 |
| 10000 | semantic | 9.254 | 24.878 | 42.405 | 88.0 ops/s | 0/720 | 10.0 |
| 10000 | hybrid | 31.287 | 71.888 | 92.244 | 27.5 ops/s | 0/720 | 4.7 |
| 100000 | fts | 52.792 | 201.716 | 257.803 | 16.8 ops/s | 0/720 | 7.1 |
| 100000 | semantic | 72.450 | 112.470 | 167.923 | 12.7 ops/s | 0/720 | 10.0 |
| 100000 | hybrid | 196.580 | 521.564 | 650.630 | 4.6 ops/s | 0/720 | 5.6 |

## Query Breakdown (hybrid, per-kind)

| Scale | Kind | Query | p50 (ms) | p95 (ms) | Avg results | Errors |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 1000 | empty | `(empty)` | 8.523 | 17.719 | 1.0 | 0 |
| 1000 | empty | `   ` | 9.384 | 27.523 | 1.0 | 0 |
| 1000 | short | `go` | 12.128 | 19.097 | 10.0 | 0 |
| 1000 | short | `ui` | 15.323 | 31.167 | 7.0 | 0 |
| 1000 | short | `id` | 15.479 | 47.802 | 4.0 | 0 |
| 1000 | short | `e` | 15.039 | 46.997 | 2.0 | 0 |
| 1000 | short | `AI` | 9.244 | 33.421 | 1.0 | 0 |
| 1000 | normal | `vector` | 15.742 | 36.974 | 10.0 | 0 |
| 1000 | normal | `memory` | 18.326 | 23.542 | 10.0 | 0 |
| 1000 | normal | `sqlite` | 13.897 | 248.967 | 4.0 | 0 |
| 1000 | normal | `cache` | 15.537 | 164.564 | 8.0 | 0 |
| 1000 | normal | `search index` | 12.211 | 16.084 | 5.0 | 0 |
| 1000 | long | `vector embedding semantic search hybrid scoring ` | 10.747 | 15.802 | 1.0 | 0 |
| 1000 | long | `workspace memory is indexed for fast semantic se` | 15.205 | 90.980 | 4.0 | 0 |
| 1000 | high-result | `memory` | 20.253 | 86.238 | 10.0 | 0 |
| 1000 | high-result | `vector` | 28.870 | 75.412 | 10.0 | 0 |
| 1000 | high-result | `search` | 13.970 | 136.211 | 2.0 | 0 |
| 1000 | no-result | `zz_nonexistent_token_xyz_999` | 9.662 | 12.775 | 1.0 | 0 |
| 1000 | no-result | `qqq_zzz_no_match_12345` | 9.416 | 16.602 | 1.0 | 0 |
| 1000 | phrase | `"semantic search"` | 11.776 | 112.647 | 4.0 | 0 |
| 1000 | cjk | `记忆` | 12.351 | 31.795 | 1.0 | 0 |
| 1000 | cjk | `向量` | 9.532 | 17.111 | 1.0 | 0 |
| 1000 | special | `data-pipeline` | 12.148 | 23.638 | 2.0 | 0 |
| 1000 | special | `better-sqlite3` | 11.608 | 15.656 | 1.0 | 0 |
| 10000 | empty | `(empty)` | 14.871 | 16.577 | 1.0 | 0 |
| 10000 | empty | `   ` | 15.446 | 29.580 | 1.0 | 0 |
| 10000 | short | `go` | 33.702 | 68.871 | 10.0 | 0 |
| 10000 | short | `ui` | 33.141 | 56.227 | 10.0 | 0 |
| 10000 | short | `id` | 30.549 | 51.750 | 10.0 | 0 |
| 10000 | short | `e` | 35.178 | 41.512 | 3.0 | 0 |
| 10000 | short | `AI` | 16.026 | 47.627 | 1.0 | 0 |
| 10000 | normal | `vector` | 47.987 | 84.254 | 10.0 | 0 |
| 10000 | normal | `memory` | 72.668 | 150.156 | 7.0 | 0 |
| 10000 | normal | `sqlite` | 42.734 | 63.808 | 4.0 | 0 |
| 10000 | normal | `cache` | 43.446 | 64.859 | 3.0 | 0 |
| 10000 | normal | `search index` | 38.970 | 69.687 | 1.0 | 0 |
| 10000 | long | `vector embedding semantic search hybrid scoring ` | 19.099 | 63.776 | 1.0 | 0 |
| 10000 | long | `workspace memory is indexed for fast semantic se` | 34.888 | 65.883 | 7.0 | 0 |
| 10000 | high-result | `memory` | 70.239 | 92.067 | 7.0 | 0 |
| 10000 | high-result | `vector` | 46.681 | 81.564 | 10.0 | 0 |
| 10000 | high-result | `search` | 42.817 | 191.495 | 6.0 | 0 |
| 10000 | no-result | `zz_nonexistent_token_xyz_999` | 16.811 | 55.830 | 1.0 | 0 |
| 10000 | no-result | `qqq_zzz_no_match_12345` | 16.196 | 19.039 | 1.0 | 0 |
| 10000 | phrase | `"semantic search"` | 22.478 | 83.439 | 10.0 | 0 |
| 10000 | cjk | `记忆` | 30.657 | 43.233 | 5.0 | 0 |
| 10000 | cjk | `向量` | 16.533 | 25.835 | 1.0 | 0 |
| 10000 | special | `data-pipeline` | 22.662 | 39.740 | 1.0 | 0 |
| 10000 | special | `better-sqlite3` | 26.524 | 67.094 | 1.0 | 0 |
| 100000 | empty | `(empty)` | 82.428 | 114.396 | 1.0 | 0 |
| 100000 | empty | `   ` | 81.654 | 93.554 | 1.0 | 0 |
| 100000 | short | `go` | 200.224 | 284.392 | 10.0 | 0 |
| 100000 | short | `ui` | 208.065 | 270.012 | 10.0 | 0 |
| 100000 | short | `id` | 235.591 | 436.176 | 10.0 | 0 |
| 100000 | short | `e` | 297.307 | 402.787 | 10.0 | 0 |
| 100000 | short | `AI` | 104.645 | 179.071 | 1.0 | 0 |
| 100000 | normal | `vector` | 303.985 | 384.197 | 10.0 | 0 |
| 100000 | normal | `memory` | 514.041 | 608.641 | 5.0 | 0 |
| 100000 | normal | `sqlite` | 237.192 | 353.351 | 7.0 | 0 |
| 100000 | normal | `cache` | 290.351 | 401.053 | 10.0 | 0 |
| 100000 | normal | `search index` | 173.487 | 278.795 | 4.0 | 0 |
| 100000 | long | `vector embedding semantic search hybrid scoring ` | 89.192 | 105.051 | 1.0 | 0 |
| 100000 | long | `workspace memory is indexed for fast semantic se` | 196.615 | 246.877 | 2.0 | 0 |
| 100000 | high-result | `memory` | 460.493 | 564.758 | 5.0 | 0 |
| 100000 | high-result | `vector` | 311.644 | 516.306 | 10.0 | 0 |
| 100000 | high-result | `search` | 247.064 | 361.949 | 10.0 | 0 |
| 100000 | no-result | `zz_nonexistent_token_xyz_999` | 77.135 | 110.110 | 1.0 | 0 |
| 100000 | no-result | `qqq_zzz_no_match_12345` | 83.321 | 105.855 | 1.0 | 0 |
| 100000 | phrase | `"semantic search"` | 127.692 | 177.091 | 9.0 | 0 |
| 100000 | cjk | `记忆` | 196.895 | 269.409 | 10.0 | 0 |
| 100000 | cjk | `向量` | 81.823 | 108.985 | 1.0 | 0 |
| 100000 | special | `data-pipeline` | 102.261 | 153.898 | 5.0 | 0 |
| 100000 | special | `better-sqlite3` | 107.516 | 189.635 | 1.0 | 0 |

## Environment

| Key | Value |
| --- | --- |
| commitSha | 77508e5c5c81dabd5929a4fb4500cda1cae91b0d |
| node | v24.18.0 |
| better-sqlite3 | 12.9.0 |
| sqliteVersion | 3.53.0 |
| pageSize | 4096 |
| heapUsed (last scale) | 225588512 |
| dbBytes (last scale) | 117080064 |

