(function() {
    'use strict';

    let isExtensionEnabled = true;
    let timestamps = [];
    let isDraggingContainer = false;
    let offsetX = 0, offsetY = 0;
    let container, recordBtn, lockButton;
    let editorPane, displayPane, bulkEditor, displayListContainer, displayListElement, currentTimeDisplay;
    let topBarElement, bottomBarElement, mainContentElement, resizerElement;
    let isLocked = false;
    let sortState = null;
    let firstTimeUser = localStorage.getItem('timestampFirstTime') === null;
    let currentTimeInterval = null;
    let pageObserver = null;
    let dragStartTime = 0;
    let editorChangeTimeout = null;
    let isDraggingModal = false;
    let modalOffsetX = 0, modalOffsetY = 0;
    let rafDragId = null;
    let rafModalDragId = null;
    let isResizingPanes = false;
    let containerResizeObserver = null;
    let resizeTimeout = null;
    let initTimeoutId = null;
    let messageTimeoutId = null;
    let initRetryCount = 0;

    let timestampToggleButton = null;
    let isToggleButtonInjected = false;
    let playerControlsCheckInterval = null;
    const TOGGLE_BUTTON_ID = 'timestamp-ext-toggle-button-star-left';

    const STORAGE_KEY_ENABLED = 'extensionEnabled';
    const CONTAINER_ID = 'ts-container-main';
    const EDITOR_DEBOUNCE_MS = 400;
    const RESIZE_DEBOUNCE_MS = 100;
    const TIME_REGEX = /^(\d+):(\d{2}):(\d{2})/;
    const MIN_PANE_WIDTH = 100;
    const MAX_INIT_RETRIES = 45;
    const INIT_RETRY_BASE_DELAY = 1500;
    const INIT_RETRY_INCREMENT = 200;
    const PLAYER_CONTROLS_CHECK_INTERVAL_MS = 500;
    const PLAYER_CONTROLS_CHECK_TIMEOUT_MS = 25000;
    const STORAGE_KEY_STAR_HINT_SHOWN = 'timestampStarHintShown_v5_2';

    function cleanupExtensionUI() {
        if (typeof stopCurrentTimeUpdate === 'function') stopCurrentTimeUpdate();
        if (typeof closeExistingContextMenu === 'function') closeExistingContextMenu();
        if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e) {} containerResizeObserver = null; }
        if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null;
        if (editorChangeTimeout) clearTimeout(editorChangeTimeout); editorChangeTimeout = null;
        if (messageTimeoutId) clearTimeout(messageTimeoutId); messageTimeoutId = null;
        if (resizeTimeout) clearTimeout(resizeTimeout); resizeTimeout = null;
        if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId = null;
        if (rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = null;

        removeTimestampToggleButton();
        if (playerControlsCheckInterval) {
            clearInterval(playerControlsCheckInterval);
            playerControlsCheckInterval = null;
        }

        const uiContainer = document.getElementById(CONTAINER_ID);
        if (uiContainer) { try { uiContainer.remove(); } catch(e) {} }

        container = recordBtn = lockButton = editorPane = displayPane = bulkEditor = displayListContainer = displayListElement = currentTimeDisplay = topBarElement = bottomBarElement = mainContentElement = resizerElement = null;
        isDraggingContainer = false; isResizingPanes = false;
        initRetryCount = 0;
    }

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
                messageBox.classList.remove('visible');
                messageBox.classList.add('fade-out');
                const transitionDuration = 400;
                const removeLogic = () => {
                    if (messageBox.parentNode) { try { messageBox.remove(); } catch(e){} }
                    if (messageTimeoutId === currentTimeoutId) { messageTimeoutId = null; }
                };
                messageBox.addEventListener('transitionend', removeLogic, { once: true });
                setTimeout(removeLogic, transitionDuration + 100);
            }, duration);
            messageTimeoutId = currentTimeoutId;
        } catch (e) { }
    }
    function showSuccessMessage(message) { showMessage(message, 'success', 2500); }
    function showErrorMessage(message) { showMessage(message, 'error', 5000); }
    function showInfoMessage(message, duration = 3000) { showMessage(message, 'info', duration); }
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

                    if (availableWidth <= (MIN_PANE_WIDTH * 2)) {
                         editorPane.style.width = ''; displayPane.style.width = '';
                         editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
                         return;
                    }

                    const editorW = parseFloat(savedEditorWidthPx);
                    if (!isNaN(editorW) && editorW >= MIN_PANE_WIDTH && (availableWidth - editorW) >= MIN_PANE_WIDTH) {
                        editorPane.style.width = `${editorW}px`;
                        displayPane.style.width = `${availableWidth - editorW}px`;
                        editorPane.style.flexBasis = '';
                        displayPane.style.flexBasis = '';
                    } else {
                        editorPane.style.width = ''; displayPane.style.width = '';
                        editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
                    }
                 }, 0);
            } else if (editorPane && displayPane) {
                editorPane.style.width = '';
                displayPane.style.width = '';
                editorPane.style.flexBasis = '45%';
                displayPane.style.flexBasis = '55%';
            }
        } catch(e) {
             if (editorPane && displayPane) {
                 editorPane.style.width = '';
                 displayPane.style.width = '';
                 editorPane.style.flexBasis = '45%';
                 displayPane.style.flexBasis = '55%';
             }
        }
    }
    function loadState() {
        try {
            const storedTimestamps = localStorage.getItem('timestamps');
            if (storedTimestamps) {
                try { timestamps = JSON.parse(storedTimestamps); }
                catch (e) { timestamps = []; }
            } else { timestamps = []; }
            isLocked = localStorage.getItem('timestampLockState') === 'true';
            firstTimeUser = localStorage.getItem('timestampFirstTime') === null;
            sortState = null;
            if (typeof applySavedPaneWidths === 'function') applySavedPaneWidths();
            if (bulkEditor && displayListElement && typeof populateEditorFromTimestamps === 'function' && typeof renderTimestampList === 'function') {
                 populateEditorFromTimestamps(); renderTimestampList();
            }
        } catch(e) {
            timestamps = []; isLocked = false; firstTimeUser = true; sortState = null;
        }
    }
    function saveTimestamps() {
        try {
            const cleanedTimestamps = timestamps.map(ts => String(ts).trim()).filter(ts => ts.length > 0);
            if (JSON.stringify(timestamps) !== JSON.stringify(cleanedTimestamps)) { timestamps = cleanedTimestamps; }
            localStorage.setItem('timestamps', JSON.stringify(timestamps));
        } catch (e) {
            if (typeof showErrorMessage === 'function') showErrorMessage("タイムスタンプ保存失敗！");
        }
    }
    function saveContainerPosition() {
        if (!container) return;
        try {
            const rect = container.getBoundingClientRect();
            const position = {
                left: container.style.left || `${rect.left}px` || "360px",
                top: container.style.top || `${rect.top}px` || "500px",
                width: container.style.width || `${rect.width}px` || "680px",
                height: container.style.height || `${rect.height}px` || "380px"
            };
            localStorage.setItem('timestampContainerPosition', JSON.stringify(position));
            if (editorPane && editorPane.style.width && editorPane.style.width.endsWith('px') && !isResizingPanes) {
                localStorage.setItem('timestampEditorWidth', editorPane.style.width);
            }
        } catch (e) { }
    }
    function loadContainerPosition() {
        const defaultPos = { left: "360px", top: "500px", width: "680px", height: "380px" };
        const savedPosition = localStorage.getItem('timestampContainerPosition');
        if (savedPosition) {
            try {
                const pos = JSON.parse(savedPosition);
                if (pos && typeof pos === 'object' && typeof pos.left === 'string' && typeof pos.top === 'string') {
                    pos.width = typeof pos.width === 'string' ? pos.width : defaultPos.width;
                    pos.height = typeof pos.height === 'string' ? pos.height : defaultPos.height;
                    return pos;
                }
            } catch (e) { }
        }
        return defaultPos;
    }

    function formatTime(totalSeconds) { totalSeconds = Math.max(0, Math.floor(totalSeconds)); const h = Math.floor(totalSeconds / 3600); const m = Math.floor((totalSeconds % 3600) / 60); const s = totalSeconds % 60; return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`; }
    function updateTimeDisplay() { try { const video = document.querySelector('video'); if (currentTimeDisplay) { if (video && typeof video.currentTime === 'number' && !isNaN(video.currentTime)) { currentTimeDisplay.textContent = `再生時間 ${formatTime(video.currentTime)}`; } else { currentTimeDisplay.textContent = '再生時間 --:--:--'; } } } catch (e) { if (currentTimeDisplay) currentTimeDisplay.textContent = '時刻表示エラー'; } }
    function startCurrentTimeUpdate() { stopCurrentTimeUpdate(); try { const video = document.querySelector('video'); if (video && video.readyState >= 1) { updateTimeDisplay(); currentTimeInterval = setInterval(updateTimeDisplay, 1000); } else if (video) { const onMetadataLoaded = () => { if (video.readyState >= 1) { updateTimeDisplay(); currentTimeInterval = setInterval(updateTimeDisplay, 1000); } video.removeEventListener('loadedmetadata', onMetadataLoaded); }; video.addEventListener('loadedmetadata', onMetadataLoaded); } } catch (e) { } }
    function stopCurrentTimeUpdate() { if (currentTimeInterval) { clearInterval(currentTimeInterval); currentTimeInterval = null; } }
    function recordTimestamp() { try { const video = document.querySelector('video'); if (video && typeof video.currentTime === 'number' && !isNaN(video.currentTime)) { const currentTime = video.currentTime; let maxNum = 0; timestamps.forEach(ts => { const match = String(ts).match(/\[(\d+)\]$/); if (match?.[1]) { const num = parseInt(match[1], 10); if (!isNaN(num) && num > maxNum) { maxNum = num; } } }); const nextNumber = maxNum + 1; const defaultText = ` [${nextNumber.toString().padStart(2, '0')}]`; const formattedTimestamp = `${formatTime(currentTime)}${defaultText}`; timestamps.push(formattedTimestamp); saveTimestamps(); if(typeof populateEditorFromTimestamps === 'function') populateEditorFromTimestamps(); sortState = null; if(typeof updateSortButtonText === 'function') updateSortButtonText(); if(typeof renderTimestampList === 'function') renderTimestampList(); if (firstTimeUser && timestamps.length === 1) { localStorage.setItem('timestampFirstTime', 'false'); firstTimeUser = false; } if (bulkEditor) { setTimeout(() => { bulkEditor.scrollTop = bulkEditor.scrollHeight; }, 0); } } else { showErrorMessage("動画が見つからないか、再生時間を取得できません。"); } } catch (err) { showErrorMessage("記録エラー: " + err.message); } }
    function adjustTimestamp(index, adjustment) { if (index < 0 || index >= timestamps.length) return; const timestamp = String(timestamps[index]); const match = timestamp.match(TIME_REGEX); if (match) { try { let h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10); if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error("時間解析エラー"); let totalSeconds = h * 3600 + m * 60 + s + adjustment; totalSeconds = Math.max(0, totalSeconds); const newFormattedTime = formatTime(totalSeconds); const restOfString = timestamp.substring(match[0].length); const newTimestamp = `${newFormattedTime}${restOfString}`; timestamps[index] = newTimestamp; saveTimestamps(); if(typeof populateEditorFromTimestamps === 'function') populateEditorFromTimestamps(); if(typeof renderTimestampList === 'function') renderTimestampList(); if(typeof jumpToTimestamp === 'function') jumpToTimestamp(newTimestamp); } catch (e) { showErrorMessage("時間調整エラー。"); } } else { showErrorMessage("時間調整エラー：時間形式 (HH:MM:SS) が見つかりません。"); } }
    function deleteTimestamp(index) { if (index < 0 || index >= timestamps.length) return; try { timestamps.splice(index, 1); saveTimestamps(); if(typeof populateEditorFromTimestamps === 'function') populateEditorFromTimestamps(); sortState = null; if(typeof updateSortButtonText === 'function') updateSortButtonText(); if(typeof renderTimestampList === 'function') renderTimestampList(); } catch (e) { showErrorMessage("削除エラー。"); } }
    function jumpToTimestamp(timestamp) { const timestampStr = String(timestamp); const match = timestampStr.match(TIME_REGEX); if (match) { try { const h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10); if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error("時間解析エラー"); const totalSeconds = h * 3600 + m * 60 + s; const video = document.querySelector('video'); if (video) { if (!isNaN(video.duration) && totalSeconds > video.duration) { video.currentTime = video.duration; } else { video.currentTime = totalSeconds; } if (typeof video.play === 'function') { video.play().catch(e => {}); } showJumpSuccessMessage(match[0]); } else { showErrorMessage("動画プレーヤーが見つかりません。"); } } catch (e) { showErrorMessage("ジャンプエラー。"); } } else { showErrorMessage(`ジャンプエラー：時間形式 (HH:MM:SS) が見つかりません。(${timestampStr.substring(0, 10)}...)`); } }
    function parseTimeToSeconds(timeString) { const match = String(timeString).match(TIME_REGEX); if (match?.[1] && match?.[2] && match?.[3]) { try { const h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10); if (!isNaN(h) && !isNaN(m) && !isNaN(s)) { return h * 3600 + m * 60 + s; } } catch(e) {} } return null; }

    function toggleSortOrder() { if (sortState === null) { sortState = true; } else if (sortState === true) { sortState = false; } else { sortState = null; } if(typeof renderTimestampList === 'function') renderTimestampList(); if(typeof updateSortButtonText === 'function') updateSortButtonText(); }
    function updateSortButtonText() { try { const btn = document.getElementById('ts-sort-button'); if (!btn) return; if (sortState === true) { btn.textContent = "時間昇順 ▲"; } else if (sortState === false) { btn.textContent = "時間降順 ▼"; } else { btn.textContent = "元の順序"; } btn.style.transform = "scale(0.95)"; setTimeout(() => { if(btn) btn.style.transform = "scale(1)"; }, 100); } catch(e) { } }

    function deleteAllTimestampsConfirmed() { try { timestamps = []; saveTimestamps(); if (bulkEditor) bulkEditor.value = ''; sortState = null; if(typeof updateSortButtonText === 'function') updateSortButtonText(); if(typeof renderTimestampList === 'function') renderTimestampList(); showInfoMessage("すべての記録が削除されました。"); } catch (error) { showErrorMessage("全削除処理中にエラーが発生しました。"); } }

    let contextMenuCloseListener = null;
    function closeExistingContextMenu() { try { const menu = document.getElementById('timestamp-context-menu'); if (menu) menu.remove(); if (contextMenuCloseListener) { document.removeEventListener('click', contextMenuCloseListener, { capture: true }); document.removeEventListener('contextmenu', contextMenuCloseListener, { capture: true }); contextMenuCloseListener = null; } } catch (e) { } }
    function showTimestampContextMenu(e, timestamp, element) { closeExistingContextMenu(); try { const menu = document.createElement('div'); menu.id = 'timestamp-context-menu'; menu.className = 'ts-context-menu'; const menuWidth = 160; const menuHeight = 80; const posX = (e.clientX + menuWidth > window.innerWidth) ? window.innerWidth - menuWidth - 5 : e.clientX + 2; const posY = (e.clientY + menuHeight > window.innerHeight) ? e.clientY - menuHeight - 2 : e.clientY + 2; menu.style.left = `${posX}px`; menu.style.top = `${posY}px`; const itemStyle = 'ts-context-menu-item'; const currentTimestamp = element?.textContent || timestamp; if (TIME_REGEX.test(String(currentTimestamp))) { const jumpOption = document.createElement('div'); jumpOption.textContent = 'タイムラインジャンプ'; jumpOption.className = itemStyle; jumpOption.onclick = () => { jumpToTimestamp(currentTimestamp); closeExistingContextMenu(); }; menu.appendChild(jumpOption); } const copyOption = document.createElement('div'); copyOption.textContent = 'コピー'; copyOption.className = itemStyle; copyOption.onclick = () => { copySingleTimestamp(currentTimestamp); closeExistingContextMenu(); }; menu.appendChild(copyOption); document.body.appendChild(menu); contextMenuCloseListener = (event) => { const menuElement = document.getElementById('timestamp-context-menu'); if (menuElement && !menuElement.contains(event.target)) { closeExistingContextMenu(); } }; setTimeout(() => { document.addEventListener('click', contextMenuCloseListener, { capture: true, once: true }); document.addEventListener('contextmenu', contextMenuCloseListener, { capture: true, once: true }); }, 0); } catch (err) { } }

    function showConfirmDeleteAllModal() { let modalOverlay = null; try { closeExistingContextMenu(); const existingModal = document.getElementById('ts-confirm-modal'); if (existingModal) existingModal.remove(); modalOverlay = document.createElement("div"); modalOverlay.id = "ts-confirm-modal"; modalOverlay.className = "ts-modal-overlay"; const modalContent = document.createElement("div"); modalContent.className = "ts-modal-content"; const message = document.createElement("p"); message.textContent = "すべての記録を削除しますか？"; message.className = "ts-modal-message"; const buttonContainer = document.createElement("div"); buttonContainer.className = "ts-modal-buttons"; const cancelButton = document.createElement("button"); cancelButton.textContent = "いいえ"; cancelButton.className = "ts-modal-button ts-modal-cancel"; cancelButton.onclick = () => { try { modalOverlay.remove(); } catch(e) {} }; const confirmButton = document.createElement("button"); confirmButton.textContent = "削除"; confirmButton.className = "ts-modal-button ts-modal-confirm"; confirmButton.onclick = () => { try { deleteAllTimestampsConfirmed(); modalOverlay.remove(); } catch (e) { showErrorMessage("削除処理中にエラーが発生しました。"); if (modalOverlay?.parentNode) { try { modalOverlay.remove(); } catch(e) {} } } }; buttonContainer.append(cancelButton, confirmButton); modalContent.append(message, buttonContainer); modalOverlay.appendChild(modalContent); document.body.appendChild(modalOverlay); modalContent.style.position = 'absolute'; modalContent.style.cursor = 'move'; modalContent.addEventListener('mousedown', (e) => { if (e.target !== modalContent || e.button !== 0) return; isDraggingModal = true; const overlayRect = modalOverlay.getBoundingClientRect(); const contentRect = modalContent.getBoundingClientRect(); modalOffsetX = e.clientX - contentRect.left; modalOffsetY = e.clientY - contentRect.top; const initialLeft = contentRect.left - overlayRect.left; const initialTop = contentRect.top - overlayRect.top; document.body.style.userSelect = 'none'; const modalMoveHandler = (moveEvent) => { if (!isDraggingModal) return; if(rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = requestAnimationFrame(() => { let newX = initialLeft + (moveEvent.clientX - e.clientX); let newY = initialTop + (moveEvent.clientY - e.clientY); modalContent.style.left = `${newX}px`; modalContent.style.top = `${newY}px`; rafModalDragId = null; }); }; const modalUpHandler = () => { if(rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = null; if (isDraggingModal) { isDraggingModal = false; document.body.style.userSelect = ''; document.removeEventListener('mousemove', modalMoveHandler); document.removeEventListener('mouseup', modalUpHandler); } }; document.addEventListener('mousemove', modalMoveHandler); document.addEventListener('mouseup', modalUpHandler, { once: true }); e.preventDefault(); }); cancelButton.focus(); } catch (error) { showErrorMessage("削除確認ウィンドウ表示中にエラー発生"); if (modalOverlay?.parentNode) { try { modalOverlay.remove(); } catch(e) {} } } }

    function copyAllTimestamps() { if (!bulkEditor || bulkEditor.value.trim() === '') { showInfoMessage("コピーする記録はありません。"); return; } const textToCopy = bulkEditor.value; navigator.clipboard.writeText(textToCopy).then(() => { const lineCount = textToCopy.split('\n').filter(line => line.trim() !== '').length; showCopySuccessMessage(`エディター内容 全${lineCount}行コピー！`); }).catch(err => { showErrorMessage("コピーに失敗しました。"); }); }
    function copySingleTimestamp(text) { if (!text) return; navigator.clipboard.writeText(String(text)).then(() => { showCopySuccessMessage(`コピー: ${String(text).substring(0, 50)}${String(text).length > 50 ? '...' : ''}`); }).catch(err => { showErrorMessage("コピー失敗。"); }); }

    function toggleLock() { isLocked = !isLocked; localStorage.setItem('timestampLockState', isLocked.toString()); applyLockState(); if (lockButton) { lockButton.style.transform = "scale(0.95)"; setTimeout(() => { if (lockButton) lockButton.style.transform = "scale(1)"; }, 100); } }
    function applyLockState() { if (!lockButton || !container || !bulkEditor || !topBarElement || !bottomBarElement || !resizerElement) { return; } try { lockButton.textContent = isLocked ? "アンロック" : "ロック"; lockButton.classList.toggle('ts-locked', isLocked); lockButton.classList.toggle('ts-unlocked', !isLocked); bulkEditor.readOnly = isLocked; bulkEditor.style.backgroundColor = isLocked ? '#eee' : '#fff'; bulkEditor.style.cursor = isLocked ? 'not-allowed' : ''; topBarElement.style.cursor = isLocked ? 'default' : 'move'; bottomBarElement.style.cursor = isLocked ? 'default' : 'move'; topBarElement.classList.toggle('ts-locked', isLocked); bottomBarElement.classList.toggle('ts-locked', isLocked); if (!container.dataset?.originalResize) { container.dataset.originalResize = window.getComputedStyle(container).resize || 'both'; } container.style.resize = isLocked ? 'none' : (container.dataset.originalResize); container.classList.toggle('ts-locked', isLocked); resizerElement.style.display = isLocked ? 'none' : 'block'; resizerElement.style.cursor = isLocked ? 'default' : 'col-resize'; } catch(e) { } }

    function populateEditorFromTimestamps() { if (!bulkEditor) return; try { bulkEditor.value = timestamps.join('\n'); } catch(e) { } }
    function handleEditorChange() { if (!bulkEditor) return; if (editorChangeTimeout) clearTimeout(editorChangeTimeout); editorChangeTimeout = setTimeout(() => { try { const currentText = bulkEditor.value; const lines = currentText.split('\n'); if (JSON.stringify(timestamps) !== JSON.stringify(lines)) { timestamps = lines; saveTimestamps(); if (sortState !== null) { sortState = null; if(typeof updateSortButtonText === 'function') updateSortButtonText(); } if(typeof renderTimestampList === 'function') renderTimestampList(); } } catch (e) { } }, EDITOR_DEBOUNCE_MS); }

    function renderTimestampList() { if (!displayListElement) { displayListElement = document.getElementById("timestamp-display-list"); if (!displayListElement) { return; } } try { displayListElement.textContent = ''; const validTimestamps = timestamps.map(String).filter(ts => ts.trim().length > 0); let displayItems = []; if (sortState !== null) { const itemsToSort = validTimestamps.map((text, index) => ({ text: text, timeSeconds: parseTimeToSeconds(text), originalIndex: timestamps.indexOf(text) })); itemsToSort.sort((a, b) => { if (a.timeSeconds !== null && b.timeSeconds !== null) { return sortState ? a.timeSeconds - b.timeSeconds : b.timeSeconds - a.timeSeconds; } if (a.timeSeconds === null && b.timeSeconds !== null) return sortState ? 1 : -1; if (a.timeSeconds !== null && b.timeSeconds === null) return sortState ? -1 : 1; return sortState ? a.text.localeCompare(b.text) : b.text.localeCompare(a.text); }); displayItems = itemsToSort; } else { displayItems = validTimestamps.map((text) => ({ text: text, originalIndex: timestamps.indexOf(text) })); } if (displayItems.length === 0) { const emptyGuide = document.createElement('div'); emptyGuide.className = 'ts-empty-guide'; emptyGuide.textContent = "記録はありません"; displayListElement.appendChild(emptyGuide); return; } const fragment = document.createDocumentFragment(); displayItems.forEach((itemData) => { const listItem = createTimestampListItem(itemData.text, itemData.originalIndex); if (listItem) { fragment.appendChild(listItem); } }); displayListElement.appendChild(fragment); } catch (e) { showErrorMessage("リスト表示エラー。"); if (displayListElement) { displayListElement.textContent = ''; const errorLi = document.createElement('li'); errorLi.textContent = 'リスト表示エラー'; errorLi.style.cssText = 'color: red; padding: 10px; text-align: center;'; displayListElement.appendChild(errorLi); } } }
    function createTimestampListItem(timestampText, originalIndex) { try { const textContent = String(timestampText); const listItem = document.createElement("li"); listItem.className = "ts-list-item"; listItem.dataset.originalIndex = originalIndex; const itemContainer = document.createElement("div"); itemContainer.className = "ts-item-container"; const hasValidTime = TIME_REGEX.test(textContent); const actionButtons = []; if (hasValidTime) { const jumpIcon = document.createElement("span"); jumpIcon.textContent = "▶️"; jumpIcon.className = "ts-jump-icon"; jumpIcon.title = "クリックでジャンプ"; jumpIcon.onclick = (e) => { e.stopPropagation(); jumpToTimestamp(textContent); }; actionButtons.push(jumpIcon); const minusButton = document.createElement("button"); minusButton.textContent = "-1s"; minusButton.className = "ts-adjust-button ts-minus-button ts-action-button"; minusButton.onclick = (e) => { e.stopPropagation(); adjustTimestamp(originalIndex, -1); }; actionButtons.push(minusButton); const plusButton = document.createElement("button"); plusButton.textContent = "+1s"; plusButton.className = "ts-adjust-button ts-plus-button ts-action-button"; plusButton.onclick = (e) => { e.stopPropagation(); adjustTimestamp(originalIndex, 1); }; actionButtons.push(plusButton); } const deleteButton = document.createElement("button"); deleteButton.textContent = "削除"; deleteButton.className = "ts-delete-button ts-action-button"; deleteButton.onclick = (e) => { e.stopPropagation(); deleteTimestamp(originalIndex); }; actionButtons.push(deleteButton); const displayContainer = document.createElement("div"); displayContainer.className = "ts-display-container"; const displayText = document.createElement("div"); displayText.className = "ts-display-text"; displayText.textContent = textContent; displayText.title = `Ctrl+クリックでジャンプ / 右クリックメニュー`; displayText.onclick = (e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey) { jumpToTimestamp(textContent); } }; displayText.oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); showTimestampContextMenu(e, textContent, displayText); }; itemContainer.append(...actionButtons); displayContainer.appendChild(displayText); itemContainer.appendChild(displayContainer); listItem.appendChild(itemContainer); return listItem; } catch (e) { return null; } }

    function createTimestampToggleButton() { if (document.getElementById(TOGGLE_BUTTON_ID)) return null; const button = document.createElement('button'); button.id = TOGGLE_BUTTON_ID; button.className = 'ytp-button timestamp-ext-star-button-left'; button.title = 'タイムスタンプ記録パネルを表示/非表示'; button.innerHTML = '★'; button.onclick = togglePanelVisibility; timestampToggleButton = button; return button; }
    function injectTimestampToggleButton() {
        if (isToggleButtonInjected || !isExtensionEnabled) return;
        const playPauseButton = document.querySelector('.ytp-play-button');
        const leftControls = document.querySelector('.ytp-left-controls');
        if (playPauseButton && leftControls) {
            const buttonToInject = createTimestampToggleButton();
            if (buttonToInject) {
                try {
                    playPauseButton.insertAdjacentElement('afterend', buttonToInject);
                    isToggleButtonInjected = true;
                    try {
                        const hintShown = localStorage.getItem(STORAGE_KEY_STAR_HINT_SHOWN);
                        if (!hintShown) {
                            showInfoMessage("ヒント：プレーヤー左下の ★ ボタンでパネルを表示/非表示できます。", 6000);
                            localStorage.setItem(STORAGE_KEY_STAR_HINT_SHOWN, 'true');
                        }
                    } catch (storageError) { }
                    if (playerControlsCheckInterval) {
                        clearInterval(playerControlsCheckInterval);
                        playerControlsCheckInterval = null;
                    }
                } catch (injectError) {
                     removeTimestampToggleButton();
                }
            }
        }
    }
    function removeTimestampToggleButton() { if (timestampToggleButton && timestampToggleButton.parentNode) { try { timestampToggleButton.remove(); } catch (e) { } } timestampToggleButton = null; isToggleButtonInjected = false; }
    function checkAndInjectToggleButton() { if (!isExtensionEnabled || isToggleButtonInjected) { if (playerControlsCheckInterval) { clearInterval(playerControlsCheckInterval); playerControlsCheckInterval = null; } return; } if (playerControlsCheckInterval) { clearInterval(playerControlsCheckInterval); } let checkStartTime = Date.now(); playerControlsCheckInterval = setInterval(() => { if (isExtensionEnabled && !isToggleButtonInjected) { injectTimestampToggleButton(); if (Date.now() - checkStartTime > PLAYER_CONTROLS_CHECK_TIMEOUT_MS) { clearInterval(playerControlsCheckInterval); playerControlsCheckInterval = null; if (!isToggleButtonInjected) { showErrorMessage("プレーヤー制御の検出に失敗しました (★)。"); } } } else { clearInterval(playerControlsCheckInterval); playerControlsCheckInterval = null; if (!isExtensionEnabled) { removeTimestampToggleButton(); } } }, PLAYER_CONTROLS_CHECK_INTERVAL_MS); }
    function togglePanelVisibility() { if (!container) return; container.classList.toggle('ts-panel-hidden'); const isHiddenNow = container.classList.contains('ts-panel-hidden'); localStorage.setItem('timestampPanelHidden', isHiddenNow); if (timestampToggleButton) { timestampToggleButton.style.transform = "scale(0.9)"; setTimeout(() => { if (timestampToggleButton) timestampToggleButton.style.transform = "scale(1)"; }, 100); } }

    function addStyles() {
        const styleId = `timestamp-styles-11.21.5.2-left-star-ui`;
        if (document.getElementById(styleId)) { return; }
        const css = `
            :root { --ts-font-size-base: 15px; --ts-font-size-small: 13px; --ts-font-size-large: 17px; --ts-primary-blue: #3498db; --ts-primary-green: #2ecc71; --ts-primary-red: #e74c3c; --ts-primary-orange: #f39c12; --ts-primary-grey: #95a5a6; --ts-text-dark: #333; --ts-text-light: #f8f8f8; --ts-border-color: #a0a0a0; --ts-resizer-color: #ccc; --ts-primary-copy-blue: #5dade2; --ts-primary-copy-blue-dark: #2e86c1; --ts-lock-red: #e74c3c; --ts-lock-red-dark: #c0392b; }
            .ts-container { position: absolute; z-index: 9998; display: flex; flex-direction: column; background: rgba(245, 245, 245, 0.97); border: 1px solid var(--ts-border-color); border-radius: 6px; box-shadow: 0 4px 15px rgba(0,0,0,0.25); user-select: none; resize: both; overflow: hidden; min-width: 550px; min-height: 350px; font-size: var(--ts-font-size-base); color: var(--ts-text-dark); pointer-events: auto; transition: opacity 0.3s ease-out, transform 0.3s ease-out; }
            .ts-container.ts-locked { resize: none !important; }
            .ts-top-bar { display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; gap: 14px; background: #e8e8e8; border-bottom: 1px solid #ccc; flex-shrink: 0; cursor: move; }
            .ts-top-bar.ts-locked { cursor: default; }
            .ts-time-display { padding: 6px 14px; background: rgba(40, 40, 40, 0.9); color: var(--ts-text-light); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 4px; font-size: var(--ts-font-size-small); font-weight: bold; text-align: center; text-shadow: 1px 1px 2px rgba(0,0,0,0.6); margin: 0; flex-shrink: 0; }
            .ts-record-button { padding: 8px 20px; background: linear-gradient(to bottom, #5dade2, var(--ts-primary-blue)); color: white; border: 1px solid #258cd1; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.25); cursor: pointer; font-size: var(--ts-font-size-base); font-weight: bold; border-radius: 5px; transition: all 0.15s ease; text-shadow: 1px 1px 1px rgba(0,0,0,0.3); margin: 0; flex-shrink: 0; }
            .ts-record-button:hover { background: linear-gradient(to bottom, #6ebef0, #3ea0e0); box-shadow: 0 3px 6px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.25); }
            .ts-record-button:active { background: linear-gradient(to top, #5dade2, var(--ts-primary-blue)); transform: scale(0.97); box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.25); }
            #ts-main-content { display: flex; flex-grow: 1; width: 100%; overflow: hidden; background: #fdfdfd; }
            #ts-editor-pane { flex-shrink: 1; flex-grow: 1; display: flex; flex-direction: column; padding: 10px; min-width: ${MIN_PANE_WIDTH}px; overflow: hidden; position: relative; background-color: #fdfdfd; width: 45%; }
            #ts-editor-pane label { font-size: var(--ts-font-size-small); font-weight: bold; color: #555; margin-bottom: 6px; display: block; text-align: center; flex-shrink: 0; }
            #ts-bulk-editor { flex-grow: 1; width: 100%; box-sizing: border-box; border: 1px solid #c0c0c0; border-radius: 4px; padding: 10px 12px; font-size: var(--ts-font-size-base); line-height: 1.7; font-family: 'Segoe UI', Meiryo, Arial, sans-serif; resize: none; outline: none; transition: all 0.2s ease; background-color: #fff; min-height: 100px; overflow-y: auto; }
            #ts-bulk-editor:focus { border-color: var(--ts-primary-blue); box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.3); }
            #ts-bulk-editor:read-only { background-color: #f5f5f5; cursor: not-allowed; border-color: #ddd; }
            #ts-pane-resizer { flex: 0 0 5px; background-color: var(--ts-resizer-color); cursor: col-resize; border-left: 1px solid #bbb; border-right: 1px solid #bbb; transition: background-color 0.2s ease; align-self: stretch; position: relative; z-index: 1; }
            #ts-pane-resizer:hover { background-color: #aaa; }
            #ts-pane-resizer.resizing { background-color: var(--ts-primary-blue); }
            #ts-display-pane { flex-shrink: 1; flex-grow: 1; display: flex; flex-direction: column; padding: 0; margin-left: 5px; box-sizing: border-box; min-width: ${MIN_PANE_WIDTH}px; overflow: hidden; background-color: #ffffff; width: 55%; }
            .ts-display-list-container { display: flex; flex-direction: column; flex-grow: 1; background: #ffffff; border: none; box-shadow: none; overflow: hidden; padding: 0 12px; }
            .ts-list-button-bar { display: flex; padding: 7px 0; gap: 10px; background: #f0f0f0; border-bottom: 1px solid #ddd; align-items: center; flex-wrap: nowrap; flex-shrink: 0; }
            .ts-list-button { padding: 7px 14px; font-size: var(--ts-font-size-small); font-weight: bold; border: 1px solid; border-radius: 4px; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .ts-list-button:active { transform: scale(0.96); box-shadow: inset 0 1px 2px rgba(0,0,0,0.15); }
            .ts-copy-all-button { flex-grow: 1; flex-shrink: 1; flex-basis: 0; min-width: 80px; background: linear-gradient(to bottom, #98FB98, #66CDAA); color: #1A4D2E; border-color: #66CDAA; text-shadow: 1px 1px 1px rgba(255, 255, 255, 0.3); }
            .ts-copy-all-button:hover { background: linear-gradient(to bottom, #85c1e9, var(--ts-primary-copy-blue)); border-color: #21618c; }
            .ts-sort-button { flex-grow: 1; flex-shrink: 1; flex-basis: 0; min-width: 80px; background: linear-gradient(to bottom, #f8c471, var(--ts-primary-orange)); color: white; border-color: #e67e22; text-shadow: 1px 1px 1px rgba(0,0,0,0.2); }
            .ts-sort-button:hover { background: linear-gradient(to bottom, #f9d08a, #f5a623); border-color: #d35400; }
            .ts-delete-all-button { background: linear-gradient(to bottom, #f1948a, var(--ts-primary-red)); color: white; border: 1px solid #d9534f; text-shadow: 1px 1px 1px rgba(0,0,0,0.2); border-radius: 50%; padding: 0; font-size: 18px; font-weight: bold; line-height: 30px; width: 32px; height: 32px; box-sizing: border-box; margin-left: auto; flex-shrink: 0; }
            .ts-delete-all-button:hover { background: linear-gradient(to bottom, #f5a79d, #e95c4d); border-color: #c9302c; }
            #timestamp-display-list { list-style-type: none; padding: 10px 0; margin: 0; flex-grow: 1; overflow-y: auto; overflow-x: hidden; background-color: #ffffff; box-sizing: border-box; }
            .ts-empty-guide { text-align: center; padding: 30px 15px; color: #999; font-size: var(--ts-font-size-base); line-height: 1.5; }
            .ts-list-item { margin-bottom: 8px; padding-bottom: 8px; border-bottom: 1px dashed #eee; display: flex; align-items: center; }
            .ts-list-item:last-child { border-bottom: none; }
            .ts-item-container { display: flex; align-items: center; flex-wrap: nowrap; width: 100%; gap: 8px; }
            .ts-jump-icon { margin-right: 6px; cursor: pointer; font-size: var(--ts-font-size-large); line-height: 1; padding: 4px; color: var(--ts-primary-blue); flex-shrink: 0; transition: transform 0.1s ease, color 0.1s ease; }
            .ts-jump-icon:hover { transform: scale(1.2); color: #2980b9; }
            .ts-action-button { padding: 5px 10px; margin: 0; border: 1px solid; font-weight: bold; font-size: 12px; border-radius: 4px; cursor: pointer; transition: all 0.15s; flex-shrink: 0; line-height: 1; box-shadow: 0 1px 1px rgba(0,0,0,0.05); }
            .ts-action-button:active { transform: scale(0.95); box-shadow: inset 0 1px 1px rgba(0,0,0,0.1); }
            .ts-adjust-button { background-color: #eafaf1; border-color: #abebc6; color: #239b56; }
            .ts-adjust-button:hover { background-color: #d4efdf; border-color: #82e0aa; }
            .ts-delete-button { background-color: #fdedec; border-color: #fadbd8; color: #cb4335; }
            .ts-delete-button:hover { background-color: #fadbd8; border-color: #f1948a; }
            .ts-display-container { flex-grow: 1; min-width: 120px; margin-left: 5px; cursor: default; border: none; background: none; overflow: hidden; }
            .ts-display-text { cursor: default; padding: 6px 2px; font-size: var(--ts-font-size-base); white-space: normal; overflow-wrap: break-word; word-break: break-all; max-width: 100%; line-height: 1.6; color: var(--ts-text-dark); }
            .ts-bottom-bar { display: flex; align-items: center; justify-content: flex-end; padding: 7px 12px; gap: 12px; background: #e0e0e0; border-top: 1px solid #ccc; flex-shrink: 0; cursor: move; }
            .ts-bottom-bar.ts-locked { cursor: default; }
            .ts-bottom-controls { display: flex; gap: 12px; cursor: default; }
            .ts-bottom-button { padding: 8px 18px; font-size: var(--ts-font-size-base); font-weight: bold; border: none; cursor: pointer; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); transition: all 0.15s ease; text-align: center; text-shadow: 1px 1px 1px rgba(0,0,0,0.15); color: white; flex-shrink: 0; white-space: nowrap; }
            .ts-bottom-button:active { transform: scale(0.97); box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.2); }
            .ts-lock-button {}
            .ts-lock-button.ts-unlocked { background: linear-gradient(to bottom, var(--ts-lock-red), var(--ts-lock-red-dark)); }
            .ts-lock-button.ts-unlocked:hover { background: linear-gradient(to bottom, #f1948a, var(--ts-lock-red)); }
            .ts-lock-button.ts-locked { background: linear-gradient(to bottom, #58d68d, var(--ts-primary-green)); }
            .ts-lock-button.ts-locked:hover { background: linear-gradient(to bottom, #6fe09f, #36d97b); }
            .ts-context-menu { position: fixed; background-color: #ffffff; border: 1px solid #b0b0b0; border-radius: 4px; box-shadow: 0 3px 10px rgba(0,0,0,0.2); z-index: 10001; padding: 6px 0; min-width: 160px; font-size: var(--ts-font-size-base); }
            .ts-context-menu-item { padding: 9px 20px; cursor: pointer; white-space: nowrap; color: #333; transition: background-color 0.1s ease; }
            .ts-context-menu-item:hover { background-color: #e8f0fe; color: var(--ts-primary-blue); }
            .ts-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.3); display: flex; justify-content: center; align-items: center; z-index: 10000; pointer-events: auto; }
            .ts-modal-content { background-color: #fff; padding: 30px 35px; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3); width: auto; min-width: 350px; max-width: 500px; text-align: center; pointer-events: auto; position: relative; cursor: move; }
            .ts-modal-message { font-size: var(--ts-font-size-large); font-weight: 600; color: var(--ts-primary-red); margin-bottom: 35px; line-height: 1.6; pointer-events: none; }
            .ts-modal-buttons { display: flex; justify-content: center; gap: 20px; cursor: default; }
            .ts-modal-button { padding: 11px 25px; font-size: var(--ts-font-size-base); font-weight: bold; border: 1px solid transparent; cursor: pointer; border-radius: 5px; min-width: 110px; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .ts-modal-cancel { background-color: #f0f0f0; color: #555; border-color: #c0c0c0; }
            .ts-modal-cancel:hover { background-color: #e5e5e5; border-color: #b0b0b0; }
            .ts-modal-confirm { background-color: var(--ts-primary-red); color: white; border-color: #c0392b; }
            .ts-modal-confirm:hover { background-color: #c0392b; border-color: #a93226; }
            .ts-modal-button:active { transform: scale(0.97); box-shadow: inset 0 1px 2px rgba(0,0,0,0.15); }
            .ts-modal-button:focus { outline: none; box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.4); }
            .ts-message-box { position: fixed; bottom: 35px; left: 50%; transform: translateX(-50%); padding: 14px 28px; color: white; font-size: var(--ts-font-size-base); font-weight: bold; border-radius: 5px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); z-index: 10002; opacity: 0; transition: opacity 0.4s ease-in-out, transform 0.4s ease-in-out; text-align: center; max-width: 85%; pointer-events: none; transform: translate(-50%, 20px); }
            .ts-message-box.visible { opacity: 1; transform: translateX(-50%); }
            .ts-message-box.fade-out { opacity: 0; transform: translate(-50%, 20px); }
            .ts-message-box.success { background-color: var(--ts-primary-green); }
            .ts-message-box.error   { background-color: var(--ts-primary-red); }
            .ts-message-box.info    { background-color: var(--ts-primary-blue); }
            .ts-message-box.jump    { background-color: #733dd8; }
            /* .ts-tooltip-hint CSS is kept in case needed later, but the element won't be created */
            .ts-tooltip-hint { position: fixed; bottom: 25px; right: 25px; background-color: rgba(0,0,0,0.85); color: white; padding: 10px 15px; border-radius: 4px; font-size: var(--ts-font-size-small); z-index: 9999; opacity: 0; transition: opacity 0.5s ease-in-out; pointer-events: none; }
            .ts-tooltip-hint.visible { opacity: 1; }
            #${TOGGLE_BUTTON_ID}.timestamp-ext-star-button-left { color: white; font-size: 26px; padding: 0 6px; margin-left: 8px; opacity: 0.9; height: 100%; display: inline-flex !important; align-items: center; vertical-align: top; transition: opacity 0.1s linear, transform 0.1s ease-out; order: 5; cursor: pointer; background: none; border: none; }
            #${TOGGLE_BUTTON_ID}.timestamp-ext-star-button-left:hover { opacity: 1; }
            .ts-panel-hidden { display: none !important; }
        `;
        try {
            const styleSheet = document.createElement("style"); styleSheet.id = styleId;
            styleSheet.textContent = css; (document.head || document.documentElement).appendChild(styleSheet);
        } catch (e) { }
    }

    function handleContainerResize(entries) {
        if(isResizingPanes) return;
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            for (let entry of entries) {
                if (entry.target === container && editorPane && displayPane && resizerElement && mainContentElement) {
                     try {
                         const parentWidth = mainContentElement.clientWidth;
                         if (parentWidth < 10) { continue; }

                         const resizerW = resizerElement.offsetWidth;
                         const availableWidth = parentWidth - resizerW;

                         if (availableWidth <= (MIN_PANE_WIDTH * 2)) {
                             if (editorPane && displayPane) {
                                 editorPane.style.width = ''; displayPane.style.width = '';
                                 editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
                             }
                             continue;
                         }

                         let targetEditorWidth;
                         const savedEditorWidthPx = localStorage.getItem('timestampEditorWidth');
                         if (savedEditorWidthPx) {
                             const savedWidth = parseFloat(savedEditorWidthPx);
                             if (!isNaN(savedWidth) && savedWidth >= MIN_PANE_WIDTH && savedWidth <= (availableWidth - MIN_PANE_WIDTH)) {
                                 targetEditorWidth = savedWidth;
                             } else { targetEditorWidth = editorPane.offsetWidth; }
                         } else { targetEditorWidth = editorPane.offsetWidth; }
                         let newEditorWidth = Math.max(MIN_PANE_WIDTH, Math.min(targetEditorWidth, availableWidth - MIN_PANE_WIDTH));
                         let newDisplayWidth = availableWidth - newEditorWidth;
                         if (newDisplayWidth < MIN_PANE_WIDTH) { newDisplayWidth = MIN_PANE_WIDTH; newEditorWidth = availableWidth - newDisplayWidth; }
                         newEditorWidth = Math.max(MIN_PANE_WIDTH, newEditorWidth);
                         editorPane.style.width = `${newEditorWidth}px`; displayPane.style.width = `${newDisplayWidth}px`;
                         editorPane.style.flexBasis = ''; displayPane.style.flexBasis = '';
                     } catch (error) { }
                }
            }
            saveContainerPosition();
        }, RESIZE_DEBOUNCE_MS);
    }

    function initializeUI() {
        const containerId = CONTAINER_ID; const oldContainer = document.getElementById(containerId);
        if (oldContainer) { try { oldContainer.remove(); } catch(e) {} }
        if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e) {} containerResizeObserver = null; }
        try {
            addStyles();
            container = document.createElement("div"); container.className = "ts-container"; container.id = containerId;
            topBarElement = document.createElement("div"); topBarElement.className = "ts-top-bar";
            currentTimeDisplay = document.createElement("div"); currentTimeDisplay.id = "ts-current-time"; currentTimeDisplay.className = "ts-time-display"; currentTimeDisplay.textContent = "読み込み中...";
            recordBtn = document.createElement("button"); recordBtn.id = "ts-record-button"; recordBtn.className = "ts-record-button"; recordBtn.textContent = "現在時刻を記録";
            mainContentElement = document.createElement("div"); mainContentElement.id = "ts-main-content";
            editorPane = document.createElement("div"); editorPane.id = "ts-editor-pane";
            const editorLabel = document.createElement("label"); editorLabel.setAttribute("for", "ts-bulk-editor"); editorLabel.textContent = "タイムスタンプ編集";
            bulkEditor = document.createElement("textarea"); bulkEditor.id = "ts-bulk-editor"; bulkEditor.placeholder = "例:\n0:15:30 開始\n1:25:00 [01]曲名\n...";
            resizerElement = document.createElement("div"); resizerElement.id = "ts-pane-resizer";
            displayPane = document.createElement("div"); displayPane.id = "ts-display-pane";
            displayListContainer = document.createElement("div"); displayListContainer.className = "ts-display-list-container";
            const listButtonBar = document.createElement("div"); listButtonBar.className = "ts-list-button-bar";
            const copyAllButton = document.createElement("button"); copyAllButton.textContent = "全コピー"; copyAllButton.title = "左パネルの内容をコピー"; copyAllButton.className = "ts-list-button ts-copy-all-button";
            const sortButton = document.createElement("button"); sortButton.id = "ts-sort-button"; sortButton.title = "右パネルの表示順を切替"; sortButton.className = "ts-list-button ts-sort-button";
            const deleteAllButton = document.createElement("button"); deleteAllButton.textContent = "✕"; deleteAllButton.title = "すべて削除"; deleteAllButton.className = "ts-list-button ts-delete-all-button";
            displayListElement = document.createElement("ul"); displayListElement.id = "timestamp-display-list";
            bottomBarElement = document.createElement("div"); bottomBarElement.className = "ts-bottom-bar";
            const bottomControls = document.createElement("div"); bottomControls.className = "ts-bottom-controls";
            lockButton = document.createElement("button"); lockButton.id = "ts-lock-button"; lockButton.className = "ts-bottom-button ts-lock-button";
            topBarElement.append(currentTimeDisplay, recordBtn); editorPane.append(editorLabel, bulkEditor);
            listButtonBar.append(copyAllButton, sortButton, deleteAllButton); displayListContainer.append(listButtonBar, displayListElement);
            displayPane.append(displayListContainer); mainContentElement.append(editorPane, resizerElement, displayPane);
            bottomControls.append(lockButton); bottomBarElement.append(bottomControls); container.append(topBarElement, mainContentElement, bottomBarElement);
            document.body.appendChild(container);
            const savedPanelHidden = localStorage.getItem('timestampPanelHidden') === 'true';
            if (savedPanelHidden) { container.classList.add('ts-panel-hidden'); }
            else { container.classList.remove('ts-panel-hidden'); }
            const savedPosition = loadContainerPosition(); container.style.left = savedPosition.left; container.style.top = savedPosition.top; container.style.width = savedPosition.width; container.style.height = savedPosition.height;
            requestAnimationFrame(() => { if (!container) return; try { container.dataset.originalBg=window.getComputedStyle(container).backgroundColor; container.dataset.originalBorder=window.getComputedStyle(container).border; container.dataset.originalBoxShadow=window.getComputedStyle(container).boxShadow; container.dataset.originalPointerEvents=window.getComputedStyle(container).pointerEvents; container.dataset.originalOverflow=window.getComputedStyle(container).overflow; container.dataset.originalResize=window.getComputedStyle(container).resize||"both"; container.dataset.originalMinWidth=container.style.minWidth||window.getComputedStyle(container).minWidth; container.dataset.originalMinHeight=container.style.minHeight||window.getComputedStyle(container).minHeight; applySavedPaneWidths(); } catch(t){ } });
            if(typeof updateSortButtonText === 'function') updateSortButtonText(); recordBtn.onclick = recordTimestamp; copyAllButton.onclick = copyAllTimestamps; sortButton.onclick = toggleSortOrder; deleteAllButton.onclick = (e) => { e.stopPropagation(); e.preventDefault(); showConfirmDeleteAllModal(); }; lockButton.onclick = toggleLock; bulkEditor.addEventListener("input", handleEditorChange); bulkEditor.addEventListener("keydown", function(e){ if(e.key==="Enter"){} });
            const addDragListener = (dragHandle) => { if (!dragHandle) return; let startX, startY, initialLeft, initialTop; const handleDragMove = (moveEvent) => { if (!isDraggingContainer || isResizingPanes || !container) return; if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId = requestAnimationFrame(() => { if (!isDraggingContainer || isResizingPanes || !container) return; const currentX = moveEvent.clientX; const currentY = moveEvent.clientY; container.style.left = `${initialLeft + (currentX - startX)}px`; container.style.top = `${initialTop + (currentY - startY)}px`; rafDragId = null; }); }; const handleDragEnd = () => { if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId = null; if (isDraggingContainer) { isDraggingContainer = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; saveContainerPosition(); document.removeEventListener('mousemove', handleDragMove); document.removeEventListener('mouseup', handleDragEnd); } }; dragHandle.addEventListener('mousedown', (e) => { if (e.target !== dragHandle) { let currentTarget = e.target; while (currentTarget && currentTarget !== dragHandle) { if (currentTarget.tagName === 'BUTTON' || currentTarget.classList.contains('ts-bottom-controls') || currentTarget.classList.contains('ts-time-display')) { return; } currentTarget = currentTarget.parentElement; } } if (isLocked || e.button !== 0 || isResizingPanes || !container ) return; isDraggingContainer = true; const rect = container.getBoundingClientRect(); startX = e.clientX; startY = e.clientY; initialLeft = rect.left; initialTop = rect.top; document.body.style.cursor = "move"; document.body.style.userSelect = "none"; document.addEventListener('mousemove', handleDragMove); document.addEventListener('mouseup', handleDragEnd, { once: true }); e.preventDefault(); }); };
            addDragListener(topBarElement); addDragListener(bottomBarElement);
            if (resizerElement && editorPane && displayPane && mainContentElement) { const handleMouseMove = (moveEvent) => { if (!isResizingPanes) return; try { const parentRect = mainContentElement.getBoundingClientRect(); const resizerW = resizerElement.offsetWidth; const totalWidth = parentRect.width; const availableW = totalWidth - resizerW; if (availableW <= MIN_PANE_WIDTH * 2) return; let newEditorWidth = moveEvent.clientX - parentRect.left; newEditorWidth = Math.max(MIN_PANE_WIDTH, newEditorWidth); newEditorWidth = Math.min(newEditorWidth, availableW - MIN_PANE_WIDTH); let newDisplayWidth = availableW - newEditorWidth; editorPane.style.width = `${newEditorWidth}px`; displayPane.style.width = `${newDisplayWidth}px`; editorPane.style.flexBasis = ''; displayPane.style.flexBasis = ''; } catch (error) { } }; const handleMouseUp = () => { if (!isResizingPanes) return; isResizingPanes = false; document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); document.body.style.cursor = ''; document.body.style.userSelect = ''; if (resizerElement) { resizerElement.classList.remove('resizing'); } saveContainerPosition(); }; const handleMouseDown = (downEvent) => { if (isLocked || downEvent.button !== 0) return; isResizingPanes = true; document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; if (resizerElement) { resizerElement.classList.add('resizing'); } document.addEventListener('mousemove', handleMouseMove); document.addEventListener('mouseup', handleMouseUp); downEvent.preventDefault(); }; resizerElement.addEventListener('mousedown', handleMouseDown); }
            if ('ResizeObserver' in window && container) { try { containerResizeObserver = new ResizeObserver(handleContainerResize); containerResizeObserver.observe(container); } catch (e) { containerResizeObserver = null; } }
            loadState(); applyLockState(); startCurrentTimeUpdate();
            // showTooltipHint(); // <--- This line is removed/commented out
        } catch (uiError) { showErrorMessage("スクリプトUIの読み込みに失敗しました！"); if (container?.parentNode) { try { container.remove(); } catch(e) {} } container = null; if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e) {} containerResizeObserver = null; } }
    }

    function runInitialization() {
        const existingContainer = document.getElementById(CONTAINER_ID);
        if (existingContainer && !isToggleButtonInjected) { container = existingContainer; checkAndInjectToggleButton(); if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null; initRetryCount = 0; return; }
        else if (existingContainer && isToggleButtonInjected) { if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null; initRetryCount = 0; return; }
        if (initRetryCount >= MAX_INIT_RETRIES) { if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null; showErrorMessage("スクリプト初期化タイムアウト！"); initRetryCount = 0; return; }
        const video = document.querySelector('video'); const playerElement = document.getElementById('movie_player'); const videoReady = video && typeof video.currentTime === 'number' && video.readyState >= 1;
        if (videoReady && playerElement) {
            if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null; initRetryCount = 0;
            try { if (typeof initializeUI === 'function') { initializeUI(); if (!document.getElementById(CONTAINER_ID)) { showErrorMessage("UI追加失敗。"); } else { checkAndInjectToggleButton(); } } else { showErrorMessage("UI初期化関数が見つかりません！"); } }
            catch (e) { showErrorMessage("スクリプト初期化失敗！"); } return;
        }
        initRetryCount++; const retryDelay = INIT_RETRY_BASE_DELAY + initRetryCount * INIT_RETRY_INCREMENT;
        if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = setTimeout(runInitialization, retryDelay);
    }

    let lastUrl = location.href;
    const observerCallback = (mutationsList, observerInstance) => {
        requestAnimationFrame(() => {
            const currentUrl = location.href; if (currentUrl !== lastUrl && currentUrl.includes('youtube.com')) {
                lastUrl = currentUrl;
                cleanupExtensionUI();
                if (isExtensionEnabled && currentUrl.includes('/watch?v=')) { setTimeout(runInitialization, 500); }
                else { if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null; initRetryCount = 0; if (playerControlsCheckInterval) clearInterval(playerControlsCheckInterval); playerControlsCheckInterval = null; }
            }
        });
    };
    try { const observeTargetNode = document.querySelector('ytd-page-manager') || document.body; if (observeTargetNode) { pageObserver = new MutationObserver(observerCallback); pageObserver.observe(observeTargetNode, { childList: true, subtree: true }); } else { } }
    catch (e) { }

    // This function definition remains, but it's no longer called by initializeUI
    function showTooltipHint() { if (firstTimeUser && !document.getElementById("ts-tooltip-hint")) { try { const hint = document.createElement("div"); hint.id = "ts-tooltip-hint"; hint.className = "ts-tooltip-hint"; hint.textContent = "ヒント: 左パネルで編集、右パネルでCtrl+クリックジャンプ / 右クリックメニュー"; document.body.appendChild(hint); setTimeout(() => { hint.classList.add("visible"); }, 100); setTimeout(() => { if (!hint.parentNode) return; hint.classList.remove("visible"); hint.addEventListener("transitionend", () => { try { hint.remove(); } catch(e) {} }, { once: true }); setTimeout(() => { hint.parentNode && (() => { try { hint.remove(); } catch(e) {} })(); }, 600); }, 8000); } catch(t) { } } }

    function initialStart() {
       chrome.storage.sync.get([STORAGE_KEY_ENABLED], (result) => {
            isExtensionEnabled = (result[STORAGE_KEY_ENABLED] !== false);
            if (isExtensionEnabled) {
                if (document.body) { if (location.href.includes('/watch?v=')) { if (typeof runInitialization === 'function') { runInitialization(); } else { } } else { } }
                else { setTimeout(initialStart, 100); }
            } else { cleanupExtensionUI(); }
       });
    }

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes[STORAGE_KEY_ENABLED]) {
            const newState = changes[STORAGE_KEY_ENABLED].newValue; const oldState = changes[STORAGE_KEY_ENABLED].oldValue;
            const wasEnabled = (oldState !== false); const nowEnabled = (newState !== false);
            if (wasEnabled === nowEnabled) return;
            isExtensionEnabled = nowEnabled;
            if (isExtensionEnabled) { if (location.href.includes('/watch?v=')) { runInitialization(); } else { } }
            else { cleanupExtensionUI(); if (initTimeoutId) clearTimeout(initTimeoutId); initTimeoutId = null; initRetryCount = 0; if (playerControlsCheckInterval) clearInterval(playerControlsCheckInterval); playerControlsCheckInterval = null; }
        }
    });

    if (document.readyState === 'interactive' || document.readyState === 'complete') { initialStart(); }
    else { document.addEventListener('DOMContentLoaded', () => { initialStart(); }, { once: true }); }

    window.addEventListener('beforeunload', () => { cleanupExtensionUI(); if (pageObserver) { try { pageObserver.disconnect(); pageObserver = null; } catch(e) {} } });

})();
