#!/bin/bash
#
# Upload images to KCDN (Kuaishou CDN)
#
# Usage:
#   ./upload-to-kcdn.sh <file1> [file2] [file3] ...
#
# Example:
#   ./upload-to-kcdn.sh /path/to/image1.png /path/to/image2.jpg
#
# Output:
#   Returns CDN URLs for uploaded files
#

set -e

# =============================================================================
# Constants
# =============================================================================

# KCDN API endpoint
KCDN_API_URL="https://kcdn.corp.kuaishou.com/api/kcdn/v1/service/npmUpload/multiple"

# KCDN token — 必须通过环境变量注入，禁止把密钥写进仓库
KCDN_TOKEN="${KCDN_TOKEN:-}"

# Upload settings
PID="locallife-shw-default"
DIR="/zhanbao/$(date +%Y%m%d%H%M%S)_$(openssl rand -hex 4)/"
ALLOW_REWRITE="true"
ALLOW_MD5="false"
ALLOW_HASH="false"
REQUEST_INFO_UPLOADER_TYPE="1"
REQUEST_INFO_SERVICE_NAME="battle-report-upload"
REQUEST_INFO_REQUEST_URI="/rest/upload"
REQUEST_INFO_USER_ID="${USER_ID:-1234567}"
REQUEST_INFO_CLIENT_IP="${CLIENT_IP:-210.21.210.162}"
REQUEST_INFO_FILE_EXTS="jpg,jpeg,png,gif,webp,svg"

# =============================================================================
# Functions
# =============================================================================

print_usage() {
    echo "Usage: $0 <file1> [file2] [file3] ..."
    echo ""
    echo "Upload images to KCDN (Kuaishou CDN)"
    echo ""
    echo "Environment Variables:"
    echo "  KCDN_TOKEN          KCDN API token (required)"
    echo "  USER_ID             User ID for request info (optional, default: 1234567)"
    echo "  CLIENT_IP           Client IP for request info (optional, default: 210.21.210.162)"
    echo ""
    echo "Examples:"
    echo "  $0 image1.png"
    echo "  $0 image1.png image2.jpg image3.png"
    echo "  KCDN_TOKEN=your_token $0 /path/to/image.png"
    echo ""
}

validate_file() {
    local file="$1"
    
    if [[ ! -f "$file" ]]; then
        echo "Error: File not found: $file"
        return 1
    fi
    
    # Check file extension
    local ext="${file##*.}"
    ext=$(echo "$ext" | tr '[:upper:]' '[:lower:]')
    
    case "$ext" in
        jpg|jpeg|png|gif|webp|svg)
            return 0
            ;;
        *)
            echo "Error: Unsupported file type: .$ext"
            echo "       Supported: jpg, jpeg, png, gif, webp, svg"
            return 1
            ;;
    esac
}

# =============================================================================
# Main
# =============================================================================

# Check arguments
if [[ $# -eq 0 ]]; then
    echo "Error: No files provided"
    print_usage
    exit 1
fi

if [[ -z "$KCDN_TOKEN" ]]; then
    echo "Error: KCDN_TOKEN is not set"
    print_usage
    exit 1
fi

if [[ "$1" == "-h" || "$1" == "--help" ]]; then
    print_usage
    exit 0
fi

# Validate all files first
echo "============================================================"
echo "KCDN Upload - Validating files..."
echo "============================================================"
echo ""

for file in "$@"; do
    echo "Checking: $file"
    if ! validate_file "$file"; then
        exit 1
    fi
done

echo ""
echo "All files validated successfully!"
echo ""

# Build curl command with multiple files
CURL_CMD="curl --location --request POST '${KCDN_API_URL}?token=${KCDN_TOKEN}'"

# Add form fields for each file
for file in "$@"; do
    CURL_CMD="$CURL_CMD --form 'files[]=@${file}'"
done

# Add other form fields
CURL_CMD="$CURL_CMD --form 'pid=${PID}'"
CURL_CMD="$CURL_CMD --form 'allowRewrite=${ALLOW_REWRITE}'"
CURL_CMD="$CURL_CMD --form 'dir=${DIR}'"
CURL_CMD="$CURL_CMD --form 'allowMD5=${ALLOW_MD5}'"
CURL_CMD="$CURL_CMD --form 'allowHash=${ALLOW_HASH}'"
CURL_CMD="$CURL_CMD --form 'requestInfo.uploaderType=${REQUEST_INFO_UPLOADER_TYPE}'"
CURL_CMD="$CURL_CMD --form 'requestInfo.serviceName=${REQUEST_INFO_SERVICE_NAME}'"
CURL_CMD="$CURL_CMD --form 'requestInfo.requestUri=${REQUEST_INFO_REQUEST_URI}'"
CURL_CMD="$CURL_CMD --form 'requestInfo.userId=${REQUEST_INFO_USER_ID}'"
CURL_CMD="$CURL_CMD --form 'requestInfo.clientIp=${REQUEST_INFO_CLIENT_IP}'"
CURL_CMD="$CURL_CMD --form 'requestInfo.fileExts=${REQUEST_INFO_FILE_EXTS}'"

# Execute upload
echo "============================================================"
echo "Uploading to KCDN..."
echo "============================================================"
echo ""
echo "Files: $#"
for file in "$@"; do
    filename=$(basename "$file")
    filesize=$(ls -lh "$file" | awk '{print $5}')
    echo "  - $filename ($filesize)"
done
echo ""

RESPONSE=$(eval "$CURL_CMD" 2>&1)

# Parse response
echo "============================================================"
echo "Upload Response"
echo "============================================================"
echo ""
echo "$RESPONSE"
echo ""

# Try to extract URLs from response (assumes JSON response)
# Example response: {"code":0,"data":["https://cdn.url/file1.png","https://cdn.url/file2.jpg"]}
if echo "$RESPONSE" | grep -q '"code":0'; then
    echo "============================================================"
    echo "Upload Successful!"
    echo "============================================================"
    echo ""
    
    # Extract URLs from JSON array
    URLS=$(echo "$RESPONSE" | grep -o '"https://[^"]*"' | tr -d '"')
    
    if [[ -n "$URLS" ]]; then
        echo "CDN URLs:"
        echo "$URLS" | while read -r url; do
            echo "  $url"
        done
        echo ""
        echo "------------------------------------------------------------"
        echo "You can now use these URLs in your battle report templates"
        echo "------------------------------------------------------------"
    else
        echo "Warning: Could not extract URLs from response"
    fi
else
    echo "============================================================"
    echo "Upload Failed"
    echo "============================================================"
    echo ""
    echo "Please check the error message above."
    exit 1
fi
