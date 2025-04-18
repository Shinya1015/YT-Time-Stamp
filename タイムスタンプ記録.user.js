// ==UserScript==
// @name         タイムスタンプ記録
// @namespace    https://www.youtube.com/
// @version      11.20
// @description  タイムスタンプ記録
// @match        *://www.youtube.com/watch?v*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

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
    let observer = null;
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
    let contextMenuCloseListener = null; // Added missing variable from original
    let messageTimeoutId = null; // Added missing variable from original

    const DRAG_THRESHOLD = 150;
    const DRAG_MOVE_THRESHOLD = 5;
    const EDITOR_DEBOUNCE_MS = 400;
    const RESIZE_DEBOUNCE_MS = 100;
    const TIME_REGEX = /^(\d+):(\d{2}):(\d{2})/;
    const MIN_PANE_WIDTH = 100;

    // --- showMessage functions (essential for user feedback) ---
    function showMessage(message, type = 'info', duration = 3000) {
        const existingBox = document.getElementById('ts-message-box-instance');
        if (existingBox) existingBox.remove();
        if (messageTimeoutId) clearTimeout(messageTimeoutId);

        const messageBox = document.createElement("div");
        messageBox.id = 'ts-message-box-instance';
        messageBox.textContent = message;
        messageBox.className = `ts-message-box ${type}`;
        // Check if document.body exists before appending
        if (document.body) {
             document.body.appendChild(messageBox);
             requestAnimationFrame(() => {
                 requestAnimationFrame(() => {
                     messageBox.classList.add('visible');
                 });
             });
        } else {
            // Failsafe if body isn't ready (should ideally not happen at document-idle)
            return;
        }


        messageTimeoutId = setTimeout(() => {
            if (!messageBox.parentNode) return;
            messageBox.classList.remove('visible');
            messageBox.classList.add('fade-out');

            messageBox.addEventListener('transitionend', () => {
                if (messageBox.parentNode) messageBox.remove();
                messageTimeoutId = null;
            }, { once: true });

            // Backup removal timer
            setTimeout(() => {
                if (messageBox.parentNode) messageBox.remove();
                if (messageTimeoutId) messageTimeoutId = null;
            }, duration + 500); // Slightly longer than transition

        }, duration);
    }
    function showSuccessMessage(message) { showMessage(message, 'success', 2500); }
    function showErrorMessage(message) { showMessage(message, 'error', 5000); }
    function showInfoMessage(message) { showMessage(message, 'info', 3000); }
    function showJumpSuccessMessage(timestamp) { showMessage(`ジャンプ成功: ${timestamp}`, 'jump', 2000); }
    function showCopySuccessMessage(text) { showMessage(`${text}`, 'success', 2000); }
    // --- End showMessage functions ---

    function loadState() {
        const storedTimestamps = localStorage.getItem('timestamps');
        // Use showErrorMessage for user feedback on load failure
        if (storedTimestamps) { try { timestamps = JSON.parse(storedTimestamps); } catch (e) { timestamps = []; showErrorMessage("タイムスタンプの読み込みに失敗"); } } else { timestamps = []; }
        isLocked = localStorage.getItem('timestampLockState') === 'true';
        isHidden = localStorage.getItem('timestampHiddenState') === 'true';
        firstTimeUser = localStorage.getItem('timestampFirstTime') === null;
        sortState = null;
        applySavedPaneWidths();
        if (bulkEditor && displayListElement) {
             populateEditorFromTimestamps();
             renderTimestampList();
        }
    }

    function applySavedPaneWidths() {
         const savedEditorWidthPx = localStorage.getItem('timestampEditorWidth');
         if (editorPane && displayPane && resizerElement && savedEditorWidthPx) {
            setTimeout(() => {
                if (!editorPane || !editorPane.parentElement || !resizerElement) return;
                const totalWidth = editorPane.parentElement.clientWidth;
                const resizerW = resizerElement.offsetWidth;
                const availableWidth = totalWidth - resizerW;
                const editorW = parseFloat(savedEditorWidthPx);

                if (availableWidth > 0 && !isNaN(editorW) && editorW >= MIN_PANE_WIDTH && (availableWidth - editorW) >= MIN_PANE_WIDTH) {
                    editorPane.style.width = `${editorW}px`;
                    displayPane.style.width = `${availableWidth - editorW}px`;
                    editorPane.style.flexBasis = '';
                    displayPane.style.flexBasis = '';
                } else {
                    // Removed console.warn, rely on default behavior
                    editorPane.style.width = '';
                    displayPane.style.width = '';
                    editorPane.style.flexBasis = '45%';
                    displayPane.style.flexBasis = '55%';
                }
            }, 0);
        } else if(editorPane && displayPane) {
            editorPane.style.width = '';
            displayPane.style.width = '';
            editorPane.style.flexBasis = '45%';
            displayPane.style.flexBasis = '55%';
        }
    }

    function saveTimestamps() {
        try {
            const cleanedTimestamps = timestamps
                .map(ts => String(ts).trim())
                .filter(ts => ts.length > 0);

            if (JSON.stringify(timestamps) !== JSON.stringify(cleanedTimestamps)) {
                timestamps = cleanedTimestamps;
            }
            localStorage.setItem('timestamps', JSON.stringify(timestamps));
        } catch (e) {
            // Keep user feedback
            showErrorMessage("タイムスタンプ保存失敗！");
        }
    }

    function saveContainerPosition() {
        if (!container) { return; }
        try {
            const rect = container.getBoundingClientRect();
            const position = {
                left: container.style.left || "360px",
                top: container.style.top || "500px",
                width: container.style.width || `${rect.width}px`,
                height: container.style.height || `${rect.height}px`
            };
            localStorage.setItem('timestampContainerPosition', JSON.stringify(position));

            if (editorPane && editorPane.style.width && !isResizingPanes) {
                 localStorage.setItem('timestampEditorWidth', editorPane.style.width);
            }
        } catch (e) {
            // Removed console.error, fail silently if position save fails
        }
    }

    function loadContainerPosition() {
        const savedPosition = localStorage.getItem('timestampContainerPosition');
        if (savedPosition) {
            try {
                const pos = JSON.parse(savedPosition);
                if (pos && typeof pos.left === 'string' && typeof pos.top === 'string') {
                    return {
                        left: pos.left || "360px",
                        top: pos.top || "500px",
                        width: pos.width || "680px",
                        height: pos.height || "380px"
                    };
                }
            } catch (e) {
                // Removed console.error, use default if load fails
            }
        }
        return { left: "360px", top: "500px", width: "680px", height: "380px" };
    }

    function formatTime(totalSeconds) {
        totalSeconds = Math.max(0, Math.floor(totalSeconds));
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    function updateTimeDisplay() {
        const video = document.querySelector('video');
        if (currentTimeDisplay) {
            if (video && typeof video.currentTime === 'number' && !isNaN(video.currentTime)) {
                try {
                    const currentVideoTime = video.currentTime;
                    const timeText = formatTime(currentVideoTime);
                    currentTimeDisplay.textContent = `再生時間 ${timeText}`;
                } catch (e) {
                    // Keep UI feedback for error
                    currentTimeDisplay.textContent = '時刻表示エラー';
                }
            } else {
                currentTimeDisplay.textContent = '再生時間 --:--:--';
            }
        }
    }

    function startCurrentTimeUpdate() {
        stopCurrentTimeUpdate();
        const video = document.querySelector('video');
        if (video && video.readyState >= 1) {
            updateTimeDisplay();
            currentTimeInterval = setInterval(updateTimeDisplay, 1000);
        }
    }

    function stopCurrentTimeUpdate() {
        if (currentTimeInterval) {
            clearInterval(currentTimeInterval);
            currentTimeInterval = null;
        }
    }

    function recordTimestamp() {
        const video = document.querySelector('video');
        if (video && typeof video.currentTime === 'number' && !isNaN(video.currentTime)) {
            try {
                const currentTime = video.currentTime;
                let maxNum = 0;
                timestamps.forEach(ts => {
                    const match = String(ts).match(/\[(\d+)\]$/);
                    if (match && match[1]) {
                        const num = parseInt(match[1], 10);
                        if (!isNaN(num) && num > maxNum) maxNum = num;
                    }
                });
                const nextNumber = maxNum + 1;
                const defaultText = ` [${nextNumber.toString().padStart(2, '0')}]`;
                const formattedTimestamp = `${formatTime(currentTime)}${defaultText}`;

                timestamps.push(formattedTimestamp);
                saveTimestamps();
                populateEditorFromTimestamps();
                sortState = null;
                renderTimestampList();

                if (firstTimeUser && timestamps.length === 1) {
                    localStorage.setItem('timestampFirstTime', 'false');
                    firstTimeUser = false;
                }

                if (bulkEditor) {
                    setTimeout(() => { bulkEditor.scrollTop = bulkEditor.scrollHeight; }, 0);
                }
            } catch (err) {
                // Keep user feedback
                showErrorMessage("記録エラー: " + err.message);
            }
        } else {
            // Keep user feedback
            showErrorMessage("動画が見つからないか、再生時間を取得できません。");
        }
    }

    function adjustTimestamp(index, adjustment) {
        if (index < 0 || index >= timestamps.length) return;
        const timestamp = String(timestamps[index]);
        const match = timestamp.match(TIME_REGEX);
        if (match) {
            try {
                let h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10);
                if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error("時間解析エラー");
                let totalSeconds = h * 3600 + m * 60 + s + adjustment;
                totalSeconds = Math.max(0, totalSeconds);
                const newFormattedTime = formatTime(totalSeconds);
                const restOfString = timestamp.substring(match[0].length);
                const newTimestamp = `${newFormattedTime}${restOfString}`;

                timestamps[index] = newTimestamp;
                saveTimestamps();
                populateEditorFromTimestamps();
                renderTimestampList();
                jumpToTimestamp(newTimestamp);
            } catch (e) {
                // Keep user feedback
                showErrorMessage("時間調整エラー。");
            }
        } else {
             // Keep user feedback
            showErrorMessage("時間調整エラー：時間形式 (HH:MM:SS) が見つかりません。");
        }
    }

    function deleteTimestamp(index) {
        if (index < 0 || index >= timestamps.length) return;
        timestamps.splice(index, 1);
        saveTimestamps();
        populateEditorFromTimestamps();
        sortState = null;
        renderTimestampList();
    }

    function jumpToTimestamp(timestamp) {
        const timestampStr = String(timestamp);
        const match = timestampStr.match(TIME_REGEX);
        if (match) {
            try {
                const h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10);
                if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error("時間解析エラー");
                const totalSeconds = h * 3600 + m * 60 + s;
                const video = document.querySelector('video');
                if (video) {
                    if (!isNaN(video.duration) && totalSeconds > video.duration) {
                        video.currentTime = video.duration;
                    } else {
                        video.currentTime = totalSeconds;
                    }
                    // Removed console.warn for play failure
                    video.play().catch(e => {});
                    showJumpSuccessMessage(match[0]);
                } else {
                    showErrorMessage("動画プレーヤーが見つかりません。");
                }
            } catch (e) {
                // Keep user feedback
                showErrorMessage("ジャンプエラー。");
            }
        } else {
            // Keep user feedback
            showErrorMessage(`ジャンプエラー：時間形式 (HH:MM:SS) が見つかりません。(${timestampStr.substring(0, 10)}...)`);
        }
    }

    function parseTimeToSeconds(timeString) {
        const match = String(timeString).match(TIME_REGEX);
        if (match && match.length === 4) {
            try {
                const h = parseInt(match[1], 10), m = parseInt(match[2], 10), s = parseInt(match[3], 10);
                if (!isNaN(h) && !isNaN(m) && !isNaN(s)) {
                    return h * 3600 + m * 60 + s;
                }
            } catch (e) {
                // Fail silently if parsing fails
            }
        }
        return null;
    }

    function toggleSortOrder() {
        if (sortState === null) {
            sortState = true;
        } else if (sortState === true) {
            sortState = false;
        } else {
            sortState = null;
        }
        renderTimestampList();
        updateSortButtonText();
    }

    function updateSortButtonText() {
         const sortButton = document.getElementById('ts-sort-button');
         if (!sortButton) return;
         if (sortState === true) {
             sortButton.textContent = "時間昇順 ▲";
         } else if (sortState === false) {
             sortButton.textContent = "時間降順 ▼";
         } else {
             sortButton.textContent = "元の順序";
         }
         sortButton.style.transform = "scale(0.95)";
         setTimeout(() => { if (sortButton) sortButton.style.transform = "scale(1)"; }, 100);
    }

    function deleteAllTimestampsConfirmed() {
        try {
            timestamps = [];
            saveTimestamps();
            if (bulkEditor) { bulkEditor.value = ''; }
            sortState = null;
            renderTimestampList();
            showInfoMessage("すべての記録が削除されました。");
        } catch (error) {
            // Keep user feedback
            showErrorMessage("全削除処理中にエラーが発生しました。");
        }
    }

    function showConfirmDeleteAllModal() {
         let modalOverlay = null;
         let modalContent = null;
         try {
             closeExistingContextMenu();
             const existingModal = document.getElementById('ts-confirm-modal');
             if (existingModal) existingModal.remove();

            modalOverlay = document.createElement("div"); modalOverlay.id = "ts-confirm-modal"; modalOverlay.className = "ts-modal-overlay";
            modalContent = document.createElement("div"); modalContent.className = "ts-modal-content";
            const message = document.createElement("p"); message.textContent = "すべての記録を削除しますか？"; message.className = "ts-modal-message";
            const buttonContainer = document.createElement("div"); buttonContainer.className = "ts-modal-buttons";
            const cancelButton = document.createElement("button"); cancelButton.textContent = "いいえ"; cancelButton.className = "ts-modal-button ts-modal-cancel";
            cancelButton.onclick = () => modalOverlay.remove();
            const confirmButton = document.createElement("button"); confirmButton.textContent = "削除"; confirmButton.className = "ts-modal-button ts-modal-confirm";

            confirmButton.onclick = () => {
                try {
                     deleteAllTimestampsConfirmed();
                     modalOverlay.remove();
                } catch (e) {
                     // Keep user feedback
                     showErrorMessage("削除処理中にエラーが発生しました。");
                     if (modalOverlay && modalOverlay.parentNode) { modalOverlay.remove(); }
                }
            };

            buttonContainer.append(cancelButton, confirmButton);
            modalContent.append(message, buttonContainer);
            modalOverlay.appendChild(modalContent);
            document.body.appendChild(modalOverlay);

            modalContent.style.position = 'absolute';
            modalContent.style.cursor = 'move';
            modalContent.addEventListener('mousedown', (e) => {
                 if (e.target !== modalContent && e.target.parentNode !== modalContent) return;
                 if (e.button !== 0) return;
                 isDraggingModal = true;
                 const overlayRect = modalOverlay.getBoundingClientRect();
                 const contentRect = modalContent.getBoundingClientRect();
                 modalOffsetX = e.clientX - contentRect.left;
                 modalOffsetY = e.clientY - contentRect.top;
                 const initialLeft = contentRect.left - overlayRect.left;
                 const initialTop = contentRect.top - overlayRect.top;
                 document.body.style.userSelect = 'none';

                 const modalMoveHandler = (moveEvent) => {
                     if (!isDraggingModal) return;
                     if(rafModalDragId) cancelAnimationFrame(rafModalDragId);

                     rafModalDragId = requestAnimationFrame(() => {
                         let newX = initialLeft + (moveEvent.clientX - e.clientX);
                         let newY = initialTop + (moveEvent.clientY - e.clientY);
                         modalContent.style.left = `${newX}px`;
                         modalContent.style.top = `${newY}px`;
                         rafModalDragId = null;
                     });
                 };

                 const modalUpHandler = () => {
                     if(rafModalDragId) cancelAnimationFrame(rafModalDragId);
                     rafModalDragId = null;
                     if (isDraggingModal) {
                         isDraggingModal = false;
                         document.body.style.userSelect = '';
                         document.removeEventListener('mousemove', modalMoveHandler);
                         document.removeEventListener('mouseup', modalUpHandler);
                     }
                 };
                 document.addEventListener('mousemove', modalMoveHandler);
                 document.addEventListener('mouseup', modalUpHandler, { once: true });
                 e.preventDefault();
            });

            cancelButton.focus();

         } catch (error) {
             // Keep user feedback
             showErrorMessage("削除確認ウィンドウ表示中にエラー発生");
             if (modalOverlay && modalOverlay.parentNode) {
                  modalOverlay.remove();
             }
         }
    }

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
            // Keep user feedback
            showErrorMessage("コピーに失敗しました。");
        });
    }

    function copySingleTimestamp(text) {
        if (!text) return;
        navigator.clipboard.writeText(String(text)).then(() => {
            showCopySuccessMessage(`コピー: ${String(text).substring(0, 50)}${String(text).length > 50 ? '...' : ''}`);
        }).catch(err => {
            // Keep user feedback
            showErrorMessage("コピー失敗。");
        });
    }

    function toggleLock() {
        isLocked = !isLocked;
        localStorage.setItem('timestampLockState', isLocked.toString());
        applyLockState();
        if (lockButton) {
            lockButton.style.transform = "scale(0.95)";
            setTimeout(() => { if (lockButton) lockButton.style.transform = "scale(1)"; }, 100);
        }
    }

    function applyLockState() {
        if (!lockButton || !container || !bulkEditor || !topBarElement || !bottomBarElement || !resizerElement) return;

        lockButton.textContent = isLocked ? "アンロック" : "ロック";
        lockButton.classList.toggle('ts-locked', isLocked);
        lockButton.classList.toggle('ts-unlocked', !isLocked);

        bulkEditor.readOnly = isLocked;
        bulkEditor.style.backgroundColor = isLocked ? '#eee' : '#fff';
        bulkEditor.style.cursor = isLocked ? 'not-allowed' : '';

        topBarElement.style.cursor = isLocked ? 'default' : 'move';
        bottomBarElement.style.cursor = isLocked ? 'default' : 'move';
        topBarElement.classList.toggle('ts-locked', isLocked);
        bottomBarElement.classList.toggle('ts-locked', isLocked);

        const originalContainerResize = container.dataset.originalResize || 'both';
        container.style.resize = isLocked ? 'none' : originalContainerResize;
        container.classList.toggle('ts-locked', isLocked);

        resizerElement.style.display = isLocked ? 'none' : 'block';
        resizerElement.style.cursor = isLocked ? 'default' : 'col-resize';
    }

    function toggleVisibility() {
        if (hideButtonDragged) {
            hideButtonDragged = false;
            return;
        }

        isHidden = !isHidden;
        localStorage.setItem('timestampHiddenState', isHidden.toString());
        applyHiddenState();
        if (hideButton) {
            hideButton.style.transform = "scale(0.95)";
            setTimeout(() => { if (hideButton) hideButton.style.transform = "scale(1)"; }, 100);
        }
    }

   function applyHiddenState() {
        if (!container || !hideButton || !topBarElement || !mainContentElement || !bottomBarElement || !resizerElement) {
            // Removed console.warn
            return;
        }

        if (!container.dataset.originalBg) container.dataset.originalBg = window.getComputedStyle(container).backgroundColor;
        if (!container.dataset.originalBorder) container.dataset.originalBorder = window.getComputedStyle(container).border;
        if (!container.dataset.originalBoxShadow) container.dataset.originalBoxShadow = window.getComputedStyle(container).boxShadow;
        if (!container.dataset.originalPointerEvents) container.dataset.originalPointerEvents = window.getComputedStyle(container).pointerEvents;
        if (!container.dataset.originalOverflow) container.dataset.originalOverflow = window.getComputedStyle(container).overflow;
        if (!container.dataset.originalResize) container.dataset.originalResize = window.getComputedStyle(container).resize || 'both';

        if (isHidden) {
            topBarElement.style.visibility = 'hidden';
            mainContentElement.style.visibility = 'hidden';
            bottomBarElement.style.visibility = 'hidden';

            container.style.backgroundColor = 'transparent';
            container.style.border = 'none';
            container.style.boxShadow = 'none';
            container.style.resize = 'none';
            container.style.overflow = 'visible';
            container.style.pointerEvents = 'none';

            // Ensure hideButton exists before accessing getBoundingClientRect
            if (hideButton) {
                const rect = hideButton.getBoundingClientRect();
                hideButtonLastViewportPos = { left: rect.left, top: rect.top };

                hideButton.style.position = 'fixed';
                hideButton.style.left = `${hideButtonLastViewportPos.left}px`;
                hideButton.style.top = `${hideButtonLastViewportPos.top}px`;
                hideButton.style.visibility = 'visible';
                hideButton.style.pointerEvents = 'auto';
                hideButton.style.zIndex = '9999';
                hideButton.textContent = "表示";
                hideButton.classList.add('ts-hidden-state');
                hideButton.classList.remove('ts-visible-state');
            }

        } else {
            container.style.pointerEvents = container.dataset.originalPointerEvents || 'auto';
            container.style.backgroundColor = container.dataset.originalBg || 'rgba(240, 240, 240, 0.95)';
            container.style.border = container.dataset.originalBorder || '1px solid #a0a0a0';
            container.style.boxShadow = container.dataset.originalBoxShadow || '0 4px 12px rgba(0,0,0,0.2)';
            container.style.overflow = container.dataset.originalOverflow || 'hidden';

            topBarElement.style.visibility = 'visible';
            mainContentElement.style.visibility = 'visible';
            bottomBarElement.style.visibility = 'visible';

            if (hideButton) { // Check hideButton exists
                hideButton.style.position = '';
                hideButton.style.left = '';
                hideButton.style.top = '';
                hideButton.style.zIndex = '';
                hideButton.style.visibility = 'visible';
                hideButton.style.pointerEvents = 'auto';
                hideButton.textContent = "隠す";
                hideButton.classList.remove('ts-hidden-state');
                hideButton.classList.add('ts-visible-state');
            }

            applyLockState(); // Apply lock state which might affect resizer visibility etc.
        }
    }


    function populateEditorFromTimestamps() {
        if (!bulkEditor) return;
        bulkEditor.value = timestamps.join('\n');
    }

    function handleEditorChange() {
        if (!bulkEditor) return;
        if (editorChangeTimeout) {
            clearTimeout(editorChangeTimeout);
        }
        editorChangeTimeout = setTimeout(() => {
            const currentText = bulkEditor.value;
            const lines = currentText.split('\n');

            timestamps = lines;
            saveTimestamps();

            if (sortState !== null) {
                sortState = null;
                updateSortButtonText();
            }
            renderTimestampList();
        }, EDITOR_DEBOUNCE_MS);
    }

    function renderTimestampList() {
        if (!displayListElement) {
            displayListElement = document.getElementById("timestamp-display-list");
            if (!displayListElement) return;
        }
        try {
            while (displayListElement.firstChild) {
                displayListElement.removeChild(displayListElement.firstChild);
            }

            let displayData;
            const validTimestamps = timestamps.filter(ts => String(ts).trim().length > 0);

            if (sortState !== null) {
                displayData = [...validTimestamps].sort((a, b) => {
                    const sA = parseTimeToSeconds(a);
                    const sB = parseTimeToSeconds(b);
                    if (sA !== null && sB !== null) {
                        return sortState ? sA - sB : sB - sA;
                    }
                    if (sA === null && sB !== null) return sortState ? 1 : -1;
                    if (sA !== null && sB === null) return sortState ? -1 : 1;
                    const strA = String(a);
                    const strB = String(b);
                    return sortState ? strA.localeCompare(strB) : strB.localeCompare(strA);
                });
            } else {
                displayData = [...validTimestamps];
            }

            if (displayData.length === 0) {
                const emptyGuide = document.createElement('div');
                emptyGuide.className = 'ts-empty-guide';
                emptyGuide.textContent = "記録はありません";
                displayListElement.appendChild(emptyGuide);
                return;
            }

            const fragment = document.createDocumentFragment();
            displayData.forEach((timestampText) => {
                const originalIndex = timestamps.findIndex(originalTs => originalTs === timestampText);
                if (originalIndex !== -1) {
                    const listItem = createTimestampListItem(timestampText, originalIndex);
                    if (listItem) fragment.appendChild(listItem);
                }
            });

            displayListElement.appendChild(fragment);

        } catch (e) {
             // Keep user feedback
            showErrorMessage("リスト表示エラー。");
            if (displayListElement) {
                 while (displayListElement.firstChild) displayListElement.removeChild(displayListElement.firstChild);
                 const errorLi = document.createElement('li');
                 errorLi.textContent = 'リスト表示エラー';
                 errorLi.style.cssText = 'color: red; padding: 10px; text-align: center;';
                 displayListElement.appendChild(errorLi);
            }
        }
    }

    function createTimestampListItem(timestampText, originalIndex) {
        const listItem = document.createElement("li");
        listItem.className = "ts-list-item";
        listItem.dataset.originalIndex = originalIndex;

        const itemContainer = document.createElement("div");
        itemContainer.className = "ts-item-container";

        const hasValidTime = TIME_REGEX.test(String(timestampText));

        const jumpIcon = document.createElement("span");
        jumpIcon.textContent = "▶️";
        jumpIcon.className = "ts-jump-icon";
        jumpIcon.title = "クリックでジャンプ";
        jumpIcon.onclick = (e) => { e.stopPropagation(); jumpToTimestamp(timestampText); };

        const minusButton = document.createElement("button");
        minusButton.textContent = "-1s";
        minusButton.className = "ts-adjust-button ts-minus-button ts-action-button";
        minusButton.onclick = (e) => { e.stopPropagation(); adjustTimestamp(originalIndex, -1); };

        const plusButton = document.createElement("button");
        plusButton.textContent = "+1s";
        plusButton.className = "ts-adjust-button ts-plus-button ts-action-button";
        plusButton.onclick = (e) => { e.stopPropagation(); adjustTimestamp(originalIndex, 1); };

        const deleteButton = document.createElement("button");
        deleteButton.textContent = "削除";
        deleteButton.className = "ts-delete-button ts-action-button";
        deleteButton.onclick = (e) => { e.stopPropagation(); deleteTimestamp(originalIndex); };

        const displayContainer = document.createElement("div");
        displayContainer.className = "ts-display-container";

        const displayText = document.createElement("div");
        displayText.className = "ts-display-text";
        displayText.textContent = timestampText;
        displayText.title = `Ctrl+クリックでジャンプ / 右クリックメニュー`;

        displayText.onclick = (e) => {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) {
                jumpToTimestamp(timestampText);
            }
        };
        displayText.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showTimestampContextMenu(e, timestampText, displayText);
        };

        if (hasValidTime) {
            itemContainer.append(jumpIcon, minusButton, plusButton);
        }
        itemContainer.append(deleteButton);
        itemContainer.append(displayContainer);
        displayContainer.appendChild(displayText);
        listItem.appendChild(itemContainer);

        return listItem;
    }


    function showTimestampContextMenu(e, timestamp, element) {
        closeExistingContextMenu();

        const menu = document.createElement('div');
        menu.id = 'timestamp-context-menu';
        menu.className = 'ts-context-menu';

        const menuWidth = 160;
        const menuHeight = 80;
        const posX = (e.clientX + menuWidth > window.innerWidth) ? window.innerWidth - menuWidth - 5 : e.clientX + 2;
        const posY = (e.clientY + menuHeight > window.innerHeight) ? e.clientY - menuHeight - 2 : e.clientY + 2;
        menu.style.left = `${posX}px`;
        menu.style.top = `${posY}px`;

        const itemStyle = 'ts-context-menu-item';
        const currentTimestamp = element.textContent || timestamp;

        if (TIME_REGEX.test(String(currentTimestamp))) {
            const jumpOption = document.createElement('div');
            jumpOption.textContent = 'タイムラインジャンプ';
            jumpOption.className = itemStyle;
            jumpOption.onclick = () => { jumpToTimestamp(currentTimestamp); closeExistingContextMenu(); };
            menu.appendChild(jumpOption);
        }

        const copyOption = document.createElement('div');
        copyOption.textContent = 'コピー';
        copyOption.className = itemStyle;
        copyOption.onclick = () => { copySingleTimestamp(currentTimestamp); closeExistingContextMenu(); };
        menu.appendChild(copyOption);

        document.body.appendChild(menu);

        contextMenuCloseListener = (event) => {
            const menuElement = document.getElementById('timestamp-context-menu');
            if (menuElement && !menuElement.contains(event.target)) {
                closeExistingContextMenu();
            } else if (menuElement) {
                // Keep listener active if clicked inside menu, reset on next cycle
                setTimeout(() => {
                    document.addEventListener('click', contextMenuCloseListener, { capture: true, once: true });
                    document.addEventListener('contextmenu', contextMenuCloseListener, { capture: true, once: true });
                }, 0);
            }
        };
        // Add listener after current event cycle finishes
        setTimeout(() => {
            document.addEventListener('click', contextMenuCloseListener, { capture: true, once: true });
            document.addEventListener('contextmenu', contextMenuCloseListener, { capture: true, once: true });
        }, 0);
    }

    function closeExistingContextMenu() {
        const existingMenu = document.getElementById('timestamp-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }
        if (contextMenuCloseListener) {
            document.removeEventListener('click', contextMenuCloseListener, { capture: true });
            document.removeEventListener('contextmenu', contextMenuCloseListener, { capture: true });
            contextMenuCloseListener = null;
        }
    }


    function addStyles() {
        const styleId = 'timestamp-styles-v11.20-ui';
        if (document.getElementById(styleId)) return;
        const css = `
            :root {
                --ts-font-size-base: 15px; --ts-font-size-small: 13px; --ts-font-size-large: 17px;
                --ts-primary-blue: #3498db; --ts-primary-green: #2ecc71; --ts-primary-red: #e74c3c;
                --ts-primary-orange: #f39c12; --ts-primary-grey: #95a5a6; --ts-text-dark: #333;
                --ts-text-light: #f8f8f8; --ts-border-color: #a0a0a0; --ts-resizer-color: #ccc;
                --ts-primary-copy-blue: #5dade2; --ts-primary-copy-blue-dark: #2e86c1;
                --ts-lock-red: #e74c3c; --ts-lock-red-dark: #c0392b;
            }
            .ts-container {
                position: absolute; z-index: 9998; display: flex; flex-direction: column;
                background: rgba(245, 245, 245, 0.97); border: 1px solid var(--ts-border-color); border-radius: 6px;
                box-shadow: 0 4px 15px rgba(0,0,0,0.25); user-select: none;
                resize: both; overflow: hidden; min-width: 550px; min-height: 350px;
                font-size: var(--ts-font-size-base); color: var(--ts-text-dark); pointer-events: auto;
            }
            .ts-container.ts-locked { resize: none !important; }
            .ts-top-bar {
                display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; gap: 14px;
                background: #e8e8e8; border-bottom: 1px solid #ccc; flex-shrink: 0; cursor: move;
            }
            .ts-top-bar.ts-locked { cursor: default; }
            .ts-time-display {
                padding: 6px 14px; background: rgba(40, 40, 40, 0.9); color: var(--ts-text-light); border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 4px; font-size: var(--ts-font-size-small); font-weight: bold; text-align: center;
                text-shadow: 1px 1px 2px rgba(0,0,0,0.6); margin: 0; flex-shrink: 0;
            }
            .ts-record-button {
                padding: 8px 20px; background: linear-gradient(to bottom, #5dade2, var(--ts-primary-blue)); color: white; border: 1px solid #258cd1;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.25); cursor: pointer;
                font-size: var(--ts-font-size-base); font-weight: bold; border-radius: 5px; transition: all 0.15s ease;
                text-shadow: 1px 1px 1px rgba(0,0,0,0.3); margin: 0; flex-shrink: 0;
            }
            .ts-record-button:hover { background: linear-gradient(to bottom, #6ebef0, #3ea0e0); box-shadow: 0 3px 6px rgba(0, 0, 0, 0.25), inset 0 1px 1px rgba(255, 255, 255, 0.25); }
            .ts-record-button:active { background: linear-gradient(to top, #5dade2, var(--ts-primary-blue)); transform: scale(0.97); box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.25); }
            #ts-main-content { display: flex; flex-grow: 1; width: 100%; overflow: hidden; background: #fdfdfd; }
            #ts-editor-pane {
                width: 45%; display: flex; flex-direction: column; padding: 10px;
                min-width: ${MIN_PANE_WIDTH}px; overflow: hidden; position: relative; background-color: #fdfdfd;
                flex-shrink: 0;
            }
             #ts-display-pane {
                 width: calc(55% - 5px); display: flex; flex-direction: column;
                 padding: 0 20px 0 0;
                 box-sizing: border-box;
                 min-width: ${MIN_PANE_WIDTH}px; overflow: hidden; background-color: #ffffff;
                 flex-shrink: 0;
            }
            #ts-pane-resizer {
                flex: 0 0 5px; background-color: var(--ts-resizer-color);
                cursor: col-resize; border-left: 1px solid #bbb; border-right: 1px solid #bbb;
                transition: background-color 0.2s ease;
            }
            #ts-pane-resizer:hover { background-color: #aaa; }
            #ts-pane-resizer.resizing { background-color: var(--ts-primary-blue); }
            #ts-editor-pane label {
                 font-size: var(--ts-font-size-small); font-weight: bold; color: #555;
                 margin-bottom: 6px; display: block; text-align: center; flex-shrink: 0;
            }
            #ts-bulk-editor {
                flex-grow: 1; width: 100%; box-sizing: border-box; border: 1px solid #c0c0c0; border-radius: 4px;
                padding: 10px 12px; font-size: var(--ts-font-size-base); line-height: 1.7; font-family: 'Segoe UI', Meiryo, Arial, sans-serif;
                resize: none; outline: none; transition: all 0.2s ease;
                background-color: #fff; min-height: 100px; overflow-y: auto;
            }
            #ts-bulk-editor:focus { border-color: var(--ts-primary-blue); box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.3); }
            #ts-bulk-editor:read-only { background-color: #f5f5f5; cursor: not-allowed; border-color: #ddd;}
            .ts-display-list-container { display: flex; flex-direction: column; flex-grow: 1; background: #ffffff; border: none; box-shadow: none; overflow: hidden; }
            .ts-list-button-bar {
                display: flex; padding: 7px 12px; gap: 10px; background: #f0f0f0;
                border-bottom: 1px solid #ddd; align-items: center; flex-wrap: nowrap; flex-shrink: 0;
             }
            .ts-list-button { padding: 7px 14px; font-size: var(--ts-font-size-small); font-weight: bold; border: 1px solid; border-radius: 4px; cursor: pointer; transition: all 0.15s ease; white-space: nowrap; text-align: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .ts-list-button:active { transform: scale(0.96); box-shadow: inset 0 1px 2px rgba(0,0,0,0.15); }
            .ts-copy-all-button {
                flex-grow: 1; flex-shrink: 1; flex-basis: 0; min-width: 80px;
                background: linear-gradient(to bottom, var(--ts-primary-copy-blue), var(--ts-primary-copy-blue-dark)); color: white; border-color: var(--ts-primary-copy-blue-dark);
                text-shadow: 1px 1px 1px rgba(0,0,0,0.2);
            }
            .ts-copy-all-button:hover { background: linear-gradient(to bottom, #85c1e9, var(--ts-primary-copy-blue)); border-color: #21618c; }
            .ts-sort-button {
                flex-grow: 1; flex-shrink: 1; flex-basis: 0; min-width: 80px;
                background: linear-gradient(to bottom, #f8c471, var(--ts-primary-orange)); color: white; border-color: #e67e22;
                text-shadow: 1px 1px 1px rgba(0,0,0,0.2);
            }
            .ts-sort-button:hover { background: linear-gradient(to bottom, #f9d08a, #f5a623); border-color: #d35400; }
            .ts-delete-all-button {
                background: linear-gradient(to bottom, #f1948a, var(--ts-primary-red)); color: white; border: 1px solid #d9534f;
                text-shadow: 1px 1px 1px rgba(0,0,0,0.2); border-radius: 50%; padding: 0; font-size: 18px; font-weight: bold;
                line-height: 30px; width: 32px; height: 32px; box-sizing: border-box;
                margin-left: auto; flex-shrink: 0; margin-right: 3px;
            }
            .ts-delete-all-button:hover { background: linear-gradient(to bottom, #f5a79d, #e95c4d); border-color: #c9302c; }
            #timestamp-display-list {
                list-style-type: none; padding: 10px 12px; margin: 0; flex-grow: 1;
                overflow-y: auto; overflow-x: hidden; background-color: #ffffff; box-sizing: border-box;
             }
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
            .ts-hide-button { visibility: visible !important; pointer-events: auto !important; cursor: pointer; }
            .ts-hide-button.ts-visible-state { background: linear-gradient(to bottom, #aeb6bf, var(--ts-primary-grey)); }
            .ts-hide-button.ts-visible-state:hover { background: linear-gradient(to bottom, #cacfd6, #aab5c0); }
             .ts-hide-button.ts-hidden-state { background: linear-gradient(to bottom, #ec7063, var(--ts-primary-red)); }
            .ts-hide-button.ts-hidden-state:hover { background: linear-gradient(to bottom, #f1948a, #e74c3c); }
            .ts-context-menu { position: fixed; background-color: #ffffff; border: 1px solid #b0b0b0; border-radius: 4px; box-shadow: 0 3px 10px rgba(0,0,0,0.2); z-index: 10001; padding: 6px 0; min-width: 160px; font-size: var(--ts-font-size-base); }
            .ts-context-menu-item { padding: 9px 20px; cursor: pointer; white-space: nowrap; color: #333; transition: background-color 0.1s ease; }
            .ts-context-menu-item:hover { background-color: #e8f0fe; color: var(--ts-primary-blue); }
            .ts-modal-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: transparent; display: flex; justify-content: center; align-items: center; z-index: 10000; pointer-events: auto; }
            .ts-modal-content { background-color: #fff; padding: 30px 35px; border: 1px solid #ccc; border-radius: 8px; box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3); width: auto; min-width: 350px; max-width: 500px; text-align: center; pointer-events: auto; position: relative; cursor: move; }
            .ts-modal-message { font-size: var(--ts-font-size-large); font-weight: 600; color: var(--ts-primary-red); margin-bottom: 35px; line-height: 1.6; pointer-events: none; }
            .ts-modal-buttons { display: flex; justify-content: center; gap: 20px; cursor: default; }
            .ts-modal-button { padding: 11px 25px; font-size: var(--ts-font-size-base); font-weight: bold; border: 1px solid transparent; cursor: pointer; border-radius: 5px; min-width: 110px; transition: all 0.15s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .ts-modal-cancel { background-color: #f0f0f0; color: #555; border-color: #c0c0c0; } .ts-modal-cancel:hover { background-color: #e5e5e5; border-color: #b0b0b0; } .ts-modal-confirm { background-color: var(--ts-primary-red); color: white; border-color: #c0392b; } .ts-modal-confirm:hover { background-color: #c0392b; border-color: #a93226; } .ts-modal-button:active { transform: scale(0.97); box-shadow: inset 0 1px 2px rgba(0,0,0,0.15); } .ts-modal-button:focus { outline: none; box-shadow: 0 0 0 3px rgba(52, 152, 219, 0.4); }
            .ts-message-box { position: fixed; bottom: 35px; left: 50%; padding: 14px 28px; color: white; font-size: var(--ts-font-size-base); font-weight: bold; border-radius: 5px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25); z-index: 10002; opacity: 0; transition: opacity 0.4s ease-in-out, transform 0.4s ease-in-out; text-align: center; max-width: 85%; pointer-events: none; transform: translate(-50%, 20px); }
            .ts-message-box.visible { opacity: 1; transform: translateX(-50%); } .ts-message-box.fade-out { opacity: 0; transform: translate(-50%, 20px); } .ts-message-box.success { background-color: var(--ts-primary-green); } .ts-message-box.error   { background-color: var(--ts-primary-red); } .ts-message-box.info    { background-color: var(--ts-primary-blue); } .ts-message-box.jump    { background-color: #733dd8; }
            .ts-tooltip-hint { position: fixed; bottom: 25px; right: 25px; background-color: rgba(0,0,0,0.85); color: white; padding: 10px 15px; border-radius: 4px; font-size: var(--ts-font-size-small); z-index: 9999; opacity: 0; transition: opacity 0.5s ease-in-out; pointer-events: none; } .ts-tooltip-hint.visible { opacity: 1; }
        `;
        const styleSheet = document.createElement("style");
        styleSheet.id = styleId;
        styleSheet.textContent = css;
        // Ensure head exists before appending
        (document.head || document.body).appendChild(styleSheet);
    }


    function handleContainerResize(entries) {
        if (isResizingPanes) return;

        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            for (let entry of entries) {
                if (entry.target === container && editorPane && displayPane && resizerElement) {
                    const newContainerWidth = entry.contentRect.width;
                    // Ensure mainContentElement exists before accessing clientWidth
                    const mainContentWidth = mainContentElement ? mainContentElement.clientWidth : newContainerWidth;
                    const resizerWidth = resizerElement.offsetWidth;
                    const newAvailableWidth = mainContentWidth - resizerWidth;

                    let lastEditorWidthPxStr = localStorage.getItem('timestampEditorWidth');
                    let lastEditorWidthPx = editorPane.offsetWidth;

                    if (lastEditorWidthPxStr) {
                         const parsedWidth = parseFloat(lastEditorWidthPxStr);
                         if (!isNaN(parsedWidth)) {
                             lastEditorWidthPx = parsedWidth;
                         }
                    }

                     let newEditorWidth = Math.max(MIN_PANE_WIDTH, Math.min(lastEditorWidthPx, newAvailableWidth - MIN_PANE_WIDTH));
                     let newDisplayWidth = Math.max(MIN_PANE_WIDTH, newAvailableWidth - newEditorWidth);
                     // Recalculate editor width based on display width to ensure sum fits
                     newEditorWidth = newAvailableWidth - newDisplayWidth;

                     if (newAvailableWidth > (MIN_PANE_WIDTH * 2)) {
                        editorPane.style.width = `${newEditorWidth}px`;
                        displayPane.style.width = `${newDisplayWidth}px`;
                        editorPane.style.flexBasis = '';
                        displayPane.style.flexBasis = '';
                     } else {
                        // If not enough space, revert to flex-basis defaults
                        editorPane.style.width = '';
                        displayPane.style.width = '';
                        editorPane.style.flexBasis = '45%';
                        displayPane.style.flexBasis = '55%';
                     }
                }
            }
             saveContainerPosition();
        }, RESIZE_DEBOUNCE_MS);
    }


    function initializeUI() {
        const containerId = 'ts-container-main';
        const oldContainer = document.getElementById(containerId);
        if (oldContainer) {
             oldContainer.remove();
        }
        if (containerResizeObserver) {
            containerResizeObserver.disconnect();
            containerResizeObserver = null;
        }

        try {
            addStyles();

            container = document.createElement("div"); container.className = "ts-container"; container.id = containerId;
            topBarElement = document.createElement("div"); topBarElement.className = "ts-top-bar";
            currentTimeDisplay = document.createElement("div"); currentTimeDisplay.id = "ts-current-time"; currentTimeDisplay.className = "ts-time-display"; currentTimeDisplay.textContent = "読み込み中...";
            recordBtn = document.createElement("button"); recordBtn.id = "ts-record-button"; recordBtn.className = "ts-record-button"; recordBtn.textContent = "現在時刻を記録";
            mainContentElement = document.createElement("div"); mainContentElement.id = "ts-main-content";

            editorPane = document.createElement("div"); editorPane.id = "ts-editor-pane";
            const editorLabel = document.createElement("label"); editorLabel.setAttribute("for", "ts-bulk-editor"); editorLabel.textContent = "タイムスタンプ編集";
            bulkEditor = document.createElement("textarea"); bulkEditor.id = "ts-bulk-editor"; bulkEditor.placeholder = "例:\n0:15:30 開始\n1:25:00 曲名 [01]\n...";

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
            hideButton = document.createElement("button"); hideButton.id = "ts-hide-button"; hideButton.className = "ts-bottom-button ts-hide-button";

            topBarElement.append(currentTimeDisplay, recordBtn);
            editorPane.append(editorLabel, bulkEditor);
            listButtonBar.append(copyAllButton, sortButton, deleteAllButton);
            displayListContainer.append(listButtonBar, displayListElement);
            displayPane.append(displayListContainer);
            mainContentElement.append(editorPane, resizerElement, displayPane);
            bottomControls.append(lockButton, hideButton);
            bottomBarElement.append(bottomControls);
            container.append(topBarElement, mainContentElement, bottomBarElement);
            // Ensure body exists before appending container
            if (document.body) {
                document.body.appendChild(container);
            } else {
                 // Handle rare case where body isn't ready even at document-idle
                 throw new Error("Document body not available for UI injection.");
            }


            const savedPosition = loadContainerPosition();
            container.style.left = savedPosition.left;
            container.style.top = savedPosition.top;
            container.style.width = savedPosition.width;
            container.style.height = savedPosition.height;

            requestAnimationFrame(() => {
                 if (!container) return;
                container.dataset.originalBg = window.getComputedStyle(container).backgroundColor;
                container.dataset.originalBorder = window.getComputedStyle(container).border;
                container.dataset.originalBoxShadow = window.getComputedStyle(container).boxShadow;
                container.dataset.originalPointerEvents = window.getComputedStyle(container).pointerEvents;
                container.dataset.originalOverflow = window.getComputedStyle(container).overflow;
                container.dataset.originalResize = window.getComputedStyle(container).resize || 'both';
                container.dataset.originalMinWidth = container.style.minWidth || window.getComputedStyle(container).minWidth;
                container.dataset.originalMinHeight = container.style.minHeight || window.getComputedStyle(container).minHeight;
                applySavedPaneWidths();
            });

            updateSortButtonText();

            recordBtn.onclick = recordTimestamp;
            copyAllButton.onclick = copyAllTimestamps;
            sortButton.onclick = toggleSortOrder;
            deleteAllButton.onclick = (e) => {
                 e.stopPropagation(); e.preventDefault();
                 showConfirmDeleteAllModal();
            };
            lockButton.onclick = toggleLock;
            hideButton.onclick = toggleVisibility;

            bulkEditor.addEventListener('input', handleEditorChange);
             bulkEditor.addEventListener('keydown', function(event) {
                // Prevent default Enter behavior if needed, currently does nothing
                if (event.key === 'Enter') { /* Add specific behavior if desired */ }
            });

             const addDragListener = (element) => {
                let dragStartX, dragStartY, initialLeft, initialTop;
                const handleDragMove = (moveEvent) => {
                     if (!isDraggingContainer || isResizingPanes) return;
                     if (rafDragId) cancelAnimationFrame(rafDragId);
                     rafDragId = requestAnimationFrame(() => {
                         if (!isDraggingContainer || isResizingPanes || !container) return; // Add check for container
                         const currentX = moveEvent.clientX; const currentY = moveEvent.clientY;
                         container.style.left = `${initialLeft + (currentX - dragStartX)}px`;
                         container.style.top = `${initialTop + (currentY - dragStartY)}px`;
                         rafDragId = null;
                     });
                };
                 const handleDragUp = () => {
                     if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId = null;
                     if (isDraggingContainer) {
                         isDraggingContainer = false;
                         document.body.style.cursor = ''; document.body.style.userSelect = '';
                         saveContainerPosition();
                         document.removeEventListener('mousemove', handleDragMove);
                         document.removeEventListener('mouseup', handleDragUp);
                     }
                 };
                 element.addEventListener('mousedown', (e) => {
                    // Check if target is within non-draggable controls
                    if (e.target !== element) {
                        let targetElement = e.target;
                        while (targetElement && targetElement !== element) {
                            if (targetElement.tagName === 'BUTTON' || targetElement.classList.contains('ts-bottom-controls') || targetElement.classList.contains('ts-time-display')) { return; }
                            targetElement = targetElement.parentElement;
                        }
                    }
                    if (isLocked || e.button !== 0 || isResizingPanes || isDraggingFromHideButton || !container) return; // Add check for container

                    isDraggingContainer = true;
                    const rect = container.getBoundingClientRect();
                    dragStartX = e.clientX; dragStartY = e.clientY;
                    initialLeft = rect.left; initialTop = rect.top;
                    document.body.style.cursor = 'move'; document.body.style.userSelect = 'none';
                    document.addEventListener('mousemove', handleDragMove);
                    document.addEventListener('mouseup', handleDragUp, { once: true, capture: true });
                    e.preventDefault();
                });
            };
            addDragListener(topBarElement);
            addDragListener(bottomBarElement);

             const paneResizeMoveHandler = (e) => {
                 if (!isResizingPanes || !editorPane || !displayPane) return;

                 const dx = e.clientX - resizeStartX;
                 let newEditorWidth = startEditorWidth + dx;
                 let newDisplayWidth = startDisplayWidth - dx;

                 const totalWidth = startEditorWidth + startDisplayWidth;
                 if (totalWidth <= 0) return; // Avoid division by zero or weird behavior

                 // Ensure minimum widths
                 newEditorWidth = Math.max(MIN_PANE_WIDTH, Math.min(newEditorWidth, totalWidth - MIN_PANE_WIDTH));
                 newDisplayWidth = totalWidth - newEditorWidth; // Calculate display width based on constrained editor width

                 editorPane.style.width = `${newEditorWidth}px`;
                 displayPane.style.width = `${newDisplayWidth}px`;
                 editorPane.style.flexBasis = ''; // Override flex-basis if setting width directly
                 displayPane.style.flexBasis = '';
             };

             const paneResizeUpHandler = () => {
                 if (!isResizingPanes) return;
                 isResizingPanes = false;
                 document.removeEventListener('mousemove', paneResizeMoveHandler);
                 document.removeEventListener('mouseup', paneResizeUpHandler);
                 document.body.style.cursor = '';
                 document.body.style.userSelect = '';
                 if(resizerElement) resizerElement.classList.remove('resizing');
                 saveContainerPosition(); // Save widths after resize finishes
             };

             resizerElement.addEventListener('mousedown', (e) => {
                 if (isLocked || e.button !== 0 || !editorPane || !displayPane) return;
                 isResizingPanes = true;
                 resizeStartX = e.clientX;
                 startEditorWidth = editorPane.offsetWidth;
                 startDisplayWidth = displayPane.offsetWidth;

                 document.body.style.cursor = 'col-resize';
                 document.body.style.userSelect = 'none';
                 resizerElement.classList.add('resizing');

                 document.addEventListener('mousemove', paneResizeMoveHandler);
                 document.addEventListener('mouseup', paneResizeUpHandler, { once: true });
                 e.preventDefault();
             });


            hideButton.addEventListener('mousedown', (e) => {
                 if (e.button !== 0) return;
                 e.stopPropagation();
                 dragStartTime = Date.now();
                 isDraggingFromHideButton = false;
                 hideButtonDragged = false;

                 const startX = e.clientX; const startY = e.clientY;
                 const buttonRect = hideButton.getBoundingClientRect();
                 const initialButtonLeft = buttonRect.left; const initialButtonTop = buttonRect.top;
                 // Ensure container exists before getting its rect
                 const containerRect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
                 const containerInitialLeft = containerRect.left; const containerInitialTop = containerRect.top;


                 const hideMoveHandler = (moveEvent) => {
                     const dx = Math.abs(moveEvent.clientX - startX);
                     const dy = Math.abs(moveEvent.clientY - startY);

                     if (!isDraggingFromHideButton && (dx > DRAG_MOVE_THRESHOLD || dy > DRAG_MOVE_THRESHOLD || Date.now() - dragStartTime > DRAG_THRESHOLD)) {
                          isDraggingFromHideButton = true;
                          document.body.style.cursor = 'move';
                          document.body.style.userSelect = 'none';
                          if (isHidden) {
                               hideButton.style.position = 'fixed';
                               hideButton.style.left = `${initialButtonLeft}px`;
                               hideButton.style.top = `${initialButtonTop}px`;
                          }
                     }

                     if (isDraggingFromHideButton) {
                         if (rafDragId) cancelAnimationFrame(rafDragId);
                         rafDragId = requestAnimationFrame(() => {
                            let newLeft, newTop;
                            if (isHidden) {
                                newLeft = initialButtonLeft + (moveEvent.clientX - startX);
                                newTop = initialButtonTop + (moveEvent.clientY - startY);
                                hideButton.style.left = `${newLeft}px`;
                                hideButton.style.top = `${newTop}px`;
                                // Also update container position if hidden and dragging button
                                if(container) {
                                    container.style.left = `${containerInitialLeft + (moveEvent.clientX - startX)}px`;
                                    container.style.top = `${containerInitialTop + (moveEvent.clientY - startY)}px`;
                                }
                            } else {
                                // If not hidden, drag the whole container
                                newLeft = containerInitialLeft + (moveEvent.clientX - startX);
                                newTop = containerInitialTop + (moveEvent.clientY - startY);
                                if(container) {
                                    container.style.left = `${newLeft}px`;
                                    container.style.top = `${newTop}px`;
                                }
                            }
                            rafDragId = null;
                         });
                     }
                 };

                 const hideUpHandler = (upEvent) => {
                     if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId = null;
                     document.removeEventListener('mousemove', hideMoveHandler);
                     document.removeEventListener('mouseup', hideUpHandler, { capture: true });

                     document.body.style.cursor = '';
                     document.body.style.userSelect = '';

                     const wasDragging = isDraggingFromHideButton;
                     isDraggingFromHideButton = false;

                     if (wasDragging) {
                         hideButtonDragged = true;

                         if (isHidden){
                             // Save button's final viewport position if hidden
                             const finalRect = hideButton.getBoundingClientRect();
                             hideButtonLastViewportPos = { left: finalRect.left, top: finalRect.top };
                             // No need to save container position directly here, it was updated during drag
                         }
                         saveContainerPosition(); // Save potentially updated container position
                         upEvent.preventDefault();
                         upEvent.stopPropagation(); // Prevent click if dragging occurred
                     }
                 };

                 document.addEventListener('mousemove', hideMoveHandler);
                 document.addEventListener('mouseup', hideUpHandler, { once: true, capture: true });
             });


             if ('ResizeObserver' in window) {
                 // Check if container exists before observing
                 if (container) {
                    containerResizeObserver = new ResizeObserver(handleContainerResize);
                    containerResizeObserver.observe(container);
                 }
             } else {
                 // Removed console.warn, feature just won't be available
             }

            loadState();
            applyLockState();
            applyHiddenState();
            startCurrentTimeUpdate();
            showTooltipHint();

        } catch (uiError) {
             // Keep user feedback
            showErrorMessage("スクリプトUIの読み込みに失敗しました！ " + uiError.message);
            if (container && container.parentNode) container.remove();
            container = null; // Ensure container is nullified on error
            if (containerResizeObserver) {
                containerResizeObserver.disconnect();
                containerResizeObserver = null;
            }
        }
    }


    let initRetryCount = 0; const MAX_INIT_RETRIES = 10;
    function runInitialization() {
        // Check if UI already exists
        if (document.getElementById('ts-container-main')) {
            initRetryCount = 0; // Reset count if UI is found
            return; // Don't re-initialize
        }

        // Check retry limit
        if (initRetryCount >= MAX_INIT_RETRIES) {
            // Removed console.error, show user message
            showErrorMessage("スクリプトの初期化がタイムアウトしました！ページを再読み込みしてみてください。");
            initRetryCount = 0; // Reset count
            return;
        }

        // Check conditions for initialization
        const video = document.querySelector('video');
        const playerElement = document.getElementById('movie_player');
        const playerAPIReady = playerElement && typeof playerElement.getCurrentTime === 'function' && typeof playerElement.seekTo === 'function';
        const videoReady = video && typeof video.currentTime === 'number' && video.readyState >= 1;

        // If conditions not met, retry later
        if (!videoReady || !playerAPIReady) {
             initRetryCount++;
            setTimeout(runInitialization, 1500 + initRetryCount * 100); // Exponential backoff-like delay
            return;
        }

        // Conditions met, proceed with initialization
        initRetryCount = 0; // Reset count on successful condition check
        try {
            initializeUI();
            // Verify UI was added (optional sanity check)
            if (!document.getElementById('ts-container-main')) {
                // Removed console.error, show user message
                showErrorMessage("UIの追加に失敗しました。");
            }
        } catch (e) {
             // Keep user feedback for initialization errors
            showErrorMessage("スクリプトの初期化に失敗しました！ " + e.message);
        }
    }


    let lastUrl = location.href;
    const observerCallback = (mutationsList, observerInstance) => {
        const currentUrl = location.href;
        // Check if URL actually changed and is a watch page
        if (currentUrl !== lastUrl) {
            lastUrl = currentUrl; // Update lastUrl immediately

            // Cleanup previous instance state
            stopCurrentTimeUpdate();
            closeExistingContextMenu();
            if (editorChangeTimeout) clearTimeout(editorChangeTimeout);
            if (containerResizeObserver) {
                containerResizeObserver.disconnect();
                containerResizeObserver = null;
            }
            const oldContainer = document.getElementById('ts-container-main');
            if (oldContainer) {
                oldContainer.remove();
            }
            // Reset all relevant state variables
            container = recordBtn = lockButton = hideButton = editorPane = displayPane = bulkEditor = displayListContainer = displayListElement = currentTimeDisplay = topBarElement = bottomBarElement = mainContentElement = resizerElement = null;
            timestamps = [];
            isDraggingContainer = false; isDraggingFromHideButton = false; hideButtonDragged = false; isResizingPanes = false;
            initRetryCount = 0; // Reset retry count for the new page
            sortState = null;
            // Stop intervals/timeouts
            if (currentTimeInterval) clearInterval(currentTimeInterval); currentTimeInterval = null;
            if (resizeTimeout) clearTimeout(resizeTimeout); resizeTimeout = null;
            if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId = null;
            if (rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = null;


            // If the new URL is a watch page, schedule re-initialization
            if (currentUrl.includes('/watch?v=')) {
                 // Use a reasonable delay to allow YouTube's SPA navigation to settle
                 setTimeout(runInitialization, 2000);
            }
        }
    };

    const observeTargetNode = document.querySelector('ytd-page-manager') || document.body;
    if (observeTargetNode) {
        observer = new MutationObserver(observerCallback);
        observer.observe(observeTargetNode, { childList: true, subtree: true });
     } else {
        // Keep user feedback if observer fails
        showErrorMessage("MutationObserver のターゲットが見つかりません！ URL変更時の自動再読み込みが機能しない可能性があります。");
    }

    function showTooltipHint() {
        if (firstTimeUser && !document.getElementById('ts-tooltip-hint')) {
            const tooltip = document.createElement('div');
            tooltip.id = 'ts-tooltip-hint';
            tooltip.className = 'ts-tooltip-hint';
            tooltip.textContent = 'ヒント: 左パネルで編集、右パネルでCtrl+クリックジャンプ / 右クリックメニュー';
             // Ensure body exists
            if (document.body) {
                 document.body.appendChild(tooltip);
                 setTimeout(() => { tooltip.classList.add('visible'); }, 100);
                 setTimeout(() => {
                     if (!tooltip.parentNode) return;
                     tooltip.classList.remove('visible');
                     tooltip.addEventListener('transitionend', () => {if (tooltip.parentNode) tooltip.remove();}, { once: true });
                     // Backup removal timer
                     setTimeout(() => { if (tooltip.parentNode) tooltip.remove(); }, 600); // Shorter than message box
                 }, 8000);
            }
        }
    }


    function initialStart() {
        // Ensure body is available before running initialization
        if (document.body) {
            runInitialization();
        } else {
            // If body is somehow not ready, retry shortly
            setTimeout(initialStart, 100);
        }
    }

    // --- Script Entry Point ---
    // Check document readiness state
    if (document.readyState === 'interactive' || document.readyState === 'complete') {
        initialStart(); // If already ready, start immediately
    } else {
        // Otherwise, wait for the DOM to be ready
        document.addEventListener('DOMContentLoaded', initialStart, { once: true });
    }

    // --- Cleanup on page unload ---
    window.addEventListener('beforeunload', () => {
        stopCurrentTimeUpdate();
        if (observer) observer.disconnect(); observer = null; // Ensure observer is nullified
        if (containerResizeObserver) {
            containerResizeObserver.disconnect();
            containerResizeObserver = null;
        }
        // Clear any pending timeouts/intervals/animation frames
        if (editorChangeTimeout) clearTimeout(editorChangeTimeout); editorChangeTimeout = null;
        if (currentTimeInterval) clearInterval(currentTimeInterval); currentTimeInterval = null;
        if (resizeTimeout) clearTimeout(resizeTimeout); resizeTimeout = null;
        if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId = null;
        if (rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = null;
        if (messageTimeoutId) clearTimeout(messageTimeoutId); messageTimeoutId = null;
        // Remove context menu listener if active
        closeExistingContextMenu();
    });

})();
