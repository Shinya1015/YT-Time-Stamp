// ==UserScript==
// @name         タイムスタンプ記録
// @namespace    https://www.youtube.com/
// @version      9.8
// @description  タイムスタンプを記録してクリックでジャンプ
// @match        *://www.youtube.com/watch?v*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    let timestamps = [];
    let isDragging = false;
    let offsetX = 0, offsetY = 0;
    let container, btn, lockButton, hideButton;
    let isLocked = false;
    let isAscending = false;
    let isHidden = localStorage.getItem('timestampHiddenState') === 'true';
    let isDraggingContainer = false;
    let dragHandle = null;
    let isDraggingFromHideButton = false;
    let dragStartTime = 0;
    const DRAG_THRESHOLD = 100;
    let firstTimeUser = localStorage.getItem('timestampFirstTime') === null;
    let currentEditIndex = -1;

    // コンテナの位置を保存
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

    // コンテナの位置を読み込み
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

    // タイムスタンプを読み込み
    function loadTimestamps() {
        let storedTimestamps = localStorage.getItem('timestamps');
        if (storedTimestamps) {
            timestamps = JSON.parse(storedTimestamps);
        }
    }

    // 設定を読み込み
    function loadSettings() {
        let storedTimestamps = localStorage.getItem('timestamps');
        if (storedTimestamps) timestamps = JSON.parse(storedTimestamps);

        const storedLockState = localStorage.getItem('timestampLockState');
        if (storedLockState !== null) {
            isLocked = storedLockState === 'true';
        }
    }

    // タイムスタンプを記録
    function recordTimestamp() {
        let video = document.querySelector('video');
        if (video) {
            let currentTime = video.currentTime;
            let hours = Math.floor(currentTime / 3600);
            let minutes = Math.floor((currentTime % 3600) / 60);
            let seconds = Math.floor(currentTime % 60);
            let formattedTimestamp = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} [${(timestamps.length + 1).toString().padStart(2, '0')}]`;
            timestamps.unshift(formattedTimestamp);
            saveTimestamps();
            updateTimestampList();

            // 初回ユーザー向けヒント表示
            if (firstTimeUser && timestamps.length === 1) {
                localStorage.setItem('timestampFirstTime', 'false');
                firstTimeUser = false;
            }
        } else {
            showErrorMessage("動画が見つかりませんでした。ページをリフレッシュして再試行してください！");
        }
    }

    // タイムスタンプリストを更新
    function updateTimestampList() {
        let list = document.getElementById("timestamp-list");
        if (list) {
            while (list.firstChild) {
                list.removeChild(list.firstChild);
            }

            if (isAscending) {
                timestamps.sort();
            } else {
                timestamps.sort().reverse();
            }

            // 空の状態のガイドを表示
            if (timestamps.length === 0 && firstTimeUser) {
                const emptyGuide = document.createElement('div');
                emptyGuide.innerHTML = '記録したタイムスタンプがここに表示されます<br><span style="font-size:24px">⬇️</span>';
                emptyGuide.style.textAlign = 'center';
                emptyGuide.style.padding = '20px';
                emptyGuide.style.color = '#666';
                emptyGuide.style.fontSize = '14px';
                list.appendChild(emptyGuide);
                return;
            }

            timestamps.forEach((t, index) => {
                let listItem = document.createElement("li");
                listItem.style.display = "flex";
                listItem.style.alignItems = "center";
                listItem.style.marginBottom = "4px";
                listItem.style.padding = "2px";
                listItem.style.width = "100%";
                listItem.style.overflow = "visible";
                listItem.style.flexWrap = "nowrap";
                listItem.style.whiteSpace = "nowrap";
                listItem.style.textOverflow = "ellipsis";
                listItem.style.flexGrow = "1";

                // ジャンプアイコンを追加
                let jumpIcon = document.createElement("span");
                jumpIcon.textContent = "▶️";
                jumpIcon.style.marginRight = "8px";
                jumpIcon.style.cursor = "pointer";
                jumpIcon.style.fontSize = "20px";
                jumpIcon.title = "クリックでジャンプ";

                jumpIcon.onclick = function(e) {
                    jumpToTimestamp(t);
                };

                let deleteButton = document.createElement("button");
                deleteButton.textContent = "削除";
                deleteButton.classList.add("delete-btn");
                deleteButton.style.fontSize = "14px";
                deleteButton.style.padding = "10px 20px";
                deleteButton.style.marginRight = "6px";
                deleteButton.style.background = "#FF6B6B";
                deleteButton.style.color = "black";
                deleteButton.style.border = "1px solid #D63A3A";
                deleteButton.style.fontWeight = "bold";
                deleteButton.style.transition = "background-color 0.3s, transform 0.2s";

                deleteButton.onmouseover = function() {
                    deleteButton.style.background = "#FF4C4C";
                };

                deleteButton.onmouseleave = function() {
                    deleteButton.style.background = "#FF6B6B";
                };

                deleteButton.onmousedown = function() {
                    deleteButton.style.background = "#D63A3A";
                    deleteButton.style.transform = "scale(0.95)";
                };

                deleteButton.onmouseup = function() {
                    deleteButton.style.background = "#FF4C4C";
                    deleteButton.style.transform = "scale(1)";
                };

                deleteButton.onclick = function() {
                    deleteTimestamp(index);
                };

                let displayContainer = document.createElement("div");
                displayContainer.style.display = "flex";
                displayContainer.style.alignItems = "center";
                displayContainer.style.flexGrow = "1";
                displayContainer.style.minWidth = "250px";
                displayContainer.style.marginRight = "20px";

                let displayText = document.createElement("div");
                displayText.style.textAlign = "left"; // 文字靠左對齊
                displayText.style.paddingLeft = "10px"; // 左側增加內邊距
                displayText.textContent = t;
                displayText.style.flexGrow = "1";
                displayText.style.padding = "10px 2px";
                displayText.style.fontSize = "16px";
                displayText.style.background = "#A3C9D9";
                displayText.style.color = "black";
                displayText.style.fontWeight = "bold";
                displayText.style.border = "1px solid #9BBED4";
                displayText.style.whiteSpace = "nowrap";
                displayText.style.overflowX = "auto";
                displayText.style.cursor = "text";
                displayText.title = "左クリックで編集 / Ctrl+クリックでジャンプ / 右クリックメニュー";

                let inputField = document.createElement("input");
                inputField.type = "text";
                inputField.value = t;
                inputField.style.display = "none";
                inputField.style.flexGrow = "1";
                inputField.style.padding = "10px 2px";
                inputField.style.fontSize = "16px";
                inputField.style.background = "#88B8D9";
                inputField.style.border = "1px solid #7AA8C9";

                displayText.onclick = function(e) {
                    if (e.ctrlKey) {
                        jumpToTimestamp(t);
                    } else {
                        // 進入編輯模式
                        currentEditIndex = index;
                        displayText.style.display = "none";
                        inputField.style.display = "block";
                        inputField.focus();
                        inputField.select();
                    }
                };

                // 在 updateTimestampList 函數中修改輸入框的事件處理
                inputField.addEventListener("keydown", function(e) {
                    if (e.key === "Enter") {
                        const newTimestamp = inputField.value;
                        if (newTimestamp !== t) {
                            timestamps[index] = newTimestamp; // 直接更新陣列
                            saveTimestamps(); // 立即保存
                            displayText.textContent = newTimestamp;
                            // 更新跳轉功能的時間值
                            jumpIcon.onclick = function(e) {
                                jumpToTimestamp(newTimestamp);
                            };
                        }
                        inputField.style.display = "none";
                        displayText.style.display = "block";
                        e.preventDefault(); // 防止預設行為影響
                    }
                });

                inputField.addEventListener("blur", function() {
                    const newTimestamp = inputField.value;
                    if (newTimestamp !== t) {
                        timestamps[index] = newTimestamp;
                        saveTimestamps();
                        displayText.textContent = newTimestamp;
                        // 更新跳轉功能的時間值
                        jumpIcon.onclick = function(e) {
                            jumpToTimestamp(newTimestamp);
                        };
                    }
                    inputField.style.display = "none";
                    displayText.style.display = "block";
                });
                displayText.oncontextmenu = function(e) {
                    e.preventDefault();
                    showTimestampContextMenu(e, t, displayText);
                };

                displayContainer.appendChild(displayText);
                displayContainer.appendChild(inputField);

                let itemContainer = document.createElement("div");
                itemContainer.style.display = "flex";
                itemContainer.style.alignItems = "center";
                itemContainer.style.flexWrap = "nowrap";
                itemContainer.style.width = "100%";
                itemContainer.style.minWidth = "400px";
                itemContainer.style.padding = "0";
                itemContainer.style.overflow = "visible";
                itemContainer.style.flexGrow = "1";

                itemContainer.appendChild(jumpIcon);
                itemContainer.appendChild(deleteButton);
                itemContainer.appendChild(displayContainer);

                listItem.appendChild(itemContainer);
                list.appendChild(listItem);

                let updateWidth = () => {
                    let width = itemContainer.scrollWidth;
                    itemContainer.style.width = `${width + 20}px`;
                };

                setTimeout(updateWidth, 100);
            });
        }
    }

    // クリップボードにコピー
    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            showCustomCopySuccessMessage(text);
        }).catch(err => {
            console.error('コピー失敗', err);
        });
    }

    // カスタムコピー成功メッセージを表示
    function showCustomCopySuccessMessage(text) {
        let messageBox = document.createElement("div");
        messageBox.textContent = `コピー成功: ${text}`;
        messageBox.style.position = "fixed";
        messageBox.style.top = "10px";
        messageBox.style.left = "50%";
        messageBox.style.transform = "translateX(-50%)";
        messageBox.style.padding = "10px 20px";
        messageBox.style.backgroundColor = "#28a745";
        messageBox.style.color = "white";
        messageBox.style.fontSize = "14px";
        messageBox.style.borderRadius = "5px";
        messageBox.style.boxShadow = "2px 2px 8px rgba(0, 0, 0, 0.2)";
        messageBox.style.zIndex = "9999";

        setTimeout(() => {
            messageBox.style.opacity = "0";
            setTimeout(() => {
                messageBox.remove();
            }, 500);
        }, 2000);

        document.body.appendChild(messageBox);
    }

    // タイムスタンプを削除
    function deleteTimestamp(index) {
        timestamps.splice(index, 1);
        saveTimestamps();
        updateTimestampList();
    }

    // タイムスタンプにジャンプ
   function jumpToTimestamp(timestamp) {
    // 支援格式：
    // 1. "1:23:45 [01]"（舊格式）
    // 2. "2:23:45 [01]"（編輯後格式）
    // 3. "2:23:45 註解"（自訂格式）
    const timePattern = /^(\d+):(\d{2}):(\d{2})/; // 嚴格匹配開頭
    const match = timestamp.match(timePattern);

    if (match) {
        const hours = parseInt(match[1], 10);   // 確保用 10 進制解析
        const minutes = parseInt(match[2], 10);
        const seconds = parseInt(match[3], 10);

        const totalSeconds = hours * 3600 + minutes * 60 + seconds;
        console.log(`解析時間: ${hours}:${minutes}:${seconds} → ${totalSeconds}秒`); // 除錯用

        const video = document.querySelector('video');
        if (video) {
            video.currentTime = totalSeconds;
            video.play();
            showJumpSuccessMessage(timestamp);
        }
    } else {
        console.error("無法解析時間戳記:", timestamp); // 除錯用
        showErrorMessage("時間格式錯誤！請使用「時:分:秒」格式，例如：2:23:45");
    }
}

    // ジャンプ成功メッセージを表示
    function showJumpSuccessMessage(timestamp) {
        let messageBox = document.createElement("div");
        messageBox.textContent = `ジャンプ成功: ${timestamp}`;
        messageBox.style.position = "fixed";
        messageBox.style.top = "10px";
        messageBox.style.left = "50%";
        messageBox.style.transform = "translateX(-50%)";
        messageBox.style.padding = "10px 20px";
        messageBox.style.backgroundColor = "#4285F4";
        messageBox.style.color = "white";
        messageBox.style.fontSize = "14px";
        messageBox.style.borderRadius = "5px";
        messageBox.style.boxShadow = "2px 2px 8px rgba(0, 0, 0, 0.2)";
        messageBox.style.zIndex = "9999";

        setTimeout(() => {
            messageBox.style.opacity = "0";
            setTimeout(() => {
                messageBox.remove();
            }, 500);
        }, 2000);

        document.body.appendChild(messageBox);
    }

    // タイムスタンプの右クリックメニューを表示
    function showTimestampContextMenu(e, timestamp, button) {
        const existingMenu = document.getElementById('timestamp-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.id = 'timestamp-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.style.backgroundColor = 'white';
        menu.style.border = '1px solid #ddd';
        menu.style.borderRadius = '4px';
        menu.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
        menu.style.zIndex = '10000';
        menu.style.padding = '5px 0';
        menu.style.minWidth = '150px';

        // 使用當前顯示的文本作為時間戳記（可能是編輯後的內容）
        const currentTimestamp = button.textContent || timestamp;

        const jumpOption = document.createElement('div');
        jumpOption.textContent = 'タイムラインジャンプ';
        jumpOption.style.padding = '8px 15px';
        jumpOption.style.cursor = 'pointer';
        jumpOption.style.fontSize = '14px';

        jumpOption.onmouseover = function() {
            jumpOption.style.backgroundColor = '#f0f0f0';
        };
        jumpOption.onmouseout = function() {
            jumpOption.style.backgroundColor = 'transparent';
        };
        jumpOption.onclick = function() {
            jumpToTimestamp(currentTimestamp);  // 使用當前顯示的文本
            menu.remove();
        };


        const copyOption = document.createElement('div');
        copyOption.textContent = 'コピー';
        copyOption.style.padding = '8px 15px';
        copyOption.style.cursor = 'pointer';
        copyOption.style.fontSize = '14px';

        copyOption.onmouseover = function() {
            copyOption.style.backgroundColor = '#f0f0f0';
        };
        copyOption.onmouseout = function() {
            copyOption.style.backgroundColor = 'transparent';
        };
        copyOption.onclick = function() {
            copyToClipboard(currentTimestamp);  // 使用當前顯示的文本
            menu.remove();
        };

        menu.appendChild(jumpOption);
        menu.appendChild(copyOption);
        document.body.appendChild(menu);

        const closeMenu = function() {
            menu.remove();
            document.removeEventListener('click', closeMenu);
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 10);
    }

    // ドラッグ可能にする
    function makeDraggable(element, allowDrag = true) {
        let dragHandle = document.createElement("div");
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

        let buttonContainer = element.querySelector('div[style*="justify-content: flex-start"]');
        if (buttonContainer) {
            buttonContainer.insertBefore(dragHandle, buttonContainer.firstChild);
            buttonContainer.style.justifyContent = "flex-start";
        }

        dragHandle.addEventListener('mousedown', function(e) {
            if (isLocked || !allowDrag) return;
            if (e.button !== 0) return;

            let rect = element.getBoundingClientRect();
            let isResizeArea =
                e.clientX > rect.right - 15 &&
                e.clientY > rect.bottom - 15;

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
            let newLeft = e.clientX - offsetX;
            let newTop = e.clientY - offsetY;
            element.style.left = `${newLeft}px`;
            element.style.top = `${newTop}px`;
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

    // 表示/非表示を切り替え
    function toggleVisibility() {
        isHidden = !isHidden;
        applyHiddenState();
        localStorage.setItem('timestampHiddenState', isHidden);
        hideButton.style.transform = "scale(0.95)";
        setTimeout(() => hideButton.style.transform = "scale(1)", 100);
    }

    // UIを追加
    function addUI() {
        if (isHidden) applyHiddenState();
        container = document.createElement("div");
        container.style.position = "absolute";

        const savedPosition = loadContainerPosition();
        container.style.left = savedPosition.left;
        container.style.top = savedPosition.top;
        container.style.zIndex = "9999";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.alignItems = "center";
        container.style.background = "transparent";
        container.style.pointerEvents = "auto";

        btn = document.createElement("button");
        btn.textContent = "タイムスタンプ記録";
        btn.style.padding = "10px 50px";
        btn.style.background = "linear-gradient(to bottom, #FFFFFF, #E0F7FA)";
        btn.style.color = "black";
        btn.style.border = "2px solid #A0C4FF";
        btn.style.boxShadow = "2px 2px 6px rgba(0, 0, 0, 0.2)";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "18px";
        btn.style.fontWeight = "bold";
        btn.style.borderRadius = "6px";
        btn.style.pointerEvents = "auto";
        btn.style.zIndex = "101";
        btn.style.position = "relative";
        btn.style.top = "-1px";

        btn.onmouseover = function () {
            btn.style.background = "linear-gradient(to bottom, #E0F7FA, #B2EBF2)";
        };

        btn.onmouseout = function () {
            btn.style.background = "linear-gradient(to bottom, #FFFFFF, #E0F7FA)";
        };

        btn.onmousedown = function () {
            btn.style.background = "linear-gradient(to bottom, #B2EBF2, #80DEEA)";
        };

        btn.onmouseup = function () {
            btn.style.background = "linear-gradient(to bottom, #E0F7FA, #B2EBF2)";
        };

        btn.onclick = recordTimestamp;
        container.appendChild(btn);
        document.body.appendChild(container);

        let listContainer = document.createElement("div");
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

        listContainer.addEventListener('mouseup', function() {
            saveContainerPosition();
        });

        listContainer.addEventListener('resize', function() {
            saveContainerPosition();
        });

        let buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = `
            display: flex;
            padding: 8px;
            gap: 5px;
            background: #f5f5f5;
            border-bottom: 1px solid #ddd;
            justify-content: flex-start;
            align-items: center;
        `;

        let copyAllButton = document.createElement("button");
        copyAllButton.textContent = "全部コピー";
        copyAllButton.style.padding = "12px 20px";
        copyAllButton.style.fontSize = "14px";
        copyAllButton.classList.add("no-drag");
        copyAllButton.style.background = "linear-gradient(to bottom, #A8E6A0, #52C41A)";
        copyAllButton.style.color = "black";
        copyAllButton.style.border = "1px solid #3A8F12";
        copyAllButton.style.fontWeight = "bold";
        copyAllButton.style.transition = "background-color 0.3s, transform 0.2s";

        copyAllButton.onmouseover = function () {
            copyAllButton.style.background = "linear-gradient(to bottom, #9AE89F, #66B22C)";
        };
        copyAllButton.onmouseleave = function () {
            copyAllButton.style.background = "linear-gradient(to bottom, #A8E6A0, #52C41A)";
        };
        copyAllButton.onmousedown = function () {
            copyAllButton.style.background = "linear-gradient(to bottom, #74B94F, #4E9B16)";
            copyAllButton.style.transform = "scale(0.95)";
        };
        copyAllButton.onmouseup = function () {
            copyAllButton.style.background = "linear-gradient(to bottom, #9AE89F, #66B22C)";
            copyAllButton.style.transform = "scale(1)";
        };

        copyAllButton.onclick = function () {
            copyAllTimestamps();
        };

        let sortButton = document.createElement("button");
        sortButton.textContent = "並べ替え";
        sortButton.style.padding = "12px 20px";
        sortButton.style.fontSize = "14px";
        sortButton.classList.add("no-drag");
        sortButton.style.background = "linear-gradient(to bottom, #FFB6C1, #FF69B4)";
        sortButton.style.color = "black";
        sortButton.style.border = "1px solid #FF1493";
        sortButton.style.fontWeight = "bold";
        sortButton.style.transition = "background-color 0.3s, transform 0.2s";

        sortButton.onmouseover = function () {
            sortButton.style.background = "linear-gradient(to bottom, #FF9AAB, #FF4D92)";
        };
        sortButton.onmouseleave = function () {
            sortButton.style.background = "linear-gradient(to bottom, #FFB6C1, #FF69B4)";
        };
        sortButton.onmousedown = function () {
            sortButton.style.background = "linear-gradient(to bottom, #FF7C92, #FF3385)";
            sortButton.style.transform = "scale(0.95)";
        };
        sortButton.onmouseup = function () {
            sortButton.style.background = "linear-gradient(to bottom, #FF9AAB, #FF4D92)";
            sortButton.style.transform = "scale(1)";
        };

        function toggleSortOrder() {
            isAscending = !isAscending;
            updateTimestampList();
            sortButton.style.transform = "scale(0.95)";
            setTimeout(() => sortButton.style.transform = "scale(1)", 100);
        }

        sortButton.onclick = function () {
            toggleSortOrder();
        };

        let deleteAllButton = document.createElement("button");
        deleteAllButton.textContent = "X";
        deleteAllButton.style.padding = "12px 15px";
        deleteAllButton.style.fontSize = "16px";
        deleteAllButton.classList.add("no-drag");
        deleteAllButton.style.background = "linear-gradient(to bottom, #FF6F61, #FF3B30)";
        deleteAllButton.style.color = "white";
        deleteAllButton.style.border = "none";
        deleteAllButton.style.fontWeight = "bold";
        deleteAllButton.style.transition = "background-color 0.3s, transform 0.2s";
        deleteAllButton.style.borderRadius = "50%";

        deleteAllButton.onmouseover = function () {
            deleteAllButton.style.background = "linear-gradient(to bottom, #FF5A47, #FF3A32)";
        };
        deleteAllButton.onmouseleave = function () {
            deleteAllButton.style.background = "linear-gradient(to bottom, #FF6F61, #FF3B30)";
        };
        deleteAllButton.onmousedown = function () {
            deleteAllButton.style.background = "linear-gradient(to bottom, #FF4B3E, #FF1F18)";
            deleteAllButton.style.transform = "scale(0.95)";
        };
        deleteAllButton.onmouseup = function () {
            deleteAllButton.style.background = "linear-gradient(to bottom, #FF5A47, #FF3A32)";
            deleteAllButton.style.transform = "scale(1)";
        };

        deleteAllButton.onclick = function () {
            showConfirmModal();
        };

        function showConfirmModal() {
            let modal = document.createElement("div");
            modal.style.position = "fixed";
            modal.style.top = "0";
            modal.style.left = "0";
            modal.style.width = "100%";
            modal.style.height = "100%";
            modal.style.backgroundColor = "transparent";
            modal.style.display = "flex";
            modal.style.justifyContent = "center";
            modal.style.alignItems = "center";
            modal.style.zIndex = "10000";

            let modalContent = document.createElement("div");
            modalContent.style.backgroundColor = "#fff";
            modalContent.style.padding = "20px";
            modalContent.style.border = "4px solid #FF3B30";
            modalContent.style.borderRadius = "12px";
            modalContent.style.boxShadow = "0 5px 25px rgba(255, 59, 48, 0.3)";
            modalContent.style.width = "300px";
            modalContent.style.textAlign = "center";
            modalContent.style.cursor = "move";
            modalContent.style.position = "absolute";

            let message = document.createElement("p");
            message.textContent = "すべての記録を削除しますか？";
            message.style.fontSize = "16px";
            message.style.fontWeight = "bold";
            message.style.color = "red";

            let isDragging = false;
            let offsetX, offsetY;

            modalContent.addEventListener('mousedown', function(e) {
                if (e.target.tagName === 'BUTTON') return;
                isDragging = true;
                offsetX = e.clientX - modalContent.getBoundingClientRect().left;
                offsetY = e.clientY - modalContent.getBoundingClientRect().top;
            });

            modalContent.addEventListener('selectstart', function(e) {
                if (!isDragging) return true;
                e.preventDefault();
                return false;
            });

            document.addEventListener('mousemove', function(e) {
                if (!isDragging) return;
                modalContent.style.left = (e.clientX - offsetX) + 'px';
                modalContent.style.top = (e.clientY - offsetY) + 'px';
            });

            document.addEventListener('mouseup', function() {
                isDragging = false;
            });

            let buttonContainer = document.createElement("div");
            buttonContainer.style.marginTop = "15px";
            buttonContainer.style.display = "flex";
            buttonContainer.style.justifyContent = "center";
            buttonContainer.style.gap = "10px";

            let cancelButton = document.createElement("button");
            cancelButton.textContent = "いいえ";
            cancelButton.style.padding = "12px 30px";
            cancelButton.style.fontSize = "16px";
            cancelButton.style.width = "140px";
            cancelButton.style.backgroundColor = "#999";
            cancelButton.style.color = "#202124";
            cancelButton.style.fontWeight = "600";
            cancelButton.style.border = "none";
            cancelButton.style.cursor = "pointer";
            cancelButton.style.borderRadius = "6px";

            let confirmButton = document.createElement("button");
            confirmButton.textContent = "削除";
            confirmButton.style.padding = "12px 30px";
            confirmButton.style.fontSize = "16px";
            confirmButton.style.width = "140px";
            confirmButton.style.backgroundColor = "#e74c3c";
            confirmButton.style.color = "white";
            confirmButton.style.textShadow = "0 1px 1px rgba(0, 0, 0, 0.3)";
            confirmButton.style.fontWeight = "600";
            confirmButton.style.border = "none";
            confirmButton.style.cursor = "pointer";
            confirmButton.style.borderRadius = "6px";

            cancelButton.onclick = function () {
                document.body.removeChild(modal);
            };

            confirmButton.onclick = function () {
                deleteAllTimestamps();
                document.body.removeChild(modal);
            };

            buttonContainer.appendChild(cancelButton);
            buttonContainer.appendChild(confirmButton);

            modalContent.appendChild(message);
            modalContent.appendChild(buttonContainer);

            modal.appendChild(modalContent);
            document.body.appendChild(modal);

            document.onmousemove = function (e) {
                if (isDragging) {
                    let x = e.clientX - offsetX;
                    let y = e.clientY - offsetY;
                    modalContent.style.left = x + "px";
                    modalContent.style.top = y + "px";
                }
            };

            cancelButton.addEventListener("mouseover", function() {
                cancelButton.style.backgroundColor = "#666";
            });
            cancelButton.addEventListener("mouseout", function() {
                cancelButton.style.backgroundColor = "#999";
            });
            cancelButton.addEventListener("mousedown", function() {
                cancelButton.style.transform = "scale(0.95)";
            });
            cancelButton.addEventListener("mouseup", function() {
                cancelButton.style.transform = "scale(1)";
            });

            confirmButton.addEventListener("mouseover", function() {
                confirmButton.style.backgroundColor = "#c0392b";
            });
            confirmButton.addEventListener("mouseout", function() {
                confirmButton.style.backgroundColor = "#e74c3c";
            });
            confirmButton.addEventListener("mousedown", function() {
                confirmButton.style.transform = "scale(0.95)";
            });
            confirmButton.addEventListener("mouseup", function() {
                confirmButton.style.transform = "scale(1)";
            });
        }

        function deleteAllTimestamps() {
            timestamps = [];
            saveTimestamps();
            updateTimestampList();
        }

        buttonContainer.appendChild(copyAllButton);
        buttonContainer.appendChild(sortButton);
        buttonContainer.appendChild(deleteAllButton);

        listContainer.appendChild(buttonContainer);

        let ul = document.createElement("ul");
        ul.id = "timestamp-list";
        ul.style.listStyleType = "none";
        ul.style.padding = "0";
        ul.style.margin = "0";
        ul.style.textAlign = "center";
        listContainer.appendChild(ul);
        container.appendChild(listContainer);

        let buttonRow = document.createElement("div");
        buttonRow.style.display = "flex";
        buttonRow.style.justifyContent = "space-between";
        buttonRow.style.width = "100%";
        buttonRow.style.marginTop = "5px";
        buttonRow.style.gap = "10px";

        lockButton = document.createElement("button");
        lockButton.textContent = "ロック";
        lockButton.style.padding = "8px 16px";
        lockButton.style.width = "60px";
        lockButton.style.background = "linear-gradient(to bottom, #4CAF50, #388E3C)";
        lockButton.style.color = "white";
        lockButton.style.border = "none";
        lockButton.style.cursor = "pointer";
        lockButton.style.fontSize = "14px";
        lockButton.style.fontWeight = "bold";
        lockButton.style.borderRadius = "6px";
        lockButton.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
        lockButton.style.transition = "all 0.3s ease";
        lockButton.style.flex = "1";

        lockButton.onmouseover = function() {
            lockButton.style.background = isLocked
                ? "linear-gradient(to bottom, #D32F2F, #B71C1C)"
                : "linear-gradient(to bottom, #388E3C, #2E7D32)";
            lockButton.style.boxShadow = "0 3px 8px rgba(0,0,0,0.3)";
        };
        lockButton.onmouseleave = function() {
            lockButton.style.background = isLocked
                ? "linear-gradient(to bottom, #FF5252, #D32F2F)"
                : "linear-gradient(to bottom, #4CAF50, #388E3C)";
            lockButton.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
        };
        lockButton.onmousedown = function() {
            lockButton.style.transform = "scale(0.98)";
        };
        lockButton.onmouseup = function() {
            lockButton.style.transform = "scale(1)";
        };

        lockButton.onclick = function() {
            toggleLock();
        };

        function toggleLock() {
            isLocked = !isLocked;
            lockButton.textContent = isLocked ? "アンロック" : "ロック";

            if (isLocked) {
                lockButton.style.background = "linear-gradient(to bottom, #FF5252, #D32F2F)";
                hideButton.style.cursor = "pointer";
            } else {
                lockButton.style.background = "linear-gradient(to bottom, #4CAF50, #388E3C)";
                hideButton.style.cursor = "default";
            }

            localStorage.setItem('timestampLockState', isLocked);
            lockButton.style.transform = "scale(0.95)";
            setTimeout(() => lockButton.style.transform = "scale(1)", 100);

            let listContainer = container.querySelector('div[style*="resize"]');
            if (listContainer) {
                listContainer.style.resize = isLocked ? "none" : "both";
            }
        }

        loadSettings();

        hideButton = document.createElement("button");
        hideButton.textContent = "隠す";
        hideButton.style.padding = "8px 16px";
        hideButton.style.width = "auto";
        hideButton.style.background = "linear-gradient(to bottom, #2196F3, #1976D2)";
        hideButton.style.color = "white";
        hideButton.style.border = "none";
        hideButton.style.cursor = isLocked ? "pointer" : "default";
        hideButton.style.fontSize = "14px";
        hideButton.style.fontWeight = "bold";
        hideButton.style.borderRadius = "6px";
        hideButton.style.boxShadow = "0 2px 5px rgba(0,0,0,0.2)";
        hideButton.style.transition = "all 0.3s ease";
        hideButton.style.flex = "0 0 60px";
        hideButton.style.whiteSpace = "nowrap";
        hideButton.style.writingMode = "horizontal-tb";

        let globalMouseMoveHandler, globalMouseUpHandler;

        hideButton.addEventListener('mousedown', function(e) {
            if (e.button === 0) {
                dragStartTime = Date.now();
                isDraggingFromHideButton = false;
                offsetX = e.clientX - container.getBoundingClientRect().left;
                offsetY = e.clientY - container.getBoundingClientRect().top;
                document.body.style.cursor = 'move';
                document.onselectstart = () => false;

                globalMouseMoveHandler = function(e) {
                    if (Date.now() - dragStartTime > DRAG_THRESHOLD) {
                        isDraggingFromHideButton = true;
                        let newLeft = e.clientX - offsetX;
                        let newTop = e.clientY - offsetY;
                        container.style.left = `${newLeft}px`;
                        container.style.top = `${newTop}px`;
                    }
                };

                globalMouseUpHandler = function(e) {
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

                    document.removeEventListener('mousemove', globalMouseMoveHandler);
                    document.removeEventListener('mouseup', globalMouseUpHandler);
                };

                document.addEventListener('mousemove', globalMouseMoveHandler);
                document.addEventListener('mouseup', globalMouseUpHandler);
            }
        });

        buttonRow.appendChild(lockButton);
        buttonRow.appendChild(hideButton);

        container.appendChild(buttonRow);

        document.body.appendChild(container);

        makeDraggable(container, true);

        loadTimestamps();
        updateTimestampList();
        applyHiddenState();

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
                if (child !== buttonRow) {
                    child.style.opacity = isHidden ? "0" : "1";
                    child.style.pointerEvents = isHidden ? "none" : "auto";
                }
            });

            if (buttonRow) {
                lockButton.style.opacity = isHidden ? "0" : "1";
                lockButton.style.pointerEvents = isHidden ? "none" : "auto";
                hideButton.style.opacity = "1";
                hideButton.style.pointerEvents = "auto";
            }

            hideButton.textContent = isHidden ? "表示" : "隠す";
            hideButton.style.background = isHidden ? "linear-gradient(to bottom, #FF5252, #D32F2F)"
                : "linear-gradient(to bottom, #2196F3, #1976D2)";

            container.style.pointerEvents = isHidden ? "none" : "auto";
        }

        // 使用説明ツールチップを追加
        setTimeout(() => {
            const tooltip = document.createElement('div');
            tooltip.textContent = 'ヒント: 左クリックで編集 / Ctrl+クリックでジャンプ / 右クリックでメニュー';
            tooltip.style.position = 'fixed';
            tooltip.style.bottom = '20px';
            tooltip.style.right = '20px';
            tooltip.style.backgroundColor = 'rgba(0,0,0,0.7)';
            tooltip.style.color = 'white';
            tooltip.style.padding = '8px 12px';
            tooltip.style.borderRadius = '4px';
            tooltip.style.fontSize = '14px';
            tooltip.style.zIndex = '9999';
            tooltip.style.animation = 'fadeIn 0.5s';

            document.body.appendChild(tooltip);

            setTimeout(() => {
                tooltip.style.opacity = '0';
                setTimeout(() => {
                    tooltip.remove();
                }, 500);
            }, 5000);
        }, 3000);
    }

    // すべてのタイムスタンプをコピー
    function copyAllTimestamps() {
        let allTimestamps = timestamps.join('\n');
        navigator.clipboard.writeText(allTimestamps).then(() => {
            showCopySuccessMessage(allTimestamps);
        }).catch(err => {
            console.error('コピーに失敗しました', err);
        });
    }

    // エラーメッセージを表示
    function showErrorMessage(message) {
        alert(message);
    }

    // コピー成功メッセージを表示
    function showCopySuccessMessage(text) {
        let messageBox = document.createElement("div");
        messageBox.textContent = `コピーしました: ${text}`;
        messageBox.style.position = "fixed";
        messageBox.style.top = "10px";
        messageBox.style.left = "50%";
        messageBox.style.transform = "translateX(-50%)";
        messageBox.style.padding = "10px 20px";
        messageBox.style.backgroundColor = "#28a745";
        messageBox.style.color = "white";
        messageBox.style.fontSize = "14px";
        messageBox.style.borderRadius = "5px";
        messageBox.style.boxShadow = "2px 2px 8px rgba(0, 0, 0, 0.2)";
        messageBox.style.zIndex = "9999";

        setTimeout(() => {
            messageBox.style.opacity = "0";
            setTimeout(() => {
                messageBox.remove();
            }, 500);
        }, 2000);

        document.body.appendChild(messageBox);
    }

    // タイムスタンプを保存
    function saveTimestamps() {
        localStorage.setItem('timestamps', JSON.stringify(timestamps));
    }

    // フェードインアニメーションを追加
    const style = document.createElement('style');
    style.textContent = `
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }
    `;
    document.head.appendChild(style);

    // 初期化
    loadSettings();
    loadTimestamps();
    addUI();
    updateTimestampList();
})();
