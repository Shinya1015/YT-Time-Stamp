// ==UserScript==
// @name         タイムスタンプ記録
// @namespace    https://www.youtube.com/
// @version      11.22
// @description  タイムスタンプ記録
// @match        *://www.youtube.com/watch?v*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';
    let timestamps = [], isDraggingContainer = false, offsetX = 0, offsetY = 0, container, recordBtn, lockButton, hideButton;
    let editorPane, displayPane, bulkEditor, displayListContainer, displayListElement, currentTimeDisplay;
    let topBarElement, bottomBarElement, mainContentElement, resizerElement;
    let isLocked = false, sortState = null, isHidden = localStorage.getItem('timestampHiddenState') === 'true';
    let firstTimeUser = localStorage.getItem('timestampFirstTime') === null, currentTimeInterval = null, observer = null;
    let dragStartTime = 0, isDraggingFromHideButton = false, hideButtonDragged = false, editorChangeTimeout = null;
    let hideButtonLastViewportPos = JSON.parse(localStorage.getItem('timestampHideButtonPos') || '{}'), isDraggingModal = false, modalOffsetX = 0, modalOffsetY = 0; // Load initial hide button pos
    let rafDragId = null, rafModalDragId = null, isResizingPanes = false, resizeStartX = 0, startEditorWidth = 0, startDisplayWidth = 0;
    let containerResizeObserver = null, resizeTimeout = null, contextMenuCloseListener = null, messageTimeoutId = null;
    const DRAG_THRESHOLD = 150, DRAG_MOVE_THRESHOLD = 5, EDITOR_DEBOUNCE_MS = 400, RESIZE_DEBOUNCE_MS = 150, TIME_REGEX = /^(\d+):(\d{2}):(\d{2})/, MIN_PANE_WIDTH = 100; // Increased debounce slightly

    function showMessage(message, type = 'info', duration = 3000) {
        const existingBox = document.getElementById('ts-message-box-instance'); if (existingBox) existingBox.remove(); if (messageTimeoutId) clearTimeout(messageTimeoutId);
        const messageBox = document.createElement("div"); messageBox.id = 'ts-message-box-instance'; messageBox.textContent = message; messageBox.className = `ts-message-box ${type}`;
        if (!document.body) return; document.body.appendChild(messageBox); requestAnimationFrame(() => requestAnimationFrame(() => messageBox.classList.add('visible')));
        const currentTimeoutId = setTimeout(() => { // Store timeout ID locally
            if (!messageBox?.parentNode) return; messageBox.classList.remove('visible'); messageBox.classList.add('fade-out');
            const removeFn = () => { if (messageBox?.parentNode) messageBox.remove(); if (messageTimeoutId === currentTimeoutId) messageTimeoutId = null; }; // Check ID before nulling
            messageBox.addEventListener('transitionend', removeFn, { once: true }); setTimeout(removeFn, 500); // Shorter cleanup delay
        }, duration);
        messageTimeoutId = currentTimeoutId; // Assign the new ID
    }
    function showSuccessMessage(m) { showMessage(m, 'success', 2500); } function showErrorMessage(m) { showMessage(m, 'error', 5000); } function showInfoMessage(m) { showMessage(m, 'info', 3000); } function showJumpSuccessMessage(t) { showMessage(`ジャンプ成功: ${t}`, 'jump', 2000); } function showCopySuccessMessage(t) { showMessage(`${t}`, 'success', 2000); }

    function loadState() {
        const stored = localStorage.getItem('timestamps'); timestamps = stored ? (()=>{ try { return JSON.parse(stored); } catch(e){ showErrorMessage("タイムスタンプの読み込みに失敗"); console.error("Failed to parse timestamps:", e); return []; } })() : [];
        isLocked = localStorage.getItem('timestampLockState') === 'true';
        isHidden = localStorage.getItem('timestampHiddenState') === 'true';
        firstTimeUser = localStorage.getItem('timestampFirstTime') === null;
        sortState = null; // Reset sort state on load
        const savedHidePos = localStorage.getItem('timestampHideButtonPos');
        if (savedHidePos) { try { hideButtonLastViewportPos = JSON.parse(savedHidePos); } catch(e) { hideButtonLastViewportPos = { left: 0, top: 0}; } }

        // Apply widths after state is loaded, ensures consistency if called standalone
        applySavedPaneWidths();
        if (bulkEditor && displayListElement) { populateEditorFromTimestamps(); renderTimestampList(); updateSortButtonText(); }
    }

    function applySavedPaneWidths() {
        // Run this after a short delay to allow layout stabilization, especially on initial load
        requestAnimationFrame(() => {
            if (!editorPane || !displayPane || !resizerElement || !mainContentElement) return;

            const savedPx = localStorage.getItem('timestampEditorWidth');
            const totalW = mainContentElement.clientWidth;
            const resizerW = resizerElement.offsetWidth;
            const availW = totalW - resizerW;

            if (availW <= 2 * MIN_PANE_WIDTH) {
                // Not enough space, use default flex basis
                editorPane.style.width = ''; displayPane.style.width = '';
                editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
                return;
            }

            if (savedPx) {
                const editorW = parseFloat(savedPx);
                // Check if saved width is valid *for the current available width*
                if (!isNaN(editorW) && editorW >= MIN_PANE_WIDTH && (availW - editorW) >= MIN_PANE_WIDTH) {
                    editorPane.style.width = `${editorW}px`;
                    displayPane.style.width = `${availW - editorW}px`;
                    editorPane.style.flexBasis = ''; displayPane.style.flexBasis = '';
                    // console.log(`Applied saved width: ${editorW}px`);
                    return; // Successfully applied saved width
                } else {
                     // Saved width exists but is invalid for current size, remove it
                     localStorage.removeItem('timestampEditorWidth');
                     // console.log(`Removed invalid saved width: ${savedPx}`);
                }
            }

            // Fallback: No valid saved width, use default flex-basis percentages
            // console.log("Applying default flex basis");
            editorPane.style.width = ''; displayPane.style.width = '';
            editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
        });
    }

    function saveTimestamps() { try { const cleaned = timestamps.map(ts => String(ts).trim()).filter(Boolean); if (JSON.stringify(timestamps) !== JSON.stringify(cleaned)) timestamps = cleaned; localStorage.setItem('timestamps', JSON.stringify(timestamps)); } catch (e) { showErrorMessage("タイムスタンプ保存失敗！"); console.error("Error saving timestamps:", e); } }

    function saveContainerPosition() {
        if (!container) return;
        try {
            const r = container.getBoundingClientRect();
            // Ensure we save pixel values, not percentages or auto
            const currentStyle = window.getComputedStyle(container);
            const p = {
                left: container.style.left || `${r.left}px`,
                top: container.style.top || `${r.top}px`,
                width: container.style.width || currentStyle.width || "680px",
                height: container.style.height || currentStyle.height || "380px"
            };
            localStorage.setItem('timestampContainerPosition', JSON.stringify(p));

            // Save editor width only if it's explicitly set in pixels and not during active pane resizing
            if (editorPane?.style.width.endsWith('px') && !isResizingPanes) {
                localStorage.setItem('timestampEditorWidth', editorPane.style.width);
                // console.log("Saved editor width:", editorPane.style.width);
            }
            if (isHidden && hideButton) {
                 const hideRect = hideButton.getBoundingClientRect();
                 // Ensure we save valid numbers
                 if (hideRect.left > 0 || hideRect.top > 0) {
                     hideButtonLastViewportPos = { left: hideRect.left, top: hideRect.top };
                     localStorage.setItem('timestampHideButtonPos', JSON.stringify(hideButtonLastViewportPos));
                 }
            }
        } catch (e) {
             console.error("Error saving container position:", e);
        }
    }
    function loadContainerPosition() { const d = { left: "360px", top: "500px", width: "680px", height: "380px" }; const s = localStorage.getItem('timestampContainerPosition'); if (s) { try { const p = JSON.parse(s); if (p?.left && p?.top) { p.width = p.width || d.width; p.height = p.height || d.height; return p; } } catch (e) { console.error("Error loading container position:", e); } } return d; }
    function formatTime(s) { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60; return `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`; }
    function updateTimeDisplay() { const v = document.querySelector('video'); if (currentTimeDisplay) { if (v && typeof v.currentTime === 'number' && !isNaN(v.currentTime)) { try { currentTimeDisplay.textContent = `再生時間 ${formatTime(v.currentTime)}`; } catch (e) { currentTimeDisplay.textContent = '時刻表示エラー'; } } else { currentTimeDisplay.textContent = '再生時間 --:--:--'; } } }
    function startCurrentTimeUpdate() { stopCurrentTimeUpdate(); const v = document.querySelector('video'); if (v?.readyState >= 1) { updateTimeDisplay(); currentTimeInterval = setInterval(updateTimeDisplay, 1000); } else if (v) { const handler = () => { if (v.readyState >= 1) { updateTimeDisplay(); currentTimeInterval = setInterval(updateTimeDisplay, 1000); } v.removeEventListener('loadedmetadata', handler); }; v.addEventListener('loadedmetadata', handler); } }
    function stopCurrentTimeUpdate() { if (currentTimeInterval) { clearInterval(currentTimeInterval); currentTimeInterval = null; } }
    function recordTimestamp() { const v = document.querySelector('video'); if (v && typeof v.currentTime === 'number' && !isNaN(v.currentTime)) { try { let maxN = 0; timestamps.forEach(ts => { const m = String(ts).match(/\[(\d+)\]$/); if (m?.[1]) { const n = parseInt(m[1], 10); if (!isNaN(n) && n > maxN) maxN = n; } }); const tsText = `${formatTime(v.currentTime)} [${(maxN + 1).toString().padStart(2, '0')}]`; timestamps.push(tsText); saveTimestamps(); populateEditorFromTimestamps(); sortState = null; renderTimestampList(); updateSortButtonText(); if (firstTimeUser && timestamps.length === 1) { localStorage.setItem('timestampFirstTime', 'false'); firstTimeUser = false; } if (bulkEditor) setTimeout(() => { bulkEditor.scrollTop = bulkEditor.scrollHeight; }, 0); } catch (err) { showErrorMessage("記録エラー: " + err.message); console.error("Record timestamp error:", err); } } else { showErrorMessage("動画が見つからないか、再生時間を取得できません。"); } }
    function adjustTimestamp(idx, adj) { if (idx < 0 || idx >= timestamps.length) return; const ts = String(timestamps[idx]); const m = ts.match(TIME_REGEX); if (m) { try { let h = parseInt(m[1],10), min = parseInt(m[2],10), s = parseInt(m[3],10); if (isNaN(h)||isNaN(min)||isNaN(s)) throw Error("Invalid time components"); let secs = Math.max(0, h*3600 + min*60 + s + adj); const newTs = `${formatTime(secs)}${ts.substring(m[0].length)}`; timestamps[idx] = newTs; saveTimestamps(); populateEditorFromTimestamps(); renderTimestampList(); jumpToTimestamp(newTs); } catch (e) { showErrorMessage("時間調整エラー: "+e.message); console.error("Adjust timestamp error:", e); } } else { showErrorMessage("時間調整エラー：時間形式 (HH:MM:SS) が見つかりません。"); } }
    function deleteTimestamp(idx) { if (idx < 0 || idx >= timestamps.length) return; try { timestamps.splice(idx, 1); saveTimestamps(); populateEditorFromTimestamps(); sortState = null; renderTimestampList(); updateSortButtonText(); } catch(e) { showErrorMessage("削除エラー"); console.error("Delete timestamp error:", e); } }
    function jumpToTimestamp(ts) { const s = String(ts); const m = s.match(TIME_REGEX); if (m) { try { const h = parseInt(m[1],10), min = parseInt(m[2],10), sec = parseInt(m[3],10); if (isNaN(h)||isNaN(min)||isNaN(sec)) throw Error("Invalid time components"); const secs = h*3600 + min*60 + sec; const v = document.querySelector('video'); if (v) { v.currentTime = (!isNaN(v.duration) && secs > v.duration) ? v.duration : secs; v.play().catch(()=>{/* Ignore play promise rejection */}); showJumpSuccessMessage(m[0]); } else { showErrorMessage("動画プレーヤーが見つかりません。"); } } catch (e) { showErrorMessage("ジャンプエラー: " + e.message); console.error("Jump timestamp error:", e); } } else { showErrorMessage(`ジャンプエラー：時間形式 (HH:MM:SS) が見つかりません。(${s.substring(0, 10)}...)`); } }
    function parseTimeToSeconds(t) { const m = String(t).match(TIME_REGEX); if (m?.[1] && m?.[2] && m?.[3]) { try { const h = parseInt(m[1],10), min = parseInt(m[2],10), s = parseInt(m[3],10); if (!isNaN(h)&&!isNaN(min)&&!isNaN(s)) return h*3600+min*60+s; } catch(e){ console.error("Error parsing time:", e); } } return null; }
    function toggleSortOrder() { sortState = (sortState === null) ? true : ((sortState === true) ? false : null); renderTimestampList(); updateSortButtonText(); }
    function updateSortButtonText() { const btn = document.getElementById('ts-sort-button'); if (!btn) return; btn.textContent = (sortState === true) ? "時間昇順 ▲" : ((sortState === false) ? "時間降順 ▼" : "元の順序"); btn.style.transform = "scale(0.95)"; setTimeout(() => { if (btn) btn.style.transform = "scale(1)"; }, 100); }
    function deleteAllTimestampsConfirmed() { try { timestamps = []; saveTimestamps(); if (bulkEditor) bulkEditor.value = ''; sortState = null; renderTimestampList(); updateSortButtonText(); showInfoMessage("すべての記録が削除されました。"); } catch (e) { showErrorMessage("全削除処理中にエラーが発生しました。"); console.error("Delete all error:", e); } }
    function showConfirmDeleteAllModal() { let ov = null; try { closeExistingContextMenu(); const em = document.getElementById('ts-confirm-modal'); if (em) em.remove(); ov = document.createElement("div"); ov.id = "ts-confirm-modal"; ov.className = "ts-modal-overlay"; const mc = document.createElement("div"); mc.className = "ts-modal-content"; const msg = document.createElement("p"); msg.textContent = "すべての記録を削除しますか？"; msg.className = "ts-modal-message"; const bc = document.createElement("div"); bc.className = "ts-modal-buttons"; const cb = document.createElement("button"); cb.textContent = "いいえ"; cb.className = "ts-modal-button ts-modal-cancel"; cb.onclick = () => { try { ov.remove(); } catch(e){} }; const okb = document.createElement("button"); okb.textContent = "削除"; okb.className = "ts-modal-button ts-modal-confirm"; okb.onclick = () => { try { deleteAllTimestampsConfirmed(); ov.remove(); } catch (e) { showErrorMessage("削除処理中にエラーが発生しました。"); console.error("Confirm delete error:", e); if (ov?.parentNode) try { ov.remove(); } catch(e){} } }; bc.append(cb, okb); mc.append(msg, bc); ov.appendChild(mc); document.body.appendChild(ov); mc.style.position = 'absolute'; mc.style.cursor = 'move'; mc.addEventListener('mousedown', (e) => { if (e.target !== mc || e.button !== 0) return; isDraggingModal = true; const or = ov.getBoundingClientRect(), cr = mc.getBoundingClientRect(); modalOffsetX = e.clientX - cr.left; modalOffsetY = e.clientY - cr.top; const il = cr.left - or.left, it = cr.top - or.top; document.body.style.userSelect = 'none'; document.body.style.cursor = 'move'; const mmh = (me) => { if (!isDraggingModal) return; if (rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = requestAnimationFrame(() => { mc.style.left = `${il + (me.clientX - e.clientX)}px`; mc.style.top = `${it + (me.clientY - e.clientY)}px`; rafModalDragId = null; }); }; const muh = () => { if (rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = null; if (isDraggingModal) { isDraggingModal = false; document.body.style.userSelect = ''; document.body.style.cursor = ''; document.removeEventListener('mousemove', mmh); document.removeEventListener('mouseup', muh); } }; document.addEventListener('mousemove', mmh); document.addEventListener('mouseup', muh, { once: true }); e.preventDefault(); }); cb.focus(); } catch (e) { showErrorMessage("削除確認ウィンドウ表示中にエラー発生"); console.error("Show confirm modal error:", e); if (ov?.parentNode) try { ov.remove(); } catch(e){} } }
    function copyAllTimestamps() { if (!bulkEditor || !bulkEditor.value.trim()) { showInfoMessage("コピーする記録はありません。"); return; } const txt = bulkEditor.value; navigator.clipboard.writeText(txt).then(() => { const lc = txt.split('\n').filter(Boolean).length; showCopySuccessMessage(`エディター内容 全${lc}行コピー！`); }).catch((err) => { showErrorMessage("コピーに失敗しました。"); console.error("Copy all error:", err); }); }
    function copySingleTimestamp(t) { if (!t) return; const s = String(t); navigator.clipboard.writeText(s).then(() => showCopySuccessMessage(`コピー: ${s.substring(0, 50)}${s.length > 50 ? '...' : ''}`)).catch((err) => { showErrorMessage("コピー失敗。"); console.error("Copy single error:", err); }); }
    function toggleLock() { isLocked = !isLocked; localStorage.setItem('timestampLockState', String(isLocked)); applyLockState(); if (lockButton) { lockButton.style.transform = "scale(0.95)"; setTimeout(() => { if (lockButton) lockButton.style.transform = "scale(1)"; }, 100); } }
    function applyLockState() { if (!lockButton || !container || !bulkEditor || !topBarElement || !bottomBarElement || !resizerElement) return; try { lockButton.textContent = isLocked ? "アンロック" : "ロック"; lockButton.classList.toggle('ts-locked', isLocked); lockButton.classList.toggle('ts-unlocked', !isLocked); bulkEditor.readOnly = isLocked; bulkEditor.style.backgroundColor = isLocked ? '#eee' : '#fff'; bulkEditor.style.cursor = isLocked ? 'not-allowed' : ''; topBarElement.style.cursor = isLocked ? 'default' : 'move'; bottomBarElement.style.cursor = isLocked ? 'default' : 'move'; topBarElement.classList.toggle('ts-locked', isLocked); bottomBarElement.classList.toggle('ts-locked', isLocked); const origResize = container.dataset.originalResize || 'both'; container.style.resize = isLocked ? 'none' : origResize; container.classList.toggle('ts-locked', isLocked); resizerElement.style.display = isLocked ? 'none' : 'block'; resizerElement.style.cursor = isLocked ? 'default' : 'col-resize'; } catch (e) { console.error("Apply lock state error:", e); } }
    function toggleVisibility() { if (hideButtonDragged) { hideButtonDragged = false; return; } isHidden = !isHidden; localStorage.setItem('timestampHiddenState', String(isHidden)); applyHiddenState(); if (hideButton) { hideButton.style.transform = "scale(0.95)"; setTimeout(() => { if (hideButton) hideButton.style.transform = "scale(1)"; }, 100); } }
    function applyHiddenState() { if (!container || !hideButton || !topBarElement || !mainContentElement || !bottomBarElement || !resizerElement) return; try { // Ensure original styles are captured if not already
            if (!container.dataset.originalBg) container.dataset.originalBg = window.getComputedStyle(container).backgroundColor || 'rgba(240, 240, 240, 0.95)';
            if (!container.dataset.originalBorder) container.dataset.originalBorder = window.getComputedStyle(container).border || '1px solid #a0a0a0';
            if (!container.dataset.originalBoxShadow) container.dataset.originalBoxShadow = window.getComputedStyle(container).boxShadow || '0 4px 12px rgba(0,0,0,0.2)';
            if (!container.dataset.originalPointerEvents) container.dataset.originalPointerEvents = window.getComputedStyle(container).pointerEvents || 'auto';
            if (!container.dataset.originalOverflow) container.dataset.originalOverflow = window.getComputedStyle(container).overflow || 'hidden';
            if (!container.dataset.originalResize) container.dataset.originalResize = window.getComputedStyle(container).resize || 'both';

            if (isHidden) {
                topBarElement.style.visibility = 'hidden'; mainContentElement.style.visibility = 'hidden'; bottomBarElement.style.visibility = 'hidden'; resizerElement.style.visibility = 'hidden';
                container.style.backgroundColor = 'transparent'; container.style.border = 'none'; container.style.boxShadow = 'none'; container.style.resize = 'none';
                // Allow overflow so the fixed button is clickable even if container is small
                container.style.overflow = 'visible';
                container.style.pointerEvents = 'none'; // Disable events on the container itself

                // Use saved position if available and valid, otherwise use current
                const currentRect = hideButton.getBoundingClientRect();
                const useLeft = (hideButtonLastViewportPos?.left > 0) ? hideButtonLastViewportPos.left : currentRect.left;
                const useTop = (hideButtonLastViewportPos?.top > 0) ? hideButtonLastViewportPos.top : currentRect.top;

                hideButton.style.position = 'fixed';
                hideButton.style.left = `${useLeft}px`;
                hideButton.style.top = `${useTop}px`;
                hideButton.style.visibility = 'visible';
                hideButton.style.pointerEvents = 'auto'; // Make button clickable
                hideButton.style.zIndex = '9999';
                hideButton.textContent = "表示";
                hideButton.classList.add('ts-hidden-state'); hideButton.classList.remove('ts-visible-state');
            } else {
                // Restore container styles from dataset or defaults
                container.style.pointerEvents = container.dataset.originalPointerEvents;
                container.style.backgroundColor = container.dataset.originalBg;
                container.style.border = container.dataset.originalBorder;
                container.style.boxShadow = container.dataset.originalBoxShadow;
                container.style.overflow = container.dataset.originalOverflow;

                // Make elements visible again
                topBarElement.style.visibility = 'visible'; mainContentElement.style.visibility = 'visible'; bottomBarElement.style.visibility = 'visible'; resizerElement.style.visibility = 'visible'; // Resizer visibility depends on lock state below

                // Reset hide button style
                hideButton.style.position = ''; hideButton.style.left = ''; hideButton.style.top = ''; hideButton.style.zIndex = '';
                hideButton.style.visibility = 'visible'; hideButton.style.pointerEvents = 'auto';
                hideButton.textContent = "隠す";
                hideButton.classList.remove('ts-hidden-state'); hideButton.classList.add('ts-visible-state');

                // Re-apply lock state which also handles container resize and resizer visibility
                applyLockState();
            }
        } catch(e){ console.error("Apply hidden state error:", e); }
    }
    function populateEditorFromTimestamps() { if (bulkEditor) bulkEditor.value = timestamps.join('\n'); }
    function handleEditorChange() { if (!bulkEditor) return; if (editorChangeTimeout) clearTimeout(editorChangeTimeout); editorChangeTimeout = setTimeout(() => { try { const lines = bulkEditor.value.split('\n'); const newTimestamps = lines.map(l => l.trim()).filter(Boolean); // Trim and filter empty lines immediately
            // Avoid unnecessary updates if content is effectively the same after trimming/filtering
            if (JSON.stringify(timestamps) !== JSON.stringify(newTimestamps)) { timestamps = newTimestamps; saveTimestamps(); if (sortState !== null) { sortState = null; updateSortButtonText(); } renderTimestampList(); } } catch(e){ console.error("Handle editor change error:", e); } }, EDITOR_DEBOUNCE_MS); }
    function renderTimestampList() { if (!displayListElement) { displayListElement = document.getElementById("timestamp-display-list"); if (!displayListElement) return; } try { displayListElement.textContent = ''; // Clear previous list
            const validTimestamps = timestamps.map(String).filter(Boolean); // Ensure working with current, valid timestamps
            let itemsToRender = [];

            if (sortState !== null) { // Sorting is enabled
                itemsToRender = validTimestamps
                    .map((t, originalIndex) => ({ text: t, time: parseTimeToSeconds(t), originalIndex: originalIndex }))
                    .sort((a, b) => {
                        const timeA = a.time;
                        const timeB = b.time;
                        // Primary sort: by time
                        if (timeA !== null && timeB !== null) {
                            return sortState ? timeA - timeB : timeB - timeA; // Ascending (true) or Descending (false)
                        }
                        // Secondary sort: entries without time vs entries with time
                        if (timeA === null && timeB !== null) return sortState ? 1 : -1; // No time comes after (asc) or before (desc)
                        if (timeA !== null && timeB === null) return sortState ? -1 : 1; // Time comes before (asc) or after (desc)
                        // Tertiary sort: entries without time keep relative original order
                        return sortState ? a.originalIndex - b.originalIndex : b.originalIndex - a.originalIndex;
                    });
            } else { // No sorting, use original order
                itemsToRender = validTimestamps.map((t, originalIndex) => ({ text: t, originalIndex: originalIndex }));
            }

            if (itemsToRender.length === 0) {
                const emptyGuide = document.createElement('div');
                emptyGuide.className = 'ts-empty-guide';
                emptyGuide.textContent = "記録はありません";
                displayListElement.appendChild(emptyGuide);
                return;
            }

            const fragment = document.createDocumentFragment();
            itemsToRender.forEach(itemData => {
                // Pass the ORIGINAL index to createTimestampListItem so delete/adjust works correctly
                const listItem = createTimestampListItem(itemData.text, itemData.originalIndex);
                if (listItem) {
                    fragment.appendChild(listItem);
                }
            });
            displayListElement.appendChild(fragment);
        } catch (e) {
            showErrorMessage("リスト表示エラー。"); console.error("Render list error:", e);
            if (displayListElement) { displayListElement.textContent=''; const el = document.createElement('li'); el.textContent='リスト表示エラー'; el.style.cssText='color:red;padding:10px;text-align:center;'; displayListElement.appendChild(el); }
        }
    }
    function createTimestampListItem(txt, originalIndex) { // Takes originalIndex
        try {
            const li = document.createElement("li"); li.className = "ts-list-item";
            // Store the original index from the main timestamps array
            li.dataset.originalIndex = originalIndex;

            const itemContainer = document.createElement("div"); itemContainer.className = "ts-item-container";
            const hasValidTime = TIME_REGEX.test(txt);
            const buttons = [];

            if (hasValidTime) {
                const jumpIcon = document.createElement("span"); jumpIcon.textContent = "▶️"; jumpIcon.className = "ts-jump-icon"; jumpIcon.title = "クリックでジャンプ";
                jumpIcon.onclick = e => { e.stopPropagation(); jumpToTimestamp(txt); };
                buttons.push(jumpIcon);

                const minusButton = document.createElement("button"); minusButton.textContent = "-1s"; minusButton.className = "ts-adjust-button ts-minus-button ts-action-button";
                minusButton.onclick = e => { e.stopPropagation(); adjustTimestamp(originalIndex, -1); }; // Use originalIndex
                buttons.push(minusButton);

                const plusButton = document.createElement("button"); plusButton.textContent = "+1s"; plusButton.className = "ts-adjust-button ts-plus-button ts-action-button";
                plusButton.onclick = e => { e.stopPropagation(); adjustTimestamp(originalIndex, 1); }; // Use originalIndex
                buttons.push(plusButton);
            }

            const deleteButton = document.createElement("button"); deleteButton.textContent = "削除"; deleteButton.className = "ts-delete-button ts-action-button";
            deleteButton.onclick = e => { e.stopPropagation(); deleteTimestamp(originalIndex); }; // Use originalIndex
            buttons.push(deleteButton);

            const displayContainer = document.createElement("div"); displayContainer.className = "ts-display-container";
            const displayText = document.createElement("div"); displayText.className = "ts-display-text";
            displayText.textContent = txt;
            displayText.title = `Ctrl+クリックでジャンプ / 右クリックメニュー`;
            displayText.onclick = e => { e.stopPropagation(); if ((e.ctrlKey || e.metaKey) && hasValidTime) jumpToTimestamp(txt); };
            displayText.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); showTimestampContextMenu(e, txt, displayText); };

            itemContainer.append(...buttons);
            displayContainer.appendChild(displayText);
            itemContainer.appendChild(displayContainer);
            li.appendChild(itemContainer);
            return li;
        } catch (e) { console.error("Create list item error:", e); return null; }
    }
    function showTimestampContextMenu(e, ts, el) { closeExistingContextMenu(); try { const m = document.createElement('div'); m.id = 'timestamp-context-menu'; m.className = 'ts-context-menu'; const mw=160, mh=80; const px = (e.clientX+mw > window.innerWidth) ? window.innerWidth-mw-5 : e.clientX+2; const py = (e.clientY+mh > window.innerHeight) ? e.clientY-mh-2 : e.clientY+2; m.style.left = `${px}px`; m.style.top = `${py}px`; const is = 'ts-context-menu-item'; const ct = el?.textContent || ts; if (TIME_REGEX.test(String(ct))) { const jo = document.createElement('div'); jo.textContent = 'タイムラインジャンプ'; jo.className = is; jo.onclick = () => { jumpToTimestamp(ct); closeExistingContextMenu(); }; m.appendChild(jo); } const co = document.createElement('div'); co.textContent = 'コピー'; co.className = is; co.onclick = () => { copySingleTimestamp(ct); closeExistingContextMenu(); }; m.appendChild(co); document.body.appendChild(m); contextMenuCloseListener = ev => { const me = document.getElementById('timestamp-context-menu'); if (me && !me.contains(ev.target)) closeExistingContextMenu(); }; setTimeout(() => { document.addEventListener('click', contextMenuCloseListener, { capture: true, once: true }); document.addEventListener('contextmenu', contextMenuCloseListener, { capture: true, once: true }); }, 0); } catch (err) { console.error("Show context menu error:", err); } }
    function closeExistingContextMenu() { try { const m = document.getElementById('timestamp-context-menu'); if (m) m.remove(); if (contextMenuCloseListener) { document.removeEventListener('click', contextMenuCloseListener, { capture: true }); document.removeEventListener('contextmenu', contextMenuCloseListener, { capture: true }); contextMenuCloseListener = null; } } catch (e) { console.error("Close context menu error:", e); } }
    function addStyles() { const id = 'timestamp-styles-v11.22-ui'; if (document.getElementById(id)) return; const css = `:root{--ts-font-size-base:15px;--ts-font-size-small:13px;--ts-font-size-large:17px;--ts-primary-blue:#3498db;--ts-primary-green:#2ecc71;--ts-primary-red:#e74c3c;--ts-primary-orange:#f39c12;--ts-primary-grey:#95a5a6;--ts-text-dark:#333;--ts-text-light:#f8f8f8;--ts-border-color:#a0a0a0;--ts-resizer-color:#ccc;--ts-primary-copy-blue:#5dade2;--ts-primary-copy-blue-dark:#2e86c1;--ts-lock-red:#e74c3c;--ts-lock-red-dark:#c0392b}.ts-container{position:fixed; /* Changed to fixed */ z-index:9998;display:flex;flex-direction:column;background:rgba(245,245,245,.97);border:1px solid var(--ts-border-color);border-radius:6px;box-shadow:0 4px 15px rgba(0,0,0,.25);user-select:none;resize:both;overflow:hidden;min-width:550px;min-height:350px;font-size:var(--ts-font-size-base);color:var(--ts-text-dark);pointer-events:auto}.ts-container.ts-locked{resize:none!important}.ts-top-bar{display:flex;align-items:center;justify-content:space-between;padding:7px 12px;gap:14px;background:#e8e8e8;border-bottom:1px solid #ccc;flex-shrink:0;cursor:move}.ts-top-bar.ts-locked{cursor:default}.ts-time-display{padding:6px 14px;background:rgba(40,40,40,.9);color:var(--ts-text-light);border:1px solid rgba(255,255,255,.15);border-radius:4px;font-size:var(--ts-font-size-small);font-weight:700;text-align:center;text-shadow:1px 1px 2px rgba(0,0,0,.6);margin:0;flex-shrink:0}.ts-record-button{padding:8px 20px;background:linear-gradient(to bottom,#5dade2,var(--ts-primary-blue));color:#fff;border:1px solid #258cd1;box-shadow:0 2px 4px rgba(0,0,0,.2),inset 0 1px 1px rgba(255,255,255,.25);cursor:pointer;font-size:var(--ts-font-size-base);font-weight:700;border-radius:5px;transition:all .15s ease;text-shadow:1px 1px 1px rgba(0,0,0,.3);margin:0;flex-shrink:0}.ts-record-button:hover{background:linear-gradient(to bottom,#6ebef0,#3ea0e0);box-shadow:0 3px 6px rgba(0,0,0,.25),inset 0 1px 1px rgba(255,255,255,.25)}.ts-record-button:active{background:linear-gradient(to top,#5dade2,var(--ts-primary-blue));transform:scale(.97);box-shadow:inset 0 2px 3px rgba(0,0,0,.25)}#ts-main-content{display:flex;flex-grow:1;width:100%;overflow:hidden;background:#fdfdfd}#ts-editor-pane{flex-basis:45%;flex-shrink:1;flex-grow:1;display:flex;flex-direction:column;padding:10px;min-width:${MIN_PANE_WIDTH}px;overflow:hidden;position:relative;background-color:#fdfdfd}#ts-display-pane{flex-basis:55%;flex-shrink:1;flex-grow:1;display:flex;flex-direction:column;padding:0;margin-left:0; /* No margin */ box-sizing:border-box;min-width:${MIN_PANE_WIDTH}px;overflow:hidden;background-color:#fff}#ts-pane-resizer{flex:0 0 5px;background-color:var(--ts-resizer-color);cursor:col-resize;border-left:1px solid #bbb;border-right:1px solid #bbb;transition:background-color .2s ease;align-self:stretch}#ts-pane-resizer:hover{background-color:#aaa}#ts-pane-resizer.resizing{background-color:var(--ts-primary-blue)}#ts-editor-pane label{font-size:var(--ts-font-size-small);font-weight:700;color:#555;margin-bottom:6px;display:block;text-align:center;flex-shrink:0}#ts-bulk-editor{flex-grow:1;width:100%;box-sizing:border-box;border:1px solid #c0c0c0;border-radius:4px;padding:10px 12px;font-size:var(--ts-font-size-base);line-height:1.7;font-family:'Segoe UI',Meiryo,Arial,sans-serif;resize:none;outline:none;transition:all .2s ease;background-color:#fff;min-height:100px;overflow-y:auto}#ts-bulk-editor:focus{border-color:var(--ts-primary-blue);box-shadow:0 0 0 2px rgba(52,152,219,.3)}#ts-bulk-editor:read-only{background-color:#f5f5f5;cursor:not-allowed;border-color:#ddd}.ts-display-list-container{display:flex;flex-direction:column;flex-grow:1;background:#fff;border:none;box-shadow:none;overflow:hidden;padding:0 12px}.ts-list-button-bar{display:flex;padding:7px 0;gap:10px;background:#f0f0f0;border-bottom:1px solid #ddd;align-items:center;flex-wrap:nowrap;flex-shrink:0}.ts-list-button{padding:7px 14px;font-size:var(--ts-font-size-small);font-weight:700;border:1px solid;border-radius:4px;cursor:pointer;transition:all .15s ease;white-space:nowrap;text-align:center;box-shadow:0 1px 2px rgba(0,0,0,.1)}.ts-list-button:active{transform:scale(.96);box-shadow:inset 0 1px 2px rgba(0,0,0,.15)}.ts-copy-all-button{flex-grow:1;flex-shrink:1;flex-basis:0;min-width:80px;background:linear-gradient(to bottom,var(--ts-primary-copy-blue),var(--ts-primary-copy-blue-dark));color:#fff;border-color:var(--ts-primary-copy-blue-dark);text-shadow:1px 1px 1px rgba(0,0,0,.2)}.ts-copy-all-button:hover{background:linear-gradient(to bottom,#85c1e9,var(--ts-primary-copy-blue));border-color:#21618c}.ts-sort-button{flex-grow:1;flex-shrink:1;flex-basis:0;min-width:80px;background:linear-gradient(to bottom,#f8c471,var(--ts-primary-orange));color:#fff;border-color:#e67e22;text-shadow:1px 1px 1px rgba(0,0,0,.2)}.ts-sort-button:hover{background:linear-gradient(to bottom,#f9d08a,#f5a623);border-color:#d35400}.ts-delete-all-button{background:linear-gradient(to bottom,#f1948a,var(--ts-primary-red));color:#fff;border:1px solid #d9534f;text-shadow:1px 1px 1px rgba(0,0,0,.2);border-radius:50%;padding:0;font-size:18px;font-weight:700;line-height:30px;width:32px;height:32px;box-sizing:border-box;margin-left:auto;flex-shrink:0}.ts-delete-all-button:hover{background:linear-gradient(to bottom,#f5a79d,#e95c4d);border-color:#c9302c}#timestamp-display-list{list-style-type:none;padding:10px 0;margin:0;flex-grow:1;overflow-y:auto;overflow-x:hidden;background-color:#fff;box-sizing:border-box}.ts-empty-guide{text-align:center;padding:30px 15px;color:#999;font-size:var(--ts-font-size-base);line-height:1.5}.ts-list-item{margin-bottom:8px;padding-bottom:8px;border-bottom:1px dashed #eee;display:flex;align-items:center}.ts-list-item:last-child{border-bottom:none}.ts-item-container{display:flex;align-items:center;flex-wrap:nowrap;width:100%;gap:8px}.ts-jump-icon{margin-right:6px;cursor:pointer;font-size:var(--ts-font-size-large);line-height:1;padding:4px;color:var(--ts-primary-blue);flex-shrink:0;transition:transform .1s ease,color .1s ease}.ts-jump-icon:hover{transform:scale(1.2);color:#2980b9}.ts-action-button{padding:5px 10px;margin:0;border:1px solid;font-weight:700;font-size:12px;border-radius:4px;cursor:pointer;transition:all .15s;flex-shrink:0;line-height:1;box-shadow:0 1px 1px rgba(0,0,0,.05)}.ts-action-button:active{transform:scale(.95);box-shadow:inset 0 1px 1px rgba(0,0,0,.1)}.ts-adjust-button{background-color:#eafaf1;border-color:#abebc6;color:#239b56}.ts-adjust-button:hover{background-color:#d4efdf;border-color:#82e0aa}.ts-delete-button{background-color:#fdedec;border-color:#fadbd8;color:#cb4335}.ts-delete-button:hover{background-color:#fadbd8;border-color:#f1948a}.ts-display-container{flex-grow:1;min-width:120px;margin-left:5px;cursor:default;border:none;background:0 0;overflow:hidden}.ts-display-text{cursor:default;padding:6px 2px;font-size:var(--ts-font-size-base);white-space:normal;overflow-wrap:break-word;word-break:break-all;max-width:100%;line-height:1.6;color:var(--ts-text-dark)}.ts-bottom-bar{display:flex;align-items:center;justify-content:flex-end;padding:7px 12px;gap:12px;background:#e0e0e0;border-top:1px solid #ccc;flex-shrink:0;cursor:move}.ts-bottom-bar.ts-locked{cursor:default}.ts-bottom-controls{display:flex;gap:12px;cursor:default}.ts-bottom-button{padding:8px 18px;font-size:var(--ts-font-size-base);font-weight:700;border:none;cursor:pointer;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,.2);transition:all .15s ease;text-align:center;text-shadow:1px 1px 1px rgba(0,0,0,.15);color:#fff;flex-shrink:0;white-space:nowrap}.ts-bottom-button:active{transform:scale(.97);box-shadow:inset 0 2px 3px rgba(0,0,0,.2)}.ts-lock-button{}.ts-lock-button.ts-unlocked{background:linear-gradient(to bottom,var(--ts-lock-red),var(--ts-lock-red-dark))}.ts-lock-button.ts-unlocked:hover{background:linear-gradient(to bottom,#f1948a,var(--ts-lock-red))}.ts-lock-button.ts-locked{background:linear-gradient(to bottom,#58d68d,var(--ts-primary-green))}.ts-lock-button.ts-locked:hover{background:linear-gradient(to bottom,#6fe09f,#36d97b)}.ts-hide-button{visibility:visible!important;pointer-events:auto!important;cursor:pointer}.ts-hide-button.ts-visible-state{background:linear-gradient(to bottom,#aeb6bf,var(--ts-primary-grey))}.ts-hide-button.ts-visible-state:hover{background:linear-gradient(to bottom,#cacfd6,#aab5c0)}.ts-hide-button.ts-hidden-state{background:linear-gradient(to bottom,#ec7063,var(--ts-primary-red))}.ts-hide-button.ts-hidden-state:hover{background:linear-gradient(to bottom,#f1948a,#e74c3c)}.ts-context-menu{position:fixed;background-color:#fff;border:1px solid #b0b0b0;border-radius:4px;box-shadow:0 3px 10px rgba(0,0,0,.2);z-index:10001;padding:6px 0;min-width:160px;font-size:var(--ts-font-size-base)}.ts-context-menu-item{padding:9px 20px;cursor:pointer;white-space:nowrap;color:#333;transition:background-color .1s ease}.ts-context-menu-item:hover{background-color:#e8f0fe;color:var(--ts-primary-blue)}.ts-modal-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background-color:rgba(0,0,0,0.1); /* Slight overlay */ display:flex;justify-content:center;align-items:center;z-index:10000;pointer-events:auto}.ts-modal-content{background-color:#fff;padding:30px 35px;border:1px solid #ccc;border-radius:8px;box-shadow:0 8px 25px rgba(0,0,0,.3);width:auto;min-width:350px;max-width:500px;text-align:center;pointer-events:auto;position:relative;cursor:move}.ts-modal-message{font-size:var(--ts-font-size-large);font-weight:600;color:var(--ts-primary-red);margin-bottom:35px;line-height:1.6;pointer-events:none}.ts-modal-buttons{display:flex;justify-content:center;gap:20px;cursor:default}.ts-modal-button{padding:11px 25px;font-size:var(--ts-font-size-base);font-weight:700;border:1px solid transparent;cursor:pointer;border-radius:5px;min-width:110px;transition:all .15s ease;box-shadow:0 1px 2px rgba(0,0,0,.1)}.ts-modal-cancel{background-color:#f0f0f0;color:#555;border-color:#c0c0c0}.ts-modal-cancel:hover{background-color:#e5e5e5;border-color:#b0b0b0}.ts-modal-confirm{background-color:var(--ts-primary-red);color:#fff;border-color:#c0392b}.ts-modal-confirm:hover{background-color:#c0392b;border-color:#a93226}.ts-modal-button:active{transform:scale(.97);box-shadow:inset 0 1px 2px rgba(0,0,0,.15)}.ts-modal-button:focus{outline:none;box-shadow:0 0 0 3px rgba(52,152,219,.4)}.ts-message-box{position:fixed;bottom:35px;left:50%;padding:14px 28px;color:#fff;font-size:var(--ts-font-size-base);font-weight:700;border-radius:5px;box-shadow:0 4px 12px rgba(0,0,0,.25);z-index:10002;opacity:0;transition:opacity .4s ease-in-out,transform .4s ease-in-out;text-align:center;max-width:85%;pointer-events:none;transform:translate(-50%,20px)}.ts-message-box.visible{opacity:1;transform:translateX(-50%)}.ts-message-box.fade-out{opacity:0;transform:translate(-50%,20px)}.ts-message-box.success{background-color:var(--ts-primary-green)}.ts-message-box.error{background-color:var(--ts-primary-red)}.ts-message-box.info{background-color:var(--ts-primary-blue)}.ts-message-box.jump{background-color:#733dd8}.ts-tooltip-hint{position:fixed;bottom:25px;right:25px;background-color:rgba(0,0,0,.85);color:#fff;padding:10px 15px;border-radius:4px;font-size:var(--ts-font-size-small);z-index:9999;opacity:0;transition:opacity .5s ease-in-out;pointer-events:none}.ts-tooltip-hint.visible{opacity:1}`;
        const styleSheet = document.createElement("style"); styleSheet.id = id; styleSheet.textContent = css; (document.head || document.body || document.documentElement).appendChild(styleSheet); // More robust append
    }

    // --- REVISED Resize Handler for the whole container ---
    function handleContainerResize(entries) {
        if (isResizingPanes) return; // Ignore if internal pane resize is active

        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            for (let entry of entries) {
                if (entry.target === container && editorPane && displayPane && resizerElement && mainContentElement) {
                    try {
                        const mainW = mainContentElement.clientWidth; // Use main content area width
                        const rW = resizerElement.offsetWidth;
                        const availW = mainW - rW;

                        if (availW <= 2 * MIN_PANE_WIDTH) {
                            // If total width is too small, reset to default flex-basis
                            editorPane.style.width = ''; displayPane.style.width = '';
                            editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
                            localStorage.removeItem('timestampEditorWidth'); // Clear potentially invalid saved width
                             // console.log("Resize too small, reset to defaults");
                            continue; // Next entry
                        }

                        let newEdW = -1; // Sentinel value
                        const savedPx = localStorage.getItem('timestampEditorWidth');

                        // 1. Try using the saved pixel width if it's valid for the *new* available width
                        if (savedPx) {
                            const savedEdW = parseFloat(savedPx);
                            if (!isNaN(savedEdW) && savedEdW >= MIN_PANE_WIDTH && (availW - savedEdW) >= MIN_PANE_WIDTH) {
                                newEdW = savedEdW;
                                // console.log(`Resize using valid saved width: ${newEdW}px`);
                            } else {
                                // Saved value exists but is invalid for this size
                                localStorage.removeItem('timestampEditorWidth');
                                // console.log(`Resize found invalid saved width: ${savedPx}`);
                            }
                        }

                        // 2. If no valid saved width, calculate based on current proportion as fallback
                        if (newEdW < 0) {
                             let currentEdW = editorPane.offsetWidth;
                             let currentDispW = displayPane.offsetWidth;
                             let edProp = (currentEdW > 0 && currentDispW > 0) ? currentEdW / (currentEdW + currentDispW) : 0.45; // Default 45%
                             newEdW = availW * edProp;
                             // console.log(`Resize calculating proportional width: ${newEdW}px`);
                        }

                        // 3. Clamp the final calculated/retrieved width and derive the other pane's width
                        newEdW = Math.max(MIN_PANE_WIDTH, Math.min(newEdW, availW - MIN_PANE_WIDTH));
                        let newDispW = availW - newEdW; // Calculate display width based on final editor width

                        // 4. Apply the calculated pixel widths
                        editorPane.style.width = `${newEdW}px`;
                        displayPane.style.width = `${newDispW}px`;
                        editorPane.style.flexBasis = ''; // Let explicit width rule
                        displayPane.style.flexBasis = ''; // Let explicit width rule

                        // 5. IMPORTANT: If we used proportion, update the saved width for next time
                        if (savedPx && parseFloat(savedPx) !== newEdW) {
                            localStorage.setItem('timestampEditorWidth', `${newEdW}px`);
                           // console.log(`Resize updated saved width to: ${newEdW}px`);
                        }


                    } catch (e) {
                        console.error("Error handling container resize:", e);
                         // Fallback in case of error during calculation
                         editorPane.style.width = ''; displayPane.style.width = '';
                         editorPane.style.flexBasis = '45%'; displayPane.style.flexBasis = '55%';
                    }
                }
            }
            // Save container dimensions after handling resize batch
            // Avoid saving editor width here, it's handled by pruh or updated above if needed
             if (!isResizingPanes) {
                 saveContainerPosition(); // Saves container pos/size, maybe editor width if set
             }

        }, RESIZE_DEBOUNCE_MS); // Use debouncing
    }

    function initializeUI() {
        const id = 'ts-container-main';
        const old = document.getElementById(id); if (old) old.remove();
        if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e){} containerResizeObserver = null; }
        try {
            addStyles();
            container = document.createElement("div"); container.className="ts-container"; container.id=id;
            topBarElement=document.createElement("div"); topBarElement.className="ts-top-bar";
            currentTimeDisplay=document.createElement("div"); currentTimeDisplay.id="ts-current-time"; currentTimeDisplay.className="ts-time-display"; currentTimeDisplay.textContent="読み込み中...";
            recordBtn=document.createElement("button"); recordBtn.id="ts-record-button"; recordBtn.className="ts-record-button"; recordBtn.textContent="現在時刻を記録";
            mainContentElement=document.createElement("div"); mainContentElement.id="ts-main-content";
            editorPane=document.createElement("div"); editorPane.id="ts-editor-pane";
            const el=document.createElement("label"); el.htmlFor="ts-bulk-editor"; el.textContent="タイムスタンプ編集";
            bulkEditor=document.createElement("textarea"); bulkEditor.id="ts-bulk-editor"; bulkEditor.placeholder="例:\n0:15:30 開始\n1:25:00 曲名 [01]\n...";
            resizerElement=document.createElement("div"); resizerElement.id="ts-pane-resizer";
            displayPane=document.createElement("div"); displayPane.id="ts-display-pane";
            displayListContainer=document.createElement("div"); displayListContainer.className="ts-display-list-container";
            const lbb=document.createElement("div"); lbb.className="ts-list-button-bar";
            const cab=document.createElement("button"); cab.textContent="全コピー"; cab.title="左パネルの内容をコピー"; cab.className="ts-list-button ts-copy-all-button";
            const sb=document.createElement("button"); sb.id="ts-sort-button"; sb.title="右パネルの表示順を切替"; sb.className="ts-list-button ts-sort-button";
            const dab=document.createElement("button"); dab.textContent="✕"; dab.title="すべて削除"; dab.className="ts-list-button ts-delete-all-button";
            displayListElement=document.createElement("ul"); displayListElement.id="timestamp-display-list";
            bottomBarElement=document.createElement("div"); bottomBarElement.className="ts-bottom-bar";
            const bc=document.createElement("div"); bc.className="ts-bottom-controls";
            lockButton=document.createElement("button"); lockButton.id="ts-lock-button"; lockButton.className="ts-bottom-button ts-lock-button";
            hideButton=document.createElement("button"); hideButton.id="ts-hide-button"; hideButton.className="ts-bottom-button ts-hide-button";

            // Assemble the structure
            topBarElement.append(currentTimeDisplay, recordBtn);
            editorPane.append(el, bulkEditor);
            lbb.append(cab, sb, dab);
            displayListContainer.append(lbb, displayListElement);
            displayPane.append(displayListContainer);
            mainContentElement.append(editorPane, resizerElement, displayPane); // Resizer between panes
            bc.append(lockButton, hideButton);
            bottomBarElement.append(bc);
            container.append(topBarElement, mainContentElement, bottomBarElement);

            // Append to body (ensure body exists)
            if (!document.body) throw Error("Document body not found during UI initialization");
            document.body.appendChild(container);

            // --- Initial Positioning and State Application (using rAF) ---
            const sp = loadContainerPosition();
            container.style.left=sp.left;
            container.style.top=sp.top;
            container.style.width=sp.width;
            container.style.height=sp.height;

            requestAnimationFrame(() => { // Defer state application until after initial render
                if (!container) return; // Check if container still exists
                try {
                    const cs = window.getComputedStyle(container);
                    container.dataset.originalBg = cs.backgroundColor || 'rgba(240, 240, 240, 0.95)';
                    container.dataset.originalBorder = cs.border || '1px solid #a0a0a0';
                    container.dataset.originalBoxShadow = cs.boxShadow || '0 4px 12px rgba(0,0,0,0.2)';
                    container.dataset.originalPointerEvents = cs.pointerEvents || 'auto';
                    container.dataset.originalOverflow = cs.overflow || 'hidden';
                    container.dataset.originalResize = cs.resize || 'both';
                    container.dataset.originalMinWidth = cs.minWidth || '550px';
                    container.dataset.originalMinHeight = cs.minHeight || '350px';

                    // Load data (timestamps etc.) and apply states
                    loadState(); // Loads data, calls applySavedPaneWidths internally at the right time
                    applyLockState();
                    applyHiddenState(); // Apply hidden state based on loaded value
                    startCurrentTimeUpdate();
                    showTooltipHint(); // Show hint if first time user

                } catch(e) {
                     console.error("Error during post-render state application:", e);
                     showErrorMessage("UI状態の適用中にエラー発生");
                }
            });
            // --- End of Initial Positioning and State Application ---


            // --- Event Listeners ---
            updateSortButtonText(); // Okay to call early
            recordBtn.onclick=recordTimestamp;
            cab.onclick=copyAllTimestamps;
            sb.onclick=toggleSortOrder;
            dab.onclick=e=>{e.stopPropagation();e.preventDefault();showConfirmDeleteAllModal();};
            lockButton.onclick=toggleLock;
            hideButton.onclick=toggleVisibility;
            bulkEditor.addEventListener('input', handleEditorChange);
            bulkEditor.addEventListener('keydown', e => {
                 // Allow default tab behavior (accessibility)
                 if (e.key === 'Tab') return;
                 // Prevent Enter from creating newline if needed (optional)
                 // if(e.key === 'Enter') { e.preventDefault(); }
            });

            // Container Drag Logic (Top/Bottom Bars)
            const addDrag=(el)=>{let sx,sy,il,it; const mm=me=>{if(!isDraggingContainer||isResizingPanes||!container)return; if(rafDragId)cancelAnimationFrame(rafDragId); rafDragId=requestAnimationFrame(()=>{if(!isDraggingContainer||isResizingPanes||!container)return; const cx=me.clientX,cy=me.clientY; container.style.left=`${il+(cx-sx)}px`; container.style.top=`${it+(cy-sy)}px`; rafDragId=null;});}; const mu=()=>{if(rafDragId)cancelAnimationFrame(rafDragId);rafDragId=null; if(isDraggingContainer){isDraggingContainer=false; document.body.style.cursor='';document.body.style.userSelect=''; saveContainerPosition(); document.removeEventListener('mousemove',mm); document.removeEventListener('mouseup',mu);}}; el.addEventListener('mousedown',e=>{ /* Check target to allow clicking buttons inside bar */ if(e.target !== el){let t=e.target;while(t&&t!==el){if(t.tagName==='BUTTON'||t.classList.contains('ts-bottom-controls')||t.classList.contains('ts-time-display'))return; t=t.parentElement;}} if(isLocked||e.button!==0||isResizingPanes||isDraggingFromHideButton||!container)return; isDraggingContainer=true; const r=container.getBoundingClientRect(); sx=e.clientX;sy=e.clientY;il=r.left;it=r.top; document.body.style.cursor='move';document.body.style.userSelect='none'; document.addEventListener('mousemove',mm); document.addEventListener('mouseup',mu,{once:true,capture:true}); e.preventDefault();});};
            addDrag(topBarElement);
            addDrag(bottomBarElement);


            // --- Pane Resizer Drag Logic (MODIFIED) ---
            const prmh = e => { // Pane Resize Mouse Move Handler
                if (!isResizingPanes || !editorPane || !displayPane || !resizerElement || !mainContentElement) return;
                const mainContentRect = mainContentElement.getBoundingClientRect();
                const totalW = mainContentRect.width - resizerElement.offsetWidth;
                if (totalW <= 0) return;
                const dx = e.clientX - resizeStartX;
                let newEdW = startEditorWidth + dx;
                newEdW = Math.max(MIN_PANE_WIDTH, Math.min(newEdW, totalW - MIN_PANE_WIDTH));
                let newDispW = totalW - newEdW;

                if (rafDragId) cancelAnimationFrame(rafDragId);
                rafDragId = requestAnimationFrame(() => {
                    if (!isResizingPanes || !editorPane || !displayPane) return;
                    editorPane.style.flexGrow = '0'; editorPane.style.flexShrink = '0'; editorPane.style.flexBasis = 'auto'; editorPane.style.width = `${newEdW}px`;
                    displayPane.style.flexGrow = '0'; displayPane.style.flexShrink = '0'; displayPane.style.flexBasis = 'auto'; displayPane.style.width = `${newDispW}px`;
                    rafDragId = null;
                });
            };
            const pruh = () => { // Pane Resize Mouse Up Handler
                if (rafDragId) { cancelAnimationFrame(rafDragId); rafDragId = null; }
                if (!isResizingPanes) return;
                isResizingPanes = false; // Set state BEFORE saving position
                document.removeEventListener('mousemove', prmh);
                document.removeEventListener('mouseup', pruh);
                document.body.style.cursor = ''; document.body.style.userSelect = '';
                if (resizerElement) resizerElement.classList.remove('resizing');

                if (editorPane) { editorPane.style.flexGrow = ''; editorPane.style.flexShrink = ''; editorPane.style.flexBasis = ''; }
                if (displayPane) { displayPane.style.flexGrow = ''; displayPane.style.flexShrink = ''; displayPane.style.flexBasis = ''; }

                // Save final position AND the explicit editor width (in pixels)
                saveContainerPosition();
            };
            resizerElement.addEventListener('mousedown', e => {
                if (isLocked || e.button !== 0 || !editorPane || !displayPane || !mainContentElement) return;
                isResizingPanes = true; // Set state immediately
                resizeStartX = e.clientX;
                startEditorWidth = editorPane.offsetWidth; // Get current pixel width
                startDisplayWidth = displayPane.offsetWidth;
                document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
                if (resizerElement) resizerElement.classList.add('resizing');
                document.addEventListener('mousemove', prmh);
                document.addEventListener('mouseup', pruh, { once: true });
                e.preventDefault();
            });
            // --- END OF RESIZER DRAG LOGIC ---


            // Hide Button Drag Logic (allows moving container via hide button)
            hideButton.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                e.stopPropagation(); // Prevent container drag starting from button
                dragStartTime = Date.now();
                isDraggingFromHideButton = false; // Track if threshold is met
                hideButtonDragged = false; // Track if it was actually dragged vs clicked
                const startX = e.clientX, startY = e.clientY;
                const buttonRect = hideButton.getBoundingClientRect();
                const initialButtonLeft = buttonRect.left;
                const initialButtonTop = buttonRect.top;
                const containerRect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
                const initialContainerLeft = containerRect.left;
                const initialContainerTop = containerRect.top;

                const hmm = me => { // Hide button Move Mouse Handler
                    const deltaX = me.clientX - startX;
                    const deltaY = me.clientY - startY;
                    const distance = Math.sqrt(deltaX*deltaX + deltaY*deltaY);

                    if (!isDraggingFromHideButton && (distance > DRAG_MOVE_THRESHOLD || Date.now() - dragStartTime > DRAG_THRESHOLD)) {
                        isDraggingFromHideButton = true; // Start dragging state
                        hideButtonDragged = true; // Mark as dragged (prevents click action on mouseup)
                        document.body.style.cursor = 'move';
                        document.body.style.userSelect = 'none';
                        // If hidden, ensure button is fixed positioned before dragging starts
                        if (isHidden) { hideButton.style.position = 'fixed'; }
                    }

                    if (isDraggingFromHideButton) { // Only move if dragging state is active
                        if (rafDragId) cancelAnimationFrame(rafDragId);
                        rafDragId = requestAnimationFrame(() => {
                            if (!isDraggingFromHideButton) return; // Check again in rAF

                            let newLeft, newTop;
                            if (isHidden) {
                                // Drag the fixed button directly
                                newLeft = initialButtonLeft + deltaX;
                                newTop = initialButtonTop + deltaY;
                                hideButton.style.left = `${newLeft}px`;
                                hideButton.style.top = `${newTop}px`;
                                // Also move the invisible container passively
                                if (container) {
                                    container.style.left = `${initialContainerLeft + deltaX}px`;
                                    container.style.top = `${initialContainerTop + deltaY}px`;
                                }
                            } else {
                                // Drag the container, button moves with it
                                if (container) {
                                    newLeft = initialContainerLeft + deltaX;
                                    newTop = initialContainerTop + deltaY;
                                    container.style.left = `${newLeft}px`;
                                    container.style.top = `${newTop}px`;
                                }
                            }
                            rafDragId = null;
                        });
                    }
                };

                const hmu = ue => { // Hide button Mouse Up Handler
                    if (rafDragId) { cancelAnimationFrame(rafDragId); rafDragId = null; }
                    document.removeEventListener('mousemove', hmm);
                    document.removeEventListener('mouseup', hmu, { capture: true });
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';

                    const wasDragging = isDraggingFromHideButton;
                    isDraggingFromHideButton = false; // Reset state

                    if (wasDragging) {
                        // Save position only if dragging actually occurred
                         if (isHidden && hideButton) {
                             // Save the final fixed position of the button
                             const finalRect = hideButton.getBoundingClientRect();
                              if (finalRect.left > 0 || finalRect.top > 0) {
                                 hideButtonLastViewportPos = { left: finalRect.left, top: finalRect.top };
                                 localStorage.setItem('timestampHideButtonPos', JSON.stringify(hideButtonLastViewportPos));
                              }
                         }
                        saveContainerPosition(); // Save container pos + maybe editor width

                        // Prevent the click action (toggleVisibility) if dragging occurred
                        ue.preventDefault();
                        ue.stopPropagation();
                    }
                    // If not dragging, the normal click event will fire toggleVisibility
                };

                document.addEventListener('mousemove', hmm);
                document.addEventListener('mouseup', hmu, { once: true, capture: true });
            });


            // Setup ResizeObserver after elements exist
            if ('ResizeObserver' in window && container) {
                 try {
                     containerResizeObserver = new ResizeObserver(handleContainerResize);
                     containerResizeObserver.observe(container);
                 } catch (e) { console.error("Failed to initialize ResizeObserver:", e); containerResizeObserver = null; }
             } else { console.warn("ResizeObserver not supported or container not found."); }


        } catch (uiError) {
            showErrorMessage("スクリプトUIの読み込みに失敗しました！ "+uiError.message);
            console.error("UI Initialization Error:", uiError);
            if (container?.parentNode) container.remove(); container = null; // Clean up partial UI
            if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e){} containerResizeObserver = null; }
        }
    } // End of initializeUI

    let initRetryCount = 0; const MAX_INIT_RETRIES = 10;
    function runInitialization() {
        if (document.getElementById('ts-container-main')) { /* console.log("Already initialized."); */ initRetryCount = 0; return; }
        if (initRetryCount >= MAX_INIT_RETRIES) { showErrorMessage("スクリプトの初期化がタイムアウトしました！ページを再読み込みしてみてください。"); console.error("Initialization timed out."); initRetryCount = 0; return; }

        const videoElement = document.querySelector('video');
        const playerElement = document.getElementById('movie_player');
        const playerApiReady = playerElement && typeof playerElement.getCurrentTime === 'function' && typeof playerElement.seekTo === 'function';
        const videoReady = videoElement && typeof videoElement.currentTime === 'number' && videoElement.readyState >= 1; // readyState >= 1 means metadata loaded

        if (!videoReady || !playerApiReady) {
            initRetryCount++;
            console.log(`Initialization check failed (${initRetryCount}/${MAX_INIT_RETRIES}). VideoReady: ${videoReady}, PlayerApiReady: ${playerApiReady}. Retrying...`);
            setTimeout(runInitialization, 1500 + initRetryCount * 100);
            return;
        }

        console.log("Video and Player API ready. Initializing UI...");
        initRetryCount = 0; // Reset counter on success condition met
        try {
            initializeUI();
            if (!document.getElementById('ts-container-main')) {
                 showErrorMessage("UIの追加に失敗しました（要素が見つかりません）。");
                 console.error("UI initialization called but main container not found afterwards.");
            }
        } catch (e) {
            showErrorMessage("スクリプトの初期化中にエラーが発生しました！ "+e.message);
            console.error("Initialization Error:", e);
        }
    }

    let lastUrl = location.href;
    // Observe URL changes for SPA navigation
    const observerCallback = (mutationsList, observerInstance) => {
        const currentUrl = location.href;
        if (currentUrl !== lastUrl) {
            console.log("URL changed from", lastUrl, "to", currentUrl);
            lastUrl = currentUrl;

            // --- Cleanup previous instance ---
            stopCurrentTimeUpdate();
            closeExistingContextMenu();
            if (editorChangeTimeout) clearTimeout(editorChangeTimeout); editorChangeTimeout = null;
            if (resizeTimeout) clearTimeout(resizeTimeout); resizeTimeout = null;
            if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId = null;
            if (rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId = null;
            if (messageTimeoutId) { clearTimeout(messageTimeoutId); messageTimeoutId = null; }
            if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e){} containerResizeObserver = null; }

            const oldContainer = document.getElementById('ts-container-main');
            if (oldContainer) oldContainer.remove();

            // Reset state variables
            container=recordBtn=lockButton=hideButton=editorPane=displayPane=bulkEditor=displayListContainer=displayListElement=currentTimeDisplay=topBarElement=bottomBarElement=mainContentElement=resizerElement=null;
            timestamps=[]; isDraggingContainer=false; isDraggingFromHideButton=false; hideButtonDragged=false; isResizingPanes=false; initRetryCount=0; sortState=null; isLocked=false; isHidden=false; // Reset lock/hide state too

            // --- Initialize for new page if it's a watch page ---
            if (currentUrl.includes('/watch?v=')) {
                console.log("Watch page detected, starting initialization...");
                // Delay slightly to allow YouTube's player to potentially initialize
                setTimeout(runInitialization, 1500);
            } else {
                 console.log("Not a watch page, skipping initialization.");
            }
        }
    };

    // Start observing
    const pageManager = document.querySelector('ytd-page-manager');
    if (pageManager) {
        observer = new MutationObserver(observerCallback);
        observer.observe(pageManager, { childList: true, subtree: true });
        console.log("MutationObserver attached to ytd-page-manager.");
    } else {
        showErrorMessage("監視ターゲット(ytd-page-manager)が見つかりません！ページナビゲーションの検出が機能しない可能性があります。");
        console.error("Target node 'ytd-page-manager' not found for MutationObserver!");
         // Fallback: Listen to popstate for back/forward navigation, though less reliable for SPA
         window.addEventListener('popstate', () => {
             if (location.href !== lastUrl) {
                 observerCallback(null, null); // Manually trigger the check
             }
         });
    }

    function showTooltipHint() { if (firstTimeUser && !document.getElementById('ts-tooltip-hint') && document.body) { const tt = document.createElement('div'); tt.id = 'ts-tooltip-hint'; tt.className = 'ts-tooltip-hint'; tt.textContent = 'ヒント: 左パネルで編集、右パネルでCtrl+クリックジャンプ / 右クリックメニュー'; document.body.appendChild(tt); setTimeout(() => tt.classList.add('visible'), 100); setTimeout(() => { if (!tt.parentNode) return; tt.classList.remove('visible'); tt.addEventListener('transitionend', () => {if (tt.parentNode) tt.remove();}, { once: true }); setTimeout(() => { if (tt.parentNode) tt.remove(); }, 600); }, 8000); } }

    // Initial load check
    function initialStart() {
        // Check if we are on a watch page on initial load
        if (location.href.includes('/watch?v=')) {
             console.log("Initial load on a watch page. Starting initialization checks.");
            runInitialization();
        } else {
             console.log("Initial load not on a watch page.");
        }
    }

    // Start initialization logic based on document state
    if (document.readyState === 'complete') {
        initialStart();
    } else {
        window.addEventListener('load', initialStart, { once: true });
    }

    // Cleanup on unload
    window.addEventListener('beforeunload', () => {
        console.log("Cleaning up before unload...");
        stopCurrentTimeUpdate();
        if (observer) observer.disconnect(); observer=null;
        if (containerResizeObserver) { try { containerResizeObserver.disconnect(); } catch(e){} containerResizeObserver=null; }
        if (editorChangeTimeout) clearTimeout(editorChangeTimeout); editorChangeTimeout=null;
        if (currentTimeInterval) clearInterval(currentTimeInterval); currentTimeInterval=null;
        if (resizeTimeout) clearTimeout(resizeTimeout); resizeTimeout=null;
        if (rafDragId) cancelAnimationFrame(rafDragId); rafDragId=null;
        if (rafModalDragId) cancelAnimationFrame(rafModalDragId); rafModalDragId=null;
        if (messageTimeoutId) clearTimeout(messageTimeoutId); messageTimeoutId=null;
        closeExistingContextMenu();
        // Save final positions/state before leaving
        saveContainerPosition();
    });

})();
