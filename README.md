# 基于 Python 的词云可视化

纯前端词云 Kiosk 应用，支持**语音输入**、**手动录入**、**敏感词过滤**、**词云形状切换**与**图片下载**。Web 版可在手机、平板、电脑浏览器中直接使用。

## 在线访问（GitHub Pages）

部署完成后，访问地址：

```
https://leo-gao-monkey.github.io/python_ciyun/
```

- **控制台（录入）**：https://leo-gao-monkey.github.io/python_ciyun/
- **大屏展示**：https://leo-gao-monkey.github.io/python_ciyun/display.html

> 建议使用 **Chrome** 或 **Edge** 浏览器。语音功能需要 **HTTPS**（GitHub Pages 默认支持），首次使用需允许麦克风权限。

## 部署到 GitHub

### 1. 创建仓库并推送代码

```bash
cd ciyun
git init
git add .
git commit -m "Initial commit: word cloud kiosk web app"
git branch -M main
git remote add origin https://github.com/Leo-Gao-Monkey/python_ciyun.git
git push -u origin main
```

### 2. 开启 GitHub Pages

1. 打开 GitHub 仓库 → **Settings** → **Pages**
2. **Build and deployment** → Source 选择 **GitHub Actions**
3. 推送代码后，Actions 会自动运行 `Deploy to GitHub Pages` 工作流
4. 部署成功后，Pages 页面会显示访问 URL

### 3. 等待部署

在仓库 **Actions** 标签页查看部署进度，绿色 ✓ 表示成功。通常 1～2 分钟后可通过网址访问。

## 本地运行（可选）

本地开发或需要**控制台 + 大屏多屏 SSE 同步**时，使用 Python 静态服务器：

```bash
cd web
python serve.py
```

浏览器打开 `http://127.0.0.1:8765/`。Windows 也可双击 `web/启动词云.bat`。

## 功能说明

| 功能 | 说明 |
|------|------|
| 语音输入 | 按住说话或点击切换录音，识别后可编辑再提交 |
| 手动输入 | 输入词语后添加，支持空格分隔多个词 |
| 词云分类 | 语音词云 / 手动词云 / 全部 分开显示 |
| 清空词云 | 词云区域右上角按钮，清空当前视图 |
| 形状模板 | 圆形、心形、星形等，支持自定义蒙版 |
| 下载图片 | 导出当前词云 PNG |
| 敏感词过滤 | 提交前自动过滤 |

## 手机使用提示

- 页面已针对手机屏宽自适应，可上下滚动查看控制面板与词云
- 输入框字号 ≥ 16px，避免 iOS 自动放大
- 语音按钮支持触摸：短按开始录音，再点一次结束
- 数据保存在**当前浏览器本地**，清除缓存会丢失词云数据

## 在线版 vs 本地版

| | GitHub Pages 在线版 | 本地 serve.py |
|--|---------------------|---------------|
| 访问方式 | 手机/电脑输入网址 | 局域网 `127.0.0.1` |
| 语音识别 | ✅（需 HTTPS） | ✅ |
| 数据存储 | 浏览器 localStorage | localStorage + 可选服务端持久化 |
| 多屏同步 | 同设备多标签页 | SSE 实时同步大屏 |

## 项目结构

```
ciyun/
├── web/                    # 前端 Web 应用（GitHub Pages 部署此目录）
│   ├── index.html          # 控制台
│   ├── display.html        # 大屏展示
│   ├── css/                # 样式
│   ├── js/                 # 逻辑脚本
│   └── serve.py            # 本地开发服务器
├── gui.py                  # Tkinter 桌面版（可选）
├── wordcloud_generator.py  # Python 词云 CLI
└── .github/workflows/      # GitHub Pages 自动部署
```

## 技术栈

- ECharts + echarts-wordcloud
- Web Speech API（语音识别）
- localStorage 数据持久化
- GitHub Actions + GitHub Pages 静态托管

## License

MIT
