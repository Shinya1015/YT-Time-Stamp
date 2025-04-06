// ========================================================================
// タイムスタンプ記録 Extension (Strategy 5 + ON/OFF Toggle) - v3
// ========================================================================
(function() {
    'use strict';
    // 日誌標籤，方便過濾
    const LOG_TAG = "[Timestamp Ext]";
    console.log(LOG_TAG, "コンテンツスクリプト 実行開始！ (Strategy 5 + Toggle v3)");

    // --- 全域變數 ---
    let isExtensionEnabled = true; // 追蹤擴充功能啟用狀態，預設為 true
    let timestamps = [];
    let isDraggingContainer = false;
    let offsetX = 0, offsetY = 0;
    let container, recordBtn, lockButton, hideButton;
    let editorPane, displayPane, bulkEditor, displayListContainer, displayListElement, currentTimeDisplay;
    let topBarElement, bottomBarElement, mainContentElement, resizerElement;
    let isLocked = false;
    let sortState = null;
    let isHidden = localStorage.getItem('timestampHiddenState') === 'true';
    let firstTimeUser = localStorage.getItem('timestampFirstTime') === null;
    let currentTimeInterval = null;
    let pageObserver = null; // For SPA navigation
    let dragStartTime = 0;
    let isDraggingFromHideButton = false;
    let hideButtonDragged = false;
    let editorChangeTimeout = null;
    let hideButtonLastViewportPos = { left: 0, top: 0 };
    let isDraggingModal = false;
    let modalOffsetX = 0, modalOffsetY = 0;
    let rafDragId = null;
    let rafModalDragId = null;
    let isResizingPanes = false;
    let resizeStartX = 0;
    let startEditorWidth = 0;
    let startDisplayWidth = 0;
    let containerResizeObserver = null;
    let resizeTimeout = null;
    let initTimeoutId = null; // Track runInitialization setTimeout
    let messageTimeoutId = null; // Track showMessage timeout

    // --- 常數定義 ---
    const STORAGE_KEY_ENABLED = 'extensionEnabled';
    const CONTAINER_ID = 'ts-container-main';
    const DRAG_THRESHOLD = 150;
    const DRAG_MOVE_THRESHOLD = 5;
    const EDITOR_DEBOUNCE_MS = 400;
    const RESIZE_DEBOUNCE_MS = 100;
    const TIME_REGEX = /^(\d+):(\d{2}):(\d{2})/;
    const MIN_PANE_WIDTH = 100;
    const MAX_INIT_RETRIES = 45;
    const INIT_RETRY_BASE_DELAY = 1500;
    const INIT_RETRY_INCREMENT = 200;

    // --- 清理函數 ---
    function cleanupExtensionUI() {
        console.log(LOG_TAG, "執行清理...");
        // Stop intervals and observers
        if (typeof stopCurrentTimeUpdate === 'function') stopCurrentTimeUpdate();
        if (typeof closeExistingContextMenu === 'function') closeExistingContextMenu();
        if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e) { console.warn(LOG_TAG, "清理 ResizeObserver 時出錯:", e); } containerResizeObserver = null; }
        // Clear timeouts
        if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null;
        if (editorChangeTimeout) clearTimeout(editorChangeTimeout); editorChangeTimeout = null;
        if (messageTimeoutId) clearTimeout(messageTimeoutId); messageTimeoutId = null;
        if (resizeTimeout) clearTimeout(resizeTimeout); resizeTimeout = null;
        // Cancel animation frames
        if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId = null;
        if (rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = null;
        // Remove UI container
        const uiContainer = document.getElementById(CONTAINER_ID);
        if (uiContainer) { try { uiContainer.remove(); } catch(e) { console.warn(LOG_TAG, "清理 UI 容器時出錯:", e); } }
        // Reset global variables related to UI elements
        container = recordBtn = lockButton = hideButton = editorPane = displayPane = bulkEditor = displayListContainer = displayListElement = currentTimeDisplay = topBarElement = bottomBarElement = mainContentElement = resizerElement = null;
        // Reset state variables if necessary
        isDraggingContainer = false; isDraggingFromHideButton = false; hideButtonDragged = false; isResizingPanes = false;
        initRetryCount = 0; // Reset init counter
        console.log(LOG_TAG, "清理完成。");
    }

    // --- 函數定義 ---

    function showMessage(message, type = 'info', duration = 3000) {
        try {
            const existingBox = document.getElementById('ts-message-box-instance');
            if (existingBox) existingBox.remove();
            if (messageTimeoutId) clearTimeout(messageTimeoutId);

            const messageBox = document.createElement("div");
            messageBox.id = 'ts-message-box-instance';
            messageBox.textContent = message;
            messageBox.className = `ts-message-box ${type}`;
            (document.body || document.documentElement).appendChild(messageBox);

            requestAnimationFrame(() => { requestAnimationFrame(() => { messageBox.classList.add('visible'); }); });

            const currentTimeoutId = setTimeout(() => {
                if (!messageBox.parentNode) return;
                messageBox.classList.remove('visible'); messageBox.classList.add('fade-out');
                const transitionDuration = 400;
                const removeLogic = () => {
                    if (messageBox.parentNode) { try { messageBox.remove(); } catch(e){} }
                    if (messageTimeoutId === currentTimeoutId) { messageTimeoutId = null; }
                };
                messageBox.addEventListener('transitionend', removeLogic, { once: true });
                setTimeout(removeLogic, transitionDuration + 100);
            }, duration);
            messageTimeoutId = currentTimeoutId;
        } catch (e) { console.error(LOG_TAG, "showMessage failed:", e, message); }
    }
    function showSuccessMessage(message) { showMessage(message, 'success', 2500); }
    function showErrorMessage(message) { showMessage(message, 'error', 5000); }
    function showInfoMessage(message) { showMessage(message, 'info', 3000); }
    function showJumpSuccessMessage(timestamp) { showMessage(`ジャンプ成功: ${timestamp}`, 'jump', 2000); }
    function showCopySuccessMessage(text) { showMessage(`${text}`, 'success', 2000); }

    function applySavedPaneWidths() {
        try {
            const savedEditorWidthPx = localStorage.getItem('timestampEditorWidth');
            if (editorPane && displayPane && resizerElement && savedEditorWidthPx) {
                setTimeout(() => {
                    if (!editorPane || !editorPane.parentElement || !resizerElement) return;
                    const totalWidth = editorPane.parentElement.clientWidth;
                    const resizerW = resizerElement.offsetWidth;
                    const availableWidth = totalWidth - resizerW;
                    const editorW = parseFloat(savedEditorWidthPx);
                    if (availableWidth > (MIN_PANE_WIDTH * 2) && !isNaN(editorW) && editorW >= MIN_PANE_WIDTH && (availableWidth - editorW) >= MIN_PANE_WIDTH) {
                        editorPane.style.width = `${editorW}px`; displayPane.style.width = `${availableWidth - editorW}px`;
                        editorPane.style.flexBasis = ''; displayPane.style.flexBasis = '';
                    } else {
                        console.warn(LOG_TAG, "保存されたエディター幅が無効または範囲外です。デフォルトの比率を使用します。");
                        editorPane.style.width = ''; displayPane.style.width = '';
                        editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
                    }
                }, 0);
            } else if (editorPane && displayPane) {
                editorPane.style.width = ''; displayPane.style.width = '';
                editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
            }
        } catch(e) {
             console.error(LOG_TAG, "Error applying saved pane widths:", e);
             if (editorPane && displayPane) { editorPane.style.width = ''; displayPane.style.width = ''; editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%'; }
        }
    }

    function loadState() {
        try {
            const storedTimestamps = localStorage.getItem('timestamps');
            if (storedTimestamps) { try { timestamps = JSON.parse(storedTimestamps); } catch (e) { console.error(LOG_TAG, 'タイムスタンプの読み込みに失敗:', e); timestamps = []; } } else { timestamps = []; }
            isLocked = localStorage.getItem('timestampLockState') === 'true';
            isHidden = localStorage.getItem('timestampHiddenState') === 'true';
            firstTimeUser = localStorage.getItem('timestampFirstTime') === null;
            sortState = null;
            if (typeof applySavedPaneWidths === 'function') applySavedPaneWidths();
            if (bulkEditor && displayListElement && typeof populateEditorFromTimestamps === 'function' && typeof renderTimestampList === 'function') {
                 populateEditorFromTimestamps();
                 renderTimestampList();
            } else { console.warn(LOG_TAG, "loadState: bulkEditor or displayListElement not ready."); }
        } catch(e) { console.error(LOG_TAG, "Error in loadState:", e); }
    }

    function saveTimestamps() {
        try {
            const cleanedTimestamps = timestamps.map(ts => String(ts).trim()).filter(ts => ts.length > 0);
            if (JSON.stringify(timestamps) !== JSON.stringify(cleanedTimestamps)) { timestamps = cleanedTimestamps; }
            localStorage.setItem('timestamps', JSON.stringify(timestamps));
        } catch (e) { console.error(LOG_TAG, "Failed to save timestamps:", e); if (typeof showErrorMessage === 'function') showErrorMessage("タイムスタンプ保存失敗！"); }
    }

    function saveContainerPosition() {
        if (!container) return;
        try {
            const rect = container.getBoundingClientRect();
            const position = {
                left: container.style.left || `${rect.left}px` || "360px", top: container.style.top || `${rect.top}px` || "500px",
                width: container.style.width || `${rect.width}px` || "680px", height: container.style.height || `${rect.height}px` || "380px"
            };
            localStorage.setItem('timestampContainerPosition', JSON.stringify(position));
            if (editorPane && editorPane.style.width.endsWith('px') && !isResizingPanes) { localStorage.setItem('timestampEditorWidth', editorPane.style.width); }
        } catch (e) { console.error(LOG_TAG, "Failed to save container position/size:", e); }
    }

    function loadContainerPosition() {
        const defaultPos = { left: "360px", top: "500px", width: "680px", height: "380px" };
        const savedPosition = localStorage.getItem('timestampContainerPosition');
        if (savedPosition) { try { const pos = JSON.parse(savedPosition); if (pos && typeof pos.left === 'string' && typeof pos.top === 'string') { pos.width = pos.width || defaultPos.width; pos.height = pos.height || defaultPos.height; return pos; } } catch (e) { console.error(LOG_TAG, '位置情報読み込み失敗:', e); } }
        return defaultPos;
    }

    function formatTime(totalSeconds) {
        totalSeconds = Math.max(0, Math.floor(totalSeconds)); const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60); const s = totalSeconds % 60;
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function updateTimeDisplay() {
        try {
            const video = document.querySelector('video');
            if (currentTimeDisplay) {
                if (video && typeof video.currentTime === 'number' && !isNaN(video.currentTime)) { currentTimeDisplay.textContent = `再生時間 ${formatTime(video.currentTime)}`; }
                else { currentTimeDisplay.textContent = '再生時間 --:--:--'; }
            }
        } catch (e) { console.error(LOG_TAG, "Error updating time display:", e); if (currentTimeDisplay) currentTimeDisplay.textContent = '時刻表示エラー'; }
    }

    function startCurrentTimeUpdate() {
        stopCurrentTimeUpdate();
        try {
            const video = document.querySelector('video');
            if (video && video.readyState >= 1) { updateTimeDisplay(); currentTimeInterval = setInterval(updateTimeDisplay, 1000); }
            else if (video) { const onMetadataLoaded = () => { if (video.readyState >= 1) { updateTimeDisplay(); currentTimeInterval = setInterval(updateTimeDisplay, 1000); } video.removeEventListener('loadedmetadata', onMetadataLoaded); }; video.addEventListener('loadedmetadata', onMetadataLoaded); }
        } catch (e) { console.error(LOG_TAG, "Error starting current time update:", e); }
    }

    function stopCurrentTimeUpdate() { if (currentTimeInterval) { clearInterval(currentTimeInterval); currentTimeInterval = null; } }

    function recordTimestamp() {
        try {
            const video = document.querySelector('video');
            if (video && typeof video.currentTime === 'number' && !isNaN(video.currentTime)) {
                const currentTime = video.currentTime; let maxNum = 0;
                timestamps.forEach(ts => { const match = String(ts).match(/\[(\d+)\]$/); if (match?.[1]) { const num = parseInt(match[1], 10); if (!isNaN(num) && num > maxNum) maxNum = num; } });
                const nextNumber = maxNum + 1; const defaultText = ` [${nextNumber.toString().padStart(2, '0')}]`; const formattedTimestamp = `${formatTime(currentTime)}${defaultText}`;
                timestamps.push(formattedTimestamp); saveTimestamps();
                if(typeof populateEditorFromTimestamps === 'function') populateEditorFromTimestamps();
                sortState = null; if(typeof updateSortButtonText === 'function') updateSortButtonText(); if(typeof renderTimestampList === 'function') renderTimestampList();
                if (firstTimeUser && timestamps.length === 1) { localStorage.setItem('timestampFirstTime', 'false'); firstTimeUser = false; }
                if (bulkEditor) { setTimeout(() => { bulkEditor.scrollTop = bulkEditor.scrollHeight; }, 0); }
            } else { console.error(LOG_TAG, "Cannot record: Video not ready or currentTime invalid.", video, video?.currentTime); showErrorMessage("動画が見つからないか、再生時間を取得できません。"); }
        } catch (err) { console.error(LOG_TAG, "Error recording timestamp:", err); showErrorMessage("記録エラー: " + err.message); }
    }

    function adjustTimestamp(index, adjustment) {
        if (index < 0 || index >= timestamps.length) return; const timestamp = String(timestamps[index]); const match = timestamp.match(TIME_REGEX);
        if (match) {
            try {
                let h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10); if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error("時間解析エラー");
                let totalSeconds = h * 3600 + m * 60 + s + adjustment; totalSeconds = Math.max(0, totalSeconds);
                const newFormattedTime = formatTime(totalSeconds); const restOfString = timestamp.substring(match[0].length);
                const newTimestamp = `${newFormattedTime}${restOfString}`; timestamps[index] = newTimestamp; saveTimestamps();
                 if(typeof populateEditorFromTimestamps === 'function') populateEditorFromTimestamps(); if(typeof renderTimestampList === 'function') renderTimestampList(); if(typeof jumpToTimestamp === 'function') jumpToTimestamp(newTimestamp);
            } catch (e) { console.error(LOG_TAG, "Error adjusting timestamp:", e); showErrorMessage("時間調整エラー。"); }
        } else { showErrorMessage("時間調整エラー：時間形式 (HH:MM:SS) が見つかりません。"); }
    }

    function deleteTimestamp(index) {
        if (index < 0 || index >= timestamps.length) return;
        try {
            timestamps.splice(index, 1); saveTimestamps(); if(typeof populateEditorFromTimestamps === 'function') populateEditorFromTimestamps();
            sortState = null; if(typeof updateSortButtonText === 'function') updateSortButtonText(); if(typeof renderTimestampList === 'function') renderTimestampList();
        } catch (e) { console.error(LOG_TAG, "Error deleting timestamp:", e); showErrorMessage("削除エラー。"); }
    }

    function jumpToTimestamp(timestamp) {
        const timestampStr = String(timestamp); const match = timestampStr.match(TIME_REGEX);
        if (match) {
            try {
                const h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10); if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error("時間解析エラー");
                const totalSeconds = h * 3600 + m * 60 + s; const video = document.querySelector('video');
                if (video) {
                    if (!isNaN(video.duration) && totalSeconds > video.duration) { video.currentTime = video.duration; } else { video.currentTime = totalSeconds; }
                    if (typeof video.play === 'function') { video.play().catch(e => console.warn(LOG_TAG, "再生失敗 (play promise rejected):", e.message)); } showJumpSuccessMessage(match[0]);
                } else { showErrorMessage("動画プレーヤーが見つかりません。"); }
            } catch (e) { console.error(LOG_TAG, "Error jumping to timestamp:", e); showErrorMessage("ジャンプエラー。"); }
        } else { showErrorMessage(`ジャンプエラー：時間形式 (HH:MM:SS) が見つかりません。(${timestampStr.substring(0, 10)}...)`); }
    }

    function parseTimeToSeconds(timeString) { const match = String(timeString).match(TIME_REGEX); if (match?.[1] && match?.[2] && match?.[3]) { try { const h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10); if (!isNaN(h) && !isNaN(m) && !isNaN(s)) return h * 3600 + m * 60 + s; } catch (e) {} } return null; }
    function toggleSortOrder() { if (sortState === null) sortState = true; else if (sortState === true) sortState = false; else sortState = null; if(typeof renderTimestampList === 'function') renderTimestampList(); if(typeof updateSortButtonText === 'function') updateSortButtonText(); }
    function updateSortButtonText() { try { const btn = document.getElementById('ts-sort-button'); if (!btn) return; if (sortState === true) btn.textContent = "時間昇順 ▲"; else if (sortState === false) btn.textContent = "時間降順 ▼"; else btn.textContent = "元の順序"; btn.style.transform = "scale(0.95)"; setTimeout(() => { if (btn) btn.style.transform = "scale(1)"; }, 100); } catch(e) { console.error(LOG_TAG, "Error updating sort button text:", e); } }
    function deleteAllTimestampsConfirmed() { try { timestamps = []; saveTimestamps(); if (bulkEditor) bulkEditor.value = ''; sortState = null; if(typeof updateSortButtonText === 'function') updateSortButtonText(); if(typeof renderTimestampList === 'function') renderTimestampList(); showInfoMessage("すべての記録が削除されました。"); } catch (error) { console.error(LOG_TAG, "Error in deleteAllTimestampsConfirmed:", error); showErrorMessage("全削除処理中にエラーが発生しました。"); } }
    let contextMenuCloseListener = null; function closeExistingContextMenu() { try { const menu = document.getElementById('timestamp-context-menu'); if (menu) menu.remove(); if (contextMenuCloseListener) { document.removeEventListener('click', contextMenuCloseListener, { capture: true }); document.removeEventListener('contextmenu', contextMenuCloseListener, { capture: true }); contextMenuCloseListener = null; } } catch (e) { console.warn(LOG_TAG, "Error closing context menu:", e); } }
    function showConfirmDeleteAllModal() { let modalOverlay = null; try { closeExistingContextMenu(); const existingModal = document.getElementById('ts-confirm-modal'); if (existingModal) existingModal.remove(); modalOverlay = document.createElement("div"); modalOverlay.id = "ts-confirm-modal"; modalOverlay.className = "ts-modal-overlay"; const modalContent = document.createElement("div"); modalContent.className = "ts-modal-content"; const message = document.createElement("p"); message.textContent = "すべての記録を削除しますか？"; message.className = "ts-modal-message"; const buttonContainer = document.createElement("div"); buttonContainer.className = "ts-modal-buttons"; const cancelButton = document.createElement("button"); cancelButton.textContent = "いいえ"; cancelButton.className = "ts-modal-button ts-modal-cancel"; cancelButton.onclick = () => { try { modalOverlay.remove(); } catch(e) {} }; const confirmButton = document.createElement("button"); confirmButton.textContent = "削除"; confirmButton.className = "ts-modal-button ts-modal-confirm"; confirmButton.onclick = () => { try { deleteAllTimestampsConfirmed(); modalOverlay.remove(); } catch (e) { console.error(LOG_TAG, "Error during deleteAll/modal removal:", e); showErrorMessage("削除処理中にエラーが発生しました。"); if (modalOverlay?.parentNode) { try { modalOverlay.remove(); } catch(e) {} } } }; buttonContainer.append(cancelButton, confirmButton); modalContent.append(message, buttonContainer); modalOverlay.appendChild(modalContent); document.body.appendChild(modalOverlay); modalContent.style.position = 'absolute'; modalContent.style.cursor = 'move'; modalContent.addEventListener('mousedown', (e) => { if (e.target !== modalContent || e.button !== 0) return; isDraggingModal = true; const overlayRect = modalOverlay.getBoundingClientRect(); const contentRect = modalContent.getBoundingClientRect(); modalOffsetX = e.clientX - contentRect.left; modalOffsetY = e.clientY - contentRect.top; const initialLeft = contentRect.left - overlayRect.left; const initialTop = contentRect.top - overlayRect.top; document.body.style.userSelect = 'none'; const modalMoveHandler = (moveEvent) => { if (!isDraggingModal) return; if(rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = requestAnimationFrame(() => { let newX = initialLeft + (moveEvent.clientX - e.clientX); let newY = initialTop + (moveEvent.clientY - e.clientY); modalContent.style.left = `${newX}px`; modalContent.style.top = `${newY}px`; rafModalDragId = null; }); }; const modalUpHandler = () => { if(rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = null; if (isDraggingModal) { isDraggingModal = false; document.body.style.userSelect = ''; document.removeEventListener('mousemove', modalMoveHandler); document.removeEventListener('mouseup', modalUpHandler); } }; document.addEventListener('mousemove', modalMoveHandler); document.addEventListener('mouseup', modalUpHandler, { once: true }); e.preventDefault(); }); cancelButton.focus(); } catch (error) { console.error(LOG_TAG, "Error showing delete confirmation modal:", error); showErrorMessage("削除確認ウィンドウ表示中にエラー発生"); if (modalOverlay?.parentNode) { try { modalOverlay.remove(); } catch(e) {} } } }
    function copyAllTimestamps() { if (!bulkEditor || bulkEditor.value.trim() === '') { showInfoMessage("コピーする記録はありません。"); return; } const textToCopy = bulkEditor.value; navigator.clipboard.writeText(textToCopy).then(() => { const lineCount = textToCopy.split('\n').filter(line => line.trim() !== '').length; showCopySuccessMessage(`エディター内容 全${lineCount}行コピー！`); }).catch(err => { console.error(LOG_TAG, 'コピー失敗:', err); showErrorMessage("コピーに失敗しました。"); }); }
    function copySingleTimestamp(text) { if (!text) return; navigator.clipboard.writeText(String(text)).then(() => { showCopySuccessMessage(`コピー: ${String(text).substring(0, 50)}${String(text).length > 50 ? '...' : ''}`); }).catch(err => { console.error(LOG_TAG, 'コピー失敗:', err); showErrorMessage("コピー失敗。"); }); }
    function toggleLock() { isLocked = !isLocked; localStorage.setItem('timestampLockState', isLocked.toString()); applyLockState(); if (lockButton) { lockButton.style.transform = "scale(0.95)"; setTimeout(() => { if (lockButton) lockButton.style.transform = "scale(1)"; }, 100); } }
    function applyLockState() { if (!lockButton || !container || !bulkEditor || !topBarElement || !bottomBarElement || !resizerElement) { console.warn(LOG_TAG, "applyLockState: Elements missing."); return; } try { lockButton.textContent = isLocked ? "アンロック" : "ロック"; lockButton.classList.toggle('ts-locked', isLocked); lockButton.classList.toggle('ts-unlocked', !isLocked); bulkEditor.readOnly = isLocked; bulkEditor.style.backgroundColor = isLocked ? '#eee' : '#fff'; bulkEditor.style.cursor = isLocked ? 'not-allowed' : ''; topBarElement.style.cursor = isLocked ? 'default' : 'move'; bottomBarElement.style.cursor = isLocked ? 'default' : 'move'; topBarElement.classList.toggle('ts-locked', isLocked); bottomBarElement.classList.toggle('ts-locked', isLocked); const originalResize = container.dataset?.originalResize || 'both'; container.style.resize = isLocked ? 'none' : originalResize; container.classList.toggle('ts-locked', isLocked); resizerElement.style.display = isLocked ? 'none' : 'block'; resizerElement.style.cursor = isLocked ? 'default' : 'col-resize'; } catch(e) { console.error(LOG_TAG, "Error applying lock state:", e); } }
    function toggleVisibility() { if (hideButtonDragged) { hideButtonDragged = false; return; } isHidden = !isHidden; localStorage.setItem('timestampHiddenState', isHidden.toString()); applyHiddenState(); if (hideButton) { hideButton.style.transform = "scale(0.95)"; setTimeout(() => { if (hideButton) hideButton.style.transform = "scale(1)"; }, 100); } }
    function applyHiddenState() { if (!container || !hideButton || !topBarElement || !mainContentElement || !bottomBarElement || !resizerElement) { console.warn(LOG_TAG, "applyHiddenState: Elements missing."); return; } try { if (!container.dataset.originalBg) container.dataset.originalBg = window.getComputedStyle(container).backgroundColor; if (!container.dataset.originalBorder) container.dataset.originalBorder = window.getComputedStyle(container).border; if (!container.dataset.originalBoxShadow) container.dataset.originalBoxShadow = window.getComputedStyle(container).boxShadow; if (!container.dataset.originalPointerEvents) container.dataset.originalPointerEvents = window.getComputedStyle(container).pointerEvents; if (!container.dataset.originalOverflow) container.dataset.originalOverflow = window.getComputedStyle(container).overflow; if (!container.dataset.originalResize) container.dataset.originalResize = window.getComputedStyle(container).resize || 'both'; if (isHidden) { topBarElement.style.visibility = 'hidden'; mainContentElement.style.visibility = 'hidden'; bottomBarElement.style.visibility = 'hidden'; resizerElement.style.visibility = 'hidden'; container.style.backgroundColor = 'transparent'; container.style.border = 'none'; container.style.boxShadow = 'none'; container.style.resize = 'none'; container.style.overflow = 'visible'; container.style.pointerEvents = 'none'; const rect = (hideButtonLastViewportPos.left !== 0 || hideButtonLastViewportPos.top !== 0) ? hideButtonLastViewportPos : hideButton.getBoundingClientRect(); hideButton.style.position = 'fixed'; hideButton.style.left = `${rect.left}px`; hideButton.style.top = `${rect.top}px`; hideButton.style.visibility = 'visible'; hideButton.style.pointerEvents = 'auto'; hideButton.style.zIndex = '9999'; hideButton.textContent = "表示"; hideButton.classList.add('ts-hidden-state'); hideButton.classList.remove('ts-visible-state'); } else { container.style.pointerEvents = container.dataset.originalPointerEvents || 'auto'; container.style.backgroundColor = container.dataset.originalBg || 'rgba(240, 240, 240, 0.95)'; container.style.border = container.dataset.originalBorder || '1px solid #a0a0a0'; container.style.boxShadow = container.dataset.originalBoxShadow || '0 4px 12px rgba(0,0,0,0.2)'; container.style.overflow = container.dataset.originalOverflow || 'hidden'; topBarElement.style.visibility = 'visible'; mainContentElement.style.visibility = 'visible'; bottomBarElement.style.visibility = 'visible'; resizerElement.style.visibility = 'visible'; hideButton.style.position = ''; hideButton.style.left = ''; hideButton.style.top = ''; hideButton.style.zIndex = ''; hideButton.style.visibility = 'visible'; hideButton.style.pointerEvents = 'auto'; hideButton.textContent = "隠す"; hideButton.classList.remove('ts-hidden-state'); hideButton.classList.add('ts-visible-state'); if (typeof applyLockState === 'function') applyLockState(); } } catch (e) { console.error(LOG_TAG, "Error applying hidden state:", e); } }
    function populateEditorFromTimestamps() { if (!bulkEditor) return; try { bulkEditor.value = timestamps.join('\n'); } catch(e) { console.error(LOG_TAG, "Error populating editor:", e); } }
    function handleEditorChange() { if (!bulkEditor) return; if (editorChangeTimeout) clearTimeout(editorChangeTimeout); editorChangeTimeout = setTimeout(() => { try { const currentText = bulkEditor.value; const lines = currentText.split('\n'); if (JSON.stringify(timestamps) !== JSON.stringify(lines)) { timestamps = lines; saveTimestamps(); if (sortState !== null) { sortState = null; if(typeof updateSortButtonText === 'function') updateSortButtonText(); } if(typeof renderTimestampList === 'function') renderTimestampList(); } } catch (e) { console.error(LOG_TAG, "Error handling editor change:", e); } }, EDITOR_DEBOUNCE_MS); }
    function renderTimestampList() { if (!displayListElement) { displayListElement = document.getElementById("timestamp-display-list"); if (!displayListElement) { console.warn(LOG_TAG, "renderTimestampList: displayListElement not found."); return; } } try { displayListElement.textContent = ''; const validTimestamps = timestamps.map(String).filter(ts => ts.trim().length > 0); let displayItems = []; if (sortState !== null) { const itemsToSort = validTimestamps.map((text) => ({ text: text, timeSeconds: parseTimeToSeconds(text), originalIndex: timestamps.indexOf(text) })); itemsToSort.sort((a, b) => { if (a.timeSeconds !== null && b.timeSeconds !== null) return sortState ? a.timeSeconds - b.timeSeconds : b.timeSeconds - a.timeSeconds; if (a.timeSeconds === null && b.timeSeconds !== null) return sortState ? 1 : -1; if (a.timeSeconds !== null && b.timeSeconds === null) return sortState ? -1 : 1; return sortState ? a.text.localeCompare(b.text) : b.text.localeCompare(a.text); }); displayItems = itemsToSort; } else { displayItems = validTimestamps.map((text) => ({ text: text, originalIndex: timestamps.indexOf(text) })); } if (displayItems.length === 0) { const emptyGuide = document.createElement('div'); emptyGuide.className = 'ts-empty-guide'; emptyGuide.textContent = "記録はありません"; displayListElement.appendChild(emptyGuide); return; } const fragment = document.createDocumentFragment(); displayItems.forEach((itemData) => { const listItem = createTimestampListItem(itemData.text, itemData.originalIndex); if (listItem) fragment.appendChild(listItem); }); displayListElement.appendChild(fragment); } catch (e) { console.error(LOG_TAG, "Error rendering timestamp display list:", e); showErrorMessage("リスト表示エラー。"); if (displayListElement) { displayListElement.textContent = ''; const errorLi = document.createElement('li'); errorLi.textContent = 'リスト表示エラー'; errorLi.style.cssText = 'color: red; padding: 10px; text-align: center;'; displayListElement.appendChild(errorLi); } } }
    function createTimestampListItem(timestampText, originalIndex) { try { const textContent = String(timestampText); const listItem = document.createElement("li"); listItem.className = "ts-list-item"; listItem.dataset.originalIndex = originalIndex; const itemContainer = document.createElement("div"); itemContainer.className = "ts-item-container"; const hasValidTime = TIME_REGEX.test(textContent); const actionButtons = []; if (hasValidTime) { const jumpIcon = document.createElement("span"); jumpIcon.textContent = "▶️"; jumpIcon.className = "ts-jump-icon"; jumpIcon.title = "クリックでジャンプ"; jumpIcon.onclick = (e) => { e.stopPropagation(); jumpToTimestamp(textContent); }; actionButtons.push(jumpIcon); const minusButton = document.createElement("button"); minusButton.textContent = "-1s"; minusButton.className = "ts-adjust-button ts-minus-button ts-action-button"; minusButton.onclick = (e) => { e.stopPropagation(); adjustTimestamp(originalIndex, -1); }; actionButtons.push(minusButton); const plusButton = document.createElement("button"); plusButton.textContent = "+1s"; plusButton.className = "ts-adjust-button ts-plus-button ts-action-button"; plusButton.onclick = (e) => { e.stopPropagation(); adjustTimestamp(originalIndex, 1); }; actionButtons.push(plusButton); } const deleteButton = document.createElement("button"); deleteButton.textContent = "削除"; deleteButton.className = "ts-delete-button ts-action-button"; deleteButton.onclick = (e) => { e.stopPropagation(); deleteTimestamp(originalIndex); }; actionButtons.push(deleteButton); const displayContainer = document.createElement("div"); displayContainer.className = "ts-display-container"; const displayText = document.createElement("div"); displayText.className = "ts-display-text"; displayText.textContent = textContent; displayText.title = `Ctrl+クリックでジャンプ / 右クリックメニュー`; displayText.onclick = (e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) jumpToTimestamp(textContent); }; displayText.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showTimestampContextMenu(e, textContent, displayText); }; itemContainer.append(...actionButtons); displayContainer.appendChild(displayText); itemContainer.appendChild(displayContainer); listItem.appendChild(itemContainer); return listItem; } catch (e) { console.error(LOG_TAG, "Error creating timestamp list item:", e, timestampText); return null; } }
    function showTimestampContextMenu(e, timestamp, element) { closeExistingContextMenu(); try { const menu = document.createElement('div'); menu.id = 'timestamp-context-menu'; menu.className = 'ts-context-menu'; const menuWidth = 160; const menuHeight = 80; const posX = (e.clientX + menuWidth > window.innerWidth) ? window.innerWidth - menuWidth - 5 : e.clientX + 2; const posY = (e.clientY + menuHeight > window.innerHeight) ? e.clientY - menuHeight - 2 : e.clientY + 2; menu.style.left = `${posX}px`; menu.style.top = `${posY}px`; const itemStyle = 'ts-context-menu-item'; const currentTimestamp = element?.textContent || timestamp; if (TIME_REGEX.test(String(currentTimestamp))) { const jumpOption = document.createElement('div'); jumpOption.textContent = 'タイムラインジャンプ'; jumpOption.className = itemStyle; jumpOption.onclick = () => { jumpToTimestamp(currentTimestamp); closeExistingContextMenu(); }; menu.appendChild(jumpOption); } const copyOption = document.createElement('div'); copyOption.textContent = 'コピー'; copyOption.className = itemStyle; copyOption.onclick = () => { copySingleTimestamp(currentTimestamp); closeExistingContextMenu(); }; menu.appendChild(copyOption); document.body.appendChild(menu); contextMenuCloseListener = (event) => { const menuElement = document.getElementById('timestamp-context-menu'); if (menuElement && !menuElement.contains(event.target)) closeExistingContextMenu(); }; setTimeout(() => { document.addEventListener('click', contextMenuCloseListener, { capture: true, once: true }); document.addEventListener('contextmenu', contextMenuCloseListener, { capture: true, once: true }); }, 0); } catch (err) { console.error(LOG_TAG, "Error showing context menu:", err); } }
    function addStyles() { const styleId = 'timestamp-styles-v11.20-ui'; if (document.getElementById(styleId)) { console.log(LOG_TAG, "Styles already added."); return; } console.log(LOG_TAG, "Adding styles..."); const css = ` :root { --ts-font-size-base: 15px; --ts-font-size-small: 13px; --ts-font-size-large: 17px; --ts-primary-blue: #3498db; --ts-primary-green: #2ecc71; --ts-primary-red: #e74c3c; --ts-primary-orange: #f39c12; --ts-primary-grey: #95a5a6; --ts-text-dark: #333; --ts-text-light: #f8f8f8; --ts-border-color: #a0a0a0; --ts-resizer-color: #ccc; --ts-primary-copy-blue: #5dade2; --ts-primary-copy-blue-dark: #2e86c1; --ts-lock-red: #e74c3c; --ts-lock-red-dark: #c0392b; } .ts-container { position: absolute; z-index: 9998; display: flex; flex-direction: column; background: rgba(245, 245, 245, 0.97); border: 1px solid var(--ts-border-color); border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.25); user-select: none; resize: both; overflow: hidden; min-width: 550px; min-height: 350px; font-size: var(--ts-font-size-base); color: var(--ts-text-dark); pointer-events: auto; } .ts-container.ts-locked { resize: none !important; } .ts-top-bar { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; gap: 14px; background: #e8e8e8; border-bottom: 1px solid #ccc; flex-shrink: 0; cursor: move; } .ts-top-bar.ts-locked { cursor: default; } .ts-time-display { padding: 6px 14px; background: rgba(40, 40, 40, 0.9); color: var(--ts-text-light); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 4px; font-size: var(--ts-font-size-small); font-weight: bold; text-align: center; text-shadow: 1px 1px 2px rgba(0,0,0,0.6); margin: 0; flex-shrink: 0; } .ts-record-button { padding: 8px 20px; background: linear-gradient(to bottom, #5dade2, var(--ts-primary-blue)); color: white; border: 1px solid #258cd1; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.25); cursor: pointer; font-size: var(--ts-font-size-base); font-weight: bold; border-radius: 5px; transition: all 0.15s ease; text-shadow: 1px 1px 1px rgba(0,0,0,0.3); margin: 0; flex-shrink: 0; } .ts-record-button:hover { background: linear-gradient(to bottom, #6ebef0, #3ea0e0); box-shadow: 0 3px 6px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.25); } .ts-record-button:active { background: linear-gradient(to top, #5dade2, var(--ts-primary-blue)); transform: scale(0.97); box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.25); } #ts-main-content { display: flex; flex-grow: 1; width: 100%; overflow: hidden; background: #fdfdfd; } #ts-editor-pane { flex-basis: 45%; flex-shrink: 1; flex-grow: 1; display: flex; flex-direction: column; padding: 10px; min-width: ${MIN_PANE_WIDTH}px; overflow: hidden; position: relative; background-color: #fdfdfd; } #ts-display-pane { flex-basis: 55%; flex-shrink: 1; flex-grow: 1; display: flex; flex-direction: column; padding: 0; margin-left: 5px; box-sizing: border-box; min-width: ${MIN_PANE_WIDTH}px; overflow: hidden; background-color: #ffffff; } #ts-pane-resizer { flex: 0 0 5px; background-color: var(--ts-resizer-color); cursor: col-resize; border-left: 1px solid #bbb; border-right: 1px solid #bbb; transition: background-color 0.2s ease; align-self: stretch; } #ts-pane-resizer:hover { background-color: #aaa; } #ts-pane-resizer.resizing { background-color: var(--ts-primary-blue); } #ts-editor-pane label { font-size: var(--ts-font-size-small); font-weight: bold; color: #555; margin-bottom: 6px; display: block; text-align: center; flex-shrink: 0; } #ts-bulk-editor { flex-grow: 1; width: 100%; box-sizing: border-box; border: 1px solid #c0c0c0; border-radius: 4px; padding: 10px 12px; font-size: var(--ts-font-size-base); line-height: 1.7; font-family: 'Segoe UI', Meiryo, Arial, sans-serif; resize: none; outline: none; transition: all 0.2s ease; background-color: #fff; min-height: 100px; overflow-y: auto; } #ts-bulk-editor:focus { border-color: var(--ts-primary-blue); box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.3); } #ts-bulk-editor:read-only { background-color: #f5f5f5; cursor: not-allowed; border-color: #ddd;} .ts-display-list-container { display: flex; flex-direction: column; flex-grow: 1; background: #ffffff; border: none; box-shadow: none; overflow: hidden; padding: 0 12px; } .ts-list-button-bar { display: flex; padding: 7px 0; gap: 10px; background: #f0f0f0; border-bottom: 1px solid #ddd; align-items: center; flex-wrap: nowrap; flex-shrink: 0; } .ts-list-button { padding: 7px 14px; font-size: var(--ts-font-size-small); font-weight: bold; border: 1px solid; border-radius: 4px; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1); } .ts-list-button:active { transform: scale(0.96); box-shadow: inset 0 1px 2px rgba(0,0,0,0.15); } .ts-copy-all-button { flex-grow: 1; flex-shrink: 1; flex-basis: 0; min-width: 80px; background: linear-gradient(to bottom, var(--ts-primary-copy-blue), var(--ts-primary-copy-blue-dark)); color: white; border-color: var(--ts-primary-copy-blue-dark); text-shadow: 1px 1px 1px rgba(0,0,0,0.2); } .ts-copy-all-button:hover { background: linear-gradient(to bottom, #85c1e9, var(--ts-primary-copy-blue)); border-color: #21618c; } .ts-sort-button { flex-grow: 1; flex-shrink: 1; flex-basis: 0; min-width: 80px; background: linear-gradient(to bottom, #f8c471, var(--ts-primary-orange)); color: white; border-color: #e67e22; text-shadow: 1px 1px 1px rgba(0,0,0,0.2); } .ts-sort-button:hover { background: linear-gradient(to bottom, #f9d08a, #f5a623); border-color: #d35400; } .ts-delete-all-button { background: linear-gradient(to bottom, #f1948a, var(--ts-primary-red)); color: white; border: 1px solid #d9534f; text-shadow: 1px 1px 1px rgba(0,0,0,0.2); border-radius: 50%; padding: 0; font-size: 18px; font-weight: bold; line-height: 30px; width: 32px; height: 32px; box-sizing: border-box; margin-left: auto; flex-shrink: 0; } .ts-delete-all-button:hover { background: linear-gradient(to bottom, #f5a79d, #e95c4d); border-color: #c9302c; } #timestamp-display-list { list-style-type: none; padding: 10px 0; margin: 0; flex-grow: 1; overflow-y: auto; overflow-x: hidden; background-color: #ffffff; box-sizing: border-box; } .ts-empty-guide { text-align: center; padding: 30px 15px; color: #999; font-size: var(--ts-font-size-base); line-height: 1.5; } .ts-list-item { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #eee; display: flex; align-items: center; } .ts-list-item:last-child { border-bottom: none; } .ts-item-container { display: flex; align-items: center; flex-wrap: nowrap; width: 100%; gap: 8px; } .ts-jump-icon { margin-right: 6px; cursor: pointer; font-size: var(--ts-font-size-large); line-height: 1; padding: 4px; color: var(--ts-primary-blue); flex-shrink: 0; transition: transform 0.1s ease, color 0.1s ease; } .ts-jump-icon:hover { transform: scale(1.2); color: #2980b9; } .ts-action-button { padding: 5px 10px; margin: 0; border: 1px solid; font-weight: bold; font-size: 12px; border-radius: 4px; cursor: pointer; transition: all 0.15s; flex-shrink: 0; line-height: 1; box-shadow: 0 1px 1px rgba(0,0,0,0.05); } .ts-action-button:active { transform: scale(0.95); box-shadow: inset 0 1px 1px rgba(0,0,0,0.1); } .ts-adjust-button { background-color: #eafaf1; border-color: #abebc6; color: #239b56; } .ts-adjust-button:hover { background-color: #d4efdf; border-color: #82e0aa; } .ts-delete-button { background-color: #fdedec; border-color: #fadbd8; color: #cb4335; } .ts-delete-button:hover { background-color: #fadbd8; border-color: #f1948a; } .ts-display-container { flex-grow: 1; min-width: 120px; margin-left: 5px; cursor: default; border: none; background: none; overflow: hidden; } .ts-display-text { cursor: default; padding: 6px 2px; font-size: var(--ts-font-size-base); white-space: normal; overflow-wrap: break-word; word-break: break-all; max-width: 100%; line-height: 1.6; color: var(--ts-text-dark); } .ts-bottom-bar { display: flex; align-items: center; justify-content: flex-end; padding: 7px 12px; gap: 12px; background: #e0e0e0; border-top: 1px solid #ccc; flex-shrink: 0; cursor: move; } .ts-bottom-bar.ts-locked { cursor: default; } .ts-bottom-controls { display: flex; gap: 12px; cursor: default; } .ts-bottom-button { padding: 8px 18px; font-size: var(--ts-font-size-base); font-weight: bold; border: none; cursor: pointer; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: all 0.15s ease; text-align: center; text-shadow: 1px 1px 1px rgba(0,0,0,0.15); color: white; flex-shrink: 0; white-space: nowrap; } .ts-bottom-button:active { transform: scale(0.97); box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.2); } .ts-lock-button {} .ts-lock-button.ts-unlocked { background: linear-gradient(to bottom, var(--ts-lock-red), var(--ts-lock-red-dark)); } .ts-lock-button.ts-unlocked:hover { background: linear-gradient(to bottom, #f1948a, var(--ts-lock-red)); } .ts-lock-button.ts-locked { background: linear-gradient(to bottom, #58d68d, var(--ts-primary-green)); } .ts-lock-button.ts-locked:hover { background: linear-gradient(to bottom, #6fe09f, #36d97b); } .ts-hide-button { visibility: visible !important; pointer-events: auto !important; cursor: pointer; } .ts-hide-button.ts-visible-state { background: linear-gradient(to bottom, #aeb6bf, var(--ts-primary-grey)); } .ts-hide-button.ts-visible-state:hover { background: linear-gradient(to bottom, #cacfd6, #aab5c0); } .ts-hide-button.ts-hidden-state { background: linear-gradient(to bottom, #ec7063, var(--ts-primary-red)); } .ts-hide-button.ts-hidden-state:hover { background: linear-gradient(to bottom, #f1948a, #e74c3c); } .ts-context-menu { position: fixed; background-color: #ffffff; border: 1px solid #b0b0b0; border-radius: 4px; box-shadow: 0 3px 10px rgba(0,0,0,0.2); z-index: 10001; padding: 6px 0; min-width: 160px; font-size: var(--ts-font-size-base); } .ts-context-menu-item { padding: 9px 20px; cursor: pointer; white-space: nowrap; color: #333; transition: background-color 0.1s ease; } .ts-context-menu-item:hover { background-color: #e8f0fe; color: var(--ts-primary-blue); } .ts-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.3); display: flex; justify-content: center; align-items: center; z-index: 10000; pointer-events: auto; } .ts-modal-content { background-color: #fff; padding: 30px 35px; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3); width: auto; min-width: 350px; max-width: 500px; text-align: center; pointer-events: auto; position: relative; cursor: move; } .ts-modal-message { font-size: var(--ts-font-size-large); font-weight: 600; color: var(--ts-primary-red); margin-bottom: 35px; line-height: 1.6; pointer-events: none; } .ts-modal-buttons { display: flex; justify-content: center; gap: 20px; cursor: default; } .ts-modal-button { padding: 11px 25px; font-size: var(--ts-font-size-base); font-weight: bold; border: 1px solid transparent; cursor: pointer; border-radius: 5px; min-width: 110px; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.1); } .ts-modal-cancel { background-color: #f0f0f0; color: #555; border-color: #c0c0c0; } .ts-modal-cancel:hover { background-color: #e5e5e5; border-color: #b0b0b0; } .ts-modal-confirm { background-color: var(--ts-primary-red); color: white; border-color: #c0392b; } .ts-modal-confirm:hover { background-color: #c0392b; border-color: #a93226; } .ts-modal-button:active { transform: scale(0.97); box-shadow: inset 0 1px 2px rgba(0,0,0,0.15); } .ts-modal-button:focus { outline: none; box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.4); } .ts-message-box { position: fixed; bottom: 35px; left: 50%; transform: translateX(-50%); padding: 14px 28px; color: white; font-size: var(--ts-font-size-base); font-weight: bold; border-radius: 5px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); z-index: 10002; opacity: 0; transition: opacity 0.4s ease-in-out, transform 0.4s ease-in-out; text-align: center; max-width: 85%; pointer-events: none; transform: translate(-50%, 20px); } .ts-message-box.visible { opacity: 1; transform: translateX(-50%); } .ts-message-box.fade-out { opacity: 0; transform: translate(-50%, 20px); } .ts-message-box.success { background-color: var(--ts-primary-green); } .ts-message-box.error   { background-color: var(--ts-primary-red); } .ts-message-box.info    { background-color: var(--ts-primary-blue); } .ts-message-box.jump    { background-color: #733dd8; } .ts-tooltip-hint { position: fixed; bottom: 25px; right: 25px; background-color: rgba(0,0,0,0.85); color: white; padding: 10px 15px; border-radius: 4px; font-size: var(--ts-font-size-small); z-index: 9999; opacity: 0; transition: opacity 0.5s ease-in-out; pointer-events: none; } .ts-tooltip-hint.visible { opacity: 1; } `;
        try { const styleSheet = document.createElement("style"); styleSheet.id = styleId; styleSheet.textContent = css; (document.head || document.documentElement).appendChild(styleSheet); console.log(LOG_TAG, "Styles added successfully."); } catch (e) { console.error(LOG_TAG, "Failed to add styles:", e); } }
    function handleContainerResize(entries) { /* ... (保持不變) ... */ if(isResizingPanes)return;resizeTimeout&&clearTimeout(resizeTimeout),resizeTimeout=setTimeout(()=>{for(let t of entries)if(t.target===container&&editorPane&&displayPane&&resizerElement&&mainContentElement)try{const e=mainContentElement.clientWidth,n=resizerElement.offsetWidth,o=e-n;if(o<=2*MIN_PANE_WIDTH){console.warn(LOG_TAG,"Container too small for resizing logic.");continue}let i=localStorage.getItem("timestampEditorWidth"),a=editorPane.offsetWidth;if(i){const t=parseFloat(i);!isNaN(t)&&t>=MIN_PANE_WIDTH&&(a=t)}let r=Math.max(MIN_PANE_WIDTH,Math.min(a,o-MIN_PANE_WIDTH)),s=o-r;s<MIN_PANE_WIDTH&&(s=MIN_PANE_WIDTH,r=o-s),r=Math.max(MIN_PANE_WIDTH,r),editorPane.style.width=`${r}px`,displayPane.style.width=`${s}px`,editorPane.style.flexBasis="",displayPane.style.flexBasis=""}catch(t){console.error(LOG_TAG,"Error handling container resize:",t)}saveContainerPosition()},RESIZE_DEBOUNCE_MS) }

    function initializeUI() {
        const containerId = CONTAINER_ID; const oldContainer = document.getElementById(containerId);
        if (oldContainer) { try { oldContainer.remove(); } catch(e) { console.warn(LOG_TAG, "Error removing old container in initializeUI:", e); } }
        if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e) { console.warn(LOG_TAG, "Error disconnecting previous ResizeObserver:", e); } containerResizeObserver = null; }

        try {
            addStyles();
            // Create Elements
            container = document.createElement("div"); container.className = "ts-container"; container.id = containerId; topBarElement = document.createElement("div"); topBarElement.className = "ts-top-bar"; currentTimeDisplay = document.createElement("div"); currentTimeDisplay.id = "ts-current-time"; currentTimeDisplay.className = "ts-time-display"; currentTimeDisplay.textContent = "読み込み中..."; recordBtn = document.createElement("button"); recordBtn.id = "ts-record-button"; recordBtn.className = "ts-record-button"; recordBtn.textContent = "現在時刻を記録"; mainContentElement = document.createElement("div"); mainContentElement.id = "ts-main-content"; editorPane = document.createElement("div"); editorPane.id = "ts-editor-pane"; const editorLabel = document.createElement("label"); editorLabel.setAttribute("for", "ts-bulk-editor"); editorLabel.textContent = "タイムスタンプ編集"; bulkEditor = document.createElement("textarea"); bulkEditor.id = "ts-bulk-editor"; bulkEditor.placeholder = "例:\n0:15:30 開始\n1:25:00 曲名 [01]\n..."; resizerElement = document.createElement("div"); resizerElement.id = "ts-pane-resizer"; displayPane = document.createElement("div"); displayPane.id = "ts-display-pane"; displayListContainer = document.createElement("div"); displayListContainer.className = "ts-display-list-container"; const listButtonBar = document.createElement("div"); listButtonBar.className = "ts-list-button-bar"; const copyAllButton = document.createElement("button"); copyAllButton.textContent = "全コピー"; copyAllButton.title = "左パネルの内容をコピー"; copyAllButton.className = "ts-list-button ts-copy-all-button"; const sortButton = document.createElement("button"); sortButton.id = "ts-sort-button"; sortButton.title = "右パネルの表示順を切替"; sortButton.className = "ts-list-button ts-sort-button"; const deleteAllButton = document.createElement("button"); deleteAllButton.textContent = "✕"; deleteAllButton.title = "すべて削除"; deleteAllButton.className = "ts-list-button ts-delete-all-button"; displayListElement = document.createElement("ul"); displayListElement.id = "timestamp-display-list"; bottomBarElement = document.createElement("div"); bottomBarElement.className = "ts-bottom-bar"; const bottomControls = document.createElement("div"); bottomControls.className = "ts-bottom-controls"; lockButton = document.createElement("button"); lockButton.id = "ts-lock-button"; lockButton.className = "ts-bottom-button ts-lock-button"; hideButton = document.createElement("button"); hideButton.id = "ts-hide-button"; hideButton.className = "ts-bottom-button ts-hide-button";
            // Append Elements
            topBarElement.append(currentTimeDisplay,recordBtn),editorPane.append(editorLabel,bulkEditor),listButtonBar.append(copyAllButton,sortButton,deleteAllButton),displayListContainer.append(listButtonBar,displayListElement),displayPane.append(displayListContainer),mainContentElement.append(editorPane,resizerElement,displayPane),bottomControls.append(lockButton,hideButton),bottomBarElement.append(bottomControls),container.append(topBarElement,mainContentElement,bottomBarElement),document.body.appendChild(container);
            // Set Initial Position/Size & Styles
            const savedPosition=loadContainerPosition();container.style.left=savedPosition.left,container.style.top=savedPosition.top,container.style.width=savedPosition.width,container.style.height=savedPosition.height,requestAnimationFrame(()=>{if(!container)return;try{container.dataset.originalBg=window.getComputedStyle(container).backgroundColor,container.dataset.originalBorder=window.getComputedStyle(container).border,container.dataset.originalBoxShadow=window.getComputedStyle(container).boxShadow,container.dataset.originalPointerEvents=window.getComputedStyle(container).pointerEvents,container.dataset.originalOverflow=window.getComputedStyle(container).overflow,container.dataset.originalResize=window.getComputedStyle(container).resize||"both",container.dataset.originalMinWidth=container.style.minWidth||window.getComputedStyle(container).minWidth,container.dataset.originalMinHeight=container.style.minHeight||window.getComputedStyle(container).minHeight,applySavedPaneWidths()}catch(t){console.error(LOG_TAG,"Error storing original styles:",t)}});
            // Add Event Listeners
            "function"==typeof updateSortButtonText&&updateSortButtonText(),recordBtn.onclick=recordTimestamp,copyAllButton.onclick=copyAllTimestamps,sortButton.onclick=toggleSortOrder,deleteAllButton.onclick=t=>{t.stopPropagation(),t.preventDefault(),showConfirmDeleteAllModal()},lockButton.onclick=toggleLock,hideButton.onclick=toggleVisibility,bulkEditor.addEventListener("input",handleEditorChange),bulkEditor.addEventListener("keydown",function(t){"Enter"===t.key&&(()=>{})()});
            const addDragListener=t=>{if(!t)return;let e,n,o,i;const a=t=>{if(!isDraggingContainer||isResizingPanes||!container)return;rafDragId&&cancelAnimationFrame(rafDragId),rafDragId=requestAnimationFrame(()=>{if(!isDraggingContainer||isResizingPanes||!container)return;const a=t.clientX,r=t.clientY;container.style.left=`${o+(a-e)}px`,container.style.top=`${i+(r-n)}px`,rafDragId=null})},r=()=>{rafDragId&&cancelAnimationFrame(rafDragId),rafDragId=null,isDraggingContainer&&(isDraggingContainer=!1,document.body.style.cursor="",document.body.style.userSelect="",saveContainerPosition(),document.removeEventListener("mousemove",a),document.removeEventListener("mouseup",r))};t.addEventListener("mousedown",t=>{if(t.target!==t){let e=t.target;for(;e&&e!==t;){if("BUTTON"===e.tagName||e.classList.contains("ts-bottom-controls")||e.classList.contains("ts-time-display"))return;e=e.parentElement}}if(isLocked||0!==t.button||isResizingPanes||isDraggingFromHideButton||!container)return;isDraggingContainer=!0;const s=container.getBoundingClientRect();e=t.clientX,n=t.clientY,o=s.left,i=s.top,document.body.style.cursor="move",document.body.style.userSelect="none",document.addEventListener("mousemove",a),document.addEventListener("mouseup",r,{once:!0}),t.preventDefault()})};addDragListener(topBarElement),addDragListener(bottomBarElement);
            if(resizerElement){const t=t=>{if(!isResizingPanes||!editorPane||!displayPane||!container||!mainContentElement)return;try{const e=mainContentElement.getBoundingClientRect(),n=resizerElement.offsetWidth,o=e.width-n;let i=t.clientX-e.left;i=Math.max(MIN_PANE_WIDTH,Math.min(i,o-MIN_PANE_WIDTH));let a=o-i;editorPane.style.width=`${i}px`,displayPane.style.width=`${a}px`,editorPane.style.flexBasis="",displayPane.style.flexBasis=""}catch(t){console.error(LOG_TAG,"Error during pane resize move:",t)}},e=()=>{if(!isResizingPanes)return;isResizingPanes=!1,document.removeEventListener("mousemove",t),document.removeEventListener("mouseup",e),document.body.style.cursor="",document.body.style.userSelect="",resizerElement&&resizerElement.classList.remove("resizing"),saveContainerPosition()};resizerElement.addEventListener("mousedown",n=>{isLocked||0!==n.button||!editorPane||!displayPane||(isResizingPanes=!0,document.body.style.cursor="col-resize",document.body.style.userSelect="none",resizerElement.classList.add("resizing"),document.addEventListener("mousemove",t),document.addEventListener("mouseup",e,{once:!0}),n.preventDefault())})}
            if(hideButton){hideButton.addEventListener("mousedown",t=>{if(0!==t.button)return;t.stopPropagation(),dragStartTime=Date.now(),isDraggingFromHideButton=!1,hideButtonDragged=!1;const e=t.clientX,n=t.clientY,o=hideButton.getBoundingClientRect(),i=o.left,a=o.top,r=container.getBoundingClientRect(),s=r.left,l=r.top,c=t=>{const o=Math.abs(t.clientX-e),r=Math.abs(t.clientY-n);isDraggingFromHideButton||!(o>DRAG_MOVE_THRESHOLD||r>DRAG_MOVE_THRESHOLD||Date.now()-dragStartTime>DRAG_THRESHOLD)||(isDraggingFromHideButton=!0,hideButtonDragged=!0,document.body.style.cursor="move",document.body.style.userSelect="none",isHidden&&(hideButton.style.position="fixed",hideButton.style.left=`${i}px`,hideButton.style.top=`${a}px`)),isDraggingFromHideButton&&container&&(rafDragId&&cancelAnimationFrame(rafDragId),rafDragId=requestAnimationFrame(()=>{let o,r;isHidden?(o=i+(t.clientX-e),r=a+(t.clientY-n),hideButton.style.left=`${o}px`,hideButton.style.top=`${r}px`,container.style.left=`${s+(t.clientX-e)}px`,container.style.top=`${l+(t.clientY-n)}px`):(o=s+(t.clientX-e),r=l+(t.clientY-n),container.style.left=`${o}px`,container.style.top=`${r}px`),rafDragId=null}))},d=t=>{rafDragId&&cancelAnimationFrame(rafDragId),rafDragId=null,document.removeEventListener("mousemove",c),document.removeEventListener("mouseup",d,{capture:!0}),isDraggingFromHideButton&&(document.body.style.cursor="",document.body.style.userSelect="");const e=isDraggingFromHideButton;isDraggingFromHideButton=!1,e&&(isHidden&&hideButton&&(()=>{const t=hideButton.getBoundingClientRect();hideButtonLastViewportPos={left:t.left,top:t.top}})(),saveContainerPosition(),t.preventDefault(),t.stopPropagation())};document.addEventListener("mousemove",c),document.addEventListener("mouseup",d,{once:!0,capture:!0})})}
            // Add Resize Observer
            if ('ResizeObserver' in window && container) { try { containerResizeObserver = new ResizeObserver(handleContainerResize); containerResizeObserver.observe(container); console.log(LOG_TAG, "Container ResizeObserver started."); } catch (e) { console.error(LOG_TAG, "Failed to create/observe ResizeObserver:", e); containerResizeObserver = null; } } else { console.warn(LOG_TAG, "ResizeObserver not supported/container missing."); }
            // Load State and Apply
            loadState(); applyLockState(); applyHiddenState(); startCurrentTimeUpdate(); showTooltipHint();
        } catch (uiError) { console.error(LOG_TAG, "UI 初期化失敗:", uiError); showErrorMessage("スクリプトUIの読み込みに失敗しました！"); if (container?.parentNode) { try { container.remove(); } catch(e) {} } container = null; if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e) {} containerResizeObserver = null; } }
    }

    // --- Initialization Retry Logic (Strategy 5: Simplified Check) ---
    let initRetryCount = 0;
    function runInitialization() {
        console.log(LOG_TAG, `[${initRetryCount}] runInitialization 嘗試開始 (策略五)...`);

        if (document.getElementById(CONTAINER_ID)) {
            console.log(LOG_TAG, "容器已存在，跳過初始化。");
            if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null;
            initRetryCount = 0; return;
        }
        if (initRetryCount >= MAX_INIT_RETRIES) {
            console.error(LOG_TAG, `初期化がタイムアウトしました (${MAX_INIT_RETRIES} 回試行)。`);
            if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null;
            showErrorMessage("スクリプトの初期化がタイムアウトしました！ページを再読み込みしてみてください。");
            initRetryCount = 0; return;
        }

        const video = document.querySelector('video');
        const playerElement = document.getElementById('movie_player');
        const videoReady = video && typeof video.currentTime === 'number' && video.readyState >= 1;
        const elementsFound = video && playerElement;

        console.log(LOG_TAG, `[${initRetryCount}] 檢查元素 (策略五): video found=${!!video}, videoReady=${videoReady}, playerElement found=${!!playerElement}`);

        if (videoReady && elementsFound) {
            console.log(LOG_TAG, `[${initRetryCount}] 基本元素已就緒，開始 initializeUI (策略五)`);
            if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null;
            initRetryCount = 0;
            try {
                if (typeof initializeUI === 'function') {
                    initializeUI();
                    if (!document.getElementById(CONTAINER_ID)) { console.error(LOG_TAG, "初期化後、コンテナがDOMに正常に追加されませんでした！"); showErrorMessage("UIの追加に失敗しました。"); }
                    else { console.log(LOG_TAG, "initializeUI 呼叫完成，容器已添加。後續功能將自行檢查 API。");
                        if(typeof startCurrentTimeUpdate === 'function') startCurrentTimeUpdate();
                        if(typeof loadState === 'function') loadState();
                        if(typeof applyLockState === 'function') applyLockState();
                        if(typeof applyHiddenState === 'function') applyHiddenState();
                        if(typeof showTooltipHint === 'function') showTooltipHint();
                     }
                } else { console.error(LOG_TAG, "initializeUI is not defined!"); showErrorMessage("UI初期化関数が見つかりません！"); }
            } catch (e) { console.error(LOG_TAG, "初期化中にエラーが発生しました:", e); showErrorMessage("スクリプトの初期化に失敗しました！"); }
            return;
        }

        initRetryCount++;
        const retryDelay = INIT_RETRY_BASE_DELAY + initRetryCount * INIT_RETRY_INCREMENT;
        console.log(LOG_TAG, `[${initRetryCount-1}] 基本元素未就緒，${retryDelay}ms 後重試 (setTimeout)...`);
        if (initTimeoutId) clearTimeout(initTimeoutId);
        initTimeoutId = setTimeout(runInitialization, retryDelay);
    }

    // --- MutationObserver for SPA Navigation ---
    let lastUrl = location.href;
    const observerCallback = (mutationsList, observerInstance) => {
        requestAnimationFrame(() => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl && currentUrl.includes('youtube.com')) {
                console.log(LOG_TAG, `URL changed from ${lastUrl} to ${currentUrl}, re-initializing...`);
                lastUrl = currentUrl;
                cleanupExtensionUI();
                if (isExtensionEnabled && currentUrl.includes('/watch?v=')) {
                     console.log(LOG_TAG, "New URL is a watch page and extension is enabled, scheduling initialization.");
                     setTimeout(runInitialization, 1500);
                } else {
                     console.log(LOG_TAG, `New URL is not a watch page or extension is disabled (${isExtensionEnabled}), skipping initialization.`);
                }
            }
        });
    };

    // --- Start Page MutationObserver ---
    try {
        const observeTargetNode = document.querySelector('ytd-page-manager') || document.body;
        if (observeTargetNode) {
            pageObserver = new MutationObserver(observerCallback);
            pageObserver.observe(observeTargetNode, { childList: true, subtree: true });
             console.log(LOG_TAG, "Page MutationObserver started on:", observeTargetNode.id || observeTargetNode.tagName);
         } else { console.error(LOG_TAG, "Page MutationObserver のターゲットが見つかりません！"); }
    } catch (e) { console.error(LOG_TAG, "Failed to start Page MutationObserver:", e); showErrorMessage("ページ変更監視の開始に失敗しました。"); }

    // --- Tooltip Hint Function ---
    function showTooltipHint() { if(firstTimeUser&&!document.getElementById("ts-tooltip-hint"))try{const t=document.createElement("div");t.id="ts-tooltip-hint",t.className="ts-tooltip-hint",t.textContent="ヒント: 左パネルで編集、右パネルでCtrl+クリックジャンプ / 右クリックメニュー",document.body.appendChild(t),setTimeout(()=>{t.classList.add("visible")},100),setTimeout(()=>{if(!t.parentNode)return;t.classList.remove("visible"),t.addEventListener("transitionend",()=>{try{t.remove()}catch(t){}},{once:!0}),setTimeout(()=>{t.parentNode&&(()=>{try{t.remove()}catch(t){}})()},600)},8e3)}catch(t){console.error(LOG_TAG,"Failed to show tooltip hint:",t)} }

    // --- Initial Script Start Logic ---
    function initialStart() {
       console.log(LOG_TAG, "initialStart 関数 実行開始");
       chrome.storage.sync.get([STORAGE_KEY_ENABLED], (result) => {
            isExtensionEnabled = (result[STORAGE_KEY_ENABLED] !== false);
            console.log(LOG_TAG, `Initial enabled state: ${isExtensionEnabled}`);
            if (isExtensionEnabled) {
                if (document.body) {
                    console.log(LOG_TAG, "document.body 発見、runInitialization を呼び出します");
                    if (typeof runInitialization === 'function') { runInitialization(); }
                    else { console.error(LOG_TAG, "initialStart: runInitialization is not defined!"); showErrorMessage("初期化関数が見つかりません！(initialStart)"); }
                } else {
                    console.warn(LOG_TAG, "document.body が見つかりません、100ms 後に再試行します (initialStart)");
                    setTimeout(initialStart, 100);
                }
            } else {
                console.log(LOG_TAG, "拡張機能が無効です。初期化をスキップします。");
            }
       });
    }

    // --- Listener for storage changes (ON/OFF toggle) ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes[STORAGE_KEY_ENABLED]) {
            const newState = changes[STORAGE_KEY_ENABLED].newValue;
            const oldState = changes[STORAGE_KEY_ENABLED].oldValue;
            console.log(LOG_TAG, `Extension enabled state changed from ${oldState} to ${newState}`);
            isExtensionEnabled = (newState !== false);

            if (isExtensionEnabled) {
                console.log(LOG_TAG, "拡張機能が有効になりました。UI を初期化しようとしています...");
                 if (location.href.includes('/watch?v=') && !document.getElementById(CONTAINER_ID)) {
                    runInitialization();
                 } else if (document.getElementById(CONTAINER_ID)) {
                     console.log(LOG_TAG, "UI は既に存在します。再初期化をスキップします。");
                 } else {
                     console.log(LOG_TAG, "Watch ページにいないため、UI の初期化をスキップします。");
                 }
            } else {
                console.log(LOG_TAG, "拡張機能が無効になりました。UI をクリーンアップします...");
                cleanupExtensionUI();
            }
        }
    });

    // --- Determine when to call initialStart ---
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        console.log(LOG_TAG, "DOM is ready or complete, calling initialStart directly."); initialStart();
    } else {
        console.log(LOG_TAG, "DOM not ready, adding DOMContentLoaded listener for initialStart.");
        document.addEventListener('DOMContentLoaded', () => { console.log(LOG_TAG, "DOMContentLoaded event fired, calling initialStart."); initialStart(); }, { once: true });
    }

    // --- Cleanup on Unload ---
    window.addEventListener('beforeunload', () => {
        console.log(LOG_TAG, "beforeunload event triggered, cleaning up...");
        cleanupExtensionUI();
        if (pageObserver) { try { pageObserver.disconnect(); pageObserver = null; } catch(e) {} }
        console.log(LOG_TAG, "Unload cleanup complete.");
    });

})(); // <-- IIFE 結束
