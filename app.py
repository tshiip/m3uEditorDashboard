import os
import uuid
from datetime import datetime, timedelta, timezone # Use timezone-aware datetimes
from flask import Flask, render_template, request, jsonify, send_from_directory, url_for, abort
import requests # <--- ADDED: For making HTTP requests from the backend

app = Flask(__name__)
app.secret_key = os.urandom(24)

# --- Configuration for Shared Files ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SHARED_FILES_DIR_NAME = 'shared_m3u_files'
SHARED_FILES_FULL_PATH = os.path.join(BASE_DIR, SHARED_FILES_DIR_NAME)
LINK_EXPIRY_HOURS = 1

if not os.path.exists(SHARED_FILES_FULL_PATH):
    os.makedirs(SHARED_FILES_FULL_PATH)
# --- End Configuration ---

@app.route('/')
def index():
    return render_template('index.html')

# +++ NEW ROUTE: To proxy M3U URL fetching +++
@app.route('/proxy_m3u_url', methods=['POST'])
def proxy_m3u_url():
    try:
        data = request.get_json()
        if not data:
            app.logger.warn("Proxy request failed: No JSON data.")
            return jsonify({'success': False, 'error': 'Invalid request. No JSON data.'}), 400

        target_url = data.get('url')
        if not target_url:
            app.logger.warn("Proxy request failed: No URL provided in JSON.")
            return jsonify({'success': False, 'error': 'No URL provided.'}), 400

        # Basic validation for HTTP/HTTPS (you might want to make this more robust)
        if not target_url.startswith(('http://', 'https://')):
            app.logger.warn(f"Proxy request failed: Invalid URL scheme for {target_url}")
            return jsonify({'success': False, 'error': 'Invalid URL scheme. URL must start with http:// or https://'}), 400

        app.logger.info(f"Proxying M3U request to: {target_url}")

        headers = {
            'User-Agent': 'M3UEditorDashboard/1.0 (Proxy)' # Example User-Agent
        }
        
        # Use a timeout for the request
        # stream=True can be useful for very large files if you process them differently,
        # but for M3U playlists, .text is usually fine.
        response = requests.get(target_url, timeout=60, headers=headers)
        response.raise_for_status() # Raise an exception for HTTP errors (4xx or 5xx)

        m3u_content = response.text

        # Optional: Check if content looks like M3U
        if not m3u_content or not m3u_content.strip().upper().startswith("#EXTM3U"):
            app.logger.warn(f"Content from proxied URL ({target_url}) did not look like an M3U playlist. Content (first 200 chars): {m3u_content[:200]}...")
            # Consider if this should be an error or just a warning. For now, returning content.
        
        return jsonify({'success': True, 'm3uContent': m3u_content})

    except requests.exceptions.Timeout:
        app.logger.error(f"Timeout connecting to proxied URL: {target_url}")
        return jsonify({'success': False, 'error': 'Connection to the provided URL timed out.'}), 504
    except requests.exceptions.HTTPError as http_err:
        error_message = f'The URL returned an HTTP error: {http_err.response.status_code}.'
        # You could add more specific messages for common status codes like 401, 403, 404 if desired
        app.logger.error(f"HTTP error from proxied URL ({target_url}): {http_err.response.status_code} - Response: {http_err.response.text[:200]}")
        return jsonify({'success': False, 'error': error_message}), http_err.response.status_code
    except requests.exceptions.RequestException as req_err:
        # This catches other network errors like DNS failure, connection refused, etc.
        app.logger.error(f"Request error connecting to proxied URL {target_url}: {req_err}")
        return jsonify({'success': False, 'error': f'Error connecting to the provided URL: {req_err}'}), 500
    except Exception as e:
        # Catch-all for any other unexpected errors
        app.logger.error(f"Generic error proxying M3U URL ({target_url if 'target_url' in locals() else 'unknown'}): {e}", exc_info=True)
        return jsonify({'success': False, 'error': 'Failed to fetch playlist from the URL due to an unexpected server error.'}), 500
# +++ END NEW ROUTE +++

@app.route('/generate-share-link', methods=['POST'])
def generate_share_link():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Invalid request. No JSON data.'}), 400
            
        content = data.get('content', '')
        # original_filename = data.get('filename', 'playlist.m3u') # For reference, not used in saved name

        if not content:
            return jsonify({'success': False, 'error': 'No content provided.'}), 400

        unique_id = str(uuid.uuid4())
        filename_on_server = f"{unique_id}.m3u"
        filepath = os.path.join(SHARED_FILES_FULL_PATH, filename_on_server)

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        shareable_link = url_for('serve_shared_file', filename=filename_on_server, _external=True)
        
        return jsonify({
            'success': True, 
            'shareableLink': shareable_link, 
            'expires_in': f"{LINK_EXPIRY_HOURS} hour(s)"
        })

    except Exception as e:
        app.logger.error(f"Error generating share link: {e}", exc_info=True)
        return jsonify({'success': False, 'error': 'Failed to generate shareable link on server.'}), 500

@app.route('/shared/<path:filename>')
def serve_shared_file(filename):
    if '..' in filename or filename.startswith('/') or filename.startswith('\\'):
        abort(400, description="Invalid filename.")
    
    filepath = os.path.join(SHARED_FILES_FULL_PATH, filename)

    if not os.path.exists(filepath) or not os.path.isfile(filepath):
        return "Link expired or file not found.", 404

    try:
        file_mod_time_timestamp = os.path.getmtime(filepath)
        file_mod_time = datetime.fromtimestamp(file_mod_time_timestamp, tz=timezone.utc)
        
        if datetime.now(tz=timezone.utc) > file_mod_time + timedelta(hours=LINK_EXPIRY_HOURS):
            try:
                os.remove(filepath)
                app.logger.info(f"Deleted expired file during access attempt: {filename}")
            except Exception as e_del:
                app.logger.error(f"Error deleting expired file {filename} during serve attempt: {e_del}")
            return "Link expired.", 404
    except Exception as e_time:
        app.logger.error(f"Error checking file expiry for {filename}: {e_time}")

    try:
        return send_from_directory(
            SHARED_FILES_FULL_PATH, 
            filename, 
            as_attachment=True,
            download_name=f"filtered_playlist_{filename[:8]}.m3u"
        )
    except FileNotFoundError:
        return "Link expired or file not found.", 404
    except Exception as e:
        app.logger.error(f"Error serving file {filename}: {e}", exc_info=True)
        return "Error serving file.", 500


if __name__ == '__main__':
    # Setup basic logging if not already configured by a production server
    if not app.debug: # Or a more specific check if you use a production WSGI server
        import logging
        logging.basicConfig(level=logging.INFO)
    app.run(debug=True)
