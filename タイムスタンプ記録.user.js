// ==UserScript==
// @name         タイムスタンプ記録
// @namespace    https://www.youtube.com/
// @version      10.0
// @description  タイムスタンプを記録
// @match        *://www.youtube.com/watch?v*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 設定變數
    let timestamps = [];
    let isLocked = false;
    let isAscending = false;
    let isHidden = localStorage.getItem('timestampHiddenState') === 'true';
    let isDraggingContainer = false;
    let isDraggingFromHideButton = false;
    let offsetX = 0, offsetY = 0;
    let dragStartTime = 0;
    const DRAG_THRESHOLD = 100;
    let firstTimeUser = localStorage.getItem('timestampFirstTime') === null;
    let currentEditIndex = -1;
    let totalLiveDuration = "00:00:00";
    let liveDurationInterval = null;
    let initialLiveTime = 0;

    // DOM 元素引用
    let container, btn, lockButton, hideButton;

    // 容器位置處理
    function saveContainerPosition() {
        if (!container) return;
        const listContainer = container.querySelector('div[style*="resize"]');
        if (!listContainer) return;

        const position = {
            left: container.style.left,
            top: container.style.top,
            width: listContainer.style.width,
            height: listContainer.style.height
        };
        localStorage.setItem('timestampContainerPosition', JSON.stringify(position));
    }

    function loadContainerPosition() {
        const savedPosition = localStorage.getItem('timestampContainerPosition');
        if (savedPosition) {
            try {
                return JSON.parse(savedPosition);
            } catch (e) {
                console.error('位置情報の読み込みに失敗しました', e);
            }
        }
        return {
            left: "380px",
            top: "500px",
            width: "420px",
            height: "150px"
        };
    }

    // 數據載入
    function loadTimestamps() {
        const storedTimestamps = localStorage.getItem('timestamps');
        if (storedTimestamps) {
            try {
                timestamps = JSON.parse(storedTimestamps);
            } catch (e) {
                console.error('タイムスタンプの解析に失敗しました', e);
                timestamps = [];
            }
        }
    }

    function loadSettings() {
        loadTimestamps();
        const storedLockState = localStorage.getItem('timestampLockState');
        if (storedLockState !== null) {
            isLocked = storedLockState === 'true';
        }
    }

    // 時間處理
    function updateTotalLiveDuration() {
        const video = document.querySelector('video');
        if (video) {
            const currentTime = video.currentTime;
            const hours = Math.floor(currentTime / 3600);
            const minutes = Math.floor((currentTime % 3600) / 60);
            const seconds = Math.floor(currentTime % 60);
            totalLiveDuration = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            const durationDisplay = document.getElementById('total-duration-display');
            if (durationDisplay) {
                durationDisplay.textContent = `配信時間: ${totalLiveDuration}`;
            }
        }
    }

    function formatTimeFromVideo(currentTime, index) {
        const hours = Math.floor(currentTime / 3600);
        const minutes = Math.floor((currentTime % 3600) / 60);
        const seconds = Math.floor(currentTime % 60);
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} [${(index + 1).toString().padStart(2, '0')}]`;
    }

    // 主要功能
    function recordTimestamp() {
        const video = document.querySelector('video');
        if (video) {
            const currentTime = video.currentTime;
            const formattedTimestamp = formatTimeFromVideo(currentTime, timestamps.length);
            timestamps.unshift(formattedTimestamp);
            saveTimestamps();
            updateTimestampList();

            if (firstTimeUser && timestamps.length === 1) {
                localStorage.setItem('timestampFirstTime', 'false');
                firstTimeUser = false;
            }

            // ライブ配信処理
            if (document.querySelector('.ytp-live')) {
                initialLiveTime = currentTime;
                if (!liveDurationInterval) {
                    liveDurationInterval = setInterval(updateTotalLiveDuration, 1000);
                }
                const durationDisplay = document.getElementById('total-duration-display');
                if (durationDisplay) {
                    durationDisplay.style.display = "block";
                }
            }
        } else {
            showErrorMessage("動画が見つかりませんでした。ページをリフレッシュして再試行してください！");
        }
    }

    function adjustTimestamp(index, adjustment) {
        const timestamp = timestamps[index];
        const timePattern = /^(\d+):(\d{2}):(\d{2})/;
        const match = timestamp.match(timePattern);

        if (match) {
            let hours = parseInt(match[1], 10);
            let minutes = parseInt(match[2], 10);
            let seconds = parseInt(match[3], 10);

            seconds += adjustment;

            // 時間調整
            if (seconds >= 60) {
                minutes += Math.floor(seconds / 60);
                seconds = seconds % 60;
            } else if (seconds < 0) {
                minutes -= Math.ceil(Math.abs(seconds) / 60);
                seconds = 60 - (Math.abs(seconds) % 60);
                if (seconds === 60) seconds = 0;
            }

            if (minutes >= 60) {
                hours += Math.floor(minutes / 60);
                minutes = minutes % 60;
            } else if (minutes < 0) {
                hours -= Math.ceil(Math.abs(minutes) / 60);
                minutes = 60 - (Math.abs(minutes) % 60);
                if (minutes === 60) minutes = 0;
            }

            if (hours < 0) {
                hours = 0;
                minutes = 0;
                seconds = 0;
            }

            const bracketPart = timestamp.match(/\[\d+\]/)?.[0] || `[${(index + 1).toString().padStart(2, '0')}]`;
            const newTimestamp = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} ${bracketPart}`;

            timestamps[index] = newTimestamp;
            saveTimestamps();
            updateTimestampList();
            jumpToTimestamp(newTimestamp);
        }
    }

    function deleteTimestamp(index) {
        timestamps.splice(index, 1);
        saveTimestamps();
        updateTimestampList();
    }

    function jumpToTimestamp(timestamp) {
        const timePattern = /^(\d+):(\d{2}):(\d{2})/;
        const match = timestamp.match(timePattern);

        if (match) {
            const hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const seconds = parseInt(match[3], 10);
            const totalSeconds = hours * 3600 + minutes * 60 + seconds;

            const video = document.querySelector('video');
            if (video) {
                video.currentTime = totalSeconds;
                video.play().catch(e => console.error('播放失敗:', e));
                showJumpSuccessMessage(timestamp);
            }
        } else {
            showErrorMessage("時間格式錯誤！請使用「時:分:秒」格式，例如：2:23:45");
        }
    }

    // UI 更新
    function updateTimestampList() {
        const list = document.getElementById("timestamp-list");
        if (!list) return;

        // 清空列表
        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }

        // 排序
        timestamps = isAscending ? [...timestamps].sort() : [...timestamps].sort().reverse();

        // 空狀態提示
        if (timestamps.length === 0 && firstTimeUser) {
            const emptyGuide = document.createElement('div');
            emptyGuide.innerHTML = '記録したタイムスタンプがここに表示されます<br><span style="font-size:24px">⬇️</span>';
            emptyGuide.style.cssText = 'text-align:center;padding:20px;color:#666;font-size:14px;';
            list.appendChild(emptyGuide);
            return;
        }

        // 創建時間戳項目
        timestamps.forEach((t, index) => {
            const listItem = createTimestampListItem(t, index);
            list.appendChild(listItem);
        });
    }

    function createTimestampListItem(t, index) {
        const listItem = document.createElement("li");
        listItem.style.cssText = `
            display: flex;
            align-items: center;
            margin-bottom: 4px;
            padding: 2px;
            width: 100%;
            overflow: visible;
            flex-wrap: nowrap;
            white-space: nowrap;
            text-overflow: ellipsis;
            flex-grow: 1;
        `;

        // 跳轉按鈕
        const jumpIcon = document.createElement("span");
        jumpIcon.textContent = "▶️";
        jumpIcon.style.cssText = `
            margin-right: 8px;
            cursor: pointer;
            font-size: 20px;
        `;
        jumpIcon.title = "クリックでジャンプ";
        jumpIcon.onclick = () => jumpToTimestamp(t);

        // 時間調整按鈕 (-1s)
        const minusButton = createAdjustButton("-1s", "#FFB6C1", "#FF1493");
        minusButton.onclick = (e) => {
            e.stopPropagation();
            adjustTimestamp(index, -1);
        };

        // 時間調整按鈕 (+1s)
        const plusButton = createAdjustButton("+1s", "#A8E6A0", "#3A8F12");
        plusButton.onclick = (e) => {
            e.stopPropagation();
            adjustTimestamp(index, 1);
        };

        // 刪除按鈕
        const deleteButton = createDeleteButton();
        deleteButton.onclick = () => deleteTimestamp(index);

        // 顯示容器
        const displayContainer = document.createElement("div");
        displayContainer.style.cssText = `
            display: flex;
            align-items: center;
            flex-grow: 1;
            min-width: 250px;
            margin-right: 20px;
        `;

        const [displayText, inputField] = createTimestampDisplay(t, index);
        displayContainer.appendChild(displayText);
        displayContainer.appendChild(inputField);

        // 項目容器
        const itemContainer = document.createElement("div");
        itemContainer.style.cssText = `
            display: flex;
            align-items: center;
            flex-wrap: nowrap;
            width: 100%;
            min-width: 400px;
            padding: 0;
            overflow: visible;
            flex-grow: 1;
        `;

        itemContainer.appendChild(jumpIcon);
        itemContainer.appendChild(minusButton);
        itemContainer.appendChild(plusButton);
        itemContainer.appendChild(deleteButton);
        itemContainer.appendChild(displayContainer);
        listItem.appendChild(itemContainer);

        return listItem;
    }

    function createAdjustButton(text, bgColor, borderColor) {
        const button = document.createElement("button");
        button.textContent = text;
        button.style.cssText = `
            padding: 10px 12px;
            margin-right: 6px;
            background: ${bgColor};
            color: black;
            border: 1px solid ${borderColor};
            font-weight: bold;
            transition: background-color 0.3s, transform 0.2s;
        `;

        button.onmouseover = () => button.style.background = darkenColor(bgColor, 10);
        button.onmouseleave = () => button.style.background = bgColor;
        button.onmousedown = () => {
            button.style.background = darkenColor(bgColor, 20);
            button.style.transform = "scale(0.95)";
        };
        button.onmouseup = () => {
            button.style.background = darkenColor(bgColor, 10);
            button.style.transform = "scale(1)";
        };

        return button;
    }

    function createDeleteButton() {
        const button = document.createElement("button");
        button.textContent = "削除";
        button.style.cssText = `
            padding: 10px 12px;
            margin-right: 6px;
            background: #FF6B6B;
            color: black;
            border: 1px solid #D63A3A;
            font-weight: bold;
            transition: background-color 0.3s, transform 0.2s;
        `;

        button.onmouseover = () => button.style.background = "#FF4C4C";
        button.onmouseleave = () => button.style.background = "#FF6B6B";
        button.onmousedown = () => {
            button.style.background = "#D63A3A";
            button.style.transform = "scale(0.95)";
        };
        button.onmouseup = () => {
            button.style.background = "#FF4C4C";
            button.style.transform = "scale(1)";
        };

        return button;
    }

    function createTimestampDisplay(t, index) {
        const displayText = document.createElement("div");
        displayText.textContent = t;
        displayText.style.cssText = `
            text-align: left;
            padding-left: 10px;
            flex-grow: 1;
            padding: 10px 2px;
            font-size: 16px;
            background: #A3C9D9;
            color: black;
            font-weight: bold;
            border: 1px solid #9BBED4;
            white-space: nowrap;
            overflow-x: auto;
            cursor: text;
        `;
        displayText.title = "左クリックで編集 / Ctrl+クリックでジャンプ / 右クリックメニュー";

        const inputField = document.createElement("input");
        inputField.type = "text";
        inputField.value = t;
        inputField.style.cssText = `
            display: none;
            flex-grow: 1;
            padding: 10px 2px;
            font-size: 16px;
            background: #88B8D9;
            border: 1px solid #7AA8C9;
        `;

        displayText.onclick = (e) => {
            if (e.ctrlKey) {
                jumpToTimestamp(t);
            } else {
                currentEditIndex = index;
                displayText.style.display = "none";
                inputField.style.display = "block";
                inputField.focus();
                inputField.select();
            }
        };

        inputField.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                finishEditing(t, index, displayText, inputField);
                e.preventDefault();
            }
        });

        inputField.addEventListener("blur", () => {
            finishEditing(t, index, displayText, inputField);
        });

        displayText.oncontextmenu = (e) => {
            e.preventDefault();
            showTimestampContextMenu(e, t, displayText);
        };

        return [displayText, inputField];
    }

    function finishEditing(originalText, index, displayText, inputField) {
        const newTimestamp = inputField.value;
        if (newTimestamp !== originalText) {
            timestamps[index] = newTimestamp;
            saveTimestamps();
            displayText.textContent = newTimestamp;
        }
        inputField.style.display = "none";
        displayText.style.display = "block";
    }

    // 右鍵菜單
    function showTimestampContextMenu(e, timestamp, button) {
        const existingMenu = document.getElementById('timestamp-context-menu');
        if (existingMenu) existingMenu.remove();

        const menu = document.createElement('div');
        menu.id = 'timestamp-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${e.clientX}px;
            top: ${e.clientY}px;
            background-color: white;
            border: 1px solid #ddd;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 10000;
            padding: 5px 0;
            min-width: 150px;
        `;

        const currentTimestamp = button.textContent || timestamp;

        const createMenuOption = (text, action) => {
            const option = document.createElement('div');
            option.textContent = text;
            option.style.cssText = `
                padding: 8px 15px;
                cursor: pointer;
                font-size: 14px;
            `;
            option.onmouseover = () => option.style.backgroundColor = '#f0f0f0';
            option.onmouseout = () => option.style.backgroundColor = 'transparent';
            option.onclick = () => {
                action();
                menu.remove();
            };
            return option;
        };

        menu.appendChild(createMenuOption('タイムラインジャンプ', () => jumpToTimestamp(currentTimestamp)));
        menu.appendChild(createMenuOption('コピー', () => copyToClipboard(currentTimestamp)));

        document.body.appendChild(menu);

        const closeMenu = () => {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 10);
    }

    // 拖拽功能
    function makeDraggable(element, allowDrag = true) {
        const dragHandle = document.createElement("div");
        dragHandle.textContent = "長押しして移動";
        dragHandle.style.cssText = `
            padding: 8px;
            margin: 0;
            cursor: move;
            font-weight: bold;
            user-select: none;
            background: #f5f5f5;
            border-bottom: 1px solid #ddd;
            text-align: center;
            flex: 1;
            margin-right: 5px;
            font-size: 16px;
        `;

        const buttonContainer = element.querySelector('div[style*="justify-content: flex-start"]');
        if (buttonContainer) {
            buttonContainer.insertBefore(dragHandle, buttonContainer.firstChild);
            buttonContainer.style.justifyContent = "flex-start";
        }

        dragHandle.addEventListener('mousedown', function(e) {
            if (isLocked || !allowDrag || e.button !== 0) return;

            const rect = element.getBoundingClientRect();
            const isResizeArea = e.clientX > rect.right - 15 && e.clientY > rect.bottom - 15;
            if (isResizeArea) return;

            e.preventDefault();
            e.stopPropagation();

            isDraggingContainer = true;
            offsetX = e.clientX - rect.left;
            offsetY = e.clientY - rect.top;
            document.body.style.cursor = 'move';
            document.onselectstart = () => false;
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDraggingContainer && !isDraggingFromHideButton) return;
            element.style.left = `${e.clientX - offsetX}px`;
            element.style.top = `${e.clientY - offsetY}px`;
        });

        document.addEventListener('mouseup', function() {
            if (isDraggingContainer || isDraggingFromHideButton) {
                isDraggingContainer = false;
                isDraggingFromHideButton = false;
                document.body.style.cursor = '';
                saveContainerPosition();
                document.onselectstart = null;
            }
        });
    }

    // 複製功能
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            showCustomCopySuccessMessage(text);
        }).catch(err => {
            console.error('コピー失敗', err);
            // 回退方法
            const textarea = document.createElement('textarea');
            textarea.value = text;
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                showCustomCopySuccessMessage(text);
            } catch (e) {
                console.error('回退コピー方法も失敗', e);
            }
            document.body.removeChild(textarea);
        });
    }

    function copyAllTimestamps() {
        const allTimestamps = timestamps.join('\n');
        copyToClipboard(allTimestamps);
    }

    // 訊息顯示
    function showCustomCopySuccessMessage(text) {
        showMessage(`コピー成功: ${text}`, "#28a745");
    }

    function showJumpSuccessMessage(timestamp) {
        showMessage(`ジャンプ成功: ${timestamp}`, "#4285F4");
    }

    function showErrorMessage(message) {
        showMessage(message, "#dc3545");
    }

    function showMessage(text, bgColor) {
        const messageBox = document.createElement("div");
        messageBox.textContent = text;
        messageBox.style.cssText = `
            position: fixed;
            top: 10px;
            left: 50%;
            transform: translateX(-50%);
            padding: 10px 20px;
            background-color: ${bgColor};
            color: white;
            font-size: 14px;
            border-radius: 5px;
            box-shadow: 2px 2px 8px rgba(0, 0, 0, 0.2);
            z-index: 9999;
            opacity: 1;
            transition: opacity 0.5s;
        `;

        document.body.appendChild(messageBox);

        setTimeout(() => {
            messageBox.style.opacity = "0";
            setTimeout(() => messageBox.remove(), 500);
        }, 2000);
    }

    // 工具函數
    function darkenColor(color, percent) {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = (num >> 16) - amt;
        const G = (num >> 8 & 0x00FF) - amt;
        const B = (num & 0x0000FF) - amt;
        return `#${(
            0x1000000 +
            (R < 0 ? 0 : R) * 0x10000 +
            (G < 0 ? 0 : G) * 0x100 +
            (B < 0 ? 0 : B)
        ).toString(16).slice(1)}`;
    }

    // 鎖定功能
    function toggleLock() {
        isLocked = !isLocked;
        lockButton.textContent = isLocked ? "アンロック" : "ロック";
        lockButton.style.background = isLocked
            ? "linear-gradient(to bottom, #FF5252, #D32F2F)"
            : "linear-gradient(to bottom, #4CAF50, #388E3C)";

        hideButton.style.cursor = isLocked ? "pointer" : "default";
        localStorage.setItem('timestampLockState', isLocked);

        const listContainer = container.querySelector('div[style*="resize"]');
        if (listContainer) {
            listContainer.style.resize = isLocked ? "none" : "both";
        }

        lockButton.style.transform = "scale(0.95)";
        setTimeout(() => lockButton.style.transform = "scale(1)", 100);
    }

    // 顯示/隱藏功能
    function toggleVisibility() {
        isHidden = !isHidden;
        localStorage.setItem('timestampHiddenState', isHidden);
        applyHiddenState();

        hideButton.style.transform = "scale(0.95)";
        setTimeout(() => hideButton.style.transform = "scale(1)", 100);
    }

    function applyHiddenState() {
        if (!container) return;

        Array.from(container.children).forEach(child => {
            if (child !== container.lastElementChild) { // 保持按鈕行可見
                child.style.opacity = isHidden ? "0" : "1";
                child.style.pointerEvents = isHidden ? "none" : "auto";
            }
        });

        hideButton.textContent = isHidden ? "表示" : "隠す";
        hideButton.style.background = isHidden
            ? "linear-gradient(to bottom, #FF5252, #D32F2F)"
            : "linear-gradient(to bottom, #2196F3, #1976D2)";
    }

    // 初始化UI
    function addUI() {
        container = document.createElement("div");
        container.style.cssText = `
            position: absolute;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            align-items: center;
            background: transparent;
            pointer-events: auto;
        `;

        const savedPosition = loadContainerPosition();
        container.style.left = savedPosition.left;
        container.style.top = savedPosition.top;

        // 配信時間顯示
        const durationDisplay = document.createElement("div");
        durationDisplay.id = "total-duration-display";
        durationDisplay.textContent = "配信時間: 00:00:00";
        durationDisplay.style.cssText = `
            padding: 8px 16px;
            background: rgba(0, 0, 0, 0.7);
            color: white;
            border-radius: 4px;
            margin-bottom: 5px;
            font-size: 14px;
            font-weight: bold;
            display: none;
        `;

        // 主按鈕
        btn = document.createElement("button");
        btn.textContent = "タイムスタンプ記録";
        btn.style.cssText = `
            padding: 10px 50px;
            background: linear-gradient(to bottom, #FFFFFF, #E0F7FA);
            color: black;
            border: 2px solid #A0C4FF;
            box-shadow: 2px 2px 6px rgba(0, 0, 0, 0.2);
            cursor: pointer;
            font-size: 18px;
            font-weight: bold;
            border-radius: 6px;
            pointer-events: auto;
            z-index: 101;
            position: relative;
            top: -1px;
            transition: all 0.3s;
        `;

        btn.onmouseover = () => btn.style.background = "linear-gradient(to bottom, #E0F7FA, #B2EBF2)";
        btn.onmouseout = () => btn.style.background = "linear-gradient(to bottom, #FFFFFF, #E0F7FA)";
        btn.onmousedown = () => btn.style.background = "linear-gradient(to bottom, #B2EBF2, #80DEEA)";
        btn.onmouseup = () => btn.style.background = "linear-gradient(to bottom, #E0F7FA, #B2EBF2)";
        btn.onclick = recordTimestamp;

        container.appendChild(durationDisplay);
        container.appendChild(btn);
        document.body.appendChild(container);

        // 列表容器
        const listContainer = document.createElement("div");
        listContainer.style.cssText = `
            background: white;
            padding: 0;
            border: 1px solid black;
            overflow-y: auto;
            z-index: 9999;
            pointer-events: auto;
            width: ${savedPosition.width};
            resize: ${isLocked ? 'none' : 'both'};
            height: ${savedPosition.height};
            min-width: 200px;
            min-height: 100px;
            user-select: none;
            display: flex;
            flex-direction: column;
        `;

        listContainer.addEventListener('mouseup', saveContainerPosition);

        // 按鈕容器
        const buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = `
            display: flex;
            padding: 8px;
            gap: 5px;
            background: #f5f5f5;
            border-bottom: 1px solid #ddd;
            justify-content: flex-start;
            align-items: center;
        `;

        // 全部複製按鈕
        const copyAllButton = createToolbarButton("全部コピー",
            "linear-gradient(to bottom, #A8E6A0, #52C41A)",
            "#3A8F12",
            copyAllTimestamps);

        // 排序按鈕
        const sortButton = createToolbarButton("並べ替え",
            "linear-gradient(to bottom, #FFB6C1, #FF69B4)",
            "#FF1493",
            () => {
                isAscending = !isAscending;
                updateTimestampList();
                sortButton.style.transform = "scale(0.95)";
                setTimeout(() => sortButton.style.transform = "scale(1)", 100);
            });

        // 刪除全部按鈕
        const deleteAllButton = createToolbarButton("X",
            "linear-gradient(to bottom, #FF6F61, #FF3B30)",
            "none",
            showConfirmModal);

        buttonContainer.appendChild(copyAllButton);
        buttonContainer.appendChild(sortButton);
        buttonContainer.appendChild(deleteAllButton);
        listContainer.appendChild(buttonContainer);

        // 時間戳列表
        const ul = document.createElement("ul");
        ul.id = "timestamp-list";
        ul.style.cssText = `
            list-style-type: none;
            padding: 0;
            margin: 0;
            text-align: center;
        `;
        listContainer.appendChild(ul);
        container.appendChild(listContainer);

        // 底部按鈕行
        const buttonRow = document.createElement("div");
        buttonRow.style.cssText = `
            display: flex;
            justify-content: space-between;
            width: 100%;
            margin-top: 5px;
            gap: 10px;
        `;

        // 鎖定按鈕
        lockButton = document.createElement("button");
        lockButton.textContent = isLocked ? "アンロック" : "ロック";
        lockButton.style.cssText = `
            padding: 8px 16px;
            width: 60px;
            background: ${isLocked
                ? "linear-gradient(to bottom, #FF5252, #D32F2F)"
                : "linear-gradient(to bottom, #4CAF50, #388E3C)"};
            color: white;
            border: none;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            border-radius: 6px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
            flex: 1;
        `;

        lockButton.onmouseover = () => lockButton.style.background = isLocked
            ? "linear-gradient(to bottom, #D32F2F, #B71C1C)"
            : "linear-gradient(to bottom, #388E3C, #2E7D32)";
        lockButton.onmouseleave = () => lockButton.style.background = isLocked
            ? "linear-gradient(to bottom, #FF5252, #D32F2F)"
            : "linear-gradient(to bottom, #4CAF50, #388E3C)";
        lockButton.onclick = toggleLock;

        // 隱藏按鈕
        hideButton = document.createElement("button");
        hideButton.textContent = isHidden ? "表示" : "隠す";
        hideButton.style.cssText = `
            padding: 8px 16px;
            width: auto;
            background: ${isHidden
                ? "linear-gradient(to bottom, #FF5252, #D32F2F)"
                : "linear-gradient(to bottom, #2196F3, #1976D2)"};
            color: white;
            border: none;
            cursor: ${isLocked ? "pointer" : "default"};
            font-size: 14px;
            font-weight: bold;
            border-radius: 6px;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            transition: all 0.3s ease;
            flex: 0 0 60px;
            white-space: nowrap;
            writing-mode: horizontal-tb;
        `;

        // 拖拽處理
        hideButton.addEventListener('mousedown', function(e) {
            if (e.button === 0) {
                dragStartTime = Date.now();
                isDraggingFromHideButton = false;
                offsetX = e.clientX - container.getBoundingClientRect().left;
                offsetY = e.clientY - container.getBoundingClientRect().top;
                document.body.style.cursor = 'move';
                document.onselectstart = () => false;

                const mouseMoveHandler = (e) => {
                    if (Date.now() - dragStartTime > DRAG_THRESHOLD) {
                        isDraggingFromHideButton = true;
                        container.style.left = `${e.clientX - offsetX}px`;
                        container.style.top = `${e.clientY - offsetY}px`;
                    }
                };

                const mouseUpHandler = (e) => {
                    if (isDraggingFromHideButton) {
                        e.preventDefault();
                        e.stopPropagation();
                        saveContainerPosition();
                    } else if (Date.now() - dragStartTime < DRAG_THRESHOLD) {
                        toggleVisibility();
                    }

                    isDraggingFromHideButton = false;
                    document.body.style.cursor = '';
                    document.onselectstart = null;
                    document.removeEventListener('mousemove', mouseMoveHandler);
                    document.removeEventListener('mouseup', mouseUpHandler);
                };

                document.addEventListener('mousemove', mouseMoveHandler);
                document.addEventListener('mouseup', mouseUpHandler);
            }
        });

        buttonRow.appendChild(lockButton);
        buttonRow.appendChild(hideButton);
        container.appendChild(buttonRow);

        makeDraggable(container, true);
        applyHiddenState();

        // ライブ配信監視
        const observer = new MutationObserver(() => {
            if (document.querySelector('.ytp-live')) {
                updateTotalLiveDuration();
                const durationDisplay = document.getElementById('total-duration-display');
                if (durationDisplay) durationDisplay.style.display = "block";
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        // 初始ライブチェック
        if (document.querySelector('.ytp-live')) {
            const video = document.querySelector('video');
            if (video) {
                initialLiveTime = video.currentTime;
                updateTotalLiveDuration();
                const durationDisplay = document.getElementById('total-duration-display');
                if (durationDisplay) durationDisplay.style.display = "block";
            }
            if (!liveDurationInterval) {
                liveDurationInterval = setInterval(updateTotalLiveDuration, 1000);
            }
        }

        // 使用提示
        setTimeout(() => {
            const tooltip = document.createElement('div');
            tooltip.textContent = 'ヒント: 左クリックで編集 / Ctrl+クリックでジャンプ / 右クリックでメニュー';
            tooltip.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background-color: rgba(0,0,0,0.7);
                color: white;
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 14px;
                z-index: 9999;
                animation: fadeIn 0.5s;
            `;
            document.body.appendChild(tooltip);

            setTimeout(() => {
                tooltip.style.opacity = '0';
                setTimeout(() => tooltip.remove(), 500);
            }, 5000);
        }, 3000);
    }

    function createToolbarButton(text, bgGradient, borderColor, onClick) {
        const button = document.createElement("button");
        button.textContent = text;
        button.style.cssText = `
            padding: 12px 20px;
            font-size: 14px;
            background: ${bgGradient};
            color: black;
            border: ${borderColor === 'none' ? 'none' : `1px solid ${borderColor}`};
            font-weight: bold;
            transition: all 0.3s;
            cursor: pointer;
        `;

        if (text === "X") {
            button.style.borderRadius = "50%";
            button.style.width = "40px";
            button.style.height = "40px";
            button.style.display = "flex";
            button.style.justifyContent = "center";
            button.style.alignItems = "center";
            button.style.color = "white";
        }

        button.onmouseover = () => button.style.background = darkenGradient(bgGradient, 10);
        button.onmouseleave = () => button.style.background = bgGradient;
        button.onmousedown = () => {
            button.style.background = darkenGradient(bgGradient, 20);
            button.style.transform = "scale(0.95)";
        };
        button.onmouseup = () => {
            button.style.background = darkenGradient(bgGradient, 10);
            button.style.transform = "scale(1)";
        };
        button.onclick = onClick;

        return button;
    }

    function darkenGradient(gradient, percent) {
        return gradient.replace(/#[0-9A-F]{6}/gi, match => darkenColor(match, percent));
    }

    function showConfirmModal() {
        const modal = document.createElement("div");
        modal.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0,0,0,0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 10000;
        `;

        const modalContent = document.createElement("div");
        modalContent.style.cssText = `
            background-color: #fff;
            padding: 20px;
            border: 4px solid #FF3B30;
            border-radius: 12px;
            box-shadow: 0 5px 25px rgba(255, 59, 48, 0.3);
            width: 300px;
            text-align: center;
        `;

        const message = document.createElement("p");
        message.textContent = "すべての記録を削除しますか？";
        message.style.cssText = `
            font-size: 16px;
            font-weight: bold;
            color: red;
            margin-bottom: 20px;
        `;

        const buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = `
            display: flex;
            justify-content: center;
            gap: 10px;
        `;

        const cancelButton = createModalButton("いいえ", "#999", () => modal.remove());
        const confirmButton = createModalButton("削除", "#e74c3c", () => {
            timestamps = [];
            saveTimestamps();
            updateTimestampList();
            modal.remove();
        });

        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(confirmButton);
        modalContent.appendChild(message);
        modalContent.appendChild(buttonContainer);
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
    }

    function createModalButton(text, bgColor, onClick) {
        const button = document.createElement("button");
        button.textContent = text;
        button.style.cssText = `
            padding: 12px 30px;
            font-size: 16px;
            width: 140px;
            background-color: ${bgColor};
            color: ${bgColor === '#999' ? '#202124' : 'white'};
            font-weight: 600;
            border: none;
            cursor: pointer;
            border-radius: 6px;
            transition: all 0.3s;
        `;

        button.onmouseover = () => button.style.backgroundColor = darkenColor(bgColor, 10);
        button.onmouseleave = () => button.style.backgroundColor = bgColor;
        button.onmousedown = () => button.style.transform = "scale(0.95)";
        button.onmouseup = () => button.style.transform = "scale(1)";
        button.onclick = onClick;

        return button;
    }

    // 數據保存
    function saveTimestamps() {
        localStorage.setItem('timestamps', JSON.stringify(timestamps));
    }

    // 添加CSS動畫
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    // 初始化
    loadSettings();
    loadTimestamps();
    addUI();
    updateTimestampList();

    // 清理計時器
    window.addEventListener('beforeunload', () => {
        if (liveDurationInterval) {
            clearInterval(liveDurationInterval);
        }
    });
})();
