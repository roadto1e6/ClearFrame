# ClearFrame 0.2
Rust + Tauri 2 图片与视频修补桌面应用。独立实现矩形边缘插值算法，没有复制网站的界面或打包代码。

## 功能
- PNG、JPEG、WebP、BMP、TIFF 图片；MP4、MOV、MKV、WebM、AVI 视频。
- 最多 16 个矩形选框，移动、四角与四边缩放、复制、删除、清空、撤销和重做。
- WebGL 2 实时预览；按住空格或“对照原片”查看原素材。
- 图片由 Rust 插值修补并保存 PNG，透明通道参与插值。
- 视频从原素材执行 FFmpeg delogo，输出 H.264 MP4；音轨转 AAC 保留。
- EXIF 图片方向归一化；视频预览自动生成兼容代理，导出仍使用原视频。
- 素材与处理留在本机，无账号、无上传服务。

## 交互与快捷键
- D 框选，V 选择；方向键微调 1 像素，Shift + 方向键微调 10 像素。
- 可直接输入选区 X / Y / 宽 / 高；Esc 取消正在进行的拖动。
- Ctrl + Z 撤销，Ctrl + Shift + Z 或 Ctrl + Y 重做。
- 按住空格临时查看原片；对照按钮可固定原片视图。
- F 适应画布，H 显示或隐藏选框；放大后可滚动查看画面。
- Ctrl + O 导入，Ctrl + Enter 导出；未导出的选区在更换素材前会提醒。
- 视频支持播放、定位、静音和倍速；处理时在底部显示进度与等待时间，不弹出遮罩。

## 开发
Windows 需要 Rust MSVC、Microsoft C++ Build Tools、WebView2、Node.js。
1. 将含 libx264 和 delogo 的 FFmpeg 放在 src-tauri/tools/ffmpeg.exe。
2. npm install
3. npm run dev
构建：npm run build
构建产物：src-tauri/target/release/clearframe-calm.exe。运行时需在程序旁保留 tools/ffmpeg.exe。
仓库不包含 FFmpeg 可执行文件，需要自行放入上述开发目录。
测试：cd src-tauri，然后 cargo test

## 使用
导入素材 → 在画面拖动框选水印（四周留出干净边界）→ 查看效果 → 导出新文件。
较长视频首次导入需等待预览转码。不要在处理时退出应用。
图片保存为 PNG；视频保存为 MP4。导出视频为兼容 H.264，奇数宽高会补齐一个像素。
FFmpeg 必须随可执行文件一起分发，置于 tools/ffmpeg.exe。

## 已知限制
这是周边插值修补，不会恢复被水印覆盖的真实细节。选框在整段素材中固定，不跟踪移动水印。
没有生成式 AI、时间轴剪辑或批处理。暂不提供取消编码。
预览按代理分辨率计算；视频导出使用 FFmpeg delogo，颜色空间和边界处理会导致轻微差异。
重叠选框预览与最终顺序滤镜可能不同，建议合并成一个选框。
图片会重新编码并移除原 EXIF 等元数据；HDR 视频未提供专门色调映射。
导出使用临时文件，成功后写入选定路径；禁止覆盖当前原素材。

## 第三方组件
Tauri、image、rfd 等依赖的许可见各项目。FFmpeg 的许可取决于实际构建；含 libx264 的版本通常涉及 GPL，重新分发应附带相应许可并履行源码提供义务。
