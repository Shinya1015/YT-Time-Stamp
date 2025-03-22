// ==UserScript==
// @name         タイムスタンプ記録
// @namespace    https://www.youtube.com/
// @version      7.0
// @description  タイムスタンプを記録
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
    let isHidden = false;

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
            let formattedTimestamp = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')} [${(timestamps.length + 1).toString().padStart(2, '0')}]`;
            timestamps.unshift(formattedTimestamp);
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

        if (isAscending) {
            timestamps.sort();
        } else {
            timestamps.sort().reverse();
        }

timestamps.forEach((t, index) => {
    // 创建列表项
    let listItem = document.createElement("li");
    listItem.style.display = "flex";
    listItem.style.alignItems = "center";
    listItem.style.marginBottom = "4px";
    listItem.style.padding = "2px";  // 增加内边距
    listItem.style.width = "100%"; // 确保列表项填充父容器宽度
    listItem.style.overflow = "visible"; // 内容不被截断
    listItem.style.flexWrap = "nowrap"; // 防止换行
    listItem.style.whiteSpace = "nowrap"; // 保持文本在一行
    listItem.style.textOverflow = "ellipsis"; // 溢出时显示省略号
    // 削除按钮
    let deleteButton = document.createElement("button");
    deleteButton.textContent = "削除";
    deleteButton.classList.add("delete-btn");
    deleteButton.style.fontSize = "12px";
    deleteButton.style.padding = "6px 12px";
    deleteButton.style.marginRight = "6px";
    deleteButton.style.background = "#FF6B6B";
    deleteButton.style.color = "black";
    deleteButton.style.border = "1px solid #D63A3A";
    deleteButton.style.fontWeight = "bold";
    deleteButton.onclick = function() {
        deleteTimestamp(index);
    };

    // 編集按钮
    let editButton = document.createElement("button");
    editButton.textContent = "編集";
    editButton.classList.add("edit-btn");
    editButton.style.fontSize = "12px";
    editButton.style.padding = "6px 12px";
    editButton.style.marginRight = "6px";
    editButton.style.background = "#FFDD57";
    editButton.style.color = "black";
    editButton.style.border = "1px solid #F39C12";
    editButton.style.fontWeight = "bold";
    editButton.onclick = function() {
        editTimestamp(index);
    };
    // 时间戳按钮
    let displayText = `${t}`;
    let copyButton = document.createElement("button");
    copyButton.textContent = displayText;
    copyButton.classList.add("copy-btn");
    copyButton.style.fontSize = "14px";
    copyButton.style.padding = "8px 250px 8px 8px"; // 只設定右邊的內邊距
    copyButton.style.marginRight = "6px"; // 調整右邊距
    copyButton.style.background = "linear-gradient(to bottom, #A3C9D9, #B0D1E5)";
    copyButton.style.color = "black";
    copyButton.style.fontWeight = "bold";
    copyButton.style.border = "1px solid #9BBED4";
    copyButton.style.whiteSpace = "nowrap"; // 防止文字換行
    copyButton.style.writingMode = "horizontal-tb"; // 強制水平排列文字

    // 這裡使用 flex 讓文字左對齊
    copyButton.style.display = "inline-flex"; // 使用 inline-flex 讓按鈕內部元素按順序排列
    copyButton.style.justifyContent = "flex-start"; // 讓文字靠左對齊
    copyButton.style.alignItems = "center"; // 保證按鈕內文字垂直居中

    // 文字對齊設置為左邊
    copyButton.style.textAlign = "left"; // 強制文字在水平方向左對齊

    copyButton.onclick = function() {
        copyToClipboard(displayText);
    };





    // 创建父元素的容器，容纳按钮和文本
    let container = document.createElement("div");
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.flexWrap = "nowrap"; // 防止元素换行
    container.style.width = "100%";  // 设置容器宽度为100%，自适应
    container.style.minWidth = "400px"; // 设置最小宽度来确保容器较大
    container.style.padding = "0"; // 设置容器内边距为0，避免多余的空白

    // 将按钮和时间戳内容添加到容器中
    container.appendChild(deleteButton);
    container.appendChild(editButton);
    container.appendChild(copyButton);

    // 将容器放入列表项中
    listItem.appendChild(container);
    list.appendChild(listItem);

    // 动态调整父元素宽度
    let updateWidth = () => {
        let width = container.scrollWidth;  // 获取容器的实际宽度
        container.style.width = `${width + 20}px`; // 自动增加宽度
    };

    // 在内容变化时调整宽度
    setTimeout(updateWidth, 100);
});
    }
}
function editTimestamp(index) {
    // 若已存在編輯視窗，則不再建立新的
    if (document.getElementById("edit-container")) return;

    let currentTimestamp = timestamps[index];
    let editContainer = document.createElement("div");
    editContainer.id = "edit-container"; // 設定唯一ID
    editContainer.style.position = "fixed";
    editContainer.style.top = "50%";
    editContainer.style.left = "50%";
    editContainer.style.transform = "translate(-50%, -50%)";
    editContainer.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
    editContainer.style.color = "white";
    editContainer.style.padding = "20px";
    editContainer.style.borderRadius = "8px";
    editContainer.style.zIndex = "9999";
    editContainer.style.display = "flex";
    editContainer.style.flexDirection = "column";
    editContainer.style.alignItems = "center";
    editContainer.style.cursor = "move";

    let inputField = document.createElement("input");
    inputField.value = currentTimestamp;
    inputField.style.fontSize = "14px";
    inputField.style.padding = "6px 10px";
    inputField.style.width = "150px";
    inputField.style.marginBottom = "10px";

    let buttonContainer = document.createElement("div");
    buttonContainer.style.display = "flex";
    buttonContainer.style.gap = "10px";

    let saveButton = document.createElement("button");
    saveButton.textContent = "保存";
    saveButton.style.padding = "8px 16px";
    saveButton.style.backgroundColor = "#28a745";
    saveButton.style.color = "white";
    saveButton.style.border = "none";
    saveButton.style.cursor = "pointer";
    saveButton.style.fontWeight = "bold";

    let cancelButton = document.createElement("button");
    cancelButton.textContent = "キャンセル";
    cancelButton.style.padding = "8px 16px";
    cancelButton.style.backgroundColor = "#dc3545";
    cancelButton.style.color = "white";
    cancelButton.style.border = "none";
    cancelButton.style.cursor = "pointer";
    cancelButton.style.fontWeight = "bold";

    saveButton.onclick = function() {
        let newTimestamp = inputField.value;
        if (newTimestamp && newTimestamp !== currentTimestamp) {
            timestamps[index] = newTimestamp;
            saveTimestamps();
            updateTimestampList();
        }
        document.body.removeChild(editContainer);
    };

    cancelButton.onclick = function() {
        document.body.removeChild(editContainer);
    };

    buttonContainer.appendChild(saveButton);
    buttonContainer.appendChild(cancelButton);
    editContainer.appendChild(inputField);
    editContainer.appendChild(buttonContainer);

    document.body.appendChild(editContainer);

    // 只在点击非输入框区域时启动拖动
    let dragIsActive = false;
    let dragOffsetX, dragOffsetY;

    editContainer.addEventListener("mousedown", function(e) {
        // 如果点到输入框，阻止拖动
        if (e.target === inputField) return;

        // 启动拖动
        dragIsActive = true;
        dragOffsetX = e.clientX - editContainer.getBoundingClientRect().left;
        dragOffsetY = e.clientY - editContainer.getBoundingClientRect().top;
        editContainer.style.cursor = "grabbing";
    });

    document.addEventListener("mousemove", function(e) {
        if (dragIsActive) {
            let left = e.clientX - dragOffsetX;
            let top = e.clientY - dragOffsetY;
            editContainer.style.left = left + "px";
            editContainer.style.top = top + "px";
        }
    });

    document.addEventListener("mouseup", function() {
        dragIsActive = false;
        editContainer.style.cursor = "move";
    });
}


function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showCustomCopySuccessMessage(text);
    }).catch(err => {
        console.error('复制失败', err);
    });
}

function showCustomCopySuccessMessage(text) {
    let messageBox = document.createElement("div");
    messageBox.textContent = `复制成功: ${text}`;
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

function deleteTimestamp(index) {
    timestamps.splice(index, 1);
    saveTimestamps();
    updateTimestampList();
}

function makeDraggable(element) {
    element.addEventListener('mousedown', function(e) {
        // 如果点击目标或其祖先元素是按钮，则不启动拖动
        if (e.target.closest("button")) {
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
        container.style.left = "380px";
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
        btn.onclick = recordTimestamp;
        container.appendChild(btn);
//清單父元素框框
        let listContainer = document.createElement("div");
        listContainer.style.background = "white";
        listContainer.style.padding = "4px";
        listContainer.style.border = "1px solid black";
        listContainer.style.overflowY = "auto";
        listContainer.style.zIndex = "9999";
        listContainer.style.pointerEvents = "auto";
        listContainer.style.width = "500px";
        listContainer.style.resize = "both";
        listContainer.style.height = "150px";
        listContainer.style.minWidth = "200px";
        listContainer.style.minHeight = "100px";


      let heading = document.createElement("h3");
        heading.textContent = "タイムスタンプ";
        heading.style.fontSize = "12px";
        heading.style.fontWeight = "bold";
        heading.style.margin = "0";
        heading.style.padding = "2px 4px";
        heading.style.textAlign = "left";

      let copyAllButton = document.createElement("button");
        copyAllButton.textContent = "全部コピー";
        copyAllButton.style.marginLeft = "4px";
        copyAllButton.style.padding = "6px 5px";
        copyAllButton.style.fontSize = "12px";
        copyAllButton.classList.add("no-drag");
        copyAllButton.style.background = "linear-gradient(to bottom, #A8E6A0, #52C41A)";
        copyAllButton.style.color = "black";
        copyAllButton.style.border = "1px solid #3A8F12";
        copyAllButton.style.fontWeight = "bold";
        copyAllButton.onclick = function() {
        copyAllTimestamps();
        };
      let sortButton = document.createElement("button");
        sortButton.textContent = "並べ替え";
        sortButton.style.marginLeft = "4px";
        sortButton.style.padding = "6px 5px";
        sortButton.style.fontSize = "12px";
        sortButton.classList.add("no-drag");
        sortButton.style.background = "linear-gradient(to bottom, #FFB6C1, #FF69B4)";
        sortButton.style.color = "black";
        sortButton.style.border = "1px solid #FF1493";
        sortButton.style.fontWeight = "bold";
        sortButton.onclick = function() {
            toggleSortOrder();
        };

        copyAllButton.addEventListener("mousedown", function(event) {
            event.stopPropagation();
        });

        heading.appendChild(copyAllButton);
        heading.appendChild(sortButton);

        listContainer.appendChild(heading);


       let ul = document.createElement("ul");
        ul.id = "timestamp-list";
        ul.style.listStyleType = "none";
        ul.style.padding = "0";
        ul.style.margin = "0";
        ul.style.textAlign = "center";
        listContainer.appendChild(ul);
        container.appendChild(listContainer);

        lockButton = document.createElement("button");
        lockButton.textContent = "ロック";
        lockButton.style.padding = "8px 10px";
        lockButton.style.background = "green";
        lockButton.style.color = "white";
        lockButton.style.border = "none";
        lockButton.style.cursor = "pointer";
        lockButton.style.fontSize = "16px";
        lockButton.style.fontWeight = "bold";
        lockButton.style.borderRadius = "6px";
        lockButton.style.boxShadow = "2px 2px 6px rgba(0, 0, 0, 0.2)";
        lockButton.style.marginTop = "3px";
        lockButton.onclick = function() {
            toggleLock();
};
        container.appendChild(lockButton);


        hideButton = document.createElement("button");
        hideButton.textContent = "隠す";
        hideButton.style.padding = "6px 6px";
        hideButton.style.background = "blue";
        hideButton.style.color = "white";
        hideButton.style.border = "none";
        hideButton.style.cursor = "pointer";
        hideButton.style.fontSize = "18px";
        hideButton.style.fontWeight = "bold";
        hideButton.style.borderRadius = "6px";
        hideButton.style.boxShadow = "2px 2px 6px rgba(0, 0, 0, 0.2)";
        hideButton.style.marginTop = "5px";
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
    lockButton.style.background = isLocked ? "red" : "green";
}


    function toggleSortOrder() {
        isAscending = !isAscending;
        updateTimestampList();
    }

   function toggleVisibility() {
    isHidden = !isHidden;
    if (isHidden) {
        container.querySelectorAll('*').forEach(element => {
            if (element !== hideButton) {
                element.style.visibility = "hidden";
            }
        });
          hideButton.textContent = "表示";
          hideButton.style.backgroundColor = "red";
    } else {
        container.querySelectorAll('*').forEach(element => {
            if (element !== hideButton) {
                element.style.visibility = "visible";
            }
        });
        hideButton.textContent = "隠す";
        hideButton.style.backgroundColor = "blue";
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
        alert(message);
    }

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
    addUI();
})();
