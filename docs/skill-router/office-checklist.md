# 办公室机器开工 Checklist

明天到办公室按下面三步来：

```bash
cd E:/Project/Voice   # 或办公室对应的本地路径
git pull origin main
git checkout -b feat/skill-router      # 分支名按自己习惯改
# 然后让 AI 读 docs/skill-router/README.md
```

## 几点提醒

1. **分支名**建议 `feat/skill-router`，和现有 `feat:` 提交前缀一致；换别的也行
2. **Node 版本** — `CLAUDE.md` 里写了 lockfile 必须 Node 24，办公室机器装没装先确认，
   不然跑 `npm install` 会生成不兼容的 `package-lock.json`
3. **`.env` / API keys** 不在 git 里，办公室那台要么已经配好了，要么得自己补
4. 让 AI 开工时，第一句就告诉它：
   > "我们刚 pull 下来 `docs/skill-router/README.md`，按里面说的来，从阶段 A 开始。"
   省得它上来还要猜你想做什么
