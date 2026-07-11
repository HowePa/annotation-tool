# Pairwise LLM Response Human Annotation Tool

基于纯前端的 Pairwise LLM Response 人工标注工具。无需后端，浏览器直接打开 `index.html` 即可使用。

## 功能

- 上传 JSON 数据（FileReader API 解析）
- 字段自动识别（不依赖固定字段数量）
- A/B Response 左右对比卡片，支持 Markdown（粗体 / 斜体 / 代码块 / 行内代码 / 换行 / 列表）
- Winner 选择：A better / B better / Tie / Both bad
- 多维评分：Correctness / Helpfulness / Personalization（1-5，A 与 B 各自打分）
- 标签系统（checkbox，可扩展）
- 人工备注
- LocalStorage 自动保存进度，防止关闭浏览器丢失
- 导出 `annotation_result.json`（Blob API）
- 顶部进度条实时显示完成度
- 大数据支持（只渲染当前一条，支持 1000 / 10000 / 50000 条）
- 快捷键导航

## 快捷键

| 按键 | 功能 |
| --- | --- |
| `←` | 上一个 |
| `→` | 下一个 |
| `1` | 选择 Response A |
| `2` | 选择 Response B |
| `3` | 选择 Tie |
| `4` | 选择 Both bad |
| `Ctrl/Cmd + S` | 保存当前标注 |

## 使用方法

1. 用浏览器打开 `index.html`。
2. 点击「选择 JSON 文件」，加载符合格式的数据。
3. 逐条完成 Winner / 评分 / 标签 / 备注。
4. 点击「Save」或使用快捷键保存，进度自动写入 LocalStorage。
5. 点击「Export JSON」导出 `annotation_result.json`。

## 输入 JSON 格式

系统自动识别字段，以下为推荐字段：

```json
[
  {
    "reflection_id": "r000449",
    "student_id": "2305518",
    "lecture_id": 74,
    "reflection": "Dijkstra algorithm but I will go over it by using past lectures",
    "response_a": "...",
    "response_b": "...",
    "a_method": "few_retrieval",
    "b_method": "non_memory"
  }
]
```

字段识别优先级：
- ID：`reflection_id` → `id` → `rid`
- Reflection：`reflection` → `question` → `prompt` → `student_reflection`
- Response A：`response_a` → `resp_a` → `answer_a` → `a`
- Response B：`response_b` → `resp_b` → `answer_b` → `b`

## 导出 JSON 格式

```json
[
  {
    "reflection_id": "r000449",
    "human_label": {
      "winner": "B",
      "response_a_score": { "correctness": 4, "helpfulness": 3, "personalization": 3 },
      "response_b_score": { "correctness": 5, "helpfulness": 5, "personalization": 4 },
      "tags": ["good example", "actionable advice"],
      "comment": "Response B identifies the core conceptual gap."
    }
  }
]
```

## 文件结构

```
annotation-tool/
├── index.html          # 页面结构
├── style.css           # 样式（A 蓝 / B 橙 / 已选绿 / 进度条）
├── app.js              # 逻辑（加载/渲染/标注/保存/导出/快捷键）
├── README.md
└── example/
    ├── sample.json     # 输入示例
    └── output.json     # 输出示例
```

## 扩展预留

代码结构便于后续扩展：
- 多模型比较 A/B/C/D
- 多人账号登录
- 标注一致性统计 / Cohen's Kappa
- 自动合并多个 annotator 结果
- 导入已有 label 继续修改（LocalStorage 已实现进度复用）
