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
        # original_filename = data.get('filename', 'playlist.m3u') # For reference, not used in saved name

        if not content:
            return jsonify({'success': False, 'error': 'No content provided.'}), 400

        unique_id = str(uuid.uuid4())
        filename_on_server = f"{unique_id}.m3u"
        filepath = os.path.join(SHARED_FILES_FULL_PATH, filename_on_server)

        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # The cleanup script will handle deletion based on file modification time.
        shareable_link = url_for('serve_shared_file', filename=filename_on_server, _external=True)
        
        return jsonify({
            'success': True, 
            'shareableLink': shareable_link, 
            'expires_in': f"{LINK_EXPIRY_HOURS} hour(s)"
        })

    except Exception as e:
        print(f"Error generating share link: {e}")
        app.logger.error(f"Error generating share link: {e}") # Log to Flask logger
        return jsonify({'success': False, 'error': 'Failed to generate shareable link on server.'}), 500

@app.route('/shared/<path:filename>') # Use <path:filename> to allow dots in filename
def serve_shared_file(filename):
    # Basic security: prevent directory traversal
    if '..' in filename or filename.startswith('/') or filename.startswith('\\'):
        abort(400, description="Invalid filename.")
    
    filepath = os.path.join(SHARED_FILES_FULL_PATH, filename)

    if not os.path.exists(filepath) or not os.path.isfile(filepath):
        # File might have been cleaned up or never existed
        return "Link expired or file not found.", 404

    # Optional: Add an explicit expiry check here as well, though the cleanup task is primary.
    try:
        file_mod_time_timestamp = os.path.getmtime(filepath)
        file_mod_time = datetime.fromtimestamp(file_mod_time_timestamp, tz=timezone.utc)
        
        if datetime.now(tz=timezone.utc) > file_mod_time + timedelta(hours=LINK_EXPIRY_HOURS):
            # File is expired, attempt to delete it now.
            # This is a secondary check; the main cleanup is done by the scheduled task.
            try:
                os.remove(filepath)
                print(f"Deleted expired file during access attempt: {filename}")
            except Exception as e_del:
                app.logger.error(f"Error deleting expired file {filename} during serve attempt: {e_del}")
            return "Link expired.", 404 # Respond as if it's gone
    except Exception as e_time:
        app.logger.error(f"Error checking file expiry for {filename}: {e_time}")
        # If time check fails, proceed to serve, rely on main cleanup task for removal.

    try:
        # Send the file, try to make it download with the original desired name if provided,
        # otherwise, it will use the unique ID name.
        return send_from_directory(
            SHARED_FILES_FULL_PATH, 
            filename, 
            as_attachment=True, # Suggest download
            download_name=f"filtered_playlist_{filename[:8]}.m3u" # Example nice download name
        )
    except FileNotFoundError:
        return "Link expired or file not found.", 404
    except Exception as e:
        app.logger.error(f"Error serving file {filename}: {e}")
        return "Error serving file.", 500


if __name__ == '__main__':
    app.run(debug=True)
