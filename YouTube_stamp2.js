// ==UserScript==
// @name         YouTube 時間標記助手 (完整修正版)
// @namespace    http://tampermonkey.net/
// @version      4.93
// @description  時間標記工具，完整保留編輯區內容，修正大小保存和按鈕位置問題
// @author       You
// @match        *://www.youtube.com/watch*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // 讀取保存的狀態
    const savedState = GM_getValue('panelState', {
        minimized: false,
        left: 'calc(100vw - 60px)',
        top: '80px',
        width: '600px',
        height: '500px',
        inputText: '',
        nextIndex: 1
    });

    // 讀取保存的標記數據
    let savedMarkers = GM_getValue('timeMarkers', []);

    const init = () => {
        if (document.querySelector('video')) {
            createUI();
        } else {
            setTimeout(init, 500);
        }
    };

    if (document.readyState === 'complete') {
        init();
    } else {
        window.addEventListener('load', init);
    }

    function createUI() {
        const oldContainer = document.getElementById('yt-time-marker');
        if (oldContainer) oldContainer.remove();

        const style = document.createElement('style');
        style.textContent = `
            #yt-time-marker {
                position: fixed;
                left: ${savedState.left};
                top: ${savedState.top};
                width: ${savedState.width};
                height: ${savedState.height};
                min-width: 500px;
                min-height: 400px;
                max-width: 80vw;
                max-height: 80vh;
                background: white;
                border-radius: 8px;
                box-shadow: 0 0 10px rgba(0,0,0,0.2);
                z-index: 9999;
                font-family: 'Roboto', Arial, sans-serif;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                cursor: default;
                resize: both;
                font-size: 18px;
            }
            #yt-time-marker.minimized {
                width: 40px !important;
                height: 40px !important;
                min-width: 40px;
                min-height: 40px;
                overflow: hidden;
                background: transparent;
                box-shadow: none;
                resize: none;
                border: none;
            }
            #yt-time-marker.minimized *:not(#toggle-minimize) {
                display: none !important;
            }
            #toggle-minimize {
                position: absolute;
                width: 30px;
                height: 30px;
                background: #ff0000;
                color: white;
                border: none;
                border-radius: 10px;
                font-size: 20px;
                cursor: pointer;
                z-index: 10001;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 0 5px rgba(0,0,0,0.3);
                right: 5px;
                top: 5px;
                margin: 0;
                min-width: 30px;
            }
            #toggle-minimize:hover {
                background: #cc0000;
            }
            .panel-content {
                display: flex;
                flex: 1;
                overflow: hidden;
                min-height: 0;
            }
            .input-section {
                width: 60%;
                min-width: 300px;
                padding: 15px;
                border-right: 1px solid #eee;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .display-section {
                width: 40%;
                min-width: 200px;
                padding: 15px;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            #marker-input {
                width: 100%;
                height: 100px;
                padding: 10px;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 18px;
                resize: vertical;
                margin-bottom: 10px;
                flex-shrink: 0;
            }
            #current-time-display {
                margin-bottom: 10px;
                padding: 8px;
                background: #f9f9f9;
                border-radius: 4px;
                text-align: center;
                font-weight: bold;
                font-size: 18px;
            }
            .marker-controls {
                display: flex;
                gap: 8px;
                margin-top: 10px;
                flex-shrink: 0;
            }
            #add-marker {
                background: #ff0000;
                color: white;
                border: none;
                border-radius: 4px;
                padding: 8px 15px;
                cursor: pointer;
                font-weight: bold;
                flex: 1;
                font-size: 18px;
            }
            #current-time {
                background: #f1f1f1;
                border: none;
                border-radius: 4px;
                padding: 8px;
                cursor: pointer;
                width: 100px;
                font-size: 18px;
            }
            #clear-all {
                background: #f1f1f1;
                border: none;
                border-radius: 4px;
                padding: 8px;
                cursor: pointer;
                width: 100px;
                font-size: 18px;
            }
            #marker-list {
                flex: 1;
                overflow-y: auto;
                padding-right: 5px;
                min-height: 0;
                margin-top: 10px;
            }
            .marker-item {
                padding: 12px 0;
                border-bottom: 1px solid #f5f5f5;
                display: flex;
                align-items: center;
                position: relative;
                font-size: 18px;
            }
            .marker-time {
                color: #ff0000;
                font-weight: bold;
                margin-right: 12px;
                cursor: pointer;
                min-width: 90px;
                font-size: 18px;
            }
            .marker-time.plain-text {
                color: #333;
                cursor: default;
            }
            .marker-text {
                flex: 1;
                word-break: break-word;
                font-size: 18px;
                padding: 5px;
                border: 1px solid transparent;
                border-radius: 3px;
            }
            .marker-text:focus {
                border-color: #ddd;
                background: #fff;
                outline: none;
            }
            .marker-actions {
                display: flex;
                gap: 5px;
                margin-left: 10px;
            }
            .marker-edit, .marker-delete {
                background: none;
                border: none;
                cursor: pointer;
                font-size: 18px;
                color: #666;
                padding: 2px 5px;
            }
            .marker-edit:hover, .marker-delete:hover {
                color: #ff0000;
            }
            .resize-handle {
                bottom: 0;
                right: 0;
                width: 15px;
                height: 15px;
                background: #ddd;
                cursor: nwse-resize;
                z-index: 10000;
            }
            ::-webkit-scrollbar {
                width: 8px;
            }
            ::-webkit-scrollbar-track {
                background: #f1f1f1;
            }
            ::-webkit-scrollbar-thumb {
                background: #888;
                border-radius: 4px;
            }
            .custom-confirm-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1000000;
            }
            .confirm-dialog-header {
                height: 30px;
                background: white;
                margin: -20px -20px 20px -20px;
                border-radius: 8px 8px 0 0;
                display: flex;
                align-items: center;
                padding: 0 15px;
                font-weight: bold;
                border-bottom: 1px solid #ddd;
                cursor: move;
                font-size: 18px;
            }
            .custom-confirm-dialog {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 0 20px rgba(0,0,0,0.3);
                max-width: 400px;
                width: 90%;
                text-align: center;
                z-index: 1000001;
                font-size: 18px;
            }
            .custom-confirm-message {
                margin-bottom: 20px;
                font-size: 18px;
            }
            .custom-confirm-buttons {
                display: flex;
                justify-content: center;
                gap: 10px;
            }
            .custom-confirm-button {
                padding: 8px 15px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-weight: bold;
                font-size: 18px;
                user-select: none;
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
            }
            .custom-confirm-button:hover {
                opacity: 0.9;
            }
            .custom-confirm-cancel {
                background: #f1f1f1;
            }
            .custom-confirm-ok {
                background: #ff0000;
                color: white;
            }
            .drag-handle {
                height: 30px;
                background: #f1f1f1;
                cursor: move;
                display: flex;
                align-items: center;
                padding: 0 15px;
                font-weight: bold;
                border-bottom: 1px solid #ddd;
                position: relative;
                font-size: 18px;
            }
            .drag-handle-text {
                flex: 1;
            }
        `;
        document.head.appendChild(style);

        const container = document.createElement('div');
        container.id = 'yt-time-marker';
        if (savedState.minimized) {
            container.classList.add('minimized');
        }

        // 創建拖動區域
        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';

        const dragHandleText = document.createElement('div');
        dragHandleText.className = 'drag-handle-text';
        dragHandleText.textContent = '⏱ 時間標記編輯器';
        dragHandle.appendChild(dragHandleText);

        container.appendChild(dragHandle);

        // 創建面板內容
        const panelContent = document.createElement('div');
        panelContent.className = 'panel-content';

        // 左側輸入區域
        const inputSection = document.createElement('div');
        inputSection.className = 'input-section';

        // 當前時間顯示
        const currentTimeDisplay = document.createElement('div');
        currentTimeDisplay.id = 'current-time-display';
        currentTimeDisplay.textContent = '當前時間: 0:00:00';
        inputSection.appendChild(currentTimeDisplay);

        const inputContainer = document.createElement('div');
        inputContainer.style.display = 'flex';
        inputContainer.style.flexDirection = 'column';
        inputContainer.style.flex = '1';
        inputContainer.style.overflow = 'hidden';
        inputContainer.style.minHeight = '0';

        const input = document.createElement('textarea');
        input.id = 'marker-input';
        input.placeholder = "輸入時間標記 (例如: 1:23:45 [01] 這是註釋)\n或直接輸入註釋內容";
        input.value = savedState.inputText || '';
        input.style.flex = '1';
        input.addEventListener('input', function() {
            savedState.inputText = this.value;
            GM_setValue('panelState', savedState);
        });
        inputContainer.appendChild(input);

        const controls = document.createElement('div');
        controls.className = 'marker-controls';

        const currentTimeBtn = document.createElement('button');
        currentTimeBtn.id = 'current-time';
        currentTimeBtn.textContent = '插入時間';
        currentTimeBtn.addEventListener('click', insertCurrentTime);
        controls.appendChild(currentTimeBtn);

        const addBtn = document.createElement('button');
        addBtn.id = 'add-marker';
        addBtn.textContent = '添加標記';
        addBtn.addEventListener('click', addMarker);
        controls.appendChild(addBtn);

        const clearAllBtn = document.createElement('button');
        clearAllBtn.id = 'clear-all';
        clearAllBtn.textContent = '全部刪除';
        clearAllBtn.addEventListener('click', showClearAllConfirmation);
        controls.appendChild(clearAllBtn);

        inputContainer.appendChild(controls);
        inputSection.appendChild(inputContainer);
        panelContent.appendChild(inputSection);

        // 右側顯示區域
        const displaySection = document.createElement('div');
        displaySection.className = 'display-section';

        const markerList = document.createElement('div');
        markerList.id = 'marker-list';
        displaySection.appendChild(markerList);

        panelContent.appendChild(displaySection);
        container.appendChild(panelContent);

        // 添加縮放手柄
        const resizeHandle = document.createElement('div');
        resizeHandle.className = 'resize-handle';
        container.appendChild(resizeHandle);

        // 創建縮小/展開按鈕
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'toggle-minimize';
        toggleBtn.textContent = savedState.minimized ? '+' : '×';

        // 設置按鈕固定位置
        toggleBtn.style.position = 'absolute';
        toggleBtn.style.right = '5px';
        toggleBtn.style.top = '5px';

        container.appendChild(toggleBtn);
        document.body.appendChild(container);

        // 加載保存的標記
        loadSavedMarkers();

        // 更新當前視頻時間顯示
        updateCurrentTimeDisplay();
        setInterval(updateCurrentTimeDisplay, 1000);

        // 保存面板狀態
        function savePanelState() {
            const inputText = document.getElementById('marker-input').value;
            const newState = {
                minimized: container.classList.contains('minimized'),
                left: container.style.left || savedState.left,
                top: container.style.top || savedState.top,
                width: container.style.width || savedState.width,
                height: container.style.height || savedState.height,
                inputText: inputText,
                nextIndex: savedState.nextIndex
            };
            GM_setValue('panelState', newState);
        }

        // 保存標記數據
        function saveMarkers() {
            const markers = [];
            document.querySelectorAll('.marker-item').forEach(item => {
                const timeEl = item.querySelector('.marker-time');
                const textEl = item.querySelector('.marker-text');
                markers.push({
                    time: timeEl.textContent,
                    text: textEl.textContent,
                    isTimeValid: !timeEl.classList.contains('plain-text')
                });
            });
            GM_setValue('timeMarkers', markers);
            savedState.inputText = document.getElementById('marker-input').value;
            GM_setValue('panelState', savedState);
        }

        // 加載保存的標記
        function loadSavedMarkers() {
            let maxIndex = 0;
            savedMarkers.forEach(marker => {
                const indexMatch = marker.text.match(/\[(\d{2})\]/);
                if (indexMatch) {
                    const currentIndex = parseInt(indexMatch[1]);
                    if (currentIndex > maxIndex) {
                        maxIndex = currentIndex;
                    }
                }
            });
            savedState.nextIndex = maxIndex + 1;

            savedMarkers.forEach(marker => {
                createMarkerItem(marker.time, marker.text, marker.isTimeValid, false);
            });

            document.getElementById('marker-input').value = savedState.inputText || '';
        }

        // 顯示清除所有確認對話框
        function showClearAllConfirmation() {
            const overlay = document.createElement('div');
            overlay.className = 'custom-confirm-overlay';

            const dialog = document.createElement('div');
            dialog.className = 'custom-confirm-dialog';

            const header = document.createElement('div');
            header.className = 'confirm-dialog-header';
            header.textContent = '確認刪除';
            dialog.appendChild(header);

            const message = document.createElement('div');
            message.className = 'custom-confirm-message';
            message.textContent = '確定要刪除所有時間標記嗎？此操作不可撤銷！';

            const buttons = document.createElement('div');
            buttons.className = 'custom-confirm-buttons';

            const cancelBtn = document.createElement('button');
            cancelBtn.className = 'custom-confirm-button custom-confirm-cancel';
            cancelBtn.textContent = '取消';
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                overlay.remove();
            });

            const okBtn = document.createElement('button');
            okBtn.className = 'custom-confirm-button custom-confirm-ok';
            okBtn.textContent = '確定刪除';
            okBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                clearAllMarkers();
                overlay.remove();
            });

            let isDialogDragging = false;
            let dialogOffsetX, dialogOffsetY;

            const startDrag = (e) => {
                if (e.target === header || e.target === message || e.target === dialog) {
                    isDialogDragging = true;
                    const rect = dialog.getBoundingClientRect();
                    dialogOffsetX = e.clientX - rect.left;
                    dialogOffsetY = e.clientY - rect.top;
                    e.preventDefault();
                    e.stopPropagation();
                    dialog.style.transition = 'none';
                    dialog.style.cursor = 'grabbing';
                }
            };

            const handleDrag = (e) => {
                if (isDialogDragging) {
                    dialog.style.left = `${e.clientX - dialogOffsetX}px`;
                    dialog.style.top = `${e.clientY - dialogOffsetY}px`;
                    e.preventDefault();
                }
            };

            const endDrag = () => {
                if (isDialogDragging) {
                    isDialogDragging = false;
                    dialog.style.transition = '';
                    dialog.style.cursor = '';
                }
            };

            header.addEventListener('mousedown', startDrag);
            message.addEventListener('mousedown', startDrag);
            dialog.addEventListener('mousedown', startDrag);
            document.addEventListener('mousemove', handleDrag);
            document.addEventListener('mouseup', endDrag);

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay && !isDialogDragging) {
                    overlay.remove();
                }
            });

            buttons.appendChild(cancelBtn);
            buttons.appendChild(okBtn);
            dialog.appendChild(message);
            dialog.appendChild(buttons);
            overlay.appendChild(dialog);

            const centerX = window.innerWidth / 2 - dialog.offsetWidth / 2;
            const centerY = window.innerHeight / 2 - dialog.offsetHeight / 2;
            dialog.style.left = `${centerX}px`;
            dialog.style.top = `${centerY}px`;

            document.body.appendChild(overlay);
            cancelBtn.focus();
        }

        // 清除所有標記
        function clearAllMarkers() {
            const markerList = document.getElementById('marker-list');
            while (markerList.firstChild) {
                markerList.removeChild(markerList.firstChild);
            }
            document.getElementById('marker-input').value = '';
            GM_setValue('timeMarkers', []);
            savedState.inputText = '';
            savedState.nextIndex = 1;
            GM_setValue('panelState', savedState);
        }

        // 更新當前視頻時間顯示
        function updateCurrentTimeDisplay() {
            const video = document.querySelector('video');
            if (video) {
                const seconds = Math.floor(video.currentTime);
                const timeStr = formatTime(seconds);
                document.getElementById('current-time-display').textContent = `當前時間: ${timeStr}`;
            }
        }

        // 拖動功能變量
        let isDragging = false;
        let isClick = true;
        let offsetX, offsetY;
        let startX, startY;

        // 縮放功能變量
        let isResizing = false;
        let startWidth, startHeight, startResizeX, startResizeY;

        // 切換縮小/展開
        function toggleMinimize() {
            if (!isClick) return;

            container.classList.toggle('minimized');
            toggleBtn.textContent = container.classList.contains('minimized') ? '+' : '×';
            savePanelState();
        }

        // 拖動開始
        const dragStart = (e) => {
            if (e.target === dragHandle || e.target === dragHandleText || e.target === toggleBtn) {
                isDragging = true;
                isClick = true;
                startX = e.clientX;
                startY = e.clientY;
                offsetX = e.clientX - container.getBoundingClientRect().left;
                offsetY = e.clientY - container.getBoundingClientRect().top;
                e.preventDefault();
            }
        };

        // 拖動中
        const dragMove = (e) => {
            if (isDragging) {
                if (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5) {
                    isClick = false;
                }

                container.style.left = `${e.clientX - offsetX}px`;
                container.style.top = `${e.clientY - offsetY}px`;
            }
        };

        // 拖動結束
        const dragEnd = () => {
            if (isDragging) {
                isDragging = false;
                if (!isClick) {
                    savePanelState();
                }
                setTimeout(() => isClick = true, 100);
            }
        };

        // 縮放開始
        resizeHandle.addEventListener('mousedown', function(e) {
            isResizing = true;
            startResizeX = e.clientX;
            startResizeY = e.clientY;
            startWidth = parseInt(document.defaultView.getComputedStyle(container).width, 10);
            startHeight = parseInt(document.defaultView.getComputedStyle(container).height, 10);
            e.preventDefault();
        });

        // 縮放中
        const resizeMove = (e) => {
            if (isResizing) {
                const newWidth = startWidth + (e.clientX - startResizeX);
                const newHeight = startHeight + (e.clientY - startResizeY);

                container.style.width = Math.min(Math.max(newWidth, 500), window.innerWidth * 0.8) + 'px';
                container.style.height = Math.min(Math.max(newHeight, 400), window.innerHeight * 0.8) + 'px';
            }
        };

        // 縮放結束
        const resizeEnd = () => {
            if (isResizing) {
                isResizing = false;
                savePanelState();
            }
        };

        // 事件監聽
        dragHandle.addEventListener('mousedown', dragStart);
        toggleBtn.addEventListener('mousedown', dragStart);
        document.addEventListener('mousemove', (e) => {
            dragMove(e);
            resizeMove(e);
        });
        document.addEventListener('mouseup', () => {
            dragEnd();
            resizeEnd();
        });
        toggleBtn.addEventListener('click', toggleMinimize);

        function insertCurrentTime() {
            const video = document.querySelector('video');
            if (video) {
                const seconds = Math.floor(video.currentTime);
                const timeStr = formatTime(seconds);
                const indexStr = `[${savedState.nextIndex.toString().padStart(2, '0')}]`;
                const input = document.getElementById('marker-input');

                let newText = timeStr + ' ' + indexStr;
                if (input.value && !input.value.endsWith('\n')) {
                    newText = '\n' + newText;
                }

                const currentPos = input.selectionStart;
                input.value = input.value.substring(0, currentPos) + newText + input.value.substring(currentPos);
                const newPos = currentPos + newText.length;
                input.setSelectionRange(newPos, newPos);
                input.focus();

                savedState.nextIndex++;
                savedState.inputText = input.value;
                GM_setValue('panelState', savedState);
            }
        }

        function addMarker() {
            const input = document.getElementById('marker-input');
            const text = input.value.trim();
            if (!text) return;

            const lines = text.split('\n');
            lines.forEach(line => {
                const trimmedLine = line.trim();
                if (!trimmedLine) return;

                const indexMatch = trimmedLine.match(/\[(\d{2})\]/);
                if (indexMatch) {
                    const currentIndex = parseInt(indexMatch[1]);
                    if (currentIndex >= savedState.nextIndex) {
                        savedState.nextIndex = currentIndex + 1;
                    }
                }

                const timeMatch = trimmedLine.match(/^(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})(?=\s|$)/);
                let timeStr = '';
                let note = trimmedLine;
                let isTimeValid = false;

                if (timeMatch) {
                    timeStr = timeMatch[0];
                    isTimeValid = true;
                    note = trimmedLine.substring(timeStr.length).trim();
                }

                createMarkerItem(timeStr, note, isTimeValid, true);
            });

            savedState.inputText = input.value;
            GM_setValue('panelState', savedState);
            input.focus();
            saveMarkers();
        }

        function createMarkerItem(timeStr, note, isTimeValid, scrollToBottom) {
            const item = document.createElement('div');
            item.className = 'marker-item';

            const timeLink = document.createElement('span');
            timeLink.className = 'marker-time';
            if (!isTimeValid) {
                timeLink.classList.add('plain-text');
                timeLink.textContent = note ? '' : '無時間';
            } else {
                timeLink.textContent = timeStr;
                timeLink.contentEditable = 'true';
                timeLink.addEventListener('blur', function() {
                    const newTime = this.textContent.trim();
                    const isValid = /^(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2})$/.test(newTime);
                    if (isValid) {
                        this.classList.remove('plain-text');
                        this.style.color = '#ff0000';
                    } else {
                        this.classList.add('plain-text');
                        this.style.color = '#333';
                    }
                    saveMarkers();
                });
                timeLink.style.color = '#ff0000';
                timeLink.addEventListener('click', function(e) {
                    if (e.target === this && !this.classList.contains('plain-text')) {
                        const seconds = parseTime(this.textContent);
                        jumpToTime(seconds);
                    }
                });
            }
            item.appendChild(timeLink);

            const textSpan = document.createElement('span');
            textSpan.className = 'marker-text';
            textSpan.textContent = isTimeValid ? note : (timeStr + ' ' + note).trim();
            textSpan.contentEditable = 'true';
            textSpan.addEventListener('blur', saveMarkers);
            item.appendChild(textSpan);

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'marker-actions';

            const editBtn = document.createElement('button');
            editBtn.className = 'marker-edit';
            editBtn.textContent = '✏️';
            editBtn.title = '編輯';
            editBtn.addEventListener('click', () => {
                textSpan.focus();
            });
            actionsDiv.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'marker-delete';
            deleteBtn.textContent = '🗑️';
            deleteBtn.title = '刪除';
            deleteBtn.addEventListener('click', () => {
                item.remove();
                saveMarkers();
            });
            actionsDiv.appendChild(deleteBtn);

            item.appendChild(actionsDiv);
            markerList.appendChild(item);

            if (scrollToBottom) {
                markerList.scrollTop = markerList.scrollHeight;
            }
        }

        function jumpToTime(seconds) {
            const video = document.querySelector('video');
            if (video) {
                video.currentTime = seconds;
                video.play().catch(e => console.log('自動播放被阻止:', e));
            }
        }

        function parseTime(timeStr) {
            if (!timeStr) return 0;
            const parts = timeStr.split(':');
            if (parts.length === 3) {
                return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
            } else if (parts.length === 2) {
                return parseInt(parts[0]) * 60 + parseInt(parts[1]);
            }
            return 0;
        }

        function formatTime(seconds) {
            const h = Math.floor(seconds / 3600);
            const m = Math.floor((seconds % 3600) / 60);
            const s = seconds % 60;
            return `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                addMarker();
            }
        });

        console.log('YouTube時間標記工具已成功加載');
    }
})();
