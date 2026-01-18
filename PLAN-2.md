1) 測試目標與原則
	•	所有 PR / 每次 push 都必須跑測試且通過（不通過就不能 merge / 不能產出 release artifact）
	•	測試分層：Unit → Integration → E2E
	•	針對你產品的高風險點（Completion 速度、Tab/State persist、Missing index fallback）一定要有測試覆蓋

⸻

2) 測試分層設計（你要測哪些）

A. Unit tests（快、每天跑、最重要）

範圍
	•	Query parser（Firestore chain，queryText → AST）
	•	AST validator（語法/型別/規則）
	•	completion engine（給定游標位置 → suggestions）
	•	error classifier（missing index / permission / invalid argument）
	•	fallback plan builder（原 AST → fallback plan）
	•	state reducer / store（tabs / workspace / persist）

工具建議（Bun 友好）
	•	Bun test（內建）或 Vitest（社群成熟）
	•	目標：Unit tests < 10 秒（CI 也快）

⸻

B. Integration tests（模組串接，仍然要快）

範圍
	•	Query runner + Firestore emulator：
	•	db.collection().where().orderBy().limit().get() 能跑
	•	pagination / cursor（若你後面做）
	•	缺 index 流程：能捕捉錯誤 → 產出 fallback plan（至少測到 “顯示 fallback 選項”）
	•	Storage layer：
	•	profiles/workspace state 寫入/讀取一致
	•	per-connection 分檔行為正確

工具
	•	Firestore Emulator（CI 起一個）
	•	測試資料用 seed script（每次跑測試前重建資料）

⸻

C. E2E tests（最慢，但能防「真的壞了」）

範圍
	•	App 啟動 → 建立 connection（指 emulator）→ 開 tab → 輸入 query（Firestore chain）→ Run → 看到結果
	•	Tab 行為：+ 新增/切換/關閉
	•	Persist：關閉 app → 重新開啟 → tabs & queries 還在
	•	Missing index UX：觸發錯誤 → 看到 fallback 卡片 → confirm → 出結果（若 emulator 不易重現 index 行為，可用 mock error 注入）

工具（桌面 app）
	•	Playwright（能測 Web UI；Tauri E2E 可走 WebDriver/Playwright + tauri-driver 方案）
	•	如果你想先簡化：先做「Web UI 模式」跑 E2E（Svelte 頁面），Tauri E2E 放到後期加

⸻

3) 「每次都要跑過測試」：CI Gate（必要）

你需要把測試變成硬規則：

A. GitHub Actions（或你用 GitLab CI 也行）

建立 3 個 job（由快到慢）：
	1.	lint-and-unit
	•	install
	•	typecheck
	•	unit tests
	2.	integration
	•	啟動 Firestore emulator
	•	seed data
	•	integration tests
	3.	e2e（可選：先跑在 main branch 或 nightly；成熟後再放 PR gate）
	•	build UI
	•	run e2e

規則
	•	PR 必須通過 lint-and-unit + integration
	•	e2e 初期可以只在 main 跑（避免你開發期一直被慢測試卡住），等穩了再加到 PR gate

⸻

4) 本地開發規範（讓你「每次都會跑」）

為了確保你跟團隊不會偷懶，做兩個機制：

A. Pre-push hook（強制）

用 lefthook 或 husky：
	•	pre-push: 跑 bun test + bun run typecheck
	•	如果測試沒過，禁止 push

這樣 CI 會更少紅燈，也符合你「每次都要跑過測試」。

B. 合併前必做（Branch protection）

GitHub 設定：
	•	Require status checks to pass before merging
	•	Require branches to be up to date before merging

⸻

5) 對應你的功能點：必測清單（直接列驗收）

這些是你最該優先寫的測試（會保護核心價值）：

Parser / Query chain
	•	正常 query（Firestore chain）可 parse 成正確 AST
	•	多個 where、orderBy、limit 的組合
	•	錯誤訊息定位（行/列 or token）

Completion
	•	在 collection 位置能提示 collections
	•	在 where  位置能提示 fields
	•	在 operator 位置提示合法 operators
	•	在 orderBy  位置提示 fields
	•	快取命中時（已有 FieldStats）延遲不超過某個門檻（可用「次數/計時」方式測，但要避免 flaky）

Tabs / Persist
	•	新增 tab → 切換 tab → queryText 不互相污染
	•	per-connection state：
	•	dev 的 tabs 不會出現在 prod
	•	重啟後 state 恢復一致

Missing index fallback（邏輯至少要測）
	•	error classifier 能把 “missing index” 分出來
	•	fallback plan 生成規則正確（移除 orderBy / 設定 cap）
	•	fallback executor 的 client sort 正確

⸻

6) 把測試納入你的 Milestones（更新版）

我幫你把每個里程碑加上「必交付測試」：

Milestone 1（Tabs + Persist + Connections）
	•	✅ Unit：tab store、persist、per-connection 分檔
	•	✅ Integration：storage 寫入/讀取 round-trip
	•	CI gate：lint + unit 必過

Milestone 2（Query chain + Query runner）
	•	✅ Unit：parser + validator（Firestore chain）
	•	✅ Integration：emulator 跑基本查詢
	•	CI gate：加 integration 必過

Milestone 3（Suggestion）
	•	✅ Unit：completion（keywords + fields）
	•	✅ Integration：FieldStats 從查詢結果增量更新

Milestone 3.1（Query Result 強化）
	•	✅ Unit：JSON viewer formatter（穩定輸出）
	•	Integration：右鍵/雙擊開啟 viewer 並顯示正確 row
	•	Manual：result header sticky + hover 狀態

Milestone 4（Missing index fallback）
	•	✅ Unit：error classifier + fallback plan builder
	•	✅ Integration/Mock：runner 接到 missing index → UI state 進入 fallback 模式

Milestone 5（多 connection 同時開）
	•	✅ Unit：tab 路由到正確 connectionId
	•	✅ Integration：同時對兩個 emulator project（或兩份資料）查詢不互串

Milestone 6（E2E）
	•	✅ E2E：新建 tab → query → results
	•	✅ E2E：persist 恢復
	•	PR gate：視專案成熟度決定是否強制
