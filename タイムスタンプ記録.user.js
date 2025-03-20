// ==UserScript==
// @name         タイムスタンプ記録
// @namespace    https://www.youtube.com/
// @version      2.6
// @description  タイムスタンプを記録
// @match        *://www.youtube.com/watch?v*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let timestamps = [];
    let isDragging = false;
    let offsetX = 0, offsetY = 0;
    let container, btn;

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
            timestamps.push(formattedTimestamp);
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

            timestamps.forEach((t, index) => {
                let listItem = document.createElement("li");

                let displayText = `${t}`;

                let copyButton = document.createElement("button");
                copyButton.textContent = displayText;
                copyButton.classList.add("copy-btn");
                copyButton.style.fontSize = "12px";
                copyButton.style.padding = "4px 6px";
                copyButton.onclick = function() {
                    copyToClipboard(displayText);
                };

                let deleteButton = document.createElement("button");
                deleteButton.textContent = "削除";
                deleteButton.classList.add("delete-btn");
                deleteButton.style.fontSize = "12px";
                deleteButton.style.padding = "4px 6px";
                deleteButton.onclick = function() {
                    deleteTimestamp(index);
                };

                listItem.appendChild(copyButton);
                listItem.appendChild(deleteButton);
                list.appendChild(listItem);
            });
        }
    }

    function copyToClipboard(text) {
        navigator.clipboard.writeText(text).then(() => {
            showCopySuccessMessage(text);
        }).catch(err => {
            console.error('コピーに失敗しました', err);
        });
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
        container.style.top = "10px";
        container.style.left = "80%";
        container.style.transform = "translateX(-50%)";
        container.style.zIndex = "9999";
        container.style.display = "flex";
        container.style.flexDirection = "column";
        container.style.alignItems = "center";

        btn = document.createElement("button");
        btn.textContent = "タイムスタンプ記録";
        btn.style.padding = "10px 16px";
        btn.style.background = "red";
        btn.style.color = "white";
        btn.style.border = "none";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "14px";
        btn.style.fontWeight = "bold";
        btn.style.borderRadius = "6px";
        btn.style.boxShadow = "2px 2px 6px rgba(0, 0, 0, 0.2)";
        btn.onclick = recordTimestamp;
        container.appendChild(btn);

        let listContainer = document.createElement("div");
        listContainer.style.background = "white";
        listContainer.style.padding = "8px";
        listContainer.style.border = "1px solid black";
        listContainer.style.maxHeight = "150px";
        listContainer.style.overflowY = "auto";
        listContainer.style.zIndex = "9999";

        let heading = document.createElement("h3");
        heading.textContent = "タイムスタンプ";
        heading.style.fontSize = "12px";
        heading.style.fontWeight = "bold";

        let copyAllButton = document.createElement("button");
        copyAllButton.textContent = "全部コピー";
        copyAllButton.style.marginLeft = "6px";
        copyAllButton.style.padding = "2px 6px";
        copyAllButton.style.fontSize = "10px";
        copyAllButton.classList.add("no-drag");
        copyAllButton.onclick = function() {
            copyAllTimestamps();
        };

        copyAllButton.addEventListener("mousedown", function(event) {
            event.stopPropagation();
        });

        heading.appendChild(copyAllButton);
        listContainer.appendChild(heading);

        let ul = document.createElement("ul");
        ul.id = "timestamp-list";
        listContainer.appendChild(ul);

        container.appendChild(listContainer);
        document.body.appendChild(container);

        makeDraggable(container);
        makeDraggable(listContainer);
    }

    function copyAllTimestamps() {
        let allTimestamps = timestamps.map((t, index) => `${t}`).join("\n");
        copyToClipboard(allTimestamps);
    }

    function showCopySuccessMessage(text) {
        let messageBox = document.createElement("div");
        messageBox.textContent = `タイムスタンプをコピーしました: ${text}`;
        messageBox.style.position = "fixed";
        messageBox.style.top = "10px";
        messageBox.style.left = "50%";
        messageBox.style.transform = "translateX(-50%)";
        messageBox.style.backgroundColor = "#4CAF50";
        messageBox.style.color = "white";
        messageBox.style.padding = "10px 20px";
        messageBox.style.borderRadius = "5px";
        messageBox.style.fontSize = "14px";
        messageBox.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
        messageBox.style.zIndex = "9999";
        document.body.appendChild(messageBox);

        setTimeout(() => {
            messageBox.style.display = "none";
        }, 3000);
    }

    loadTimestamps();
    addUI();
})();
