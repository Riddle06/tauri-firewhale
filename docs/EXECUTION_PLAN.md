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
狀態：DONE

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
狀態：DONE

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
狀態：DONE

目標
- 即時 suggestion（keywords + collection + fields），體感不卡

交付物
- [x] Completion engine v1（static + cached fields）
- [x] FieldStats 初版（從 query results 增量學習）
- [x] Editor 換成 CodeMirror 6 或 Monaco

任務
- [x] Trie / hashmap 結構做 keywords/operators/snippets
- [x] collection('<collection>') 位置的本地歷史 suggestion
- [x] FieldStats cache（per-connection / per-collection）
- [ ] IPC + abort 支援（避免輸入排隊）

驗收條件
- [x] 在 collection('<collection>') 位置能提示 collections
- [x] 在 where/orderBy 位置能提示 fields
- [x] 提示延遲接近即時，不卡字

測試門檻
- [x] Unit：completion（keywords + fields）
- [x] Integration：FieldStats 增量更新
- ---

## Milestone 3.1： 強化 Query Result 的功能
狀態：DONE

目標
- Collection List 跟 Query Result List 需要有 hover 的效果
- Query Result 的 row 要支援點擊右鍵 有 view as JSON, 或是針對該 row double click 也會 trigger view as JSON
  - 點擊了之後會有一個視窗出來, 會是該 doc 的內容
  - 該 document 要有 colorful highlight
- Query Result 的 欄位名稱要是 freeze 的, (捲軸往下滾  欄位名稱還是要在)

交付物
- [x] Collection list / Query result list hover 狀態
- [x] Query result row context menu（View as JSON）+ double click 觸發
- [x] JSON viewer 視窗（syntax highlight + formatted JSON）
- [x] Query result header freeze（scroll 時欄位名稱固定）


任務
- [x] 補齊 collection list / result rows hover 樣式
- [x] 結果列互動（右鍵選單、double click）
- [x] JSON viewer 視窗（開關、資料綁定、格式化、highlight）
- [x] 表格 header sticky（配合 scroll 容器調整）


驗收條件
- [x] Collection list 與 Query result list hover 明顯可辨
- [x] 結果列右鍵與 double click 都能打開 JSON viewer
- [x] JSON viewer 顯示該 row 完整內容且有語法高亮
- [x] Query result 欄位名稱在捲動時保持固定


測試門檻
- [x] Unit：JSON viewer formatter（縮排/穩定輸出）
- [x] Integration：右鍵/雙擊開啟 viewer 並顯示正確 row
- [x] Manual：結果表格捲動時 header 不消失

---

## Milestone 3.2： 強化 Query Result 的功能 (edit document)
狀態：DONE

目標
- Query Result 的 row 點擊右鍵多了一個功能 Edit document
  - 點擊了之後會有一個視窗出來, 會是該 doc 的內容
  - 該 document 要有 JSON colorful highlight
  - Edit Window 的最下方會有 save 跟 cancel 的 button
   -  Save 代表儲存該 doc 並關閉視窗, 且 Query Result 的該列需要更新
   -  Cancel 代表取消操作 並關閉視窗
  - 儲存時請注意日期型別的部分, 不要存成字串, 應該要存成 firestore 的 Timestamp

交付物
- [x] Query result row 右鍵選單新增 Edit document
- [x] Edit Document 視窗（可編輯 JSON + colorful highlight）
- [x] Save / Cancel 操作（含 JSON 校驗與錯誤提示）
- [x] Save 後更新 Firestore doc 並同步更新結果列

任務
- [x] 定義 Edit document 互動流程（開啟/關閉/dirty state/錯誤狀態）
- [x] UI：新增 Edit document 右鍵選項與開窗
- [x] JSON 編輯器：載入 doc、可編輯、保留語法高亮
- [x] JSON parse/validation，無效時禁止 Save 並顯示錯誤
- [x] Save：呼叫更新 API（Firestore）+ 更新結果列資料
- [x] Cancel：丟棄修改並關閉視窗

驗收條件
- [x] 右鍵 row 有 Edit document，點擊後開啟編輯視窗
- [x] 視窗內顯示該 doc 的格式化 JSON，且有語法高亮
- [x] Cancel 會關閉視窗且不更動結果列
- [x] JSON 無效時 Save disabled 並顯示提示
- [x] Save 成功後關閉視窗，結果列資料即時更新（不需重新查詢）
- [x] Save 失敗時顯示錯誤且保留編輯內容

測試門檻
- [x] Unit：JSON 編輯輸入/輸出格式化、invalid JSON 校驗、dirty state 判斷
- [x] Integration：更新 doc 後結果列資料更新（emulator 或 mock）
- [x] Manual：視窗開啟/關閉、語法高亮、Save/Cancel 行為

---

## Milestone 4：Client-side pagination mode 
狀態：TODO

目標
- 於 `Run` Button 的下方多一個 checkbox button, named: Client-side pagination mode
- 如果 Client-side pagination mode 是 enable 的, 在 query firestore 就會略過 orderBy 跟 Limit 的參數,然後透過前端做 order by 跟 pagination
- 另外就是該功能 enable 之後, 會先用 count query 數量, 如果數量大於 1000 (這個未來可以調整), 會先跳出警告: 
> You are currently using client-side pagination.
> This action will fetch approximately {xx} records in a single request.
> Loading this amount of data may take longer and result in higher query costs.
> Are you sure you want to continue?
  - 如果 user 點擊確認才會 query
  - 另外這個 query 有一個條件就是至少要下一種 where condition


交付物
- [ ] Client-side pagination mode checkbox（Run 下方）+ per-tab 狀態
- [ ] Count query + threshold 警告視窗（>1000）
- [ ] Client-side 排序 + 分頁 pipeline（忽略 orderBy/limit）
- [ ] Query guard：至少一個 where 才可執行
- [ ] 分頁切換使用前端資料（不重新查 Firestore）

任務
- [ ] 定義 client-side pagination 設定與儲存（per-tab）
- [ ] UI：Run 下方加入 checkbox 與說明文案
- [ ] Firestore：新增 count query（aggregation）與 threshold 常數
- [ ] UI：count 超過 threshold 時彈警告，確認才繼續
- [ ] Runner：啟用時移除 orderBy/limit，抓取完整結果，前端套用排序/分頁
- [ ] 驗證：無 where 時阻擋執行並回傳可讀錯誤

驗收條件
- [ ] Run 下方顯示 Client-side pagination mode checkbox，切換僅影響該 tab
- [ ] 啟用時 Firestore request 不帶 orderBy/limit，前端套用排序/分頁結果正確
- [ ] count > 1000 先顯示警告，確認才送出查詢；取消不執行
- [ ] 啟用且無 where 時會阻擋執行並提示原因
- [ ] 關閉時維持原本 server-side orderBy/limit/page 行為

測試門檻
- [ ] Unit：client-side 排序/分頁、orderBy/limit 移除、where guard
- [ ] Integration：count query + confirm gating；client-side 分頁結果正確
- [ ] Manual：警告文案與 checkbox 位置/交互符合描述



---

## Milestone 5 ：打磨與效率 + E2E
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
