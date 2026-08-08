# 題庫生成指示

## 任務
為乙級職業安全衛生管理員考試編寫選擇題題庫，每單元 50 題，輸出為 JSON 檔案。

## 輸出格式
每個單元一個 JSON 檔案，檔名為 `U{單元號碼}.json`（例如 U02.json、U03.json），儲存在 `/home/user/workspace/osh-exam/data/questions/` 目錄。

## JSON 結構
請嚴格遵循以下結構（參考已完成的 `/home/user/workspace/osh-exam/data/questions/U01.json`）：

```json
{
  "unitId": "U02",
  "unitTitle": "職業安全衛生法及其施行細則",
  "unitNumber": 2,
  "questions": [
    {
      "id": "U02-Q001",
      "type": "single_choice",
      "difficulty": "basic",
      "stem": "題目文字",
      "options": [
        {"id": "A", "text": "選項A"},
        {"id": "B", "text": "選項B"},
        {"id": "C", "text": "選項C"},
        {"id": "D", "text": "選項D"}
      ],
      "answer": ["B"],
      "explanation": "解析說明",
      "references": [{"title": "法規名稱第X條", "url": "https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=...&flno=..."}]
    }
  ]
}
```

## 題型分配（每單元 50 題）
- 單選題（single_choice）：24 題
- 複選題（multiple_choice）：8 題
- 是非題（true_false）：5 題
- 填充題（fill_blank）：5 題
- 計算題（calculation）：3 題
- 配合題（matching）：3 題
- 排序題（ordering）：2 題

## 各題型格式

### 單選題 (single_choice)
```json
{
  "id": "U02-Q001",
  "type": "single_choice",
  "difficulty": "basic|intermediate|advanced",
  "stem": "題目",
  "options": [
    {"id": "A", "text": "..."},
    {"id": "B", "text": "..."},
    {"id": "C", "text": "..."},
    {"id": "D", "text": "..."}
  ],
  "answer": ["B"],
  "explanation": "...",
  "references": [{"title": "...", "url": "https://law.moj.gov.tw/..."}]
}
```

### 複選題 (multiple_choice)
```json
{
  "id": "U02-Q025",
  "type": "multiple_choice",
  "difficulty": "...",
  "stem": "下列哪些...？（複選）",
  "options": [
    {"id": "A", "text": "..."},
    {"id": "B", "text": "..."},
    {"id": "C", "text": "..."},
    {"id": "D", "text": "..."}
  ],
  "answer": ["A", "B", "C"],
  "explanation": "...",
  "references": [...]
}
```

### 是非題 (true_false)
```json
{
  "id": "U02-Q033",
  "type": "true_false",
  "difficulty": "...",
  "stem": "叙述文字",
  "options": [
    {"id": "A", "text": "正確"},
    {"id": "B", "text": "錯誤"}
  ],
  "answer": ["A"],
  "explanation": "...",
  "references": [...]
}
```

### 填充題 (fill_blank)
```json
{
  "id": "U02-Q038",
  "type": "fill_blank",
  "difficulty": "...",
  "stem": "___處填空",
  "answer": ["答案文字"],
  "explanation": "...",
  "references": [...]
}
```
注意：answer 為字串陣列，可接受多個等價答案（如 ["5", "五"]）。

### 計算題 (calculation)
```json
{
  "id": "U02-Q043",
  "type": "calculation",
  "difficulty": "...",
  "stem": "計算題目",
  "answer": {"value": 2000, "unit": "元", "tolerance": 0.01},
  "explanation": "...",
  "references": [...]
}
```

### 配合題 (matching)
```json
{
  "id": "U02-Q046",
  "type": "matching",
  "difficulty": "...",
  "stem": "請將下列...正確配對：",
  "leftItems": [
    {"id": "L1", "text": "..."},
    {"id": "L2", "text": "..."}
  ],
  "rightItems": [
    {"id": "R1", "text": "..."},
    {"id": "R2", "text": "..."}
  ],
  "answer": [
    {"left": "L1", "right": "R1"},
    {"left": "L2", "right": "R2"}
  ],
  "explanation": "...",
  "references": [...]
}
```

### 排序題 (ordering)
```json
{
  "id": "U02-Q048",
  "type": "ordering",
  "difficulty": "...",
  "stem": "請依...排列：",
  "items": [
    {"id": "I1", "text": "..."},
    {"id": "I2", "text": "..."}
  ],
  "answer": ["I1", "I2"],
  "explanation": "...",
  "references": [...]
}
```

## 重要規則
1. 所有法規內容以現行有效法規為準（全國法規資料庫 https://law.moj.gov.tw/）
2. 每題必須有 explanation 和 references
3. references 中的 URL 必須是全國法規資料庫的真實連結
4. 題目難度分為 basic、intermediate、advanced 三級
5. ID 格式：`U{單元號碼}-Q{三位數序號}`，從 Q001 到 Q050
6. 確保 JSON 格式正確，不可有語法錯誤
7. 題目內容要涵蓋該單元的重點法規、數字、期限、責任與實務應用
8. 選項設計要有迷惑性，但不能有爭議
9. 解析要說明「為什麼對、其他選項錯在哪裡」
10. 不要直接複製網路上的題目，要根據法規自行編寫

## 單元清單
請參考 `/home/user/workspace/osh-exam/data/units.json` 確認你要處理的單元。
