const NO_GROUP_CATEGORY_NAME = "[No Group / Uncategorized]";

function parseM3UContentForWorker(content) {
    let localCategoriesData = {}; // Renamed to avoid confusion if this code is ever merged back
    let localOriginalHeader = "#EXTM3U";
    let localOtherDirectives = [];

    const lines = content.split(/\r?\n/);
    let currentChannelInfo = null;
    let tempCategories = {};

    if (lines.length > 0 && lines[0].trim().toUpperCase().startsWith("#EXTM3U")) {
        localOriginalHeader = lines[0].trim();
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.toUpperCase().startsWith("#EXTM3U")) continue;

        if (line.startsWith('#EXTINF:')) {
            currentChannelInfo = { info: line, name: '', attributes: {}, url: '' };
            const nameMatch = line.match(/,(.+)$/);
            currentChannelInfo.name = nameMatch ? nameMatch[1].trim() : 'Unknown Channel';
            const attrRegex = /([a-zA-Z0-9_-]+)=("([^"]*)"|([^"\s]+))/g;
            let match;
            while ((match = attrRegex.exec(line)) !== null) {
                currentChannelInfo.attributes[match[1]] = match[3] || match[4];
            }
        } else if (currentChannelInfo && !line.startsWith('#')) {
            currentChannelInfo.url = line;
            const groupTitle = currentChannelInfo.attributes['group-title'] || NO_GROUP_CATEGORY_NAME;
            if (!tempCategories[groupTitle]) {
                tempCategories[groupTitle] = { state: true, channels: [], isExpanded: false };
            }
            tempCategories[groupTitle].channels.push({
                name: currentChannelInfo.name,
                info: currentChannelInfo.info,
                url: currentChannelInfo.url,
                state: true
            });
            currentChannelInfo = null;
        } else if (currentChannelInfo && line.startsWith('#') && line.toUpperCase() !== "#EXTM3U") {
            const groupTitle = currentChannelInfo.attributes['group-title'] || NO_GROUP_CATEGORY_NAME;
            if (!tempCategories[groupTitle]) {
                tempCategories[groupTitle] = { state: true, channels: [], isExpanded: false };
            }
            tempCategories[groupTitle].channels.push({
                name: currentChannelInfo.name,
                info: currentChannelInfo.info,
                url: '',
                state: true
            });
            currentChannelInfo = null;
            localOtherDirectives.push(line);
        } else if (line.startsWith('#')) {
            localOtherDirectives.push(line);
        }
    }
    
    const sortedCategoryNames = Object.keys(tempCategories).sort((a, b) => {
        if (a === NO_GROUP_CATEGORY_NAME) return -1;
        if (b === NO_GROUP_CATEGORY_NAME) return 1;
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });

    sortedCategoryNames.forEach(name => {
        tempCategories[name].channels.sort((a,b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
        localCategoriesData[name] = tempCategories[name];
    });

    return {
        categoriesData: localCategoriesData,
        originalHeader: localOriginalHeader,
        otherDirectives: localOtherDirectives
    };
}

// Listen for messages from the main thread
self.onmessage = function(event) {
    const fileContent = event.data;
    try {
        const parsedData = parseM3UContentForWorker(fileContent);
        // Send the parsed data back to the main thread
        self.postMessage({ success: true, data: parsedData });
    } catch (error) {
        self.postMessage({ success: false, error: error.message });
    }
};