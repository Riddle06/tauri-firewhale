1) 目標與非目標

目標（你要做成什麼）

一個 Desktop Firebase GUI（類 Firefoo），支援：
	•	多 Connection（dev/prod）
	•	多 Tab（每個 tab 對不同 collection/path 做 query）
	•	Query 編輯器有 IDE 級 suggestion（快、穩、可用）
	•	缺 index 時提供 fallback 流程（where 先撈 + client sort）
	•	狀態可記憶：同 connection 下次開，tabs & queries 還在

非目標（先不要做，避免爆炸）
	•	完整 Firestore security rules 模擬
	•	大而全的 schema 自動探索（Firestore 不提供真正 schema）
	•	所有 Firestore 進階特性一次全包（先鎖定你常用的查詢組合）

⸻

1) 產品體驗設計（你要有哪些畫面/互動）

A. App Shell（最外層）
	•	左上：Connection selector（可同時開多個）
	•	上方：Tabs bar（+ 新增、切換、關閉）
	•	中間：Editor + Result grid
	•	右側/下方：Query console（log / errors / warnings）

B. New Tab（按 +）
	•	選 connection（若只有一個，跳過）
	•	輸入 collection path（帶本地歷史 suggestion）
	•	Enter → 開新 tab，title = path 最後一段 + connection badge

C. Query Editor
	•	DSL（建議 SQL-ish 但簡單）
	•	即時 lint（語法錯、欄位不存在疑似）
	•	suggestion：keywords / operators / fields / 常用片段
	•	Run（快捷鍵 Cmd/Ctrl+Enter）

D. 缺 Index 流程（關鍵 UX）
	•	先執行原 query
	•	若收到「missing index」：
	•	顯示錯誤卡片 +（建立 index 按鈕 / 打開 console link）
	•	提供「Fallback 搜尋」區：
	•	說明：先 where 撈 → 本地排序
	•	讓使用者設定最大讀取筆數（預設 2000）
	•	顯示警告：可能耗時/費用，排序只對已讀取 N 筆有效
	•	Confirm 才執行

E. 記憶/恢復
	•	同一 connection 下次打開：自動恢復上次 tabs、active tab、每個 tab queryText

⸻

2) 技術架構（清楚分層，避免後面很難改）

Process/Runtime 分工
	•	Svelte (UI)：渲染、互動、editor、tabs、result grid
	•	Bun (JS runtime)：Firestore SDK、query runner、parser、completion engine（先用 Bun 迭代快）
	•	Tauri (Rust)：IPC、檔案存取、加密儲存（credentials / profiles）、多視窗

一開始可以「completion + runner 都跑 Bun」，效能不夠再搬 parser/索引到 Rust。

核心模組
	1.	Connection Manager（profiles、credentials、切換）
	2.	Workspace/Tab Manager（多 tabs、多 connections、persist）
	3.	Query Language（DSL）+ Parser（AST）
	4.	Completion Engine（超快 suggestion）
	5.	Query Runner（Firestore 執行、錯誤分類、fallback）
	6.	Result Grid（顯示、欄寬、欄位選取、copy、export optional）
	7.	Storage（state、fieldStats、history、加密資料）

⸻

3) Data Model（這些先定好，後面會輕鬆）

Connection Profile

type ConnectionProfile = {
  id: string;
  name: string;          // dev/prod
  projectId: string;
  kind: "firestore" | "rtdb"; // 先 Firestore
  auth: {
    mode: "serviceAccount" | "apiKeyUserLogin" | "emulator";
    encryptedPayloadRef: string; // 真正秘密放加密區
  };
  ui: { colorTag?: string; badgeText?: string }; // PROD 紅色
  lastOpenedAt?: number;
};

Workspace（通常一個視窗一個）

type WorkspaceState = {
  id: string;
  openConnectionIds: string[];
  tabs: TabState[];
  activeTabId: string;
};

Tab

type TabState = {
  id: string;
  title: string;
  connectionId: string;
  collectionPath: string;

  queryText: string;
  lastRunAt?: number;

  view: {
    selectedColumns?: string[];
    columnWidths?: Record<string, number>;
  };

  // optional：讓重開後還能看到上次結果（可先不做）
  // lastResultPreview?: any[];
};

Field Stats（做快 suggestion 的關鍵）

type FieldStats = {
  connectionId: string;
  collectionPath: string;
  fields: Record<string, {
    types: Record<string, number>;      // string/number/bool/map/array/timestamp…
    sampleValues?: any[];               // optional top values
    lastSeenAt: number;
  }>;
  updatedAt: number;
};


⸻

4) Query DSL 規格（先鎖定 MVP 範圍）

建議先支持這些（夠用、好做 suggestion）：
	•	from <collectionPath>
	•	where <field> <op> <value>（支援 ==, !=, <, <=, >, >=, in, array-contains, array-contains-any）
	•	orderBy <field> [asc|desc]
	•	limit <n>

例：

from users
where status == "active"
where age >= 18
orderBy createdAt desc
limit 50

Parser 產出 AST：

type QueryAST = {
  collectionPath: string;
  where: { field: string; op: string; value: any }[];
  orderBy: { field: string; dir: "asc"|"desc" }[];
  limit?: number;
};


⸻

5) Completion Engine 設計（要像 VSCode 就靠這塊）

Completion 來源分三層（快到慢）
	1.	Static：keywords / operators / snippets（O(1)）
	2.	Cached Schema：FieldStats fields（讀本地 cache）
	3.	Dynamic（可選）：top values（節流 + 可取消）

性能策略（必做）
	•	增量解析：輸入變化只更新最小 AST/Token 狀態
	•	completion 查找使用 Trie / hashmap
	•	UI thread 不做重運算：透過 Tauri IPC → Bun completion service
	•	任何請求都支援 abort（輸入很快時避免排隊）

⸻

6) Missing Index Fallback（完整落地流程）

錯誤分類

在 Query Runner 裡把 Firestore error 分類：
	•	missing index（包含建立 index link / message pattern）
	•	permission denied
	•	invalid argument（語法/型別）
	•	network

Fallback 設計
	•	原 query（where + orderBy + limit）先跑
	•	若 missing index：
	•	組一個 fallbackPlan：
	•	保留 where
	•	移除 orderBy（或標記改 client sort）
	•	設定 fetchCap（預設 2000）
	•	UI 顯示確認卡，使用者同意才跑

Fallback 執行
	•	執行 where + limit(fetchCap)
	•	client-side sort（依原 orderBy）
	•	顯示「已讀取 N 筆，排序僅針對此範圍」
	•	若超過 fetchCap 還可能更多：提示「請建立 index 才能完整排序」

⸻

7) Storage / Persist 設計（對應你的 4、7 點）

檔案分層（推薦）
	•	appState.json：最近開哪些 workspace、視窗位置（可選）
	•	connections.json：profile 列表（不含秘密）
	•	connections/<id>/workspace.json：tabs + activeTab + 每 tab queryText
	•	connections/<id>/fieldStats.json：欄位快取（用於 suggestion）
	•	secrets.enc：加密的 service account / token 等

寫入策略
	•	queryText / tabs 改動：debounce 500ms
	•	active tab change：立即寫
	•	app close：flush

⸻

8) 開發階段（Milestones / Backlog）

Milestone 1：App Skeleton + Tabs（先把 5、6、7 打通）

目標
	•	可新增/關閉 tab
	•	tab 綁定 collectionPath
	•	每 tab 有獨立 queryText
	•	連線 profile 可建立/切換
	•	重開 app：同 connection 的 tabs & queryText 還在

交付物
	•	Connection manager（profile CRUD，至少 local storage）
	•	Workspace/Tab store（Svelte store + persist）
	•	基礎 UI：connection selector + tab bar + editor（先用 textarea 也行）

驗收
	•	開 3 個 tabs，切換不互相污染
	•	切換 dev/prod，tabs 狀態分開保存
	•	重開 app 狀態完整恢復

⸻

Milestone 2：Query DSL + 基本執行（能查到資料）

目標
	•	DSL parse → AST
	•	AST → Firestore SDK query（where/orderBy/limit）
	•	顯示結果表格（最少 key/value viewer）

交付物
	•	Parser（tokenize + parse）
	•	Query runner（執行、顯示 loading、error）
	•	Result grid（先簡單，後面再強化）

驗收
	•	能對指定 collection 跑 where/orderBy/limit 並顯示結果
	•	無效語法會在 UI 顯示錯誤（lint）

⸻

Milestone 3：Suggestion（做到“像 IDE”）

目標
	•	keywords/operators/snippets suggestion
	•	fields suggestion（FieldStats）
	•	collection path 本地歷史 suggestion

交付物
	•	Completion engine v1
	•	FieldStats 初版（從 query results 增量學習即可）
	•	Editor 換成 Monaco 或 CodeMirror 6（建議此時換）

驗收
	•	輸入 where  立刻提示欄位
	•	提示延遲肉眼感受接近即時（不會卡字）
	•	同 collection 用越久提示越準

⸻

Milestone 4：Missing Index Fallback（你差異化的亮點）

目標
	•	missing index error 偵測
	•	提示建立 index + fallback confirm
	•	fallback 執行 where + client sort（含 fetchCap）

交付物
	•	Error classifier
	•	Fallback plan builder + executor
	•	UI confirm panel

驗收
	•	人為製造缺 index query：
	•	先報錯 → UI 顯示 fallback 選項
	•	Confirm 後成功顯示結果（並提示限制）

⸻

Milestone 5：多 connection 同時開（強化第 6 點）

目標
	•	同一 workspace 同時連多個 connection
	•	tab 顯示 connection badge
	•	防呆：prod 顯眼提示

交付物
	•	multi-client 管理（依 connectionId 路由）
	•	UI badge + theme tag

驗收
	•	同時開 dev/users 與 prod/users
	•	Query 執行確實打到對的環境，不混線

⸻

Milestone 6：打磨與效率（讓它“像 Firefoo”）

可選但很加分
	•	tab reorder / duplicate
	•	result grid 虛擬化（大量資料不卡）
	•	copy/export（JSON/CSV）
	•	query history（每 tab 或 per connection）
	•	快捷鍵（Run、New Tab、Switch Tab、Command palette）

⸻

9) 風險清單（提前避坑）
	•	Firestore 沒有 schema：欄位提示只能靠快取/抽樣 → 你要接受「漸進式變準」
	•	missing index fallback 的排序「只對已讀取資料」→ UI 必須明說，避免誤解
	•	credentials 儲存務必加密（至少 OS keychain 等級）
	•	prod 防呆一定要做（顏色、badge、甚至二次確認）

⸻

10) Done Definition（最後你怎麼判定做完）

你列的 7 點對應可驗收條件：
	1.	✅ 輸入 query 有 suggestion（keywords + fields）
	2.	✅ suggestion 體感即時（不卡字、不排隊）
	3.	✅ 缺 index 時：提示 + fallback confirm + client sort 執行
	4.	✅ connection 可儲存/重用（含安全儲存）
	5.	✅ tab：+ 新增，多 collection 各自查詢
	6.	✅ 同時多 connection（dev/prod 同時存在）
	7.	✅ 記憶：重開同 connection 還原 tabs & queries