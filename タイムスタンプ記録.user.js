// ==UserScript==
// @name         タイムスタンプ記録
// @namespace    https://www.youtube.com/
// @version      6.1
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
                let listItem = document.createElement("li");

                let displayText = `${t}`;

                let copyButton = document.createElement("button");
                copyButton.textContent = displayText;
                copyButton.classList.add("copy-btn");
                copyButton.style.fontSize = "14px";
                copyButton.style.padding = "12px 48px";
                copyButton.onclick = function() {
                    copyToClipboard(displayText);
                };

                let deleteButton = document.createElement("button");
                deleteButton.textContent = "削除";
                deleteButton.classList.add("delete-btn");
                deleteButton.style.fontSize = "12px";
                deleteButton.style.padding = "12px 30px";
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
        console.error('コピーに失敗しました', err);
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
        container.style.left = "380px";
        container.style.zIndex = "9999";
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
        listContainer.style.width = "300px";

        let heading = document.createElement("h3");
        heading.textContent = "タイムスタンプ";
        heading.style.fontSize = "12px";
        heading.style.fontWeight = "bold";

        let copyAllButton = document.createElement("button");
        copyAllButton.textContent = "全部コピー";
        copyAllButton.style.marginLeft = "6px";
        copyAllButton.style.padding = "12px 12px";
        copyAllButton.style.fontSize = "10px";
        copyAllButton.classList.add("no-drag");
        copyAllButton.onclick = function() {
            copyAllTimestamps();
        };

        let sortButton = document.createElement("button");
        sortButton.textContent = "並べ替え";
        sortButton.style.marginLeft = "8px";
        sortButton.style.padding = "12px 12px";
        sortButton.style.fontSize = "10px";
        sortButton.classList.add("no-drag");
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
    } else {
        container.querySelectorAll('*').forEach(element => {
            if (element !== hideButton) {
                element.style.visibility = "visible";
            }
        });
        hideButton.textContent = "隠す";
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
