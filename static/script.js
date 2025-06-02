document.addEventListener('DOMContentLoaded', () => {
    // Main UI elements
    const m3uFileInput = document.getElementById('m3uFile');
    const categorySearchInput = document.getElementById('categorySearchInput');
    const categoryListContainer = document.getElementById('categoryListContainer');
    
    const channelPaneTitle = document.getElementById('channelPaneTitle');
    const channelSearchInput = document.getElementById('channelSearchInput');
    const channelGridDiv = document.getElementById('channelGrid');
    
    const saveFilteredButton = document.getElementById('saveFilteredButton');
    const selectAllButton = document.getElementById('selectAllButton'); 
    const deselectAllButton = document.getElementById('deselectAllButton'); 
    
    const loadingMessage = document.getElementById('loadingMessage');
    const totalChannelsMessage = document.getElementById('totalChannelsMessage');
    const themeToggleButton = document.getElementById('themeToggleButton');

    const m3uUrlInput = document.getElementById('m3uUrlInput');
    const loadFromUrlButton = document.getElementById('loadFromUrlButton');
    const generateShareLinkButton = document.getElementById('generateShareLinkButton');
    const shareLinkStatusMessage = document.getElementById('shareLinkStatusMessage');

    // Data and state
    let categoriesData = {}; 
    let originalHeader = "#EXTM3U";
    let otherDirectives = [];
    let m3uParserWorker;
    let activeCategoryName = null;
    let currentCategorySearchTerm = "";
    let currentChannelSearchTerm = "";

    let categoryToggleButtonMap = new Map(); 
    let channelToggleButtonMap = new Map(); 

    // --- THEME TOGGLE LOGIC ---
    function applyTheme(theme) {
        if (theme === 'dark') {
            document.body.classList.add('dark-theme');
            if (themeToggleButton) themeToggleButton.textContent = '☀️';
        } else {
            document.body.classList.remove('dark-theme');
            if (themeToggleButton) themeToggleButton.textContent = '🌙';
        }
        localStorage.setItem('theme', theme);
    }

    function toggleTheme() {
        if (document.body.classList.contains('dark-theme')) {
            applyTheme('light');
        } else {
            applyTheme('dark');
        }
    }

    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme) applyTheme(savedTheme);
    else if (prefersDark) applyTheme('dark');
    else applyTheme('light');
    // --- END THEME TOGGLE LOGIC ---

    // Event Listeners
    if (themeToggleButton) themeToggleButton.addEventListener('click', toggleTheme);
    m3uFileInput.addEventListener('change', handleFileSelect);
    if (loadFromUrlButton) loadFromUrlButton.addEventListener('click', handleLoadFromUrl);
    if (generateShareLinkButton) generateShareLinkButton.addEventListener('click', handleGenerateShareLink);


    saveFilteredButton.addEventListener('click', saveFilteredM3U);
    selectAllButton.addEventListener('click', () => toggleAllMaster(true));
    deselectAllButton.addEventListener('click', () => toggleAllMaster(false));
    
    const closeOverlayButton = document.getElementById('closeOverlayButton');
    const channelOverlay = document.getElementById('channelOverlay');
    if(closeOverlayButton) closeOverlayButton.addEventListener('click', hideChannelOverlay);
    if(channelOverlay) channelOverlay.addEventListener('click', (event) => {
        if (event.target === channelOverlay) hideChannelOverlay();
    });

    categorySearchInput.addEventListener('input', (event) => {
        currentCategorySearchTerm = event.target.value.toLowerCase();
        renderCategoryList();
    });
    channelSearchInput.addEventListener('input', (event) => {
        currentChannelSearchTerm = event.target.value.toLowerCase();
        if (activeCategoryName) {
            renderChannelsPane(activeCategoryName);
        }
    });

    function toggleLoading(isLoading, pane = "main") {
        if (pane === "main") {
            loadingMessage.style.display = isLoading ? 'block' : 'none';
            if(isLoading) channelGridDiv.innerHTML = ''; 
        }
         if (isLoading) {
            disableActionButtons();
        }
    }
    
    function commonInitialClearAndSetup() {
        channelGridDiv.innerHTML = ''; 
        categoryListContainer.innerHTML = '';
        categoriesData = {};
        otherDirectives = [];
        originalHeader = "#EXTM3U"; 
        activeCategoryName = null;
        channelPaneTitle.textContent = "Select a Category";
        channelSearchInput.style.display = 'none';
        channelSearchInput.value = '';
        currentChannelSearchTerm = '';
        currentCategorySearchTerm = ""; 
        categorySearchInput.value = ""; 
        categoryToggleButtonMap.clear(); 
        channelToggleButtonMap.clear();
        disableActionButtons();
        updateTotalChannelsMessage();
        if(shareLinkStatusMessage) shareLinkStatusMessage.style.display = 'none';
    }

    function processM3UContent(contentString, sourceDescription = "playlist") {
        loadingMessage.textContent = `Processing ${sourceDescription}...`;
        toggleLoading(true, "main"); 

        if (m3uParserWorker) m3uParserWorker.terminate();
        m3uParserWorker = new Worker('static/m3u_parser_worker.js'); // Assuming m3u_parser_worker.js is in the same static folder

        m3uParserWorker.onmessage = function(e) {
            if (e.data.success) {
                const parsed = e.data.data;
                categoriesData = parsed.categoriesData;
                originalHeader = parsed.originalHeader;
                otherDirectives = parsed.otherDirectives;
                renderCategoryList(); 
                updateTotalChannelsMessage();
                setChannelPanePlaceholder("Select a category to view channels.");
                enableSaveButtonOnly(); 
            } else {
                console.error("Worker error:", e.data.error);
                setChannelPanePlaceholder(`Error processing ${sourceDescription}: ${e.data.error}`, true);
                disableActionButtons();
            }
            toggleLoading(false, "main"); 
            if (m3uParserWorker) { m3uParserWorker.terminate(); m3uParserWorker = null; }
        };
        m3uParserWorker.onerror = function(error) {
            console.error(`Worker script error while processing ${sourceDescription}:`, error.message, error);
            setChannelPanePlaceholder(`A critical error occurred with the playlist processor for ${sourceDescription}.`, true);
            toggleLoading(false, "main");
            disableActionButtons();
            if (m3uParserWorker) { m3uParserWorker.terminate(); m3uParserWorker = null; }
        };
        m3uParserWorker.postMessage(contentString);
    }

    async function handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        commonInitialClearAndSetup();
        toggleLoading(true, "main"); 
        loadingMessage.textContent = "Reading file..."; 

        const fileContent = await file.text();
        processM3UContent(fileContent, "local file");
    }

    // *** MODIFIED FUNCTION: handleLoadFromUrl ***
    async function handleLoadFromUrl() {
        const url = m3uUrlInput.value.trim();
        if (!url) {
            alert("Please enter an M3U URL.");
            return;
        }

        commonInitialClearAndSetup();
        toggleLoading(true, "main");
        loadingMessage.textContent = `Fetching playlist from URL via proxy...`; // Updated message

        try {
            // Instead of direct fetch, call our backend proxy
            const backendResponse = await fetch('/proxy_m3u_url', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ url: url }) // Send the target URL to our backend
            });

            const result = await backendResponse.json(); // Get JSON response from our backend

            if (!backendResponse.ok || !result.success) {
                // If backendResponse.ok is false, result.error might come from Flask's error handlers (e.g. for 404, 500 before our JSON)
                // If result.success is false, it's a custom error from our /proxy_m3u_url logic
                throw new Error(result.error || `Failed to fetch from URL. Server responded with status: ${backendResponse.status}`);
            }
            
            const urlContent = result.m3uContent;

            if (!urlContent || !urlContent.trim().toUpperCase().startsWith("#EXTM3U")) {
                console.warn("Content from proxied URL doesn't start with #EXTM3U. Processing anyway.");
            }
            processM3UContent(urlContent, `URL: ${url.substring(0, 50)}...`);
        } catch (error) {
            console.error("Error loading from URL via proxy:", error);
            // Ensure the error message displayed is helpful
            let displayError = error.message;
            if (error.message.includes("Failed to fetch")) { // Network error connecting to our backend proxy
                displayError = "Network error connecting to the server. Please check your connection.";
            }
            setChannelPanePlaceholder(`Failed to load from URL: ${displayError}`, true);
            toggleLoading(false, "main");
            disableActionButtons();
        }
    }
    // *** END MODIFIED FUNCTION ***

    function displayShareLinkStatus(message, isSuccess, link = null, expiryInfo = null) {
        if (!shareLinkStatusMessage) return;
        
        let contentHTML = message;
        if (link) {
            contentHTML += `<br><a href="${link}" target="_blank" rel="noopener noreferrer">${link}</a>`;
        }
        if (expiryInfo) {
            contentHTML += `<br><small>(Link expires in approximately ${expiryInfo})</small>`;
        }
        shareLinkStatusMessage.innerHTML = contentHTML;

        shareLinkStatusMessage.className = 'status-message'; 
        if (isSuccess === true) { 
            shareLinkStatusMessage.classList.add('success');
        } else if (isSuccess === false) {
            shareLinkStatusMessage.classList.add('error');
        }
        shareLinkStatusMessage.style.display = 'block';
    }

    async function handleGenerateShareLink() {
        if(shareLinkStatusMessage) shareLinkStatusMessage.style.display = 'none';
        displayShareLinkStatus("Generating shareable link...", null); 

        let m3uContent = originalHeader + '\n';
        otherDirectives.forEach(directive => m3uContent += directive + '\n');
        for (const catName in categoriesData) {
            if (categoriesData[catName].state) { 
                categoriesData[catName].channels.forEach(channel => {
                    if (channel.state) {
                        m3uContent += channel.info + '\n';
                        if (channel.url) m3uContent += channel.url + '\n';
                    }
                });
            }
        }
        
        const playlistName = `filtered_playlist_${Date.now()}.m3u`;

        try {
            const response = await fetch('/generate-share-link', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', },
                body: JSON.stringify({ filename: playlistName, content: m3uContent }),
            });

            const result = await response.json();

            if (response.ok && result.success && result.shareableLink) {
                displayShareLinkStatus(
                    "Shareable link generated successfully!", 
                    true, 
                    result.shareableLink, 
                    result.expires_in
                );
            } else {
                throw new Error(result.error || `Server error: ${response.status}`);
            }
        } catch (error) {
            console.error("Generate Share Link error:", error);
            displayShareLinkStatus(`Error generating link: ${error.message}`, false);
        }
    }
    
    function updateTotalChannelsMessage() { 
        if (Object.keys(categoriesData).length > 0) {
            let totalChannels = 0;
            for (const catName in categoriesData) totalChannels += categoriesData[catName].channels.length;
            totalChannelsMessage.textContent = `Total Channels: ${totalChannels}`;
        } else {
            totalChannelsMessage.textContent = "Load a playlist to begin.";
        }
    }
    function setChannelPanePlaceholder(message, isError = false) { 
        channelGridDiv.innerHTML = `<p class="empty-state-message ${isError ? 'error' : ''}">${message}</p>`;
        channelPaneTitle.textContent = isError ? "Error" : "Channels List";
        channelSearchInput.style.display = 'none';
        selectAllButton.disabled = true;
        deselectAllButton.disabled = true;
    }
    function enableSaveButtonOnly() { 
        saveFilteredButton.disabled = Object.keys(categoriesData).length === 0;
        if (generateShareLinkButton) generateShareLinkButton.disabled = Object.keys(categoriesData).length === 0;
        selectAllButton.disabled = true;
        deselectAllButton.disabled = true;
    }
    function enableActionButtonsForPane() { 
        saveFilteredButton.disabled = Object.keys(categoriesData).length === 0;
        if (generateShareLinkButton) generateShareLinkButton.disabled = Object.keys(categoriesData).length === 0;
        const categoryIsActive = activeCategoryName && categoriesData[activeCategoryName];
        selectAllButton.disabled = !categoryIsActive || categoriesData[activeCategoryName].channels.length === 0;
        deselectAllButton.disabled = !categoryIsActive || categoriesData[activeCategoryName].channels.length === 0;
    }
    function disableActionButtons() {
        saveFilteredButton.disabled = true;
        if (generateShareLinkButton) generateShareLinkButton.disabled = true;
        selectAllButton.disabled = true;
        deselectAllButton.disabled = true;
    }
    function createCircularToggleButton(initialState, changeCallback) {
        const button = document.createElement('button');
        button.classList.add('circular-toggle');
        if (initialState) button.classList.add('active');
        button.addEventListener('click', (event) => {
            event.stopPropagation(); 
            const isActive = button.classList.toggle('active');
            if (changeCallback) changeCallback(isActive); 
        });
        return button;
    }
    function renderCategoryList() {
        categoryListContainer.innerHTML = '';
        const fragment = document.createDocumentFragment();
        categoryToggleButtonMap.clear(); 
        const categoryNames = Object.keys(categoriesData);
        const filteredCategoryNames = currentCategorySearchTerm
            ? categoryNames.filter(name => name.toLowerCase().includes(currentCategorySearchTerm))
            : categoryNames;
        if (filteredCategoryNames.length === 0 && categoryNames.length > 0) {
            categoryListContainer.innerHTML = `<p class="empty-state-message">No categories match "${currentCategorySearchTerm}".</p>`; return;
        }
        if (categoryNames.length === 0 && (loadingMessage.style.display === 'none' || !loadingMessage.style.display) ) {
             categoryListContainer.innerHTML = `<p class="empty-state-message">No categories found.</p>`; return;
        }
        filteredCategoryNames.forEach(categoryName => {
            const category = categoriesData[categoryName];
            const listItem = document.createElement('div'); 
            listItem.classList.add('category-list-item');
            listItem.dataset.categoryName = categoryName;
            if (categoryName === activeCategoryName) listItem.classList.add('active');
            const categoryToggle = createCircularToggleButton(category.state, (isActive) => {
                category.state = isActive;
                category.channels.forEach(ch => ch.state = isActive);
                if (activeCategoryName === categoryName) renderChannelsPane(categoryName);
            });
            listItem.appendChild(categoryToggle);
            categoryToggleButtonMap.set(categoryName, categoryToggle); 
            const nameSpan = document.createElement('span');
            nameSpan.classList.add('category-name');
            nameSpan.textContent = categoryName;
            listItem.appendChild(nameSpan);
            const countSpan = document.createElement('span');
            countSpan.classList.add('category-channel-count');
            countSpan.textContent = category.channels.length;
            listItem.appendChild(countSpan);
            listItem.addEventListener('click', (event) => {
                if (event.target.closest('.circular-toggle')) return;
                if (activeCategoryName === categoryName) return; 
                const currentActiveDOM = categoryListContainer.querySelector('.category-list-item.active');
                if (currentActiveDOM) currentActiveDOM.classList.remove('active');
                listItem.classList.add('active');
                activeCategoryName = categoryName;
                channelPaneTitle.textContent = `${categoryName}`; 
                channelSearchInput.style.display = 'block';
                channelSearchInput.value = ''; 
                currentChannelSearchTerm = '';
                renderChannelsPane(categoryName);
                enableActionButtonsForPane();
            });
            fragment.appendChild(listItem);
        });
        categoryListContainer.appendChild(fragment);
    }
    function renderChannelsPane(categoryName) {
        const category = categoriesData[categoryName];
        if (!category) { setChannelPanePlaceholder("Category not found.", true); return; }
        channelGridDiv.innerHTML = '';
        channelToggleButtonMap.clear(); 
        const fragment = document.createDocumentFragment();
        const filteredChannels = currentChannelSearchTerm
            ? category.channels.filter(ch => ch.name.toLowerCase().includes(currentChannelSearchTerm))
            : category.channels;
        if (filteredChannels.length === 0) {
            const message = category.channels.length === 0 ? "This category has no channels." : `No channels match your search: "${currentChannelSearchTerm}".`;
            channelGridDiv.innerHTML = `<p class="empty-state-message">${message}</p>`;
        } else {
            filteredChannels.forEach((channel) => {
                const channelItemDiv = document.createElement('div');
                channelItemDiv.classList.add('channel-item');
                const toggleButton = createCircularToggleButton(channel.state, (isActive) => {
                    channel.state = isActive;
                    updateCategoryToggleFromChannelStates(categoryName);
                });
                channelItemDiv.appendChild(toggleButton);
                // Storing original index for mapping is fine, but ensure it's robust if channels array can change order elsewhere
                const originalIndex = categoriesData[categoryName].channels.indexOf(channel); 
                channelToggleButtonMap.set(`${categoryName}_${originalIndex}`, toggleButton);

                const channelNameSpan = document.createElement('span');
                channelNameSpan.classList.add('channel-name-text');
                channelNameSpan.textContent = channel.name;
                channelNameSpan.addEventListener('click', () => toggleButton.click());
                channelItemDiv.appendChild(channelNameSpan);
                fragment.appendChild(channelItemDiv);
            });
            channelGridDiv.appendChild(fragment);
        }
        enableActionButtonsForPane(); 
    }
    function updateCategoryToggleFromChannelStates(categoryName) {
        const category = categoriesData[categoryName];
        if (!category || !category.channels) return;
        let newCategoryDataState;
        if (category.channels.length === 0) { newCategoryDataState = false; } 
        else { newCategoryDataState = category.channels.some(ch => ch.state); }
        category.state = newCategoryDataState;
        const categoryToggle = categoryToggleButtonMap.get(categoryName);
        if (categoryToggle) {
            if (newCategoryDataState) categoryToggle.classList.add('active');
            else categoryToggle.classList.remove('active');
        }
    }
    function toggleAllMaster(selectState) { 
        currentCategorySearchTerm = ""; 
        categorySearchInput.value = "";   
        for (const categoryName in categoriesData) {
            const category = categoriesData[categoryName];
            category.state = selectState; 
            category.channels.forEach(channel => { channel.state = selectState; });
        }
        renderCategoryList(); 
        if (activeCategoryName && categoriesData[activeCategoryName]) {
             // If an active category is selected, re-render its channels
            renderChannelsPane(activeCategoryName); // Changed from activeOverlayCategoryName
        } else if (!activeCategoryName && Object.keys(categoriesData).length > 0) {
             // If no category is active but data exists, show placeholder
             setChannelPanePlaceholder("Select a category to view channels.");
        }
        // Ensure action buttons are updated according to the new overall state
        if (activeCategoryName) {
            enableActionButtonsForPane();
        } else {
            enableSaveButtonOnly(); // Or disable all if that's preferred after a global toggle
        }
    }
    function saveFilteredM3U() {
        let output = originalHeader + '\n';
        otherDirectives.forEach(directive => output += directive + '\n');
        for (const catName in categoriesData) {
            if (categoriesData[catName].state) { 
                categoriesData[catName].channels.forEach(channel => {
                    if (channel.state) {
                        output += channel.info + '\n';
                        if (channel.url) output += channel.url + '\n';
                    }
                });
            }
        }
        const blob = new Blob([output], { type: 'application/vnd.apple.mpegurl' }); // Or 'audio/mpegurl'
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'filtered_playlist.m3u';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // Dummy hideChannelOverlay function if it's referenced but not fully implemented or needed for this view
    function hideChannelOverlay() {
        const overlay = document.getElementById('channelOverlay');
        if (overlay) overlay.classList.remove('overlay-visible');
        // Potentially reset any state related to the overlay if necessary
    }


    // Initial setup
    disableActionButtons();
    channelSearchInput.style.display = 'none';
    setChannelPanePlaceholder("Load an M3U file to start filtering channels.");
});
