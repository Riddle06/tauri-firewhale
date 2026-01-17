# 執行計劃（可標注）

## 使用方式
- Milestone 狀態請填：TODO / IN_PROGRESS / DONE
- 任務請用 checkbox：- [ ] 未做 / - [x] 完成
- 每個 Milestone 完成前，必須符合「測試門檻」與「驗收條件」

## 執行順序
- Phase 0 → Milestone 1 → Milestone 2 → Milestone 3 → Milestone 4 → Milestone 5 → Milestone 6

## 專案約定（初始化設定）
- UI：SvelteKit + TypeScript（Tauri v2 template）
- Desktop：Tauri v2（Rust）
- JS runtime：Bun（先承擔 query runner / completion）
- 儲存：Tauri 檔案系統 + secrets 加密存放

---

## Phase 0：專案初始化
狀態：DONE

目標
- 建立可啟動的 Tauri + SvelteKit 專案骨架

任務
- [x] 建立專案骨架（SvelteKit + TypeScript + Bun）
- [x] 安裝依賴（bun install）
- [x] 安裝 Rust toolchain（rustup）
- [x] 確認可啟動桌面開發（bun run tauri dev）
- [x] README 補上本機 prerequisites 與啟動方式

驗收條件
- [x] `bun run tauri dev` 可啟動桌面視窗

測試門檻
- [x] `bun run check` 可通過

---

## Milestone 1.1：App Shell + Tabs + Persist + Connections
狀態：DONE

目標
- 多 tab + 多 connection 的基本流程跑通，並可持久化

交付物
- [x] Connection manager（profiles CRUD）
- [x] Workspace/Tab store（Svelte store）
- [x] Persist 機制（queryText debounce、active tab 立即寫入）
- [x] 基礎 UI（connection selector / tabs / editor）

任務
- [x] 定義 data model（ConnectionProfile / WorkspaceState / TabState）
- [x] 建立 storage layer（connections.json / per-connection workspace.json）
- [x] 實作 per-connection 狀態隔離與載入
- [x] 編輯器先用 textarea（之後再換 CodeMirror/Monaco）

驗收條件
- [x] 可新增/關閉 3 個 tabs，切換時 queryText 不互相污染
- [x] 切換 dev/prod，tabs 狀態分開保存
- [x] 重開 app 狀態完整恢復

測試門檻
- [x] Unit：tab store / persist / per-connection 分檔
- [x] Integration：storage 讀寫 round-trip

---

## Milestone 1.2：Tweak UX details
狀態：IN_PROGRESS

目標
- 程式啟動時, 會有一個主視窗可以先選擇之前儲存或是新增 Connection 的列表, 選擇後會出現一個新視窗, 新視窗 title 會叫做 (<connection_name> - Firewhale)
  - 新增 connection 時需要選擇 credential 的 .json 檔
- 新的視窗的左邊是 collection 的 list（資料來源為 Firestore）
- 支援 create collection（新增後立即出現在 list）
- collection list 以 table list 呈現，過多時 scrollbar 只在 collection block
- 按下 + 或是 New tab 時, 上方的 tab 保留, 下方的內容都需淨空
- UI layout 應該是 Query 在最上方, 下方則會有 Result, 跟 Query Console, 這兩個功能也請用 tab 展示, 預設會是在 Result Tab, 但 User 可以切換到 Query Console 隨時看 console log（含 Run 按鈕）

交付物
- [x] Launcher 主視窗（connection list + 新增/選擇）
- [x] Connection 新增流程（必選 credential 的 .json 檔）
- [x] Workspace 新視窗（title: "<connection_name> - Firewhale"）
- [x] 左側 collection list（取代手動輸入）
- [x] New tab 行為（保留 tabs bar、內容清空、可重新選 collection）
- [x] Query 在上方；Result / Query Console 以 tabs 呈現（預設 Result）
- [x] Create collection（新增 collection 並可選）
- [x] Collection list table layout（含內部 scrollbar）
- [x] Query Run 按鈕

任務
- [x] 定義多視窗流程與路由（Launcher → Workspace；非 Tauri 時降級單窗）
- [x] 連線選擇後開新視窗，並更新視窗 title
- [x] 加入 credential .json 檔案選擇與驗證（副檔名）
- [x] 規劃 collection list 的資料來源與空清單狀態
- [x] 調整 New tab 流程：建立空白 tab、清空 editor/result/console
- [x] 調整主版面：Query 在上方，下方為 Result / Query Console tabs
- [x] 預設顯示 Result tab，可切換到 Query Console
- [x] 移除 mock collections seed
- [x] 新增 create collection 流程（輸入 + 去重 + 立即顯示）
- [x] 調整 collection list 為 table layout + block 內 scrollbar
- [x] 新增 Query Run 按鈕（先 UI）

驗收條件
- [x] 啟動後先看到 Launcher；選擇 connection 會開新 Workspace 視窗
- [x] 新視窗 title 顯示為 "<connection_name> - Firewhale"
- [x] 新增 connection 時必須選擇 credential 的 .json 檔，未選不可建立
- [x] Workspace 左側顯示 collection list（由 Firestore 載入）
- [x] 可新增 collection，新增後立刻出現在 list 並可選
- [x] Collection list 為 table list 且 scrollbar 僅在 collection block
- [x] 按 + / New tab 後，tabs bar 保留、下方內容清空
- [x] Query 在最上方；Result / Query Console 以 tabs 呈現
- [x] 預設顯示 Result tab，且可切換到 Query Console 查看 log
- [x] Query 區域顯示 Run 按鈕

測試門檻
- [x] Unit：New tab 清空行為、connection 建立驗證（需選檔）
- [x] Integration：選擇 connection 會開新視窗並帶入正確 title（可先手動驗證）
- [x] Unit：Result / Query Console tab 切換狀態維持正確

---

## Milestone 2：Query Chain + 基本執行
狀態：IN_PROGRESS

目標
- Firestore chain parse 成 AST，能執行基本查詢並顯示結果

交付物
- [x] Parser（Firestore chain tokenize + parse）
- [x] AST validator（語法/規則）
- [x] Query runner（collection/where/orderBy/limit/get；目前為 mock data）
- [x] 簡易 result viewer（table + row summary）
- [x] Firestore collection list loader（service account）

任務
- [x] 定義 Firestore chain 解析規格（db.collection / where / orderBy / limit / get）
- [x] AST → query runner mapping（目前為 mock data）
- [x] 錯誤處理（invalid argument）
- [x] 透過 service account 撈取 collection list

驗收條件
- [x] 可對指定 collection 跑 collection/where/orderBy/limit/get 並顯示結果
- [x] 無效語法會在 UI 顯示錯誤（lint）

測試門檻
- [x] Unit：parser + validator
- [x] Integration：Firestore emulator 基本查詢

---

## Milestone 3：Suggestion（像 IDE）
狀態：TODO

目標
- 即時 suggestion（keywords + collection + fields），體感不卡

交付物
- [ ] Completion engine v1（static + cached fields）
- [ ] FieldStats 初版（從 query results 增量學習）
- [ ] Editor 換成 CodeMirror 6 或 Monaco

任務
- [ ] Trie / hashmap 結構做 keywords/operators/snippets
- [ ] collection('<collection>') 位置的本地歷史 suggestion
- [ ] FieldStats cache（per-connection / per-collection）
- [ ] IPC + abort 支援（避免輸入排隊）

驗收條件
- [ ] 在 collection('<collection>') 位置能提示 collections
- [ ] 在 where/orderBy 位置能提示 fields
- [ ] 提示延遲接近即時，不卡字

測試門檻
- [ ] Unit：completion（keywords + fields）
- [ ] Integration：FieldStats 增量更新

---

## Milestone 4：Missing Index Fallback
狀態：TODO

目標
- 缺 index 時提示建立 index，並提供 fallback

交付物
- [ ] Error classifier（missing index / permission / invalid argument）
- [ ] Fallback plan builder + executor
- [ ] UI 確認卡片與警告文案

任務
- [ ] missing index error pattern parsing
- [ ] fallback（保留 where、移除 orderBy、設 fetchCap）
- [ ] client-side sort（標示限制）

驗收條件
- [ ] 觸發缺 index → UI 顯示 fallback 選項
- [ ] Confirm 後能跑出結果並顯示限制提示

測試門檻
- [ ] Unit：error classifier + fallback plan
- [ ] Integration/Mock：runner 接到 missing index 進入 fallback 模式

---

## Milestone 5：多 Connection 同時開
狀態：TODO

目標
- 同一 workspace 同時開 dev/prod，不混線 (dev 跟 prod 只是範例, workspace 指的是不同的 env)

交付物
- [ ] multi-client 管理（依 connectionId 路由）
- [ ] tab 顯示 connection badge
- [ ] prod 顯眼提示（顏色/標示）

驗收條件
- [ ] 同時開 dev/users 與 prod/users
- [ ] Query 執行確實打到對的環境

測試門檻
- [ ] Unit：tab 路由到正確 connectionId
- [ ] Integration：同時對兩份資料查詢不互串

---

## Milestone 6：打磨與效率 + E2E
狀態：TODO

目標
- 交互完善並加入端對端測試

交付物（可選）
- [ ] tab reorder / duplicate
- [ ] result grid 虛擬化
- [ ] copy/export（JSON/CSV）
- [ ] query history
- [ ] 快捷鍵（Run / New Tab / Switch Tab）

E2E（桌面或 Web UI 模式）
- [ ] 新建 tab → query → results
- [ ] persist 恢復
- [ ] missing index fallback 流程

測試門檻
- [ ] E2E 可在 main 或 nightly 先跑

---

## CI / 開發規範（持續性工作）
狀態：TODO

任務
- [ ] GitHub Actions：lint + unit + integration
- [ ] Firestore emulator + seed script
- [ ] pre-push hook（bun test + bun run check）
- [ ] branch protection（require status checks）

驗收條件
- [ ] PR 必須通過 lint-and-unit + integration
- [ ] E2E 視成熟度加入 PR gate
