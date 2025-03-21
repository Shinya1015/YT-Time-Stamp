// ==UserScript==
// @name         タイムスタンプ記録
// @namespace    https://www.youtube.com/
// @version      6.1
// @description  タイムスタンプを記録、並べ替え機能追加
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
    let isAscending = false; // 默认按升序排列
    let isHidden = false;  // 添加一个隐藏状态

    function loadTimestamps() {
        let storedTimestamps = localStorage.getItem('timestamps');
        if (storedTimestamps) {
            timestamps = JSON.parse(storedTimestamps);
        }
    }

function saveTimestamps() {
    localStorage.setItem('timestamps', JSON.stringify(timestamps));
}

function recordTimestamp() {
    let video = document.querySelector('video');
    if (video) {
        let currentTime = video.currentTime;
        let hours = Math.floor(currentTime / 3600);
        let minutes = Math.floor((currentTime % 3600) / 60);
        let seconds = Math.floor(currentTime % 60);
        let formattedTimestamp = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        timestamps.unshift(formattedTimestamp); // 插入新的时间戳到数组前面
        saveTimestamps();
        updateTimestampList();
    } else {
        showErrorMessage("動画が見つかりませんでした。ページをリフレッシュして再試行してください！");
    }
}

function updateTimestampList() {
    let list = document.getElementById("timestamp-list");
    if (list) {
        while (list.firstChild) {
            list.removeChild(list.firstChild);
        }

        // 按照升序或降序排序时间戳
        if (isAscending) {
            timestamps.sort(); // 默认按升序排列
        } else {
            timestamps.sort().reverse(); // 反向排序
        }

        timestamps.forEach((t, index) => {
            let listItem = document.createElement("li");

            let displayText = `${t}`; // 只保留时间戳，去掉 []

            let copyButton = document.createElement("button");
            copyButton.textContent = displayText;
            copyButton.classList.add("copy-btn");
            copyButton.style.fontSize = "14px";
            copyButton.style.padding = "12px 48px"; // 增加按钮宽度
            copyButton.onclick = function() {
                copyToClipboard(displayText);
            };

            let deleteButton = document.createElement("button");
            deleteButton.textContent = "削除";
            deleteButton.classList.add("delete-btn");
            deleteButton.style.fontSize = "12px";
            deleteButton.style.padding = "12px 30px"; // 增加按钮宽度
            deleteButton.onclick = function() {
                deleteTimestamp(index);
            };

            listItem.appendChild(copyButton);
            listItem.appendChild(deleteButton);
            list.appendChild(listItem);
        });

        setTimeout(() => {
            list.scrollTop = list.scrollHeight;
        }, 100);
    }
}

function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showCustomCopySuccessMessage(text);
    }).catch(err => {
        console.error('コピーに失敗しました', err);  // 如果复制失败，输出错误信息
    });
}

function showCustomCopySuccessMessage(text) {
    let messageBox = document.createElement("div");
    messageBox.textContent = `コピー成功: ${text}`;
    messageBox.style.position = "fixed";
    messageBox.style.top = "10px";
    messageBox.style.left = "50%";
    messageBox.style.transform = "translateX(-50%)";
    messageBox.style.padding = "10px 20px";
    messageBox.style.backgroundColor = "#28a745";  // 成功绿色背景
    messageBox.style.color = "white";
    messageBox.style.fontSize = "14px";
    messageBox.style.borderRadius = "5px";
    messageBox.style.boxShadow = "2px 2px 8px rgba(0, 0, 0, 0.2)";
    messageBox.style.zIndex = "9999";

    // 自动隐藏通知
    setTimeout(() => {
        messageBox.style.opacity = "0";
        setTimeout(() => {
            messageBox.remove();
        }, 500);  // 延迟时间与动画效果匹配
    }, 2000);  // 通知显示2秒

    document.body.appendChild(messageBox);
}


    function deleteTimestamp(index) {
        timestamps.splice(index, 1);
        saveTimestamps();
        updateTimestampList();
    }

    function makeDraggable(element) {
        element.addEventListener('mousedown', function(e) {
            if (e.target && (e.target.classList.contains('delete-btn') || e.target.classList.contains('copy-btn') || e.target.classList.contains('no-drag'))) {
                return;
            }

            if (isLocked) return;

            e.preventDefault();
            isDragging = true;
            offsetX = e.clientX - element.getBoundingClientRect().left;
            offsetY = e.clientY - element.getBoundingClientRect().top;
            document.body.style.cursor = 'move';
        });

        document.addEventListener('mousemove', function(e) {
            if (isDragging) {
                let newLeft = e.clientX - offsetX;
                let newTop = e.clientY - offsetY;
                element.style.left = `${newLeft}px`;
                element.style.top = `${newTop}px`;
            }
        });

        document.addEventListener('mouseup', function() {
            isDragging = false;
            document.body.style.cursor = '';
        });
    }

    function addUI() {
        container = document.createElement("div");
        container.style.position = "fixed";
        container.style.top = "500px";
        container.style.left = "380px";  // Adjusted position to the left side
        container.style.zIndex = "9999"; // Ensure it's on top of other elements
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.alignItems = "center";
        container.style.background = "transparent";
        container.style.pointerEvents = "auto";

        btn = document.createElement("button");
        btn.textContent = "タイムスタンプ記録";
        btn.style.padding = "10px 70px";
        btn.style.background = "red";
        btn.style.color = "white";
        btn.style.border = "none";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "18px";
        btn.style.fontWeight = "bold";
        btn.style.borderRadius = "6px";
        btn.style.boxShadow = "2px 2px 6px rgba(0, 0, 0, 0.2)";
        btn.style.pointerEvents = "auto";
        btn.style.zIndex = "101";
        btn.onclick = recordTimestamp;
        container.appendChild(btn);

        let listContainer = document.createElement("div");
        listContainer.style.background = "white";
        listContainer.style.padding = "8px";
        listContainer.style.border = "1px solid black";
        listContainer.style.maxHeight = "150px";
        listContainer.style.overflowY = "auto";
        listContainer.style.zIndex = "9999";
        listContainer.style.pointerEvents = "auto";
        listContainer.style.width = "300px"; // 设置固定宽度，确保框框大小不变

        let heading = document.createElement("h3");
        heading.textContent = "タイムスタンプ";
        heading.style.fontSize = "12px";
        heading.style.fontWeight = "bold";

        let copyAllButton = document.createElement("button");
        copyAllButton.textContent = "全部コピー";
        copyAllButton.style.marginLeft = "6px";
        copyAllButton.style.padding = "12px 12px";  // 调整按钮宽度
        copyAllButton.style.fontSize = "10px";
        copyAllButton.classList.add("no-drag");
        copyAllButton.onclick = function() {
            copyAllTimestamps();
        };

        // 排序按钮
        let sortButton = document.createElement("button");
        sortButton.textContent = "並べ替え";
        sortButton.style.marginLeft = "8px";
        sortButton.style.padding = "12px 12px";  // 调整按钮宽度
        sortButton.style.fontSize = "10px";
        sortButton.classList.add("no-drag");
        sortButton.onclick = function() {
            toggleSortOrder();
        };

        copyAllButton.addEventListener("mousedown", function(event) {
            event.stopPropagation();
        });

        heading.appendChild(copyAllButton);
        heading.appendChild(sortButton); // 排序按钮添加到标题栏
        listContainer.appendChild(heading);

        let ul = document.createElement("ul");
        ul.id = "timestamp-list";
        ul.style.listStyleType = "none"; // 去掉列表的默认项目符号
        ul.style.padding = "0";
        ul.style.margin = "0";
        ul.style.textAlign = "center"; // 让时间戳居中显示
        listContainer.appendChild(ul);
        container.appendChild(listContainer);

        lockButton = document.createElement("button");
        lockButton.textContent = "ロック";
        lockButton.style.padding = "10px 70px";
        lockButton.style.background = "green";
        lockButton.style.color = "white";
        lockButton.style.border = "none";
        lockButton.style.cursor = "pointer";
        lockButton.style.fontSize = "18px";
        lockButton.style.fontWeight = "bold";
        lockButton.style.borderRadius = "6px";
        lockButton.style.boxShadow = "2px 2px 6px rgba(0, 0, 0, 0.2)";
        lockButton.style.marginTop = "10px";
        lockButton.onclick = function() {
            toggleLock();
        };
        container.appendChild(lockButton);

        // 隐藏按钮
        hideButton = document.createElement("button");
        hideButton.textContent = "隠す";
        hideButton.style.padding = "10px 70px";
        hideButton.style.background = "blue";
        hideButton.style.color = "white";
        hideButton.style.border = "none";
        hideButton.style.cursor = "pointer";
        hideButton.style.fontSize = "18px";
        hideButton.style.fontWeight = "bold";
        hideButton.style.borderRadius = "6px";
        hideButton.style.boxShadow = "2px 2px 6px rgba(0, 0, 0, 0.2)";
        hideButton.style.marginTop = "10px";
        hideButton.onclick = function() {
            toggleVisibility();
        };
        container.appendChild(hideButton);

        document.body.appendChild(container);
        makeDraggable(container);
        loadTimestamps();
        updateTimestampList();
    }

    function toggleLock() {
        isLocked = !isLocked;
        lockButton.textContent = isLocked ? "アンロック" : "ロック";
    }

    function toggleSortOrder() {
        isAscending = !isAscending; // 切换排序顺序
        updateTimestampList();
    }

   function toggleVisibility() {
    isHidden = !isHidden;
    if (isHidden) {
        // 隐藏除隐藏按钮之外的所有元素，并保持布局
        container.querySelectorAll('*').forEach(element => {
            if (element !== hideButton) {
                element.style.visibility = "hidden"; // 使用visibility隐藏元素，保持布局
            }
        });
        hideButton.textContent = "表示"; // 更改为"表示"以便显示
    } else {
        // 恢复显示所有元素
        container.querySelectorAll('*').forEach(element => {
            if (element !== hideButton) {
                element.style.visibility = "visible"; // 恢复显示
            }
        });
        hideButton.textContent = "隠す"; // 恢复为"隠す"
    }
}

    function copyAllTimestamps() {
        let allTimestamps = timestamps.join('\n');
        navigator.clipboard.writeText(allTimestamps).then(() => {
            showCopySuccessMessage(allTimestamps);
        }).catch(err => {
            console.error('コピーに失敗しました', err);
        });
    }

    function showErrorMessage(message) {
        alert(message); // Display error message using alert
    }

function showCopySuccessMessage(text) {
    let messageBox = document.createElement("div");
    messageBox.textContent = `コピーしました: ${text}`;
    messageBox.style.position = "fixed";
    messageBox.style.top = "10px";
    messageBox.style.left = "50%";
    messageBox.style.transform = "translateX(-50%)";
    messageBox.style.padding = "10px 20px";
    messageBox.style.backgroundColor = "#28a745";  // 成功绿色背景
    messageBox.style.color = "white";
    messageBox.style.fontSize = "14px";
    messageBox.style.borderRadius = "5px";
    messageBox.style.boxShadow = "2px 2px 8px rgba(0, 0, 0, 0.2)";
    messageBox.style.zIndex = "9999";

    // 自动隐藏通知
    setTimeout(() => {
        messageBox.style.opacity = "0";
        setTimeout(() => {
            messageBox.remove();
        }, 500);  // 延迟时间与动画效果匹配
    }, 2000);  // 通知显示2秒

    document.body.appendChild(messageBox);
}
    addUI();
})();
