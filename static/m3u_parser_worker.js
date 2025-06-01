const NO_GROUP_CATEGORY_NAME = "[No Group / Uncategorized]";

function parseM3UContentForWorker(content) {
    let localCategoriesData = {};
    let localOriginalHeader = "#EXTM3U";
    let localOtherDirectives = [];
    let tempCategories = {};

    const lines = content.split(/\r?\n/);
    let currentChannelInfo = null;

    if (lines.length > 0 && lines[0].trim().toUpperCase().startsWith("#EXTM3U")) {
        localOriginalHeader = lines[0].trim();
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        if (line.toUpperCase().startsWith("#EXTM3U")) continue;

        if (line.startsWith('#EXTINF:')) {
            currentChannelInfo = { info: line, name: '', attributes: {}, url: '' };

            const attrRegex = /([a-zA-Z0-9_-]+)=("([^"]*)"|([^"\s]+))/g;
            let matchAttr;
            while ((matchAttr = attrRegex.exec(line)) !== null) {
                currentChannelInfo.attributes[matchAttr[1]] = matchAttr[3] || matchAttr[4];
            }

            const nameMatch = line.match(/,(.+)$/);
            let displayName = nameMatch ? nameMatch[1].trim() : 'Unknown Channel';

            // --- REFINED HEURISTIC TO CLEANUP DISPLAY NAME ---
            // Only apply if the name is long and seems to contain attribute patterns
            if (displayName.length > 60 && displayName.includes('="')) {
                const markers = ['group-title="', 'tvg-logo="', 'tvg-name="', 'tvg-id="', 'catchup-source="']; // Common markers
                let bestCandidateTitle = displayName;
                let lastAttributeEndPosition = -1;

                // Find the end position of the last recognizable attribute within the current displayName
                for (const marker of markers) {
                    let searchFrom = 0;
                    while (searchFrom < displayName.length) {
                        const markerPos = displayName.indexOf(marker, searchFrom);
                        if (markerPos === -1) break;

                        const quoteAfterMarker = displayName.indexOf('"', markerPos + marker.length);
                        if (quoteAfterMarker === -1) { // Malformed or unquoted attribute value, less reliable
                            searchFrom = markerPos + marker.length;
                            continue;
                        }
                        // The attribute effectively ends at its closing quote
                        if (quoteAfterMarker > lastAttributeEndPosition) {
                            lastAttributeEndPosition = quoteAfterMarker;
                        }
                        searchFrom = quoteAfterMarker + 1;
                    }
                }

                if (lastAttributeEndPosition !== -1) {
                    // Now look for the first comma *after* this last found attribute's value
                    const commaAfterAttributes = displayName.indexOf(',', lastAttributeEndPosition + 1);
                    if (commaAfterAttributes !== -1) {
                        const potentialTitle = displayName.substring(commaAfterAttributes + 1).trim();
                        if (potentialTitle) { // If there's something after that comma
                            // Further check: ensure this potential title doesn't look like more attributes
                            let looksLikeMoreAttributes = false;
                            for (const marker of markers) { // Use a subset or different check if needed
                                if (potentialTitle.startsWith(marker) || (potentialTitle.includes('="') && potentialTitle.indexOf('="') < 20) ) {
                                    looksLikeMoreAttributes = true;
                                    break;
                                }
                            }
                            if (!looksLikeMoreAttributes) {
                                bestCandidateTitle = potentialTitle;
                            }
                        }
                    }
                }
                displayName = bestCandidateTitle;
            }
            currentChannelInfo.name = displayName;
            // --- END REFINED HEURISTIC ---

        } else if (currentChannelInfo && !line.startsWith('#')) {
            currentChannelInfo.url = line;
            const groupTitle = currentChannelInfo.attributes['group-title'] || NO_GROUP_CATEGORY_NAME;
            if (!tempCategories[groupTitle]) {
                tempCategories[groupTitle] = { state: true, channels: [], isExpanded: false };
            }
            tempCategories[groupTitle].channels.push({
                name: currentChannelInfo.name,
                info: currentChannelInfo.info,
                attributes: currentChannelInfo.attributes,
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
                attributes: currentChannelInfo.attributes,
                url: '',
                state: true
            });
            currentChannelInfo = null;
            localOtherDirectives.push(line);
        } else if (line.startsWith('#')) {
            localOtherDirectives.push(line);
        }
    }

    const categoryKeys = Object.keys(tempCategories);
    const sortedCategoryNames = categoryKeys.sort((a, b) => {
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

self.onmessage = function(event) {
    const fileContent = event.data;
    try {
        const parsedData = parseM3UContentForWorker(fileContent);
        self.postMessage({ success: true, data: parsedData });
    } catch (error) {
        console.error("Worker: CAUGHT ERROR during parsing: ", error.message, error.stack);
        self.postMessage({ success: false, error: error.message + (error.stack ? `\nStack: ${error.stack}` : '') });
    }
};
