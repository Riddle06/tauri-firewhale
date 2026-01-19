# Firewhale UI/UX 設計定義 (以 Logo 為基準)

## 1) Logo 參考與品牌意象
- 參考圖片: `src-tauri/icons/Square310x310Logo.png`
- 品牌意象: Firestore + Whale → 噴火的鯨魚
- 核心氣質: 可靠、靈活、帶點俏皮與能量感
- 視覺關鍵字: 海洋藍、火焰橙、亮黃、清爽、圓潤

## 2) UI / UX 定義
- UI (User Interface): 使用者看得到、操作得到的視覺與互動介面，涵蓋色彩、排版、元件、動畫與視覺一致性。
- UX (User Experience): 使用者完成任務的整體體驗，包含流程、可理解性、效率、情緒與回饋感。
- 關係: UX 定方向與流程品質，UI 負責把方向具象化並保持一致性。

## 3) 色系總則 (從 Logo 延伸)
- 以「鯨魚藍」為主色系、「火焰橙 / 黃」為強調色，形成冷暖對比與能量感。
- 視覺主畫面與背景以冷色系為主，關鍵 CTA 與強烈提示使用火焰色系。
- 所有中性色偏冷、偏藍，避免偏灰或偏棕造成品牌偏移。

## 4) 色票與用途 (建議色碼)
> 色碼為視覺近似值，可依日後調整精修，但需維持冷暖與飽和度比例。

### 主色系 (Whale / Ocean)
- Whale Blue (主色): #28B6F6
- Deep Ocean (深主色/標題/重點): #0B5A80
- Sky Foam (淺藍/背景氛圍): #9ADFFF
- Ice Glow (高光/面板底): #E6F7FF

### 火焰系 (Flame / Energy)
- Flame Orange (CTA/主強調): #F46A2A
- Flame Yellow (高光/次強調): #FFC84A
- Ember Red (危險/警示): #D94A2A

### 中性色 (文本/邊線/底色)
- Ink (主要文字): #10222D
- Slate (次文字): #4B5B66
- Mist (頁面背景): #F5FAFD
- Frost Line (邊線/分隔): #D7E8F2

## 5) 漸層定義 (Logo 延伸)
- Flame Gradient: linear-gradient(135deg, #F46A2A 0%, #FFC84A 100%)
- Ocean Gradient: linear-gradient(135deg, #28B6F6 0%, #9ADFFF 100%)
- Mist Gradient (背景): linear-gradient(180deg, #F5FAFD 0%, #E6F7FF 100%)

## 6) 元件配色規則 (不實作、僅定義)

### 按鈕
- Primary: 背景 Whale Blue；文字白色；Hover 加深至 Deep Ocean；Focus ring 使用 Sky Foam。
- Accent / CTA: Flame Gradient；文字白色；Hover 增強對比或加深 Flame Orange。
- Secondary: 透明底 + Deep Ocean 外框；Hover 背景 Ice Glow。
- Ghost: 透明底 + Ink 字色；Hover 背景 Mist。
- Danger: Ember Red 底；文字白色；Hover 略加深。

### 背景/區塊
- 頁面背景: Mist 或 Mist Gradient，避免純白平面。
- 卡片/面板: Ice Glow 或 #FFFFFF，邊線 Frost Line。
- Header: 可用 Ocean Gradient 淡化版 + 透明度，保持清爽感。

### 文字與標題
- 主標題: Deep Ocean / Ink
- 內文: Ink / Slate
- 強調文字: Flame Orange (少量點綴)

### 列表 / 表格 / 選單
- Collection List / Query List hover: Ice Glow 實心底 + Whale Blue 明顯描邊/內陰影。
- Query Result Header: 純白實心底，避免透明或模糊效果造成髒感。
- Query Result Row: 每列底部加淡分隔線 (低對比)，提升資料可讀性。
- Context Menu: 純白實心底 + Deep Ocean 淺邊框；Item hover 使用 Ice Glow 實心底。

## 7) 可用視覺語氣
- 色彩節奏: 冷色為主體、暖色為爆點
- 氣質: 可信賴的工具感 + 趣味的品牌識別
- 圓角/柔和陰影: 呼應鯨魚圓潤視覺

## 8) 後續實作注意事項
- 所有新元件需引用上述色票，不新增偏離色相的顏色。
- 若需新增色階，需以 Whale Blue 或 Flame Orange 為基底做明度/飽和度衍生。
- 保持色彩對比可讀性 (文字對比至少 4.5:1)。
