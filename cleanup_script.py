import os
import sys
from datetime import datetime, timedelta, timezone

# Ensure this script can find SHARED_FILES_DIR_NAME relative to its own location
# This assumes cleanup_script.py is in the same directory as app.py
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SHARED_FILES_DIR_NAME = 'shared_m3u_files' # Must match app.py
SHARED_FILES_FULL_PATH = os.path.join(BASE_DIR, SHARED_FILES_DIR_NAME)
LINK_EXPIRY_HOURS = 1 # Must match app.py

def cleanup_expired_files():
    now = datetime.now(tz=timezone.utc)
    print(f"[{now.isoformat()}] Running cleanup task for shared files in {SHARED_FILES_FULL_PATH}...")
    
    if not os.path.isdir(SHARED_FILES_FULL_PATH):
        print(f"Shared files directory {SHARED_FILES_FULL_PATH} does not exist. Nothing to clean.")
        return

    cleaned_count = 0
    error_count = 0
    for filename in os.listdir(SHARED_FILES_FULL_PATH):
        filepath = os.path.join(SHARED_FILES_FULL_PATH, filename)
        
        # Ensure it's a file and not a subdirectory
        if not os.path.isfile(filepath):
            continue
        
        try:
            file_mod_time_timestamp = os.path.getmtime(filepath)
            file_mod_time = datetime.fromtimestamp(file_mod_time_timestamp, tz=timezone.utc)
            
            expiry_time = file_mod_time + timedelta(hours=LINK_EXPIRY_HOURS)

            if now > expiry_time:
                os.remove(filepath)
                print(f"Deleted expired file: {filename} (Expired at: {expiry_time.isoformat()})")
                cleaned_count += 1
            # else:
            #     print(f"File {filename} is not expired. Mod time: {file_mod_time.isoformat()}, Expires at: {expiry_time.isoformat()}")
        except FileNotFoundError:
            print(f"File {filename} not found during cleanup (possibly deleted by another process or request). Skipping.")
        except Exception as e:
            print(f"Error processing or deleting file {filename}: {e}")
            error_count += 1
            
    print(f"[{datetime.now(tz=timezone.utc).isoformat()}] Cleanup task finished. Deleted {cleaned_count} file(s). Encountered {error_count} error(s).")

if __name__ == "__main__":
    # This allows running the script directly, e.g., python cleanup_script.py
    # And for setting up the scheduled task on PythonAnywhere
    cleanup_expired_files()
