# Router v7 · 124 条复核表 (2026-04-20)

- 模型: `Qwen3-4B-Q4_K_M.gguf` · 端点: `http://127.0.0.1:8200/v1/chat/completions`
- 准确率: **121/124 (97.6%)**
- 延迟 ms: min=402 p50=1263 avg=1229 p95=1680 max=3057

> 复核列说明：如果模型输出与你心目中的真实意图一致，留空或 ✓。不一致就在「真实意图」列写下你希望的 intent/skill/slots，我会据此调 prompt 或接受新的期望值。

| # | 句子 | 模型 intent | 模型 skill | 模型 slots | 延迟 ms | 我的预期 | 判定 | 真实意图（你填） |
|---|------|-------------|------------|-----------|--------:|---------|:----:|-----------------|
| 1 | 今天天气真好啊 | chat | — | — | 1080 | chat | ✓ | |
| 2 | 你觉得人为什么会焦虑 | chat | — | — | 492 | chat | ✓ | |
| 3 | 讲个冷笑话听听 | chat | — | — | 1143 | chat | ✓ | |
| 4 | 我饿了 | chat | — | — | 886 | chat | ✓ | |
| 5 | 什么是量子纠缠 | chat | — | — | 3057 | chat | ✓ | |
| 6 | 帮我想个周末计划 | chat | — | — | 1419 | chat | ✓ | |
| 7 | 最近睡眠不太好，有什么建议 | chat | — | — | 495 | chat | ✓ | |
| 8 | 这首歌挺好听的 | chat | — | — | 492 | chat | ✓ | |
| 9 | 放首歌 | action | play_music | query:"", shuffle:true | 1455 | action/play_music | ✓ | |
| 10 | 播放周杰伦的夜曲 | action | play_music | query:"夜曲", shuffle:true | 1512 | action/play_music | ✓ | |
| 11 | 暂停 | action | music_control | action:"pause" | 1335 | action/music_control {action:"pause"} | ✓ | |
| 12 | 继续播放 | action | music_control | action:"shuffle", value:true | 1491 | action/music_control {action:"pause"} (slot.action=shuffle want=pause) | ✗ | |
| 13 | 循环播放 | action | music_control | action:"repeat", value:"all" | 1543 | action/music_control {action:"repeat"} | ✓ | |
| 14 | 放第三首 | action | play_music | query:"第三首", shuffle:true | 1545 | action/play_music | ✓ | |
| 15 | 随便放点轻音乐 | action | play_music | query:"轻音乐", shuffle:true | 1521 | action/play_music | ✓ | |
| 16 | 声音大一点 | action | music_control | action:"volume", value:80 | 1576 | action/music_control {action:"volume"} · alt:unclear | ✓ | |
| 17 | 开灯 | action | smart_device | action:"on", device:"灯" | 1552 | action/smart_device {action:"on"} | ✓ | |
| 18 | 关掉客厅的灯 | action | smart_device | action:"off", device:"客厅 灯" | 1636 | action/smart_device {action:"off"} | ✓ | |
| 19 | 把卧室灯调暗一点 | chat | — | — | 802 | chat · alt:unclear | ✓ | |
| 20 | 开空气净化器 | action | smart_device | action:"on", device:"空气净化器" | 1603 | action/smart_device {action:"on"} | ✓ | |
| 21 | 把灯光调到暖色 | chat | — | — | 930 | chat · alt:unclear | ✓ | |
| 22 | 关掉所有灯 | action | smart_device | action:"off", device:"所有 灯" | 1642 | action/smart_device {action:"off"} | ✓ | |
| 23 | 把风扇关掉 | action | smart_device | action:"off", device:"风扇" | 1560 | action/smart_device {action:"off"} | ✓ | |
| 24 | 我心情不好，想听首歌 | action | play_music | query:"一首歌", shuffle:true | 1528 | action/play_music · alt:chat | ✓ | |
| 25 | 好烦，把它关了吧 | unclear | — | — | 769 | unclear | ✓ | |
| 26 | 灯光能不能再柔和点 | chat | — | — | 1108 | chat · alt:unclear | ✓ | |
| 27 | 帮我订明天去北京的机票 | chat | — | — | 987 | chat | ✓ | |
| 28 | 那个…放个…算了 | unclear | — | — | 958 | unclear · alt:chat | ✓ | |
| 29 | 帮我… | unclear | — | — | 841 | unclear | ✓ | |
| 30 | 嗯 | chat | — | — | 402 | chat | ✓ | |
| 31 | 你说呢 | chat | — | — | 406 | chat | ✓ | |
| 32 | 把空调调到 26 度 | chat | — | — | 803 | chat · alt:unclear | ✓ | |
| 33 | 给张三发个微信说我迟到了 | chat | — | — | 901 | chat | ✓ | |
| 34 | 帮我打车去机场 | chat | — | — | 961 | chat | ✓ | |
| 35 | 设个 7 点的闹钟 | chat | — | — | 928 | chat | ✓ | |
| 36 | 现在几点 | chat | — | — | 1147 | chat | ✓ | |
| 37 | 今天是几号 | chat | — | — | 1076 | chat | ✓ | |
| 38 | 纽约现在的天气怎么样 | chat | — | — | 985 | chat | ✓ | |
| 39 | 明天会下雨吗 | chat | — | — | 896 | chat | ✓ | |
| 40 | 美股今天怎么样 | chat | — | — | 1459 | chat | ✓ | |
| 41 | 播放 | unclear | — | — | 770 | unclear | ✓ | |
| 42 | 开 | unclear | — | — | 736 | unclear | ✓ | |
| 43 | 把音乐关了 | action | music_control | action:"stop" | 1334 | action/music_control {action:"stop"} | ✓ | |
| 44 | 开卧室灯 | action | smart_device | action:"on", device:"卧室 灯" | 1669 | action/smart_device {action:"on"} | ✓ | |
| 45 | 你叫什么名字 | chat | — | — | 992 | chat | ✓ | |
| 46 | 你是什么模型 | chat | — | — | 1030 | chat | ✓ | |
| 47 | 介绍一下你自己 | chat | — | — | 1708 | chat | ✓ | |
| 48 | 我今天心情有点低落 | chat | — | — | 498 | chat | ✓ | |
| 49 | 最近工作压力好大 | chat | — | — | 496 | chat | ✓ | |
| 50 | 你会做饭吗 | chat | — | — | 526 | chat | ✓ | |
| 51 | 给我推荐一本书 | chat | — | — | 959 | chat | ✓ | |
| 52 | 人生的意义是什么 | chat | — | — | 1263 | chat | ✓ | |
| 53 | 我该不该换工作 | chat | — | — | 495 | chat | ✓ | |
| 54 | 解释一下深度学习 | chat | — | — | 2059 | chat | ✓ | |
| 55 | 来首周杰伦 | action | play_music | query:"周杰伦", shuffle:true | 1561 | action/play_music | ✓ | |
| 56 | 播放一下最近的新歌 | action | play_music | query:"最近的新歌", shuffle:true | 1564 | action/play_music | ✓ | |
| 57 | 放点安静的音乐 | action | play_music | query:"安静的音乐", shuffle:true | 1597 | action/play_music | ✓ | |
| 58 | 放一首摇滚乐 | action | play_music | query:"摇滚乐", shuffle:true | 1636 | action/play_music | ✓ | |
| 59 | 切到下一首 | action | music_control | action:"next" | 1414 | action/music_control {action:"next"} | ✓ | |
| 60 | 跳过这首 | action | music_control | action:"next" | 1407 | action/music_control {action:"next"} | ✓ | |
| 61 | 回到上一首 | action | music_control | action:"previous" | 1386 | action/music_control {action:"previous"} | ✓ | |
| 62 | 音量调到 50 | action | music_control | action:"volume", value:50 | 1620 | action/music_control {action:"volume"} | ✓ | |
| 63 | 静音 | action | music_control | action:"volume", value:0 | 1608 | action/music_control {action:"volume"} · alt:unclear,chat | ✓ | |
| 64 | 放大声点 | action | music_control | action:"volume", value:80 | 1603 | action/music_control {action:"volume"} | ✓ | |
| 65 | 单曲循环这首 | action | music_control | action:"repeat", value:"one" | 1555 | action/music_control {action:"repeat"} | ✓ | |
| 66 | 取消循环 | action | music_control | action:"repeat", value:"off" | 1563 | action/music_control {action:"repeat"} | ✓ | |
| 67 | 随机播放 | action | music_control | action:"shuffle", value:true | 1522 | action/music_control {action:"shuffle"} | ✓ | |
| 68 | 按顺序播放 | action | music_control | action:"shuffle", value:false | 1543 | action/music_control {action:"shuffle"} | ✓ | |
| 69 | 停止播放 | action | music_control | action:"stop" | 1359 | action/music_control {action:"stop"} | ✓ | |
| 70 | 打开书房的灯 | action | smart_device | action:"on", device:"书房的灯" | 1641 | action/smart_device {action:"on"} | ✓ | |
| 71 | 关上厨房的灯 | action | smart_device | action:"off", device:"厨房 灯" | 1684 | action/smart_device {action:"off"} | ✓ | |
| 72 | 打开走廊的灯 | action | smart_device | action:"on", device:"走廊 灯" | 1677 | action/smart_device {action:"on"} | ✓ | |
| 73 | 把阳台灯关了 | action | smart_device | action:"off", device:"阳台 灯" | 1680 | action/smart_device {action:"off"} | ✓ | |
| 74 | 开电扇 | action | smart_device | action:"on", device:"电扇" | 1649 | action/smart_device {action:"on"} | ✓ | |
| 75 | 关掉所有插座 | action | smart_device | action:"off", device:"所有 插座" | 1680 | action/smart_device {action:"off"} | ✓ | |
| 76 | 开饮水机 | action | smart_device | action:"on", device:"饮水机" | 1637 | action/smart_device {action:"on"} | ✓ | |
| 77 | 关加湿器 | action | smart_device | action:"off", device:"加湿器" | 1668 | action/smart_device {action:"off"} | ✓ | |
| 78 | 把所有设备都关了 | action | smart_device | action:"off", device:"全部" | 1627 | action/smart_device {action:"off"} | ✓ | |
| 79 | 看看我有哪些设备 | action | smart_device | action:"list", device:"设备" | 1618 | action/smart_device {action:"list"} | ✓ | |
| 80 | 我都有什么音乐 | action | list_music | — | 1222 | action/list_music | ✓ | |
| 81 | 开主卧灯和客厅灯 | action | smart_device | action:"on", device:"主卧灯和客厅灯" | 1803 | action/smart_device {action:"on"} | ✓ | |
| 82 | 把全屋灯都打开 | action | smart_device | action:"on", device:"全部" | 1617 | action/smart_device {action:"on"} | ✓ | |
| 83 | 打开卫生间的灯 | action | smart_device | action:"on", device:"卫生间 灯" | 1675 | action/smart_device {action:"on"} | ✓ | |
| 84 | 关灯 | action | smart_device | action:"off", device:"灯" | 1572 | action/smart_device {action:"off"} | ✓ | |
| 85 | 帮我放首歌吧，我想静一静 | action | play_music | query:"", shuffle:true | 1802 | action/play_music · alt:chat | ✓ | |
| 86 | 好累，来点轻音乐 | action | play_music | query:"轻音乐", shuffle:true | 1521 | action/play_music · alt:chat | ✓ | |
| 87 | 灯太亮了 | chat | — | — | 1023 | chat · alt:unclear | ✓ | |
| 88 | 灯有点暗 | chat | — | — | 1058 | chat · alt:unclear | ✓ | |
| 89 | 音乐太吵了 | chat | — | — | 1079 | action/music_control · alt:chat | ✓ | |
| 90 | 背景音乐换一下 | action | music_control | action:"shuffle", value:true | 1493 | action/play_music · alt:unclear (skill=music_control want=play_music) | ✗ | |
| 91 | 能不能把灯关一下 | action | smart_device | action:"off", device:"灯" | 1563 | action/smart_device {action:"off"} | ✓ | |
| 92 | 帮我把音乐声音关小 | action | music_control | action:"volume", value:30 | 1555 | action/music_control {action:"volume"} | ✓ | |
| 93 | 音乐听着好烦 | chat | — | — | 499 | chat · alt:action | ✓ | |
| 94 | 这歌真的好听，别停 | chat | — | — | 505 | chat | ✓ | |
| 95 | 那个 | unclear | — | — | 812 | unclear | ✓ | |
| 96 | 呃… | unclear | — | — | 819 | unclear · alt:chat | ✓ | |
| 97 | 我想… | unclear | — | — | 696 | unclear | ✓ | |
| 98 | 等等 | unclear | — | — | 905 | chat · alt:unclear | ✓ | |
| 99 | 嗯嗯嗯 | chat | — | — | 686 | chat | ✓ | |
| 100 | 哦 | chat | — | — | 814 | chat | ✓ | |
| 101 | 算了 | chat | — | — | 807 | chat · alt:unclear | ✓ | |
| 102 | 好吧 | chat | — | — | 809 | chat | ✓ | |
| 103 | 帮我订一个饭店 | chat | — | — | 1003 | chat | ✓ | |
| 104 | 查一下我的快递 | chat | — | — | 788 | chat | ✓ | |
| 105 | 查我的日历 | chat | — | — | 814 | chat | ✓ | |
| 106 | 提醒我下午 3 点开会 | chat | — | — | 941 | chat | ✓ | |
| 107 | 定个 10 分钟的计时器 | chat | — | — | 879 | chat | ✓ | |
| 108 | 帮我翻译一下这句话 | chat | — | — | 878 | chat | ✓ | |
| 109 | 转账给张三 100 元 | chat | — | — | 941 | chat | ✓ | |
| 110 | 帮我写邮件给老板 | chat | — | — | 966 | chat | ✓ | |
| 111 | 打开网易云音乐 app | unclear | — | — | 1006 | chat · alt:action (intent=unclear want=chat|action) | ✗ | |
| 112 | 开 QQ 音乐 | action | smart_device | action:"on", device:"QQ 音乐" | 1657 | chat · alt:action | ✓ | |
| 113 | 上海现在几点了 | chat | — | — | 1250 | chat | ✓ | |
| 114 | 今天星期几 | chat | — | — | 870 | chat | ✓ | |
| 115 | 下周一是几号 | chat | — | — | 1249 | chat | ✓ | |
| 116 | 北京明天最高气温多少 | chat | — | — | 1029 | chat | ✓ | |
| 117 | 苹果股价多少 | chat | — | — | 967 | chat | ✓ | |
| 118 | 比特币现在多少钱 | chat | — | — | 963 | chat | ✓ | |
| 119 | 汇率怎么查 | chat | — | — | 1182 | chat | ✓ | |
| 120 | 麻烦把灯打开 | action | smart_device | action:"on", device:"灯" | 1566 | action/smart_device {action:"on"} | ✓ | |
| 121 | 请播放音乐 | action | play_music | query:"", shuffle:true | 1462 | action/play_music | ✓ | |
| 122 | 可以把音量调大吗 | action | music_control | action:"volume", value:80 | 1563 | action/music_control {action:"volume"} | ✓ | |
| 123 | 关下客厅灯好吗 | action | smart_device | action:"off", device:"客厅 灯" | 1661 | action/smart_device {action:"off"} | ✓ | |
| 124 | 能帮我放首歌吗 | action | play_music | query:"", shuffle:true | 1443 | action/play_music | ✓ | |

## 分布

- `chat`: 57
- `action`: 57
- `unclear`: 10

## 失败项（我的预期 ≠ 模型输出）

- **#12** 「继续播放」 — 预期 `action/music_control`，模型返回 `action/music_control` · slot.action=shuffle want=pause
- **#90** 「背景音乐换一下」 — 预期 `action/play_music`，模型返回 `action/music_control` · skill=music_control want=play_music
- **#111** 「打开网易云音乐 app」 — 预期 `chat`，模型返回 `unclear` · intent=unclear want=chat|action
