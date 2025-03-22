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

    // 删除按钮
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

    // 鼠标悬停时变色
    deleteButton.onmouseover = function() {
        deleteButton.style.background = "#FF4C4C"; // 鼠标悬停时变色
    };

    deleteButton.onmouseleave = function() {
        deleteButton.style.background = "#FF6B6B"; // 恢复原色
    };

    // 按钮点击时变色
    deleteButton.onmousedown = function() {
        deleteButton.style.background = "#D63A3A"; // 按下时变色
        deleteButton.style.transform = "scale(0.95)"; // 点击时缩小
    };

    deleteButton.onmouseup = function() {
        deleteButton.style.background = "#FF4C4C"; // 点击结束时变色
        deleteButton.style.transform = "scale(1)"; // 恢复按钮大小
    };

    deleteButton.onclick = function() {
        deleteTimestamp(index);
    };

    // 编辑按钮
    let editButton = document.createElement("button");
    editButton.textContent = "編集";
    editButton.classList.add("edit-btn");
    editButton.style.fontSize = "14px";
    editButton.style.padding = "10px 20px";
    editButton.style.marginRight = "6px";
    editButton.style.background = "#FFDD57";
    editButton.style.color = "black";
    editButton.style.border = "1px solid #F39C12";
    editButton.style.fontWeight = "bold";
    editButton.style.transition = "background-color 0.3s, transform 0.2s";

    // 鼠标悬停时变色
    editButton.onmouseover = function() {
        editButton.style.background = "#FFCF57"; // 鼠标悬停时变色
    };

    editButton.onmouseleave = function() {
        editButton.style.background = "#FFDD57"; // 恢复原色
    };

    // 按钮点击时变色
    editButton.onmousedown = function() {
        editButton.style.background = "#F39C12"; // 按下时变色
        editButton.style.transform = "scale(0.95)"; // 点击时缩小
    };

    editButton.onmouseup = function() {
        editButton.style.background = "#FFCF57"; // 点击结束时变色
        editButton.style.transform = "scale(1)"; // 恢复按钮大小
    };

    editButton.onclick = function() {
        editTimestamp(index);
    };
    // 时间戳按钮
   let displayText = `${t}`;
let copyButton = document.createElement("button");
copyButton.textContent = displayText;
copyButton.classList.add("copy-btn");
copyButton.style.fontSize = "16px";
copyButton.style.padding = "10px 2px";  // 固定的内边距，防止背景变大
copyButton.style.marginRight = "20px"; // 调整右边距
copyButton.style.background = "#A3C9D9";  // 固定的背景色（蓝色）
copyButton.style.color = "black";
copyButton.style.fontWeight = "bold";
copyButton.style.border = "1px solid #9BBED4"; // 固定的边框颜色
copyButton.style.whiteSpace = "nowrap"; // 防止文字换行
copyButton.style.writingMode = "horizontal-tb"; // 强制水平排列文字

// 设置固定宽度，确保背景不变
copyButton.style.width = "250px";  // 设置一个固定宽度（根据需求调整）
copyButton.style.overflowX = "auto"; // 开启水平滚动条
copyButton.style.textOverflow = "clip"; // 防止省略号显示
copyButton.style.whiteSpace = "nowrap"; // 保证文字不换行，超出显示滚动条

// 使用 flex 让文字左对齐
copyButton.style.display = "inline-flex"; // 使用 inline-flex 让按钮内部元素按顺序排列
copyButton.style.justifyContent = "flex-start"; // 让文字靠左对齐
copyButton.style.alignItems = "center"; // 保证按钮内文字垂直居中

// 如果文字超出按钮宽度，使用滚动条显示
copyButton.style.overflow = "hidden";  // 防止溢出的内容被遮挡
copyButton.style.overflowX = "auto";  // 在X轴方向允许滚动

// 悬停和点击后的颜色变化
copyButton.onmouseover = function() {
    copyButton.style.background = "#88B8D9";  // 鼠标悬停时变色
};

copyButton.onmouseleave = function() {
    copyButton.style.background = "#A3C9D9";  // 悬停结束时恢复原色
};

copyButton.onmousedown = function() {
    copyButton.style.background = "#7AA8C9";  // 鼠标点击时变色
};

copyButton.onmouseup = function() {
    copyButton.style.background = "#88B8D9";  // 点击结束时变色
};

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

    // 按下Enter键时触发保存
    inputField.addEventListener("keydown", function(e) {
        if (e.key === "Enter") {
            saveButton.click(); // 模拟点击保存按钮
        }
    });

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

// 鼠标悬停变色
btn.onmouseover = function () {
    btn.style.background = "linear-gradient(to bottom, #E0F7FA, #B2EBF2)";
};

// 鼠标移开恢复
btn.onmouseout = function () {
    btn.style.background = "linear-gradient(to bottom, #FFFFFF, #E0F7FA)";
};

// 按下变色
btn.onmousedown = function () {
    btn.style.background = "linear-gradient(to bottom, #B2EBF2, #80DEEA)";
};

// 松开恢复
btn.onmouseup = function () {
    btn.style.background = "linear-gradient(to bottom, #E0F7FA, #B2EBF2)";
};

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
        listContainer.style.width = "400px";//拉寬
        listContainer.style.resize = "both";
        listContainer.style.height = "150px";
        listContainer.style.minWidth = "200px";
        listContainer.style.minHeight = "100px";


      let heading = document.createElement("h3");
        heading.textContent = "長押しして移動";
        heading.style.fontSize = "14px";
        heading.style.fontWeight = "bold";
        heading.style.margin = "0";
        heading.style.padding = "1px 10px";
        heading.style.textAlign = "left";

  let copyAllButton = document.createElement("button");
copyAllButton.textContent = "全部コピー";
copyAllButton.style.marginLeft = "45px";
copyAllButton.style.padding = "8px 20px";
copyAllButton.style.fontSize = "14px";
copyAllButton.classList.add("no-drag");
copyAllButton.style.background = "linear-gradient(to bottom, #A8E6A0, #52C41A)";
copyAllButton.style.color = "black";
copyAllButton.style.border = "1px solid #3A8F12";
copyAllButton.style.fontWeight = "bold";
copyAllButton.style.transition = "background-color 0.3s, transform 0.2s";

// 鼠标悬停时变色
copyAllButton.onmouseover = function() {
    copyAllButton.style.background = "linear-gradient(to bottom, #9AE89F, #66B22C)"; // 鼠标悬停时变色
};

// 鼠标离开时恢复原色
copyAllButton.onmouseleave = function() {
    copyAllButton.style.background = "linear-gradient(to bottom, #A8E6A0, #52C41A)";
};

// 按钮点击时变色
copyAllButton.onmousedown = function() {
    copyAllButton.style.background = "linear-gradient(to bottom, #74B94F, #4E9B16)"; // 按下时变色
    copyAllButton.style.transform = "scale(0.95)"; // 按钮缩小
};

// 按钮点击结束时恢复
copyAllButton.onmouseup = function() {
    copyAllButton.style.background = "linear-gradient(to bottom, #9AE89F, #66B22C)"; // 恢复悬停颜色
    copyAllButton.style.transform = "scale(1)"; // 恢复按钮大小
};

copyAllButton.onclick = function() {
    copyAllTimestamps();
};

let sortButton = document.createElement("button");
sortButton.textContent = "並べ替え";
sortButton.style.marginLeft = "8px";
sortButton.style.padding = "8px 20px";
sortButton.style.fontSize = "14px";
sortButton.classList.add("no-drag");
sortButton.style.background = "linear-gradient(to bottom, #FFB6C1, #FF69B4)";
sortButton.style.color = "black";
sortButton.style.border = "1px solid #FF1493";
sortButton.style.fontWeight = "bold";
sortButton.style.transition = "background-color 0.3s, transform 0.2s";

// 鼠标悬停时变色
sortButton.onmouseover = function() {
    sortButton.style.background = "linear-gradient(to bottom, #FF9AAB, #FF4D92)"; // 鼠标悬停时变色
};

// 鼠标离开时恢复原色
sortButton.onmouseleave = function() {
    sortButton.style.background = "linear-gradient(to bottom, #FFB6C1, #FF69B4)";
};

// 按钮点击时变色
sortButton.onmousedown = function() {
    sortButton.style.background = "linear-gradient(to bottom, #FF7C92, #FF3385)"; // 按下时变色
    sortButton.style.transform = "scale(0.95)"; // 按钮缩小
};

// 按钮点击结束时恢复
sortButton.onmouseup = function() {
    sortButton.style.background = "linear-gradient(to bottom, #FF9AAB, #FF4D92)"; // 恢复悬停颜色
    sortButton.style.transform = "scale(1)"; // 恢复按钮大小
};

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
lockButton.style.transition = "background-color 0.3s, transform 0.2s";  // 添加过渡动画

lockButton.onmouseover = function() {
    lockButton.style.background = "darkgreen";
};
lockButton.onmouseleave = function() {
    lockButton.style.background = "green";
};
lockButton.onmousedown = function() {
    lockButton.style.transform = "scale(0.95)";
};
lockButton.onmouseup = function() {
    lockButton.style.transform = "scale(1)";
};

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
hideButton.style.transition = "background-color 0.3s, transform 0.2s";  // 添加过渡动画

hideButton.onmouseover = function() {
    hideButton.style.background = "darkblue";
};
hideButton.onmouseleave = function() {
    hideButton.style.background = "blue";
};
hideButton.onmousedown = function() {
    hideButton.style.transform = "scale(0.95)";
};
hideButton.onmouseup = function() {
    hideButton.style.transform = "scale(1)";
};

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
    lockButton.style.transition = "background-color 0.3s, transform 0.2s";  // 添加过渡效果

    // 鼠标悬停时变色
    lockButton.onmouseover = function() {
        lockButton.style.background = isLocked ? "darkred" : "darkgreen";
    };

    // 鼠标离开时恢复原色
    lockButton.onmouseleave = function() {
        lockButton.style.background = isLocked ? "red" : "green";
    };

    // 按钮点击时变色
    lockButton.onmousedown = function() {
        lockButton.style.background = isLocked ? "darkred" : "darkgreen";
        lockButton.style.transform = "scale(0.95)";  // 按钮缩小
    };

    lockButton.onmouseup = function() {
        lockButton.style.background = isLocked ? "red" : "green";
        lockButton.style.transform = "scale(1)";  // 恢复按钮大小
    };
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

    // 添加按钮的过渡效果
    hideButton.style.transition = "background-color 0.3s, transform 0.2s";

    // 鼠标悬停时变色
    hideButton.onmouseover = function() {
        hideButton.style.backgroundColor = isHidden ? "darkred" : "darkblue";
    };

    // 鼠标离开时恢复原色
    hideButton.onmouseleave = function() {
        hideButton.style.backgroundColor = isHidden ? "red" : "blue";
    };

    // 按钮点击时变色
    hideButton.onmousedown = function() {
        hideButton.style.backgroundColor = isHidden ? "darkred" : "darkblue";
        hideButton.style.transform = "scale(0.95)";  // 按钮缩小
    };

    hideButton.onmouseup = function() {
        hideButton.style.backgroundColor = isHidden ? "red" : "blue";
        hideButton.style.transform = "scale(1)";  // 恢复按钮大小
    };
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
