import os
import uuid
from datetime import datetime, timedelta, timezone # Use timezone-aware datetimes
from flask import Flask, render_template, request, jsonify, send_from_directory, url_for, abort

app = Flask(__name__)
app.secret_key = os.urandom(24) 

# --- Configuration for Shared Files ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SHARED_FILES_DIR_NAME = 'shared_m3u_files'
SHARED_FILES_FULL_PATH = os.path.join(BASE_DIR, SHARED_FILES_DIR_NAME)
LINK_EXPIRY_HOURS = 1
MAX_FILE_SIZE_BYTES = 1 * 1024 * 1024  # MODIFIED: 1 MB size limit

if not os.path.exists(SHARED_FILES_FULL_PATH):
    os.makedirs(SHARED_FILES_FULL_PATH)
# --- End Configuration ---

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/generate-share-link', methods=['POST'])
def generate_share_link():
    try:
        data = request.get_json()
        if not data:
            return jsonify({'success': False, 'error': 'Invalid request. No JSON data.'}), 400
            
        content = data.get('content', '')
        # original_filename = data.get('filename', 'playlist.m3u') # For reference

        if not content:
            return jsonify({'success': False, 'error': 'No content provided.'}), 400

        # --- NEW: Check content size ---
        content_bytes = content.encode('utf-8') # Encode to UTF-8 to get byte size
        if len(content_bytes) > MAX_FILE_SIZE_BYTES:
            max_size_mb = MAX_FILE_SIZE_BYTES / (1024 * 1024)
            return jsonify({
                'success': False, 
                'error': f'Playlist content is too large to share via link (max {max_size_mb:.0f}MB).'
            }), 413 # HTTP 413 Payload Too Large is an appropriate status code
        # --- End new check ---

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
        app.logger.error(f"Error generating share link: {e}")
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
                print(f"Deleted expired file during access attempt: {filename}")
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
        app.logger.error(f"Error serving file {filename}: {e}")
        return "Error serving file.", 500


if __name__ == '__main__':
    app.run(debug=True)
