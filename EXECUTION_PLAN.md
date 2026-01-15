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
- [ ] `bun run check` 可通過

---

## Milestone 1：App Shell + Tabs + Persist + Connections
狀態：TODO

目標
- 多 tab + 多 connection 的基本流程跑通，並可持久化

交付物
- [ ] Connection manager（profiles CRUD）
- [ ] Workspace/Tab store（Svelte store）
- [ ] Persist 機制（queryText debounce、active tab 立即寫入）
- [ ] 基礎 UI（connection selector / tabs / editor）

任務
- [ ] 定義 data model（ConnectionProfile / WorkspaceState / TabState）
- [ ] 建立 storage layer（connections.json / per-connection workspace.json）
- [ ] 實作 per-connection 狀態隔離與載入
- [ ] 編輯器先用 textarea（之後再換 CodeMirror/Monaco）

驗收條件
- [ ] 可新增/關閉 3 個 tabs，切換時 queryText 不互相污染
- [ ] 切換 dev/prod，tabs 狀態分開保存
- [ ] 重開 app 狀態完整恢復

測試門檻
- [ ] Unit：tab store / persist / per-connection 分檔
- [ ] Integration：storage 讀寫 round-trip

---

## Milestone 2：Query DSL + 基本執行
狀態：TODO

目標
- DSL parse 成 AST，能執行基本查詢並顯示結果

交付物
- [ ] Parser（tokenize + parse）
- [ ] AST validator（語法/規則）
- [ ] Query runner（where/orderBy/limit）
- [ ] 簡易 result viewer（key/value 或 table）

任務
- [ ] 定義 DSL 解析規格（from / where / orderBy / limit）
- [ ] AST → Firestore SDK query mapping
- [ ] 錯誤處理（invalid argument / permission / network）

驗收條件
- [ ] 可對指定 collection 跑 where/orderBy/limit 並顯示結果
- [ ] 無效語法會在 UI 顯示錯誤（lint）

測試門檻
- [ ] Unit：parser + validator
- [ ] Integration：Firestore emulator 基本查詢

---

## Milestone 3：Suggestion（像 IDE）
狀態：TODO

目標
- 即時 suggestion（keywords + fields），體感不卡

交付物
- [ ] Completion engine v1（static + cached fields）
- [ ] FieldStats 初版（從 query results 增量學習）
- [ ] Editor 換成 CodeMirror 6 或 Monaco

任務
- [ ] Trie / hashmap 結構做 keywords/operators/snippets
- [ ] FieldStats cache（per-connection / per-collection）
- [ ] IPC + abort 支援（避免輸入排隊）

驗收條件
- [ ] 在 where 位置能提示 fields
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
- 同一 workspace 同時開 dev/prod，不混線

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
