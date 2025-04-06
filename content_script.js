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
    let isResizingPanes = false; // Flag to track if resizing is active
    // Note: resizeStartX, startEditorWidth, startDisplayWidth are removed as the new logic doesn't rely on them in the same way
    let containerResizeObserver = null;
    let resizeTimeout = null;
    let initTimeoutId = null; // Track runInitialization setTimeout
    let messageTimeoutId = null; // Track showMessage timeout
    let initRetryCount = 0; // Moved here for clarity with runInitialization

    // --- 常數定義 ---
    const STORAGE_KEY_ENABLED = 'extensionEnabled';
    const CONTAINER_ID = 'ts-container-main';
    const DRAG_THRESHOLD = 150; // ms threshold to differentiate click from drag start
    const DRAG_MOVE_THRESHOLD = 5; // pixels threshold to differentiate click from drag start
    const EDITOR_DEBOUNCE_MS = 400;
    const RESIZE_DEBOUNCE_MS = 100;
    const TIME_REGEX = /^(\d+):(\d{2}):(\d{2})/;
    const MIN_PANE_WIDTH = 100; // Minimum width for editor and display panes in pixels
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

            // Force reflow before adding 'visible' class for transition
            requestAnimationFrame(() => { requestAnimationFrame(() => { messageBox.classList.add('visible'); }); });

            const currentTimeoutId = setTimeout(() => {
                if (!messageBox.parentNode) return; // Already removed
                messageBox.classList.remove('visible');
                messageBox.classList.add('fade-out');
                const transitionDuration = 400; // Match CSS transition duration
                // Fallback removal in case transitionend doesn't fire
                const removeLogic = () => {
                    if (messageBox.parentNode) { try { messageBox.remove(); } catch(e){} }
                    // Clear the timeout ID only if it's the one currently active
                    if (messageTimeoutId === currentTimeoutId) { messageTimeoutId = null; }
                };
                messageBox.addEventListener('transitionend', removeLogic, { once: true });
                setTimeout(removeLogic, transitionDuration + 100); // Safety net
            }, duration);
            messageTimeoutId = currentTimeoutId; // Store the new timeout ID
        } catch (e) { console.error(LOG_TAG, "showMessage failed:", e, message); }
    }
    function showSuccessMessage(message) { showMessage(message, 'success', 2500); }
    function showErrorMessage(message) { showMessage(message, 'error', 5000); }
    function showInfoMessage(message) { showMessage(message, 'info', 3000); }
    function showJumpSuccessMessage(timestamp) { showMessage(`ジャンプ成功: ${timestamp}`, 'jump', 2000); }
    function showCopySuccessMessage(text) { showMessage(`${text}`, 'success', 2000); }

    function applySavedPaneWidths() {
        // Applies saved widths, falling back to flex-basis defaults if needed
        try {
            const savedEditorWidthPx = localStorage.getItem('timestampEditorWidth');
            if (editorPane && displayPane && resizerElement && savedEditorWidthPx) {
                 // Use setTimeout to ensure layout is stable after initial render
                 setTimeout(() => {
                    if (!editorPane || !editorPane.parentElement || !resizerElement) return; // Elements might have been removed
                    const totalWidth = editorPane.parentElement.clientWidth; // Use parent (mainContentElement) width
                    const resizerW = resizerElement.offsetWidth;
                    const availableWidth = totalWidth - resizerW;

                    if (availableWidth <= (MIN_PANE_WIDTH * 2)) {
                         console.warn(LOG_TAG, "applySavedPaneWidths: Container too small, using default flex basis.");
                         editorPane.style.width = ''; displayPane.style.width = '';
                         editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
                         return;
                    }

                    const editorW = parseFloat(savedEditorWidthPx);
                    // Validate saved width
                    if (!isNaN(editorW) && editorW >= MIN_PANE_WIDTH && (availableWidth - editorW) >= MIN_PANE_WIDTH) {
                        editorPane.style.width = `${editorW}px`;
                        displayPane.style.width = `${availableWidth - editorW}px`;
                        // IMPORTANT: Clear flex-basis when setting specific pixel widths
                        editorPane.style.flexBasis = '';
                        displayPane.style.flexBasis = '';
                        // console.log(LOG_TAG, `Applied saved widths: Editor=${editorW}px, Display=${availableWidth - editorW}px`);
                    } else {
                        console.warn(LOG_TAG, "保存されたエディター幅が無効または範囲外です。デフォルトの比率を使用します。");
                        editorPane.style.width = ''; displayPane.style.width = '';
                        editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
                    }
                 }, 0); // Delay slightly
            } else if (editorPane && displayPane) {
                // Fallback to default flex basis if no saved width or elements missing
                editorPane.style.width = ''; displayPane.style.width = '';
                editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
            }
        } catch(e) {
             console.error(LOG_TAG, "Error applying saved pane widths:", e);
             // Ensure fallback in case of error
             if (editorPane && displayPane) {
                 editorPane.style.width = ''; displayPane.style.width = '';
                 editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
             }
        }
    }

    function loadState() {
        try {
            const storedTimestamps = localStorage.getItem('timestamps');
            if (storedTimestamps) {
                try {
                    timestamps = JSON.parse(storedTimestamps);
                } catch (e) {
                    console.error(LOG_TAG, 'タイムスタンプの読み込みに失敗:', e);
                    timestamps = []; // Reset on parse error
                }
            } else {
                timestamps = [];
            }
            isLocked = localStorage.getItem('timestampLockState') === 'true';
            isHidden = localStorage.getItem('timestampHiddenState') === 'true';
            firstTimeUser = localStorage.getItem('timestampFirstTime') === null;
            sortState = null; // Reset sort on load

            // Apply saved layout *after* elements are potentially created/recreated
            if (typeof applySavedPaneWidths === 'function') {
                applySavedPaneWidths();
            }

            // Populate UI if elements exist
            if (bulkEditor && displayListElement && typeof populateEditorFromTimestamps === 'function' && typeof renderTimestampList === 'function') {
                 populateEditorFromTimestamps();
                 renderTimestampList(); // Also updates sort button text indirectly
            } else {
                 // This might happen if loadState is called before UI is fully ready (e.g., on toggle)
                 console.warn(LOG_TAG, "loadState: bulkEditor or displayListElement not ready yet.");
            }
        } catch(e) {
            console.error(LOG_TAG, "Error in loadState:", e);
            // Reset to defaults in case of critical error
            timestamps = [];
            isLocked = false;
            isHidden = false;
            firstTimeUser = true;
            sortState = null;
        }
    }

    function saveTimestamps() {
        try {
            // Ensure timestamps are strings and trimmed, filter out empty ones before saving
            const cleanedTimestamps = timestamps.map(ts => String(ts).trim()).filter(ts => ts.length > 0);
            // Avoid unnecessary save if content is identical after cleaning
            if (JSON.stringify(timestamps) !== JSON.stringify(cleanedTimestamps)) {
                timestamps = cleanedTimestamps; // Update the main array only if changed
            }
            localStorage.setItem('timestamps', JSON.stringify(timestamps));
        } catch (e) {
            console.error(LOG_TAG, "Failed to save timestamps:", e);
            if (typeof showErrorMessage === 'function') showErrorMessage("タイムスタンプ保存失敗！");
        }
    }

    function saveContainerPosition() {
        // Saves container position, size, and editor pane width
        if (!container) return;
        try {
            const rect = container.getBoundingClientRect();
            const position = {
                left: container.style.left || `${rect.left}px` || "360px", // Use style first, then rect, then default
                top: container.style.top || `${rect.top}px` || "500px",
                width: container.style.width || `${rect.width}px` || "680px",
                height: container.style.height || `${rect.height}px` || "380px"
            };
            localStorage.setItem('timestampContainerPosition', JSON.stringify(position));

            // Save editor width only if it's explicitly set in pixels (meaning it was likely resized)
            // Avoid saving flex-basis percentages or empty strings
            if (editorPane && editorPane.style.width && editorPane.style.width.endsWith('px') && !isResizingPanes) {
                localStorage.setItem('timestampEditorWidth', editorPane.style.width);
                // console.log(LOG_TAG, `Saved editor width: ${editorPane.style.width}`);
            }
        } catch (e) {
            console.error(LOG_TAG, "Failed to save container position/size:", e);
        }
    }

    function loadContainerPosition() {
        const defaultPos = { left: "360px", top: "500px", width: "680px", height: "380px" };
        const savedPosition = localStorage.getItem('timestampContainerPosition');
        if (savedPosition) {
            try {
                const pos = JSON.parse(savedPosition);
                // Basic validation
                if (pos && typeof pos.left === 'string' && typeof pos.top === 'string') {
                    // Ensure width and height are present, falling back to defaults if missing
                    pos.width = pos.width || defaultPos.width;
                    pos.height = pos.height || defaultPos.height;
                    return pos;
                }
            } catch (e) {
                console.error(LOG_TAG, '位置情報読み込み失敗:', e);
            }
        }
        return defaultPos; // Return default if saved data is missing or invalid
    }

    function formatTime(totalSeconds) {
        totalSeconds = Math.max(0, Math.floor(totalSeconds)); // Ensure non-negative integer
        const h = Math.floor(totalSeconds / 3600);
        const m = Math.floor((totalSeconds % 3600) / 60);
        const s = totalSeconds % 60;
        return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function updateTimeDisplay() {
        try {
            const video = document.querySelector('video');
            if (currentTimeDisplay) {
                if (video && typeof video.currentTime === 'number' && !isNaN(video.currentTime)) {
                    currentTimeDisplay.textContent = `再生時間 ${formatTime(video.currentTime)}`;
                } else {
                    currentTimeDisplay.textContent = '再生時間 --:--:--'; // Placeholder if no video or time
                }
            }
        } catch (e) {
            console.error(LOG_TAG, "Error updating time display:", e);
            if (currentTimeDisplay) currentTimeDisplay.textContent = '時刻表示エラー';
        }
    }

    function startCurrentTimeUpdate() {
        stopCurrentTimeUpdate(); // Clear any existing interval
        try {
            const video = document.querySelector('video');
            if (video && video.readyState >= 1) { // If metadata is already loaded
                 updateTimeDisplay(); // Update immediately
                 currentTimeInterval = setInterval(updateTimeDisplay, 1000);
            } else if (video) { // If video exists but metadata isn't ready
                 const onMetadataLoaded = () => {
                     // Ensure video is still present and readyState is sufficient
                     if (video.readyState >= 1) {
                         updateTimeDisplay(); // Update immediately
                         currentTimeInterval = setInterval(updateTimeDisplay, 1000);
                     }
                     // Clean up the listener once fired (or if it fails)
                     video.removeEventListener('loadedmetadata', onMetadataLoaded);
                 };
                 video.addEventListener('loadedmetadata', onMetadataLoaded);
            }
            // No 'else' needed - if no video, the display will show '--:--:--' via updateTimeDisplay calls
        } catch (e) {
            console.error(LOG_TAG, "Error starting current time update:", e);
            // Optionally update display to show error state here if needed
        }
    }

    function stopCurrentTimeUpdate() {
        if (currentTimeInterval) {
            clearInterval(currentTimeInterval);
            currentTimeInterval = null;
        }
    }

    function recordTimestamp() {
        try {
            const video = document.querySelector('video');
            if (video && typeof video.currentTime === 'number' && !isNaN(video.currentTime)) {
                const currentTime = video.currentTime;
                let maxNum = 0;
                // Find the highest number in "[XX]" format at the end of existing timestamps
                timestamps.forEach(ts => {
                    const match = String(ts).match(/\[(\d+)\]$/);
                    if (match?.[1]) { // Check if match and group 1 exist
                        const num = parseInt(match[1], 10);
                        if (!isNaN(num) && num > maxNum) {
                            maxNum = num;
                        }
                    }
                });
                const nextNumber = maxNum + 1;
                const defaultText = ` [${nextNumber.toString().padStart(2, '0')}]`; // e.g., [01], [02] ... [10]
                const formattedTimestamp = `${formatTime(currentTime)}${defaultText}`;

                timestamps.push(formattedTimestamp);
                saveTimestamps();

                // Update UI
                if(typeof populateEditorFromTimestamps === 'function') populateEditorFromTimestamps();
                sortState = null; // Reset sort when adding new item
                if(typeof updateSortButtonText === 'function') updateSortButtonText();
                if(typeof renderTimestampList === 'function') renderTimestampList();

                // Update first time user flag
                if (firstTimeUser && timestamps.length === 1) {
                     localStorage.setItem('timestampFirstTime', 'false');
                     firstTimeUser = false;
                }

                // Scroll editor to bottom
                if (bulkEditor) {
                     setTimeout(() => { bulkEditor.scrollTop = bulkEditor.scrollHeight; }, 0); // Use setTimeout to ensure DOM update
                }

            } else {
                console.error(LOG_TAG, "Cannot record: Video not ready or currentTime invalid.", video, video?.currentTime);
                showErrorMessage("動画が見つからないか、再生時間を取得できません。");
            }
        } catch (err) {
            console.error(LOG_TAG, "Error recording timestamp:", err);
            showErrorMessage("記録エラー: " + err.message);
        }
    }

    function adjustTimestamp(index, adjustment) {
        if (index < 0 || index >= timestamps.length) return; // Index out of bounds

        const timestamp = String(timestamps[index]);
        const match = timestamp.match(TIME_REGEX); // Use the global regex

        if (match) {
            try {
                let h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10);
                if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error("時間解析エラー"); // Validate parsing

                let totalSeconds = h * 3600 + m * 60 + s + adjustment;
                totalSeconds = Math.max(0, totalSeconds); // Ensure time doesn't go below zero

                const newFormattedTime = formatTime(totalSeconds);
                const restOfString = timestamp.substring(match[0].length); // Get the part after HH:MM:SS
                const newTimestamp = `${newFormattedTime}${restOfString}`;

                timestamps[index] = newTimestamp;
                saveTimestamps();

                // Update UI
                 if(typeof populateEditorFromTimestamps === 'function') populateEditorFromTimestamps();
                 if(typeof renderTimestampList === 'function') renderTimestampList();
                 // Optionally jump after adjusting
                 if(typeof jumpToTimestamp === 'function') jumpToTimestamp(newTimestamp);

            } catch (e) {
                console.error(LOG_TAG, "Error adjusting timestamp:", e);
                showErrorMessage("時間調整エラー。");
            }
        } else {
            // Handle cases where the timestamp string doesn't start with HH:MM:SS
             showErrorMessage("時間調整エラー：時間形式 (HH:MM:SS) が見つかりません。");
        }
    }

    function deleteTimestamp(index) {
        if (index < 0 || index >= timestamps.length) return; // Index out of bounds
        try {
            timestamps.splice(index, 1); // Remove the item at the index
            saveTimestamps();
            // Update UI
            if(typeof populateEditorFromTimestamps === 'function') populateEditorFromTimestamps();
            // Potentially reset sort if the deleted item affects the sorted order significantly,
            // but usually just re-rendering is enough. Let's reset it for simplicity.
            sortState = null;
            if(typeof updateSortButtonText === 'function') updateSortButtonText();
            if(typeof renderTimestampList === 'function') renderTimestampList();
        } catch (e) {
             console.error(LOG_TAG, "Error deleting timestamp:", e);
             showErrorMessage("削除エラー。");
        }
    }

    function jumpToTimestamp(timestamp) {
        const timestampStr = String(timestamp); // Ensure it's a string
        const match = timestampStr.match(TIME_REGEX); // Match HH:MM:SS at the beginning

        if (match) {
            try {
                const h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10);
                if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error("時間解析エラー");

                const totalSeconds = h * 3600 + m * 60 + s;
                const video = document.querySelector('video');

                if (video) {
                    // Ensure jump time is within video duration if available
                    if (!isNaN(video.duration) && totalSeconds > video.duration) {
                        video.currentTime = video.duration; // Jump to end if target is beyond duration
                    } else {
                        video.currentTime = totalSeconds;
                    }
                    // Attempt to play the video after jumping
                    if (typeof video.play === 'function') {
                         video.play().catch(e => console.warn(LOG_TAG, "再生失敗 (play promise rejected):", e.message)); // Catch potential play errors
                    }
                     showJumpSuccessMessage(match[0]); // Show success with the HH:MM:SS part
                } else {
                    showErrorMessage("動画プレーヤーが見つかりません。");
                }
            } catch (e) {
                console.error(LOG_TAG, "Error jumping to timestamp:", e);
                showErrorMessage("ジャンプエラー。");
            }
        } else {
             showErrorMessage(`ジャンプエラー：時間形式 (HH:MM:SS) が見つかりません。(${timestampStr.substring(0, 10)}...)`);
        }
    }

    // Helper function to parse time string (HH:MM:SS) to seconds
    function parseTimeToSeconds(timeString) {
        const match = String(timeString).match(TIME_REGEX); // Match HH:MM:SS at the start
        if (match?.[1] && match?.[2] && match?.[3]) { // Check match and groups exist
             try {
                const h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10);
                if (!isNaN(h) && !isNaN(m) && !isNaN(s)) {
                    return h * 3600 + m * 60 + s;
                }
             } catch(e) {/* Ignore parsing errors here, return null below */}
        }
        return null; // Return null if format is invalid or parsing fails
    }

    // --- Sorting Logic ---
    function toggleSortOrder() {
        // Cycle through: null (Original) -> true (Ascending) -> false (Descending) -> null
        if (sortState === null) {
            sortState = true; // Ascending
        } else if (sortState === true) {
            sortState = false; // Descending
        } else {
            sortState = null; // Original order
        }
        // Re-render the list with the new sort order
        if(typeof renderTimestampList === 'function') renderTimestampList();
        if(typeof updateSortButtonText === 'function') updateSortButtonText(); // Update button text
    }

    function updateSortButtonText() {
        try {
            const btn = document.getElementById('ts-sort-button');
            if (!btn) return;

            if (sortState === true) {
                btn.textContent = "時間昇順 ▲";
            } else if (sortState === false) {
                btn.textContent = "時間降順 ▼";
            } else {
                btn.textContent = "元の順序";
            }
            // Add subtle feedback on click/toggle
            btn.style.transform = "scale(0.95)";
            setTimeout(() => { if(btn) btn.style.transform = "scale(1)"; }, 100);
        } catch(e) {
            console.error(LOG_TAG, "Error updating sort button text:", e);
        }
    }

    // --- Delete All Logic ---
    function deleteAllTimestampsConfirmed() {
         try {
            timestamps = []; // Clear the array
            saveTimestamps(); // Save the empty array
            // Update UI
            if (bulkEditor) bulkEditor.value = ''; // Clear editor
            sortState = null; // Reset sort state
            if(typeof updateSortButtonText === 'function') updateSortButtonText(); // Update sort button
            if(typeof renderTimestampList === 'function') renderTimestampList(); // Re-render display list (will show empty message)
            showInfoMessage("すべての記録が削除されました。");
         } catch (error) {
            console.error(LOG_TAG, "Error in deleteAllTimestampsConfirmed:", error);
            showErrorMessage("全削除処理中にエラーが発生しました。");
         }
    }

    // --- Context Menu Logic ---
    let contextMenuCloseListener = null; // Store the listener to remove it later

    function closeExistingContextMenu() {
        try {
            const menu = document.getElementById('timestamp-context-menu');
            if (menu) menu.remove();
            // Remove the global click/contextmenu listener if it exists
            if (contextMenuCloseListener) {
                 document.removeEventListener('click', contextMenuCloseListener, { capture: true });
                 document.removeEventListener('contextmenu', contextMenuCloseListener, { capture: true });
                 contextMenuCloseListener = null;
            }
        } catch (e) {
             console.warn(LOG_TAG, "Error closing context menu:", e); // Use warn as it's not critical
        }
    }

    // --- Modal Logic ---
    function showConfirmDeleteAllModal() {
        let modalOverlay = null; // Define here to be accessible in catch block
        try {
            closeExistingContextMenu(); // Close any open context menus

            // Remove existing modal if any
            const existingModal = document.getElementById('ts-confirm-modal');
            if (existingModal) existingModal.remove();

            // Create Modal Structure
            modalOverlay = document.createElement("div");
            modalOverlay.id = "ts-confirm-modal";
            modalOverlay.className = "ts-modal-overlay";

            const modalContent = document.createElement("div");
            modalContent.className = "ts-modal-content";

            const message = document.createElement("p");
            message.textContent = "すべての記録を削除しますか？";
            message.className = "ts-modal-message";

            const buttonContainer = document.createElement("div");
            buttonContainer.className = "ts-modal-buttons";

            const cancelButton = document.createElement("button");
            cancelButton.textContent = "いいえ";
            cancelButton.className = "ts-modal-button ts-modal-cancel";
            cancelButton.onclick = () => {
                try { modalOverlay.remove(); } catch(e) {} // Safely remove modal
            };

            const confirmButton = document.createElement("button");
            confirmButton.textContent = "削除";
            confirmButton.className = "ts-modal-button ts-modal-confirm";
            confirmButton.onclick = () => {
                 try {
                    deleteAllTimestampsConfirmed();
                    modalOverlay.remove(); // Close modal after action
                 } catch (e) {
                     console.error(LOG_TAG, "Error during deleteAll/modal removal:", e);
                     showErrorMessage("削除処理中にエラーが発生しました。");
                     // Ensure modal is removed even if deleteAll fails
                     if (modalOverlay?.parentNode) { try { modalOverlay.remove(); } catch(e) {} }
                 }
            };

            // Assemble Modal
            buttonContainer.append(cancelButton, confirmButton);
            modalContent.append(message, buttonContainer);
            modalOverlay.appendChild(modalContent);
            document.body.appendChild(modalOverlay);

            // --- Modal Dragging Logic ---
            modalContent.style.position = 'absolute'; // Needed for dragging calculation
            modalContent.style.cursor = 'move';

            modalContent.addEventListener('mousedown', (e) => {
                // Only drag when clicking directly on the modal content background (not buttons/text)
                // and only with the primary mouse button (button 0)
                if (e.target !== modalContent || e.button !== 0) return;

                isDraggingModal = true;
                const overlayRect = modalOverlay.getBoundingClientRect(); // Get overlay position for relative calculation
                const contentRect = modalContent.getBoundingClientRect();
                modalOffsetX = e.clientX - contentRect.left;
                modalOffsetY = e.clientY - contentRect.top;
                // Store initial position relative to the overlay, not the viewport
                const initialLeft = contentRect.left - overlayRect.left;
                const initialTop = contentRect.top - overlayRect.top;

                document.body.style.userSelect = 'none'; // Prevent text selection during drag

                const modalMoveHandler = (moveEvent) => {
                    if (!isDraggingModal) return;

                    // Use requestAnimationFrame for smoother dragging
                    if(rafModalDragId) cancelAnimationFrame(rafModalDragId);
                    rafModalDragId = requestAnimationFrame(() => {
                         // Calculate new position based on initial offset and mouse movement
                         // Position is relative to the overlay div
                        let newX = initialLeft + (moveEvent.clientX - e.clientX);
                        let newY = initialTop + (moveEvent.clientY - e.clientY);

                        // Keep modal within viewport boundaries (optional but good practice)
                        // newX = Math.max(0, Math.min(newX, overlayRect.width - contentRect.width));
                        // newY = Math.max(0, Math.min(newY, overlayRect.height - contentRect.height));

                        modalContent.style.left = `${newX}px`;
                        modalContent.style.top = `${newY}px`;
                        rafModalDragId = null; // Clear RAF ID after execution
                    });
                };

                const modalUpHandler = () => {
                     if(rafModalDragId) cancelAnimationFrame(rafModalDragId); // Cancel any pending frame
                     rafModalDragId = null;
                    if (isDraggingModal) {
                        isDraggingModal = false;
                        document.body.style.userSelect = ''; // Restore text selection
                        document.removeEventListener('mousemove', modalMoveHandler);
                        document.removeEventListener('mouseup', modalUpHandler); // Clean up self
                    }
                };

                document.addEventListener('mousemove', modalMoveHandler);
                document.addEventListener('mouseup', modalUpHandler, { once: true }); // Use once for mouseup
                e.preventDefault(); // Prevent default drag behavior
            });

            // --- End Modal Dragging Logic ---

            cancelButton.focus(); // Set focus to cancel button by default

        } catch (error) {
            console.error(LOG_TAG, "Error showing delete confirmation modal:", error);
            showErrorMessage("削除確認ウィンドウ表示中にエラー発生");
            // Ensure cleanup if modal creation failed mid-way
            if (modalOverlay?.parentNode) { try { modalOverlay.remove(); } catch(e) {} }
        }
    }

    // --- Copy Logic ---
    function copyAllTimestamps() {
         if (!bulkEditor || bulkEditor.value.trim() === '') {
            showInfoMessage("コピーする記録はありません。");
            return;
         }
         const textToCopy = bulkEditor.value;
         navigator.clipboard.writeText(textToCopy).then(() => {
             const lineCount = textToCopy.split('\n').filter(line => line.trim() !== '').length;
             showCopySuccessMessage(`エディター内容 全${lineCount}行コピー！`);
         }).catch(err => {
             console.error(LOG_TAG, 'コピー失敗:', err);
             showErrorMessage("コピーに失敗しました。");
         });
    }

    function copySingleTimestamp(text) {
        if (!text) return; // Do nothing if text is empty or null
        navigator.clipboard.writeText(String(text)).then(() => {
             showCopySuccessMessage(`コピー: ${String(text).substring(0, 50)}${String(text).length > 50 ? '...' : ''}`);
        }).catch(err => {
             console.error(LOG_TAG, 'コピー失敗:', err);
             showErrorMessage("コピー失敗。");
        });
    }

    // --- Lock/Unlock Logic ---
    function toggleLock() {
        isLocked = !isLocked;
        localStorage.setItem('timestampLockState', isLocked.toString());
        applyLockState();
         // Visual feedback for the button click
         if (lockButton) {
             lockButton.style.transform = "scale(0.95)";
             setTimeout(() => { if (lockButton) lockButton.style.transform = "scale(1)"; }, 100);
         }
    }

    function applyLockState() {
        // Check if elements exist before trying to modify them
        if (!lockButton || !container || !bulkEditor || !topBarElement || !bottomBarElement || !resizerElement) {
            console.warn(LOG_TAG, "applyLockState: Elements missing, cannot apply state.");
            return;
        }
        try {
            lockButton.textContent = isLocked ? "アンロック" : "ロック";
            lockButton.classList.toggle('ts-locked', isLocked);
            lockButton.classList.toggle('ts-unlocked', !isLocked);

            // Editor
            bulkEditor.readOnly = isLocked;
            bulkEditor.style.backgroundColor = isLocked ? '#eee' : '#fff'; // Visual cue
            bulkEditor.style.cursor = isLocked ? 'not-allowed' : '';

            // Drag Handles (Top/Bottom Bars)
            topBarElement.style.cursor = isLocked ? 'default' : 'move';
            bottomBarElement.style.cursor = isLocked ? 'default' : 'move';
            topBarElement.classList.toggle('ts-locked', isLocked);
            bottomBarElement.classList.toggle('ts-locked', isLocked);

            // Container Resizing
             // Store original resize style if not already stored
             if (!container.dataset?.originalResize) {
                 container.dataset.originalResize = window.getComputedStyle(container).resize || 'both';
             }
             container.style.resize = isLocked ? 'none' : (container.dataset.originalResize); // Restore original or set to none
             container.classList.toggle('ts-locked', isLocked); // Add class for potential CSS targeting

            // Pane Resizer
            resizerElement.style.display = isLocked ? 'none' : 'block'; // Hide resizer when locked
            resizerElement.style.cursor = isLocked ? 'default' : 'col-resize';

        } catch(e) {
            console.error(LOG_TAG, "Error applying lock state:", e);
        }
    }

    // --- Hide/Show Logic ---
    function toggleVisibility() {
        // Prevent toggling if the mouse was dragged from the hide button
        if (hideButtonDragged) {
            hideButtonDragged = false; // Reset flag for next click
            return;
        }
        isHidden = !isHidden;
        localStorage.setItem('timestampHiddenState', isHidden.toString());
        applyHiddenState();
         // Visual feedback for the button click
         if (hideButton) {
             hideButton.style.transform = "scale(0.95)";
             setTimeout(() => { if (hideButton) hideButton.style.transform = "scale(1)"; }, 100);
         }
    }

    function applyHiddenState() {
        // Ensure all required elements exist
        if (!container || !hideButton || !topBarElement || !mainContentElement || !bottomBarElement || !resizerElement) {
            console.warn(LOG_TAG, "applyHiddenState: Elements missing, cannot apply state.");
            return;
        }

        try {
            // Store original styles if not already stored (using dataset)
            if (!container.dataset.originalBg) container.dataset.originalBg = window.getComputedStyle(container).backgroundColor;
            if (!container.dataset.originalBorder) container.dataset.originalBorder = window.getComputedStyle(container).border;
            if (!container.dataset.originalBoxShadow) container.dataset.originalBoxShadow = window.getComputedStyle(container).boxShadow;
            if (!container.dataset.originalPointerEvents) container.dataset.originalPointerEvents = window.getComputedStyle(container).pointerEvents;
            if (!container.dataset.originalOverflow) container.dataset.originalOverflow = window.getComputedStyle(container).overflow;
            // Also store original resize state here if not done by applyLockState
             if (!container.dataset.originalResize) {
                 container.dataset.originalResize = window.getComputedStyle(container).resize || 'both';
             }


            if (isHidden) {
                // --- Hide the main container content ---
                topBarElement.style.visibility = 'hidden';
                mainContentElement.style.visibility = 'hidden';
                bottomBarElement.style.visibility = 'hidden'; // Hide bottom bar too
                resizerElement.style.visibility = 'hidden'; // Hide resizer

                // Make container visually disappear but keep its layout space for positioning the button relative to it initially
                container.style.backgroundColor = 'transparent';
                container.style.border = 'none';
                container.style.boxShadow = 'none';
                container.style.resize = 'none'; // Disable resizing
                container.style.overflow = 'visible'; // Allow button to be outside bounds if needed
                // IMPORTANT: Disable pointer events on the container itself so it doesn't block underlying elements
                container.style.pointerEvents = 'none';

                // --- Position and style the Hide Button ---
                 // Get button's current position relative to viewport *before* changing its position style
                 // Use last saved pos if available (from dragging), otherwise get current pos
                 const rect = (hideButtonLastViewportPos.left !== 0 || hideButtonLastViewportPos.top !== 0)
                             ? hideButtonLastViewportPos
                             : hideButton.getBoundingClientRect();

                hideButton.style.position = 'fixed'; // Position relative to viewport
                hideButton.style.left = `${rect.left}px`;
                hideButton.style.top = `${rect.top}px`;
                hideButton.style.visibility = 'visible'; // Ensure button is visible
                hideButton.style.pointerEvents = 'auto'; // Make button clickable
                hideButton.style.zIndex = '9999'; // Bring button to front
                hideButton.textContent = "表示";
                hideButton.classList.add('ts-hidden-state');
                hideButton.classList.remove('ts-visible-state');

            } else {
                // --- Restore the container ---
                // Restore original styles using dataset fallbacks
                container.style.pointerEvents = container.dataset.originalPointerEvents || 'auto';
                container.style.backgroundColor = container.dataset.originalBg || 'rgba(240, 240, 240, 0.95)';
                container.style.border = container.dataset.originalBorder || '1px solid #a0a0a0';
                container.style.boxShadow = container.dataset.originalBoxShadow || '0 4px 12px rgba(0,0,0,0.2)';
                container.style.overflow = container.dataset.originalOverflow || 'hidden';
                // Restore resize based on lock state (applyLockState handles this)


                // Make content visible again
                topBarElement.style.visibility = 'visible';
                mainContentElement.style.visibility = 'visible';
                bottomBarElement.style.visibility = 'visible';
                 // Resizer visibility depends on lock state, handled by applyLockState below

                // --- Restore the Hide Button ---
                hideButton.style.position = ''; // Reset position to default (likely relative)
                hideButton.style.left = '';
                hideButton.style.top = '';
                hideButton.style.zIndex = '';
                hideButton.style.visibility = 'visible'; // Ensure visible
                hideButton.style.pointerEvents = 'auto'; // Ensure clickable
                hideButton.textContent = "隠す";
                hideButton.classList.remove('ts-hidden-state');
                hideButton.classList.add('ts-visible-state');

                // Re-apply lock state to ensure correct resize/resizer visibility
                if (typeof applyLockState === 'function') {
                    applyLockState();
                }
            }
        } catch (e) {
            console.error(LOG_TAG, "Error applying hidden state:", e);
        }
    }

    // --- Editor/Display Sync ---
    function populateEditorFromTimestamps() {
        if (!bulkEditor) return;
        try {
             bulkEditor.value = timestamps.join('\n');
        } catch(e) {
             console.error(LOG_TAG, "Error populating editor:", e);
        }
    }

    function handleEditorChange() {
        if (!bulkEditor) return;
        // Debounce the input handling
        if (editorChangeTimeout) clearTimeout(editorChangeTimeout);

        editorChangeTimeout = setTimeout(() => {
            try {
                const currentText = bulkEditor.value;
                const lines = currentText.split('\n');
                // Avoid unnecessary updates if content hasn't effectively changed
                // Note: This simple comparison works because saveTimestamps also cleans/filters
                if (JSON.stringify(timestamps) !== JSON.stringify(lines)) {
                    timestamps = lines; // Update the main array
                    saveTimestamps(); // Save the new content (will also clean/filter)
                    // If user edits while sorted, reset sort to avoid confusion
                    if (sortState !== null) {
                        sortState = null;
                        if(typeof updateSortButtonText === 'function') updateSortButtonText();
                    }
                    // Re-render the display list
                    if(typeof renderTimestampList === 'function') renderTimestampList();
                }
            } catch (e) {
                 console.error(LOG_TAG, "Error handling editor change:", e);
            }
        }, EDITOR_DEBOUNCE_MS);
    }

    // --- Rendering Display List ---
    function renderTimestampList() {
        // Ensure the list element exists, try to find it if null
        if (!displayListElement) {
             displayListElement = document.getElementById("timestamp-display-list");
             if (!displayListElement) {
                 console.warn(LOG_TAG, "renderTimestampList: displayListElement not found. Cannot render.");
                 return; // Exit if list element is absolutely not found
             }
        }

        try {
            // Clear previous content efficiently
            displayListElement.textContent = ''; // Fastest way to clear children

            // Filter out empty/whitespace-only lines from the source `timestamps` array
             // Convert to string first as array might contain non-strings after manual edit
            const validTimestamps = timestamps.map(String).filter(ts => ts.trim().length > 0);

            let displayItems = []; // Array to hold items for display { text: string, originalIndex: number }

            if (sortState !== null) { // If sorting is enabled (true for ASC, false for DESC)
                const itemsToSort = validTimestamps.map((text, index) => ({
                    text: text,
                    timeSeconds: parseTimeToSeconds(text), // Returns null if no valid time found
                    originalIndex: timestamps.indexOf(text) // Find original index in the *unsaved* `timestamps` array
                }));

                itemsToSort.sort((a, b) => {
                     // Primary sort: by time in seconds
                     if (a.timeSeconds !== null && b.timeSeconds !== null) {
                         return sortState ? a.timeSeconds - b.timeSeconds : b.timeSeconds - a.timeSeconds;
                     }
                     // Secondary sort: items without valid time format go after items with time
                     if (a.timeSeconds === null && b.timeSeconds !== null) return sortState ? 1 : -1; // a (no time) comes after b (time) in ASC
                     if (a.timeSeconds !== null && b.timeSeconds === null) return sortState ? -1 : 1; // a (time) comes before b (no time) in ASC
                     // Tertiary sort: if both have no time or times are equal, sort alphabetically (localeCompare)
                     return sortState ? a.text.localeCompare(b.text) : b.text.localeCompare(a.text);
                });
                displayItems = itemsToSort; // Use the sorted array

            } else { // No sorting, use original order (filtered)
                displayItems = validTimestamps.map((text) => ({
                     text: text,
                     originalIndex: timestamps.indexOf(text) // Find original index
                }));
            }

            // Handle empty list case
            if (displayItems.length === 0) {
                const emptyGuide = document.createElement('div');
                emptyGuide.className = 'ts-empty-guide';
                emptyGuide.textContent = "記録はありません"; // "No records"
                displayListElement.appendChild(emptyGuide);
                return;
            }

            // Build list items using a DocumentFragment for performance
            const fragment = document.createDocumentFragment();
            displayItems.forEach((itemData) => {
                 // Pass the text content and its original index from the main `timestamps` array
                 const listItem = createTimestampListItem(itemData.text, itemData.originalIndex);
                 if (listItem) { // Append only if item creation was successful
                    fragment.appendChild(listItem);
                 }
            });

            displayListElement.appendChild(fragment); // Append all items at once

        } catch (e) {
            console.error(LOG_TAG, "Error rendering timestamp display list:", e);
             showErrorMessage("リスト表示エラー。");
             // Display error message in the list area
             if (displayListElement) {
                 displayListElement.textContent = ''; // Clear first
                 const errorLi = document.createElement('li');
                 errorLi.textContent = 'リスト表示エラー';
                 errorLi.style.cssText = 'color: red; padding: 10px; text-align: center;';
                 displayListElement.appendChild(errorLi);
             }
        }
    }


    function createTimestampListItem(timestampText, originalIndex) {
        try {
            const textContent = String(timestampText); // Ensure it's a string
            const listItem = document.createElement("li");
            listItem.className = "ts-list-item";
            // Store the original index from the main `timestamps` array.
            // This is crucial for delete/adjust functions to target the correct item,
            // especially when the list is sorted.
            listItem.dataset.originalIndex = originalIndex;

            const itemContainer = document.createElement("div");
            itemContainer.className = "ts-item-container"; // Flex container for buttons and text

            // Check if the text starts with a valid time format to show time-related buttons
            const hasValidTime = TIME_REGEX.test(textContent);

            // --- Action Buttons ---
            const actionButtons = [];

            if (hasValidTime) {
                 // Jump Button (Icon)
                 const jumpIcon = document.createElement("span");
                 jumpIcon.textContent = "▶️"; // Play icon
                 jumpIcon.className = "ts-jump-icon";
                 jumpIcon.title = "クリックでジャンプ"; // "Click to jump"
                 jumpIcon.onclick = (e) => { e.stopPropagation(); jumpToTimestamp(textContent); };
                 actionButtons.push(jumpIcon);

                 // Adjust Buttons (-1s / +1s)
                 const minusButton = document.createElement("button");
                 minusButton.textContent = "-1s";
                 minusButton.className = "ts-adjust-button ts-minus-button ts-action-button";
                 minusButton.onclick = (e) => { e.stopPropagation(); adjustTimestamp(originalIndex, -1); }; // Use originalIndex
                 actionButtons.push(minusButton);

                 const plusButton = document.createElement("button");
                 plusButton.textContent = "+1s";
                 plusButton.className = "ts-adjust-button ts-plus-button ts-action-button";
                 plusButton.onclick = (e) => { e.stopPropagation(); adjustTimestamp(originalIndex, 1); }; // Use originalIndex
                 actionButtons.push(plusButton);
            }

            // Delete Button (Always shown)
            const deleteButton = document.createElement("button");
            deleteButton.textContent = "削除"; // "Delete"
            deleteButton.className = "ts-delete-button ts-action-button";
            deleteButton.onclick = (e) => { e.stopPropagation(); deleteTimestamp(originalIndex); }; // Use originalIndex
            actionButtons.push(deleteButton);

            // --- Text Display ---
            const displayContainer = document.createElement("div");
            displayContainer.className = "ts-display-container"; // Takes remaining space

            const displayText = document.createElement("div");
            displayText.className = "ts-display-text";
            displayText.textContent = textContent; // Display the full timestamp text
            displayText.title = `Ctrl+クリックでジャンプ / 右クリックメニュー`; // Tooltip hint

            // Click listener for Ctrl+Click jump
            displayText.onclick = (e) => {
                e.stopPropagation(); // Prevent triggering potential parent listeners
                if (e.ctrlKey || e.metaKey) { // Meta key for Mac users
                    jumpToTimestamp(textContent);
                }
                // Simple click could potentially select text or do nothing
            };

            // Context menu listener
            displayText.oncontextmenu = (e) => {
                e.preventDefault(); // Prevent default browser context menu
                e.stopPropagation();
                 showTimestampContextMenu(e, textContent, displayText); // Pass event, text, and element
            };

            // Assemble the item
            itemContainer.append(...actionButtons); // Add buttons first
            displayContainer.appendChild(displayText);
            itemContainer.appendChild(displayContainer); // Add text container after buttons
            listItem.appendChild(itemContainer);

            return listItem;

        } catch (e) {
             console.error(LOG_TAG, "Error creating timestamp list item:", e, timestampText);
             return null; // Return null if creation fails
        }
    }

     function showTimestampContextMenu(e, timestamp, element) {
         closeExistingContextMenu(); // Close any previous menu

         try {
             const menu = document.createElement('div');
             menu.id = 'timestamp-context-menu';
             menu.className = 'ts-context-menu';

             // Calculate position - try to keep menu within viewport
             const menuWidth = 160; // Estimated width
             const menuHeight = 80; // Estimated height based on items
             const posX = (e.clientX + menuWidth > window.innerWidth) ? window.innerWidth - menuWidth - 5 : e.clientX + 2;
             const posY = (e.clientY + menuHeight > window.innerHeight) ? e.clientY - menuHeight - 2 : e.clientY + 2;
             menu.style.left = `${posX}px`;
             menu.style.top = `${posY}px`;

             const itemStyle = 'ts-context-menu-item'; // CSS class for items

             // Get the most current text content directly from the element if possible
             const currentTimestamp = element?.textContent || timestamp; // Fallback to passed timestamp

             // Option 1: Jump (only if it looks like a time)
             if (TIME_REGEX.test(String(currentTimestamp))) {
                 const jumpOption = document.createElement('div');
                 jumpOption.textContent = 'タイムラインジャンプ'; // Timeline Jump
                 jumpOption.className = itemStyle;
                 jumpOption.onclick = () => {
                     jumpToTimestamp(currentTimestamp);
                     closeExistingContextMenu();
                 };
                 menu.appendChild(jumpOption);
             }

             // Option 2: Copy
             const copyOption = document.createElement('div');
             copyOption.textContent = 'コピー'; // Copy
             copyOption.className = itemStyle;
             copyOption.onclick = () => {
                 copySingleTimestamp(currentTimestamp);
                 closeExistingContextMenu();
             };
             menu.appendChild(copyOption);

             document.body.appendChild(menu);

             // Add a listener to close the menu when clicking outside or on another context menu trigger
             contextMenuCloseListener = (event) => {
                 const menuElement = document.getElementById('timestamp-context-menu');
                 // Close if the click is outside the menu itself
                 if (menuElement && !menuElement.contains(event.target)) {
                     closeExistingContextMenu();
                 }
             };
             // Add listener slightly deferred to avoid capturing the opening click itself
             setTimeout(() => {
                  // Capture phase ensures this runs before other click listeners
                  // Once ensures it auto-removes after firing
                  document.addEventListener('click', contextMenuCloseListener, { capture: true, once: true });
                  // Also close on subsequent context menu attempts elsewhere
                  document.addEventListener('contextmenu', contextMenuCloseListener, { capture: true, once: true });
             }, 0);

         } catch (err) {
             console.error(LOG_TAG, "Error showing context menu:", err);
         }
     }

    // --- Add Styles ---
    function addStyles() {
        const styleId = 'timestamp-styles-v11.20-ui'; // Increment version if styles change significantly
        if (document.getElementById(styleId)) {
             console.log(LOG_TAG, "Styles already added.");
            return; // Don't add styles multiple times
        }
        console.log(LOG_TAG, "Adding styles...");
        // Using template literal for readability
        const css = `
            :root {
                --ts-font-size-base: 15px;
                --ts-font-size-small: 13px;
                --ts-font-size-large: 17px;
                --ts-primary-blue: #3498db;
                --ts-primary-green: #2ecc71;
                --ts-primary-red: #e74c3c;
                --ts-primary-orange: #f39c12;
                --ts-primary-grey: #95a5a6;
                --ts-text-dark: #333;
                --ts-text-light: #f8f8f8;
                --ts-border-color: #a0a0a0;
                --ts-resizer-color: #ccc;
                --ts-primary-copy-blue: #5dade2; /* Lighter blue for copy */
                --ts-primary-copy-blue-dark: #2e86c1; /* Darker blue for copy hover/border */
                --ts-lock-red: #e74c3c; /* Red for unlocked state */
                --ts-lock-red-dark: #c0392b; /* Darker red */
            }

            /* Main Container */
            .ts-container {
                position: absolute; /* Changed from fixed to absolute */
                z-index: 9998;
                display: flex;
                flex-direction: column;
                background: rgba(245, 245, 245, 0.97);
                border: 1px solid var(--ts-border-color);
                border-radius: 6px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.25);
                user-select: none;
                resize: both; /* Allow resizing by default */
                overflow: hidden; /* Clip content, required for resize */
                min-width: 550px; /* Minimum size */
                min-height: 350px;
                font-size: var(--ts-font-size-base);
                color: var(--ts-text-dark);
                pointer-events: auto; /* Ensure container is interactive */
            }
            .ts-container.ts-locked {
                resize: none !important; /* Disable resizing when locked */
            }

            /* Top Bar */
            .ts-top-bar {
                display: flex;
                align-items: center;
                justify-content: space-between; /* Space out time display and record button */
                padding: 7px 12px;
                gap: 14px; /* Space between items */
                background: #e8e8e8;
                border-bottom: 1px solid #ccc;
                flex-shrink: 0; /* Prevent shrinking */
                cursor: move; /* Indicate draggable */
            }
            .ts-top-bar.ts-locked {
                cursor: default; /* No move cursor when locked */
            }
            .ts-time-display {
                padding: 6px 14px;
                background: rgba(40, 40, 40, 0.9);
                color: var(--ts-text-light);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 4px;
                font-size: var(--ts-font-size-small);
                font-weight: bold;
                text-align: center;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.6);
                margin: 0; /* Reset margin */
                flex-shrink: 0; /* Don't shrink */
            }
            .ts-record-button {
                padding: 8px 20px;
                background: linear-gradient(to bottom, #5dade2, var(--ts-primary-blue));
                color: white;
                border: 1px solid #258cd1; /* Slightly darker blue border */
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.25);
                cursor: pointer;
                font-size: var(--ts-font-size-base);
                font-weight: bold;
                border-radius: 5px;
                transition: all 0.15s ease;
                text-shadow: 1px 1px 1px rgba(0,0,0,0.3);
                margin: 0; /* Reset margin */
                flex-shrink: 0; /* Don't shrink */
            }
            .ts-record-button:hover {
                background: linear-gradient(to bottom, #6ebef0, #3ea0e0); /* Lighter gradient on hover */
                box-shadow: 0 3px 6px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.25);
            }
            .ts-record-button:active {
                background: linear-gradient(to top, #5dade2, var(--ts-primary-blue)); /* Invert gradient on active */
                transform: scale(0.97);
                box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.25);
            }

            /* Main Content Area (Panes) */
            #ts-main-content {
                display: flex;
                flex-grow: 1; /* Take remaining vertical space */
                width: 100%;
                overflow: hidden; /* Prevent content spill */
                background: #fdfdfd; /* Light background for the area */
            }

            /* Editor Pane (Left) */
            #ts-editor-pane {
                /* flex-basis: 45%; Use width in pixels now, fallback in JS */
                flex-shrink: 1; /* Allow shrinking */
                flex-grow: 1; /* Allow growing */
                display: flex;
                flex-direction: column;
                padding: 10px;
                min-width: ${MIN_PANE_WIDTH}px; /* Minimum width */
                overflow: hidden; /* Contains the textarea scroll */
                position: relative; /* For potential absolute elements inside */
                background-color: #fdfdfd;
                 /* Default width - overridden by JS */
                 width: 45%; /* Fallback if JS width calc fails */
            }
             #ts-editor-pane label {
                 font-size: var(--ts-font-size-small);
                 font-weight: bold;
                 color: #555;
                 margin-bottom: 6px;
                 display: block; /* Make it a block */
                 text-align: center;
                 flex-shrink: 0; /* Don't shrink label */
             }
             #ts-bulk-editor {
                 flex-grow: 1; /* Take remaining space in pane */
                 width: 100%; /* Fill pane width */
                 box-sizing: border-box; /* Include padding/border in width */
                 border: 1px solid #c0c0c0;
                 border-radius: 4px;
                 padding: 10px 12px;
                 font-size: var(--ts-font-size-base);
                 line-height: 1.7;
                 font-family: 'Segoe UI', Meiryo, Arial, sans-serif; /* Consistent fonts */
                 resize: none; /* Disable native textarea resize */
                 outline: none; /* Remove default focus outline */
                 transition: all 0.2s ease;
                 background-color: #fff;
                 min-height: 100px; /* Ensure a minimum editing area */
                 overflow-y: auto; /* Allow vertical scroll */
             }
             #ts-bulk-editor:focus {
                 border-color: var(--ts-primary-blue);
                 box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.3); /* Subtle focus glow */
             }
             #ts-bulk-editor:read-only {
                 background-color: #f5f5f5; /* Grey out when locked */
                 cursor: not-allowed;
                 border-color: #ddd;
             }


            /* Resizer Handle */
            #ts-pane-resizer {
                flex: 0 0 5px; /* Fixed width, don't grow or shrink */
                background-color: var(--ts-resizer-color);
                cursor: col-resize; /* Indicate horizontal resize */
                border-left: 1px solid #bbb;
                border-right: 1px solid #bbb;
                transition: background-color 0.2s ease;
                align-self: stretch; /* Stretch vertically */
                /* Ensure it's visible even if panes have background */
                position: relative;
                z-index: 1;
            }
            #ts-pane-resizer:hover {
                background-color: #aaa; /* Darker on hover */
            }
            #ts-pane-resizer.resizing {
                background-color: var(--ts-primary-blue); /* Highlight during drag */
            }

            /* Display Pane (Right) */
            #ts-display-pane {
                 /* flex-basis: 55%; Use width in pixels now, fallback in JS */
                 flex-shrink: 1;
                 flex-grow: 1;
                 display: flex;
                 flex-direction: column;
                 padding: 0; /* No padding on the pane itself */
                 margin-left: 5px; /* Space between resizer and content */
                 box-sizing: border-box;
                 min-width: ${MIN_PANE_WIDTH}px;
                 overflow: hidden; /* Contains the list scroll */
                 background-color: #ffffff; /* White background for the list area */
                  /* Default width - overridden by JS */
                 width: 55%; /* Fallback if JS width calc fails */
             }

            /* Display List Container (Inside Display Pane) */
             .ts-display-list-container {
                 display: flex;
                 flex-direction: column;
                 flex-grow: 1; /* Take space in display pane */
                 background: #ffffff;
                 border: none; /* No border needed here */
                 box-shadow: none; /* No shadow needed here */
                 overflow: hidden; /* Manage internal scrolling */
                 padding: 0 12px; /* Padding for content inside */
             }

             /* List Button Bar (Copy, Sort, Delete All) */
             .ts-list-button-bar {
                 display: flex;
                 padding: 7px 0; /* Padding top/bottom */
                 gap: 10px;
                 background: #f0f0f0; /* Light grey background */
                 border-bottom: 1px solid #ddd;
                 align-items: center;
                 flex-wrap: nowrap; /* Prevent wrapping */
                 flex-shrink: 0; /* Don't shrink */
             }
             .ts-list-button {
                 padding: 7px 14px;
                 font-size: var(--ts-font-size-small);
                 font-weight: bold;
                 border: 1px solid; /* Border color set below */
                 border-radius: 4px;
                 cursor: pointer;
                 transition: all 0.15s ease;
                 white-space: nowrap; /* Prevent text wrapping */
                 text-align: center;
                 box-shadow: 0 1px 2px rgba(0,0,0,0.1);
             }
             .ts-list-button:active {
                 transform: scale(0.96);
                 box-shadow: inset 0 1px 2px rgba(0,0,0,0.15);
             }
             .ts-copy-all-button {
                /* Allow buttons to share space somewhat equally */
                flex-grow: 1;
                flex-shrink: 1;
                flex-basis: 0; /* Start from 0 and grow */
                min-width: 80px; /* Ensure readability */
                 background: linear-gradient(to bottom, var(--ts-primary-copy-blue), var(--ts-primary-copy-blue-dark));
                 color: white;
                 border-color: var(--ts-primary-copy-blue-dark);
                 text-shadow: 1px 1px 1px rgba(0,0,0,0.2);
             }
             .ts-copy-all-button:hover {
                 background: linear-gradient(to bottom, #85c1e9, var(--ts-primary-copy-blue));
                 border-color: #21618c; /* Darker border on hover */
             }
             .ts-sort-button {
                flex-grow: 1;
                flex-shrink: 1;
                flex-basis: 0;
                min-width: 80px;
                 background: linear-gradient(to bottom, #f8c471, var(--ts-primary-orange));
                 color: white;
                 border-color: #e67e22; /* Darker orange */
                 text-shadow: 1px 1px 1px rgba(0,0,0,0.2);
             }
             .ts-sort-button:hover {
                 background: linear-gradient(to bottom, #f9d08a, #f5a623);
                 border-color: #d35400; /* Even darker orange */
             }
             .ts-delete-all-button {
                 background: linear-gradient(to bottom, #f1948a, var(--ts-primary-red));
                 color: white;
                 border: 1px solid #d9534f; /* Darker red */
                 text-shadow: 1px 1px 1px rgba(0,0,0,0.2);
                 /* Make it a small, round button */
                 border-radius: 50%;
                 padding: 0;
                 font-size: 18px; /* Adjust for '✕' symbol */
                 font-weight: bold;
                 line-height: 30px; /* Center symbol vertically */
                 width: 32px; /* Fixed width */
                 height: 32px; /* Fixed height */
                 box-sizing: border-box;
                 margin-left: auto; /* Push to the right */
                 flex-shrink: 0; /* Don't shrink */
             }
             .ts-delete-all-button:hover {
                 background: linear-gradient(to bottom, #f5a79d, #e95c4d);
                 border-color: #c9302c; /* Even darker red */
             }

             /* Timestamp Display List (UL) */
             #timestamp-display-list {
                 list-style-type: none;
                 padding: 10px 0; /* Vertical padding */
                 margin: 0;
                 flex-grow: 1; /* Take remaining space */
                 overflow-y: auto; /* Allow vertical scrolling */
                 overflow-x: hidden; /* Prevent horizontal scrolling */
                 background-color: #ffffff; /* Ensure white background */
                 box-sizing: border-box;
             }
              .ts-empty-guide {
                 text-align: center;
                 padding: 30px 15px;
                 color: #999;
                 font-size: var(--ts-font-size-base);
                 line-height: 1.5;
              }

             /* Individual List Item (LI) */
             .ts-list-item {
                 margin-bottom: 8px;
                 padding-bottom: 8px;
                 border-bottom: 1px dashed #eee; /* Separator */
                 display: flex; /* Use flex for alignment */
                 align-items: center; /* Vertically align items */
             }
             .ts-list-item:last-child {
                 border-bottom: none; /* Remove border for last item */
             }
             .ts-item-container {
                 display: flex;
                 align-items: center; /* Align buttons and text */
                 flex-wrap: nowrap; /* Prevent wrapping */
                 width: 100%;
                 gap: 8px; /* Space between button groups and text */
             }

            /* Action Buttons inside List Item */
             .ts-jump-icon {
                margin-right: 6px; /* Space after icon */
                cursor: pointer;
                font-size: var(--ts-font-size-large); /* Make icon slightly larger */
                line-height: 1; /* Prevent extra vertical space */
                padding: 4px; /* Clickable area */
                color: var(--ts-primary-blue);
                flex-shrink: 0; /* Don't shrink icon */
                transition: transform 0.1s ease, color 0.1s ease;
             }
             .ts-jump-icon:hover {
                 transform: scale(1.2);
                 color: #2980b9; /* Darker blue on hover */
             }
             .ts-action-button {
                 padding: 5px 10px; /* Smaller padding */
                 margin: 0; /* Reset margin */
                 border: 1px solid; /* Defined below */
                 font-weight: bold;
                 font-size: 12px; /* Smaller font */
                 border-radius: 4px;
                 cursor: pointer;
                 transition: all 0.15s;
                 flex-shrink: 0; /* Prevent shrinking */
                 line-height: 1; /* Adjust line height */
                 box-shadow: 0 1px 1px rgba(0,0,0,0.05);
             }
             .ts-action-button:active {
                 transform: scale(0.95);
                 box-shadow: inset 0 1px 1px rgba(0,0,0,0.1);
             }
             .ts-adjust-button { /* Specific colors for adjust buttons */
                 background-color: #eafaf1; /* Light green */
                 border-color: #abebc6; /* Pale green */
                 color: #239b56; /* Dark green text */
             }
             .ts-adjust-button:hover {
                 background-color: #d4efdf;
                 border-color: #82e0aa;
             }
             .ts-delete-button { /* Specific colors for delete button */
                 background-color: #fdedec; /* Light red */
                 border-color: #fadbd8; /* Pale red */
                 color: #cb4335; /* Dark red text */
             }
             .ts-delete-button:hover {
                 background-color: #fadbd8;
                 border-color: #f1948a;
             }

             /* Text Display Area in List Item */
             .ts-display-container {
                 flex-grow: 1; /* Take up remaining space */
                 min-width: 120px; /* Prevent text getting too squished */
                 margin-left: 5px; /* Small space after buttons */
                 cursor: default; /* Default cursor over text */
                 border: none;
                 background: none;
                 overflow: hidden; /* Clip long text if needed (handled by inner div) */
             }
             .ts-display-text {
                 cursor: default;
                 padding: 6px 2px; /* Vertical padding, minimal horizontal */
                 font-size: var(--ts-font-size-base);
                 white-space: normal; /* Allow wrapping */
                 overflow-wrap: break-word; /* Break long words */
                 word-break: break-all; /* Break anywhere if needed */
                 max-width: 100%; /* Ensure it doesn't overflow container */
                 line-height: 1.6;
                 color: var(--ts-text-dark);
             }


            /* Bottom Bar */
            .ts-bottom-bar {
                display: flex;
                align-items: center;
                justify-content: flex-end; /* Align buttons to the right */
                padding: 7px 12px;
                gap: 12px; /* Space between button groups */
                background: #e0e0e0;
                border-top: 1px solid #ccc;
                flex-shrink: 0; /* Prevent shrinking */
                cursor: move; /* Indicate draggable */
            }
             .ts-bottom-bar.ts-locked {
                 cursor: default; /* No move cursor when locked */
             }
            .ts-bottom-controls {
                display: flex;
                gap: 12px; /* Space between lock and hide buttons */
                cursor: default; /* Clicks handled by buttons inside */
            }
            .ts-bottom-button {
                 padding: 8px 18px;
                 font-size: var(--ts-font-size-base);
                 font-weight: bold;
                 border: none; /* Use background/shadow for definition */
                 cursor: pointer;
                 border-radius: 5px;
                 box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                 transition: all 0.15s ease;
                 text-align: center;
                 text-shadow: 1px 1px 1px rgba(0,0,0,0.15);
                 color: white; /* White text on colored buttons */
                 flex-shrink: 0; /* Prevent shrinking */
                 white-space: nowrap; /* Prevent text wrap */
            }
             .ts-bottom-button:active {
                 transform: scale(0.97);
                 box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.2);
             }

            /* Lock/Unlock Button Styles */
            .ts-lock-button {} /* Base class */
            .ts-lock-button.ts-unlocked { /* Style for "Lock" button (currently unlocked) */
                background: linear-gradient(to bottom, var(--ts-lock-red), var(--ts-lock-red-dark));
            }
            .ts-lock-button.ts-unlocked:hover {
                background: linear-gradient(to bottom, #f1948a, var(--ts-lock-red)); /* Lighter red on hover */
            }
            .ts-lock-button.ts-locked { /* Style for "Unlock" button (currently locked) */
                 background: linear-gradient(to bottom, #58d68d, var(--ts-primary-green)); /* Green */
            }
            .ts-lock-button.ts-locked:hover {
                 background: linear-gradient(to bottom, #6fe09f, #36d97b); /* Lighter green on hover */
            }

            /* Hide/Show Button Styles */
            .ts-hide-button {
                 /* Ensure it's always interactable, visibility controlled by applyHiddenState */
                 visibility: visible !important;
                 pointer-events: auto !important;
                 cursor: pointer;
            }
            .ts-hide-button.ts-visible-state { /* Style for "Hide" button (currently visible) */
                 background: linear-gradient(to bottom, #aeb6bf, var(--ts-primary-grey)); /* Grey */
            }
            .ts-hide-button.ts-visible-state:hover {
                 background: linear-gradient(to bottom, #cacfd6, #aab5c0); /* Lighter grey */
            }
            .ts-hide-button.ts-hidden-state { /* Style for "Show" button (currently hidden) */
                 /* Use a distinct color like red/orange to indicate it will reveal */
                 background: linear-gradient(to bottom, #ec7063, var(--ts-primary-red)); /* Red */
            }
             .ts-hide-button.ts-hidden-state:hover {
                 background: linear-gradient(to bottom, #f1948a, #e74c3c); /* Lighter red */
             }

            /* Context Menu */
            .ts-context-menu {
                position: fixed; /* Position relative to viewport */
                background-color: #ffffff;
                border: 1px solid #b0b0b0;
                border-radius: 4px;
                box-shadow: 0 3px 10px rgba(0,0,0,0.2);
                z-index: 10001; /* Above container, below modals */
                padding: 6px 0; /* Vertical padding for items */
                min-width: 160px;
                font-size: var(--ts-font-size-base);
            }
            .ts-context-menu-item {
                padding: 9px 20px;
                cursor: pointer;
                white-space: nowrap;
                color: #333;
                transition: background-color 0.1s ease;
            }
            .ts-context-menu-item:hover {
                background-color: #e8f0fe; /* Light blue highlight */
                color: var(--ts-primary-blue);
            }

            /* Confirmation Modal */
            .ts-modal-overlay {
                position: fixed;
                top: 0; left: 0;
                width: 100%; height: 100%;
                background-color: rgba(0,0,0,0.3); /* Semi-transparent backdrop */
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 10000; /* High z-index */
                pointer-events: auto; /* Allow interaction with overlay (to close?) */
            }
            .ts-modal-content {
                background-color: #fff;
                padding: 30px 35px;
                border: 1px solid #ccc;
                border-radius: 8px;
                box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
                width: auto;
                min-width: 350px; /* Minimum width */
                max-width: 500px; /* Maximum width */
                text-align: center;
                pointer-events: auto; /* Allow interaction with content */
                position: relative; /* Needed for absolute positioning if dragged */
                cursor: move; /* Indicate draggable */
            }
            .ts-modal-message {
                 font-size: var(--ts-font-size-large);
                 font-weight: 600;
                 color: var(--ts-primary-red); /* Red color for delete confirmation */
                 margin-bottom: 35px;
                 line-height: 1.6;
                 pointer-events: none; /* Prevent message from blocking drag */
            }
            .ts-modal-buttons {
                display: flex;
                justify-content: center; /* Center buttons */
                gap: 20px;
                cursor: default; /* Buttons handle their own cursor */
            }
            .ts-modal-button {
                padding: 11px 25px;
                font-size: var(--ts-font-size-base);
                font-weight: bold;
                border: 1px solid transparent;
                cursor: pointer;
                border-radius: 5px;
                min-width: 110px; /* Ensure decent button size */
                transition: all 0.15s ease;
                box-shadow: 0 1px 2px rgba(0,0,0,0.1);
            }
            .ts-modal-cancel {
                background-color: #f0f0f0;
                color: #555;
                border-color: #c0c0c0;
            }
            .ts-modal-cancel:hover {
                background-color: #e5e5e5;
                border-color: #b0b0b0;
            }
            .ts-modal-confirm {
                background-color: var(--ts-primary-red);
                color: white;
                border-color: #c0392b; /* Darker red border */
            }
            .ts-modal-confirm:hover {
                background-color: #c0392b; /* Darker red background */
                border-color: #a93226;
            }
            .ts-modal-button:active {
                 transform: scale(0.97);
                 box-shadow: inset 0 1px 2px rgba(0,0,0,0.15);
            }
            .ts-modal-button:focus {
                 outline: none; /* Remove default outline */
                 box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.4); /* Blue focus ring */
            }


            /* Message Box (Toast Notifications) */
            .ts-message-box {
                position: fixed;
                bottom: 35px; /* Position from bottom */
                left: 50%;
                transform: translateX(-50%); /* Center horizontally */
                padding: 14px 28px;
                color: white;
                font-size: var(--ts-font-size-base);
                font-weight: bold;
                border-radius: 5px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
                z-index: 10002; /* Above context menu, below modal */
                opacity: 0;
                transition: opacity 0.4s ease-in-out, transform 0.4s ease-in-out;
                text-align: center;
                max-width: 85%; /* Prevent overly wide messages */
                pointer-events: none; /* Don't block clicks */
                /* Start slightly lower */
                transform: translate(-50%, 20px);
            }
            .ts-message-box.visible {
                opacity: 1;
                transform: translateX(-50%); /* Move to final Y position */
            }
            .ts-message-box.fade-out {
                 opacity: 0;
                 transform: translate(-50%, 20px); /* Move back down on fade out */
            }
            .ts-message-box.success { background-color: var(--ts-primary-green); }
            .ts-message-box.error   { background-color: var(--ts-primary-red); }
            .ts-message-box.info    { background-color: var(--ts-primary-blue); }
            .ts-message-box.jump    { background-color: #733dd8; } /* Purple for jump */


            /* Tooltip Hint (First time user) */
            .ts-tooltip-hint {
                 position: fixed;
                 bottom: 25px;
                 right: 25px;
                 background-color: rgba(0,0,0,0.85);
                 color: white;
                 padding: 10px 15px;
                 border-radius: 4px;
                 font-size: var(--ts-font-size-small);
                 z-index: 9999; /* Below modals/menus but high */
                 opacity: 0;
                 transition: opacity 0.5s ease-in-out;
                 pointer-events: none;
            }
            .ts-tooltip-hint.visible {
                 opacity: 1;
            }
        `;
        try {
            const styleSheet = document.createElement("style");
            styleSheet.id = styleId;
            styleSheet.textContent = css;
            (document.head || document.documentElement).appendChild(styleSheet);
             console.log(LOG_TAG, "Styles added successfully.");
        } catch (e) {
            console.error(LOG_TAG, "Failed to add styles:", e);
        }
    }

    // --- Container Resize Handling ---
    function handleContainerResize(entries) {
        // Debounce the resize handling to avoid excessive calculations during rapid resizing
        // Also check if pane resizing is active, if so, let that handle widths.
        if(isResizingPanes) return;

        if (resizeTimeout) clearTimeout(resizeTimeout);

        resizeTimeout = setTimeout(() => {
            for (let entry of entries) {
                if (entry.target === container && editorPane && displayPane && resizerElement && mainContentElement) {
                     try {
                         // Recalculate available width based on the *new* container size
                         const parentWidth = mainContentElement.clientWidth; // Width of the flex container for panes
                         const resizerW = resizerElement.offsetWidth;
                         const availableWidth = parentWidth - resizerW;

                         // If container becomes too small, reset to default flex ratio
                         if (availableWidth <= (MIN_PANE_WIDTH * 2)) {
                             console.warn(LOG_TAG, "Container too small for resizing logic. Resetting to flex basis.");
                             editorPane.style.width = '';
                             displayPane.style.width = '';
                             editorPane.style.flexBasis = '45%';
                             displayPane.style.flexBasis = '55%';
                             continue; // Skip further calculation for this entry
                         }

                         // Try to maintain the *proportion* or use saved absolute width
                         let targetEditorWidth;
                         const savedEditorWidthPx = localStorage.getItem('timestampEditorWidth');

                         if (savedEditorWidthPx) {
                             const savedWidth = parseFloat(savedEditorWidthPx);
                             if (!isNaN(savedWidth) && savedWidth >= MIN_PANE_WIDTH) {
                                 targetEditorWidth = savedWidth;
                             } else {
                                 // If saved width is invalid, fall back to current proportion
                                 const currentEditorWidth = editorPane.offsetWidth;
                                 targetEditorWidth = currentEditorWidth;
                             }
                         } else {
                             // If no saved width, use current width to maintain proportion
                             targetEditorWidth = editorPane.offsetWidth;
                         }


                         // Clamp the target width to ensure both panes meet minimum width requirements
                         // within the new available space
                         let newEditorWidth = Math.max(MIN_PANE_WIDTH, Math.min(targetEditorWidth, availableWidth - MIN_PANE_WIDTH));
                         let newDisplayWidth = availableWidth - newEditorWidth;

                         // Final check: if display pane is too small after clamping editor, adjust editor down
                         if (newDisplayWidth < MIN_PANE_WIDTH) {
                             newDisplayWidth = MIN_PANE_WIDTH;
                             newEditorWidth = availableWidth - newDisplayWidth;
                         }
                         // Ensure editor is still at least MIN_PANE_WIDTH after adjustment
                         newEditorWidth = Math.max(MIN_PANE_WIDTH, newEditorWidth);

                         // Apply the calculated widths
                         editorPane.style.width = `${newEditorWidth}px`;
                         displayPane.style.width = `${newDisplayWidth}px`;
                         // Clear flex-basis to ensure pixel widths apply
                         editorPane.style.flexBasis = '';
                         displayPane.style.flexBasis = '';

                     } catch (error) {
                         console.error(LOG_TAG, "Error handling container resize:", error);
                     }
                }
            }
            // Save the new container size (width/height) after resizing stops
            saveContainerPosition();
        }, RESIZE_DEBOUNCE_MS); // Debounce time
    }


    // =============================================================
    // START: Corrected initializeUI Function
    // =============================================================
    function initializeUI() {
        const containerId = CONTAINER_ID;
        const oldContainer = document.getElementById(containerId);
        if (oldContainer) { try { oldContainer.remove(); } catch(e) { console.warn(LOG_TAG, "Error removing old container in initializeUI:", e); } }
        if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e) { console.warn(LOG_TAG, "Error disconnecting previous ResizeObserver:", e); } containerResizeObserver = null; }

        try {
            addStyles();
            // Create Elements
            container = document.createElement("div"); container.className = "ts-container"; container.id = containerId;
            topBarElement = document.createElement("div"); topBarElement.className = "ts-top-bar";
            currentTimeDisplay = document.createElement("div"); currentTimeDisplay.id = "ts-current-time"; currentTimeDisplay.className = "ts-time-display"; currentTimeDisplay.textContent = "読み込み中...";
            recordBtn = document.createElement("button"); recordBtn.id = "ts-record-button"; recordBtn.className = "ts-record-button"; recordBtn.textContent = "現在時刻を記録";
            mainContentElement = document.createElement("div"); mainContentElement.id = "ts-main-content";
            editorPane = document.createElement("div"); editorPane.id = "ts-editor-pane";
            const editorLabel = document.createElement("label"); editorLabel.setAttribute("for", "ts-bulk-editor"); editorLabel.textContent = "タイムスタンプ編集";
            bulkEditor = document.createElement("textarea"); bulkEditor.id = "ts-bulk-editor"; bulkEditor.placeholder = "例:\n0:15:30 開始\n1:25:00 曲名 [01]\n...";
            resizerElement = document.createElement("div"); resizerElement.id = "ts-pane-resizer"; // << Resizer Element
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
            hideButton = document.createElement("button"); hideButton.id = "ts-hide-button"; hideButton.className = "ts-bottom-button ts-hide-button";

            // Append Elements
            topBarElement.append(currentTimeDisplay, recordBtn);
            editorPane.append(editorLabel, bulkEditor);
            listButtonBar.append(copyAllButton, sortButton, deleteAllButton);
            displayListContainer.append(listButtonBar, displayListElement);
            displayPane.append(displayListContainer);
            mainContentElement.append(editorPane, resizerElement, displayPane); // << Resizer in the middle
            bottomControls.append(lockButton, hideButton);
            bottomBarElement.append(bottomControls);
            container.append(topBarElement, mainContentElement, bottomBarElement);
            document.body.appendChild(container);

            // Set Initial Position/Size & Styles
            const savedPosition = loadContainerPosition();
            container.style.left = savedPosition.left;
            container.style.top = savedPosition.top;
            container.style.width = savedPosition.width;
            container.style.height = savedPosition.height;
            requestAnimationFrame(() => { // Store original styles after initial render
                if (!container) return;
                try {
                    container.dataset.originalBg = window.getComputedStyle(container).backgroundColor;
                    container.dataset.originalBorder = window.getComputedStyle(container).border;
                    container.dataset.originalBoxShadow = window.getComputedStyle(container).boxShadow;
                    container.dataset.originalPointerEvents = window.getComputedStyle(container).pointerEvents;
                    container.dataset.originalOverflow = window.getComputedStyle(container).overflow;
                    container.dataset.originalResize = window.getComputedStyle(container).resize || "both";
                    container.dataset.originalMinWidth = container.style.minWidth || window.getComputedStyle(container).minWidth;
                    container.dataset.originalMinHeight = container.style.minHeight || window.getComputedStyle(container).minHeight;
                    // Apply saved widths AFTER storing originals and ensuring layout
                    applySavedPaneWidths();
                } catch (t) { console.error(LOG_TAG, "Error storing original styles:", t); }
            });

            // Add Event Listeners (General)
            if(typeof updateSortButtonText === 'function') updateSortButtonText(); // Initialize sort button text
            recordBtn.onclick = recordTimestamp;
            copyAllButton.onclick = copyAllTimestamps;
            sortButton.onclick = toggleSortOrder;
            deleteAllButton.onclick = (e) => { e.stopPropagation(); e.preventDefault(); showConfirmDeleteAllModal(); };
            lockButton.onclick = toggleLock;
            hideButton.onclick = toggleVisibility;
            bulkEditor.addEventListener("input", handleEditorChange);
            bulkEditor.addEventListener("keydown", function(e) { if (e.key === "Enter") { /* Potential future use - e.g., prevent default submit if in form */ } });

            // Add Event Listeners (Container Dragging)
            const addDragListener = (dragHandle) => {
                if (!dragHandle) return;
                let startX, startY, initialLeft, initialTop;
                const handleDragMove = (moveEvent) => {
                    if (!isDraggingContainer || isResizingPanes || !container) return; // Check flags
                    if (rafDragId) cancelAnimationFrame(rafDragId); // Cancel previous frame
                    rafDragId = requestAnimationFrame(() => { // Use RAF for performance
                        if (!isDraggingContainer || isResizingPanes || !container) return; // Double check flags
                        const currentX = moveEvent.clientX;
                        const currentY = moveEvent.clientY;
                        container.style.left = `${initialLeft + (currentX - startX)}px`;
                        container.style.top = `${initialTop + (currentY - startY)}px`;
                        rafDragId = null; // Clear RAF ID
                    });
                };
                const handleDragEnd = () => {
                    if (rafDragId) cancelAnimationFrame(rafDragId); // Cancel pending frame
                    rafDragId = null;
                    if (isDraggingContainer) {
                        isDraggingContainer = false; // Reset flag
                        // Restore styles
                        document.body.style.cursor = "";
                        document.body.style.userSelect = "";
                        // Save position
                        saveContainerPosition();
                        // Remove global listeners
                        document.removeEventListener('mousemove', handleDragMove);
                        document.removeEventListener('mouseup', handleDragEnd);
                    }
                };
                dragHandle.addEventListener('mousedown', (e) => {
                    // Prevent dragging if click starts on interactive elements within the handle
                    if (e.target !== dragHandle) {
                        let currentTarget = e.target;
                        while (currentTarget && currentTarget !== dragHandle) {
                           if (currentTarget.tagName === 'BUTTON' || currentTarget.classList.contains('ts-bottom-controls') || currentTarget.classList.contains('ts-time-display')) {
                                return; // Don't initiate drag
                           }
                           currentTarget = currentTarget.parentElement;
                        }
                    }
                    // Check conditions: not locked, left mouse button, not resizing panes, not dragging hide button, container exists
                    if (isLocked || e.button !== 0 || isResizingPanes || isDraggingFromHideButton || !container) return;

                    isDraggingContainer = true; // Set flag
                    const rect = container.getBoundingClientRect();
                    // Record starting positions
                    startX = e.clientX;
                    startY = e.clientY;
                    initialLeft = rect.left;
                    initialTop = rect.top;
                    // Apply dragging styles
                    document.body.style.cursor = "move";
                    document.body.style.userSelect = "none"; // Prevent text selection
                    // Add global listeners for move and up events
                    document.addEventListener('mousemove', handleDragMove);
                    document.addEventListener('mouseup', handleDragEnd, { once: true }); // Remove automatically on mouse up
                    e.preventDefault(); // Prevent default actions like text selection
                });
            };
            addDragListener(topBarElement);
            addDragListener(bottomBarElement);

            // =============================================================
            // START: Resizer Event Listener Modification (Corrected Version)
            // =============================================================
            if (resizerElement && editorPane && displayPane && mainContentElement) {

                // Define handlers *outside* mousedown so they can be removed correctly
                const handleMouseMove = (moveEvent) => {
                    if (!isResizingPanes) return; // Only run if resizing is active

                    try {
                        const parentRect = mainContentElement.getBoundingClientRect();
                        const resizerW = resizerElement.offsetWidth;
                        const totalWidth = parentRect.width;
                        const availableW = totalWidth - resizerW;

                        // Prevent calculation if panes are too small
                        if (availableW <= MIN_PANE_WIDTH * 2) return;

                        // Calculate potential new width based on mouse X relative to the pane container
                        let newEditorWidth = moveEvent.clientX - parentRect.left;

                        // Clamp the editor width: ensure it's at least MIN_PANE_WIDTH
                        // and leaves enough space for the display pane's MIN_PANE_WIDTH
                        newEditorWidth = Math.max(MIN_PANE_WIDTH, newEditorWidth);
                        newEditorWidth = Math.min(newEditorWidth, availableW - MIN_PANE_WIDTH);

                        // Calculate the corresponding display pane width
                        let newDisplayWidth = availableW - newEditorWidth;

                        // Apply widths directly in pixels for precise control
                        editorPane.style.width = `${newEditorWidth}px`;
                        displayPane.style.width = `${newDisplayWidth}px`;

                        // IMPORTANT: Clear flex-basis. If flex-basis is set (e.g., '45%'),
                        // it can override the pixel width calculation in some scenarios.
                        editorPane.style.flexBasis = '';
                        displayPane.style.flexBasis = '';

                    } catch (error) {
                        console.error(LOG_TAG, "Error during pane resize move:", error);
                    }
                };

                const handleMouseUp = () => {
                    if (!isResizingPanes) return; // Only run if resizing was active

                    isResizingPanes = false; // Reset the resizing flag

                    // Remove the global listeners
                    document.removeEventListener('mousemove', handleMouseMove);
                    document.removeEventListener('mouseup', handleMouseUp); // Remove this listener itself

                    // Restore default body styles
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    // Remove resizing class from the resizer element
                    if (resizerElement) {
                        resizerElement.classList.remove('resizing');
                    }

                    // Save the final container position AND the new editor width
                    saveContainerPosition();

                    // console.log(LOG_TAG, "Pane resizing finished.");
                };

                // MouseDown on the resizer element starts the process
                const handleMouseDown = (downEvent) => {
                    // Only activate on left click (button 0) and when not locked
                    if (isLocked || downEvent.button !== 0) return;

                    isResizingPanes = true; // Set the flag to indicate resizing has started

                    // Apply visual feedback styles
                    document.body.style.cursor = 'col-resize'; // Change cursor globally
                    document.body.style.userSelect = 'none'; // Prevent text selection during drag
                    if (resizerElement) {
                        resizerElement.classList.add('resizing'); // Add class for CSS styling (e.g., highlight)
                    }

                    // Attach the move and up listeners to the DOCUMENT.
                    // This ensures resizing continues even if the mouse cursor
                    // moves outside the bounds of the resizer or the container.
                    document.addEventListener('mousemove', handleMouseMove);
                    document.addEventListener('mouseup', handleMouseUp); // Add the specific mouseup handler

                    downEvent.preventDefault(); // Prevent default browser actions (e.g., drag selection)
                    // console.log(LOG_TAG, "Pane resizing started.");
                };

                // Attach the mousedown listener to the resizer element
                resizerElement.addEventListener('mousedown', handleMouseDown);

            } else {
                console.warn(LOG_TAG, "Resizer, editorPane, displayPane, or mainContentElement not found. Resizing disabled.");
            }
            // =============================================================
            // END: Resizer Event Listener Modification
            // =============================================================


            // Add Event Listeners (Hide Button Dragging - Keep Original Logic)
             if(hideButton){
                hideButton.addEventListener("mousedown", t => {
                    if (t.button !== 0) return; // Only left click
                    t.stopPropagation(); // Prevent triggering container drag
                    dragStartTime = Date.now();
                    isDraggingFromHideButton = false; // Assume click first
                    hideButtonDragged = false; // Has the button actually been dragged?

                    const startX = t.clientX;
                    const startY = t.clientY;
                    const buttonRect = hideButton.getBoundingClientRect();
                    const initialButtonLeft = buttonRect.left;
                    const initialButtonTop = buttonRect.top;
                    const containerRect = container.getBoundingClientRect();
                    const initialContainerLeft = containerRect.left;
                    const initialContainerTop = containerRect.top;

                    const handleHideMove = moveEvent => {
                        const deltaX = Math.abs(moveEvent.clientX - startX);
                        const deltaY = Math.abs(moveEvent.clientY - startY);

                        // If not already dragging, check thresholds to determine if it's a drag
                        if (!isDraggingFromHideButton && (deltaX > DRAG_MOVE_THRESHOLD || deltaY > DRAG_MOVE_THRESHOLD || (Date.now() - dragStartTime > DRAG_THRESHOLD))) {
                            isDraggingFromHideButton = true;
                            hideButtonDragged = true; // Mark that a drag occurred
                            document.body.style.cursor = "move";
                            document.body.style.userSelect = "none";
                            // If hidden, ensure button is fixed for dragging
                            if (isHidden) {
                                hideButton.style.position = "fixed";
                                hideButton.style.left = `${initialButtonLeft}px`;
                                hideButton.style.top = `${initialButtonTop}px`;
                            }
                        }

                        // If dragging, update positions using RAF
                        if (isDraggingFromHideButton && container) {
                            if (rafDragId) cancelAnimationFrame(rafDragId);
                            rafDragId = requestAnimationFrame(() => {
                                let newLeft, newTop;
                                if (isHidden) {
                                    // Drag the fixed button, and move the invisible container relatively
                                    newLeft = initialButtonLeft + (moveEvent.clientX - startX);
                                    newTop = initialButtonTop + (moveEvent.clientY - startY);
                                    hideButton.style.left = `${newLeft}px`;
                                    hideButton.style.top = `${newTop}px`;
                                    // Also move the hidden container's logical position
                                    container.style.left = `${initialContainerLeft + (moveEvent.clientX - startX)}px`;
                                    container.style.top = `${initialContainerTop + (moveEvent.clientY - startY)}px`;

                                } else {
                                    // Drag the container (button moves with it)
                                    newLeft = initialContainerLeft + (moveEvent.clientX - startX);
                                    newTop = initialContainerTop + (moveEvent.clientY - startY);
                                    container.style.left = `${newLeft}px`;
                                    container.style.top = `${newTop}px`;
                                }
                                rafDragId = null;
                            });
                        }
                    };

                    const handleHideUp = upEvent => {
                        if (rafDragId) cancelAnimationFrame(rafDragId);
                        rafDragId = null;
                        document.removeEventListener('mousemove', handleHideMove);
                        document.removeEventListener('mouseup', handleHideUp, { capture: true }); // Remove listener

                        if (isDraggingFromHideButton) {
                             document.body.style.cursor = "";
                             document.body.style.userSelect = "";
                        }

                        const wasDragging = isDraggingFromHideButton; // Store flag before resetting
                        isDraggingFromHideButton = false; // Reset flag

                        if (wasDragging) {
                             // If it was hidden and dragged, save the button's final viewport position
                             if (isHidden && hideButton) {
                                 const finalRect = hideButton.getBoundingClientRect();
                                 hideButtonLastViewportPos = { left: finalRect.left, top: finalRect.top };
                             }
                             // Save container position regardless of hidden state if dragged
                             saveContainerPosition();
                             // Prevent the click action (toggleVisibility) if it was a drag
                             upEvent.preventDefault();
                             upEvent.stopPropagation();
                        }
                        // If it wasn't a drag (i.e., a click), hideButtonDragged remains false,
                        // and toggleVisibility will execute normally via its own click listener.
                    };

                    document.addEventListener('mousemove', handleHideMove);
                    document.addEventListener('mouseup', handleHideUp, { once: true, capture: true }); // Use capture on mouseup
                });
             }


            // Add Resize Observer (Keep Original Setup)
            if ('ResizeObserver' in window && container) {
                try {
                     containerResizeObserver = new ResizeObserver(handleContainerResize);
                     containerResizeObserver.observe(container);
                      console.log(LOG_TAG, "Container ResizeObserver started.");
                } catch (e) {
                     console.error(LOG_TAG, "Failed to create/observe ResizeObserver:", e);
                     containerResizeObserver = null;
                }
            } else {
                 console.warn(LOG_TAG, "ResizeObserver not supported or container missing.");
            }

            // Load State and Apply initial states (Keep Original)
            loadState(); // Loads timestamps, lock, hidden states, applies pane widths
            applyLockState(); // Applies lock styles based on loaded state
            applyHiddenState(); // Applies hidden styles based on loaded state
            startCurrentTimeUpdate(); // Start updating time display
            showTooltipHint(); // Show hint for first-time users

        } catch (uiError) {
            console.error(LOG_TAG, "UI 初期化失敗:", uiError);
            showErrorMessage("スクリプトUIの読み込みに失敗しました！");
            // Cleanup partial UI if initialization failed
            if (container?.parentNode) { try { container.remove(); } catch(e) {} }
            container = null; // Ensure container is nullified
            if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e) {} containerResizeObserver = null; }
        }
    }
    // =============================================================
    // END: Corrected initializeUI Function
    // =============================================================


    // --- Initialization Retry Logic (Strategy 5: Simplified Check) ---
    // Moved initRetryCount declaration to the top with other globals
    function runInitialization() {
        console.log(LOG_TAG, `[${initRetryCount}] runInitialization 嘗試開始 (策略五)...`);

        // 1. Check if UI already exists (e.g., due to HMR or race condition)
        if (document.getElementById(CONTAINER_ID)) {
            console.log(LOG_TAG, "容器已存在，跳過初始化。");
            if (initTimeoutId) clearTimeout(initTimeoutId); // Clear any pending retry timeout
            initTimeoutId = null;
            initRetryCount = 0; // Reset counter
            return; // Stop initialization
        }

        // 2. Check retry limit
        if (initRetryCount >= MAX_INIT_RETRIES) {
            console.error(LOG_TAG, `初期化がタイムアウトしました (${MAX_INIT_RETRIES} 回試行)。`);
            if (initTimeoutId) clearTimeout(initTimeoutId); // Clear timeout
            initTimeoutId = null;
            showErrorMessage("スクリプトの初期化がタイムアウトしました！ページを再読み込みしてみてください。");
            initRetryCount = 0; // Reset counter
            return; // Stop initialization
        }

        // 3. Check for essential page elements (Simplified Check)
        const video = document.querySelector('video');
        const playerElement = document.getElementById('movie_player'); // Common YouTube player container ID
        // Check if video exists AND has started loading metadata (readyState >= 1)
        const videoReady = video && typeof video.currentTime === 'number' && video.readyState >= 1;

        console.log(LOG_TAG, `[${initRetryCount}] 檢查元素 (策略五): video found=${!!video}, videoReady=${videoReady}, playerElement found=${!!playerElement}`);

        // 4. Proceed if elements are ready
        if (videoReady && playerElement) { // Require video to be at least partially loaded and player element present
            console.log(LOG_TAG, `[${initRetryCount}] 基本元素已就緒，開始 initializeUI (策略五)`);
            if (initTimeoutId) clearTimeout(initTimeoutId); // Clear pending timeout
            initTimeoutId = null;
            initRetryCount = 0; // Reset counter

            try {
                // Ensure initializeUI is available before calling
                if (typeof initializeUI === 'function') {
                    initializeUI(); // Create the UI
                    // Post-initialization check
                    if (!document.getElementById(CONTAINER_ID)) {
                         console.error(LOG_TAG, "初期化後、コンテナがDOMに正常に追加されませんでした！");
                         showErrorMessage("UIの追加に失敗しました。");
                    } else {
                         console.log(LOG_TAG, "initializeUI 呼叫完成，容器已添加。");
                         // It's generally safer to call these *after* initializeUI confirms success
                         // Note: initializeUI itself already calls these at its end. Redundant calls are usually harmless.
                         // if(typeof startCurrentTimeUpdate === 'function') startCurrentTimeUpdate();
                         // if(typeof loadState === 'function') loadState();
                         // if(typeof applyLockState === 'function') applyLockState();
                         // if(typeof applyHiddenState === 'function') applyHiddenState();
                         // if(typeof showTooltipHint === 'function') showTooltipHint();
                    }
                } else {
                    console.error(LOG_TAG, "initializeUI is not defined!");
                    showErrorMessage("UI初期化関数が見つかりません！");
                }
            } catch (e) {
                console.error(LOG_TAG, "初期化中にエラーが発生しました:", e);
                showErrorMessage("スクリプトの初期化に失敗しました！");
            }
            return; // Stop retrying
        }

        // 5. Schedule Retry
        initRetryCount++;
        const retryDelay = INIT_RETRY_BASE_DELAY + initRetryCount * INIT_RETRY_INCREMENT; // Incremental backoff
        console.log(LOG_TAG, `[${initRetryCount-1}] 基本元素未就緒，${retryDelay}ms 後重試 (setTimeout)...`);
        if (initTimeoutId) clearTimeout(initTimeoutId); // Clear previous timeout before setting a new one
        initTimeoutId = setTimeout(runInitialization, retryDelay);
    }

    // --- MutationObserver for SPA Navigation ---
    let lastUrl = location.href;
    const observerCallback = (mutationsList, observerInstance) => {
        // Use requestAnimationFrame to avoid layout thrashing and ensure checks run after DOM updates settle
        requestAnimationFrame(() => {
            const currentUrl = location.href;
            // Check if URL changed and it's a YouTube URL (basic check)
            if (currentUrl !== lastUrl && currentUrl.includes('youtube.com')) {
                console.log(LOG_TAG, `URL changed from ${lastUrl} to ${currentUrl}, re-evaluating initialization...`);
                lastUrl = currentUrl; // Update the last known URL

                // Clean up any existing UI from the previous page
                cleanupExtensionUI();

                // Check if the new page is a watch page and the extension is enabled
                if (isExtensionEnabled && currentUrl.includes('/watch?v=')) {
                     console.log(LOG_TAG, "New URL is a watch page and extension is enabled, scheduling initialization.");
                     // Delay initialization slightly to allow the new page's elements to load
                     setTimeout(runInitialization, 1500); // Delay might need adjustment
                } else {
                     console.log(LOG_TAG, `New URL is not a watch page or extension is disabled (${isExtensionEnabled}), skipping initialization.`);
                     // Ensure any pending init timeouts are cleared if navigating away from a watch page
                     if (initTimeoutId) clearTimeout(initTimeoutId);
                     initTimeoutId = null;
                     initRetryCount = 0;
                }
            }
            // Optimization: Check if the container *should* exist but doesn't, potentially trigger re-init?
            // This can be complex due to timing. The URL change check is usually sufficient.
            // else if (isExtensionEnabled && location.href.includes('/watch?v=') && !document.getElementById(CONTAINER_ID) && !initTimeoutId) {
            //     console.log(LOG_TAG, "Watch page, extension enabled, but UI missing. Triggering check.");
            //     runInitialization(); // Or schedule it with a short delay
            // }
        });
    };

    // --- Start Page MutationObserver ---
    try {
        // Target a high-level container likely to change during SPA navigation
        const observeTargetNode = document.querySelector('ytd-page-manager') || document.body; // Fallback to body
        if (observeTargetNode) {
            pageObserver = new MutationObserver(observerCallback);
            // Observe changes to the child list and subtree, which usually occur during navigation
            pageObserver.observe(observeTargetNode, { childList: true, subtree: true });
             console.log(LOG_TAG, "Page MutationObserver started on:", observeTargetNode.id || observeTargetNode.tagName);
         } else {
             console.error(LOG_TAG, "Page MutationObserver のターゲットが見つかりません！ SPA navigation might not trigger re-initialization.");
             // Consider adding a fallback mechanism if observer fails? (e.g., periodic checks - less efficient)
         }
    } catch (e) {
        console.error(LOG_TAG, "Failed to start Page MutationObserver:", e);
        showErrorMessage("ページ変更監視の開始に失敗しました。");
    }

    // --- Tooltip Hint Function ---
    function showTooltipHint() {
         // Only show if it's the first time and the hint doesn't already exist
        if (firstTimeUser && !document.getElementById("ts-tooltip-hint")) {
            try {
                const hint = document.createElement("div");
                hint.id = "ts-tooltip-hint";
                hint.className = "ts-tooltip-hint";
                hint.textContent = "ヒント: 左パネルで編集、右パネルでCtrl+クリックジャンプ / 右クリックメニュー";
                document.body.appendChild(hint);

                // Fade in
                setTimeout(() => { hint.classList.add("visible"); }, 100); // Short delay before fade-in

                // Automatically fade out and remove after a duration
                setTimeout(() => {
                    if (!hint.parentNode) return; // Check if already removed
                    hint.classList.remove("visible");
                    // Remove from DOM after fade-out transition completes
                    hint.addEventListener("transitionend", () => {
                        try { hint.remove(); } catch(e) {}
                    }, { once: true });
                     // Fallback removal if transitionend doesn't fire
                    setTimeout(() => { hint.parentNode && (() => { try { hint.remove(); } catch(e) {} })(); }, 600); // 500ms transition + buffer
                }, 8000); // Show hint for 8 seconds
            } catch(t) {
                console.error(LOG_TAG, "Failed to show tooltip hint:", t);
            }
        }
    }

    // --- Initial Script Start Logic ---
    function initialStart() {
       console.log(LOG_TAG, "initialStart 関数 実行開始");
       // Get the initial enabled state from storage
       chrome.storage.sync.get([STORAGE_KEY_ENABLED], (result) => {
            // Default to true if the key doesn't exist in storage yet
            isExtensionEnabled = (result[STORAGE_KEY_ENABLED] !== false);
            console.log(LOG_TAG, `Initial enabled state from storage: ${isExtensionEnabled}`);

            if (isExtensionEnabled) {
                // Check if the body element is available (it should be at or after DOMContentLoaded)
                if (document.body) {
                    console.log(LOG_TAG, "document.body 発見、runInitialization を呼び出します");
                    // Start the initialization process (which includes checks and retries)
                    // Only run if on a watch page initially
                    if (location.href.includes('/watch?v=')) {
                         if (typeof runInitialization === 'function') {
                            runInitialization();
                         } else {
                            console.error(LOG_TAG, "initialStart: runInitialization is not defined!");
                            showErrorMessage("初期化関数が見つかりません！(initialStart)");
                         }
                    } else {
                         console.log(LOG_TAG, "Not on a watch page, initial runInitialization skipped.");
                    }
                } else {
                    // This case should be rare if called after DOMContentLoaded, but as a fallback:
                    console.warn(LOG_TAG, "document.body が見つかりません、100ms 後に再試行します (initialStart)");
                    setTimeout(initialStart, 100);
                }
            } else {
                console.log(LOG_TAG, "拡張機能が無効です。初期化をスキップします。");
                // Ensure cleanup hasn't left anything behind if it was previously enabled then disabled before reload
                cleanupExtensionUI();
            }
       });
    }

    // --- Listener for storage changes (ON/OFF toggle from popup) ---
    chrome.storage.onChanged.addListener((changes, namespace) => {
        // Check if the change is in sync storage and affects our specific key
        if (namespace === 'sync' && changes[STORAGE_KEY_ENABLED]) {
            const newState = changes[STORAGE_KEY_ENABLED].newValue;
            const oldState = changes[STORAGE_KEY_ENABLED].oldValue;
            const wasEnabled = (oldState !== false);
            const nowEnabled = (newState !== false);

            // Prevent unnecessary actions if state hasn't effectively changed
            if (wasEnabled === nowEnabled) return;

            console.log(LOG_TAG, `Extension enabled state changed from ${wasEnabled} to ${nowEnabled}`);
            isExtensionEnabled = nowEnabled; // Update the global flag

            if (isExtensionEnabled) {
                // Extension was turned ON
                console.log(LOG_TAG, "拡張機能が有効になりました。UI を初期化しようとしています...");
                 // Only initialize if we are currently on a watch page and the UI doesn't already exist
                 if (location.href.includes('/watch?v=') && !document.getElementById(CONTAINER_ID)) {
                    runInitialization(); // Start the initialization process
                 } else if (document.getElementById(CONTAINER_ID)) {
                     console.log(LOG_TAG, "UI は既に存在します。再初期化をスキップします。");
                     // Optional: Re-apply state if needed, though usually not necessary if UI persists
                     // applyLockState(); applyHiddenState();
                 } else {
                     console.log(LOG_TAG, "Watch ページにいないため、UI の初期化をスキップします。");
                 }
            } else {
                // Extension was turned OFF
                console.log(LOG_TAG, "拡張機能が無効になりました。UI をクリーンアップします...");
                cleanupExtensionUI(); // Remove the UI and clear resources
                 // Ensure any pending init timeouts are cleared
                 if (initTimeoutId) clearTimeout(initTimeoutId);
                 initTimeoutId = null;
                 initRetryCount = 0;
            }
        }
    });

    // --- Determine when to call initialStart ---
    // Check the document's readyState
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        // DOM is already ready or fully loaded
        console.log(LOG_TAG, "DOM is ready or complete, calling initialStart directly.");
        initialStart();
    } else {
        // DOM is not ready yet, wait for the DOMContentLoaded event
        console.log(LOG_TAG, "DOM not ready, adding DOMContentLoaded listener for initialStart.");
        document.addEventListener('DOMContentLoaded', () => {
            console.log(LOG_TAG, "DOMContentLoaded event fired, calling initialStart.");
            initialStart();
        }, { once: true }); // Use 'once' to automatically remove the listener after it fires
    }

    // --- Cleanup on Unload ---
    // Use 'beforeunload' for synchronous cleanup if possible,
    // but be aware limitations exist (can't do async operations reliably).
    window.addEventListener('beforeunload', () => {
        console.log(LOG_TAG, "beforeunload event triggered, cleaning up...");
        // Primarily focus on removing UI elements and maybe saving state synchronously if needed.
        // Intervals and observers are less critical here as the page context is ending.
        cleanupExtensionUI(); // Attempt to remove UI
        // Disconnect observer if it's still active
        if (pageObserver) { try { pageObserver.disconnect(); pageObserver = null; } catch(e) {} }
        console.log(LOG_TAG, "Unload cleanup attempt complete.");
        // Note: Saving to localStorage in 'beforeunload' is generally reliable.
        // Avoid complex logic or async operations here.
    });

})(); // <-- End of IIFE
