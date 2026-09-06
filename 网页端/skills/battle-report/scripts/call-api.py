#!/usr/bin/env python3
"""
图生图 API 调用脚本（后台进程 + 状态文件模式）

根治同步阻塞问题：
- 主进程：启动后立即返回 job_id，然后退出
- 后台 worker：执行实际的 API 调用，实时写入 progress.json
- Agent：通过 status 子命令轮询 progress.json 获取进度

用法：
  # 1. 启动生成任务（立即返回，不阻塞）
  python3 call-api.py start --prompt "修改指令" --image-url "https://原图..." --output /tmp/generated_image.png
  # 输出: JOB:/tmp/call-api-jobs/{job_id}/progress.json

  # 2. 轮询进度（agent 每 5-10 秒执行一次）
  python3 call-api.py status --job /tmp/call-api-jobs/{job_id}
  # 输出: RUNNING:正在调用 Seedream API (IDC)... 或 SUCCESS:/tmp/... 或 FAIL:错误原因

  # 3. 带头像的任务
  python3 call-api.py start --prompt "..." --image-url "..." --avatar-url "..." --output /tmp/result.png --api seedream
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error
import ssl
import uuid
import subprocess
import tempfile
import re
import signal

# ===== 配置 =====
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, '..', 'references', 'api-config.json')
JOBS_DIR = '/tmp/call-api-jobs'

MAX_RETRIES = 3
BACKOFF_SECONDS = [5, 10, 20]
API_TIMEOUT = 120  # 单次 API 调用超时
TOTAL_TIMEOUT = 300  # 整个任务总超时（5分钟）

class APIError(Exception):
    pass

# ===== 加载配置 =====
def load_config():
    config_path = CONFIG_PATH
    example_path = os.path.join(SCRIPT_DIR, '..', 'references', 'api-config.example.json')
    if not os.path.exists(config_path):
        config_path = example_path
    with open(config_path, 'r') as f:
        return json.load(f)


def resolve_headers(headers):
    """用环境变量覆盖密钥，避免把 token 写进仓库。"""
    resolved = dict(headers or {})
    seedream_key = os.environ.get('SEEDREAM_API_KEY', '').strip()
    if seedream_key:
        resolved['Authorization'] = (
            seedream_key
            if seedream_key.lower().startswith('bearer ')
            else f'Bearer {seedream_key}'
        )
    gemini_key = os.environ.get('GEMINI_API_KEY', '').strip()
    if gemini_key:
        resolved['x-api-key'] = gemini_key
    cookie = os.environ.get('GEMINI_GATEWAY_COOKIE', '').strip()
    if cookie:
        resolved['Cookie'] = cookie
    return {key: value for key, value in resolved.items() if value}


def parse_json_response(body):
    """鲁棒解析响应：支持标准 JSON / SSE data 行 / 被污染文本中的 JSON"""
    text = (body or '').strip()
    if not text:
        raise APIError('响应为空')

    lower_text = text.lower()
    non_json_markers = [
        'stream error',
        'upstream connect error',
        'bad gateway',
        'service unavailable',
        '<html',
        '<!doctype html'
    ]
    for marker in non_json_markers:
        if marker in lower_text:
            raise APIError(f'上游返回非 JSON 错误: {marker}')

    # 1) 直接按 JSON 解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 2) 尝试解析 SSE: data: {...}
    for line in reversed(text.splitlines()):
        line = line.strip()
        if not line.startswith('data:'):
            continue
        payload = line[5:].strip()
        if not payload or payload == '[DONE]':
            continue
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            continue

    # 3) 尝试从混合文本中截取 JSON 主体
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end > start:
        candidate = text[start:end + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    raise APIError(f"响应不是有效 JSON: {text[:200]}")

# ===== 进度文件操作 =====
def write_progress(job_dir, status, message, detail=None):
    """写入进度状态（原子写入，避免轮询读取到半写入文件）"""
    progress = {
        'status': status,      # 'running' | 'success' | 'failed'
        'message': message,    # 人类可读的状态描述
        'timestamp': time.time(),
        'detail': detail or {}
    }
    os.makedirs(job_dir, exist_ok=True)
    progress_file = os.path.join(job_dir, 'progress.json')
    tmp_file = progress_file + '.tmp'
    with open(tmp_file, 'w') as f:
        json.dump(progress, f)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_file, progress_file)
    return progress

def read_progress(job_dir):
    """读取进度状态"""
    progress_file = os.path.join(job_dir, 'progress.json')
    if not os.path.exists(progress_file):
        return {'status': 'unknown', 'message': '任务不存在', 'timestamp': 0, 'detail': {}}

    try:
        with open(progress_file, 'r') as f:
            return json.load(f)
    except json.JSONDecodeError:
        # 写入中的瞬态状态，给轮询方返回可重试信号
        return {
            'status': 'running',
            'message': '状态文件写入中，请稍后重试',
            'timestamp': time.time(),
            'detail': {'retryable': True}
        }
    except Exception as e:
        return {
            'status': 'running',
            'message': f'读取状态异常，请稍后重试: {str(e)}',
            'timestamp': time.time(),
            'detail': {'retryable': True}
        }

# ===== Seedream API 调用 =====
def call_seedream(url, headers, request_body, timeout=API_TIMEOUT):
    """调用 Seedream API，返回响应 JSON"""
    data = json.dumps(request_body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    for key, value in headers.items():
        req.add_header(key, value)
    req.add_header('Accept', 'application/json')
    req.add_header('Accept', 'application/json')
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read().decode('utf-8')
            return parse_json_response(body)
    except APIError:
        raise
    except Exception as e:
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode('utf-8')
                return parse_json_response(body)
        except APIError:
            raise
        except Exception:
            raise APIError(f"请求失败: {str(e)}")

# ===== Gemini API 调用 =====
def call_gemini(url, headers, prompt, image_b64, avatar_b64=None, timeout=API_TIMEOUT):
    """调用 Gemini API，返回响应 JSON"""
    parts = [{"text": prompt}, {"inlineData": {"mimeType": "image/png", "data": image_b64}}]
    if avatar_b64:
        parts.append({"inlineData": {"mimeType": "image/png", "data": avatar_b64}})
    
    request_body = {
        "contents": [{"parts": parts}],
        "generationConfig": {"imageConfig": {"imageSize": "2K"}, "responseModalities": ["Image"]}
    }
    
    data = json.dumps(request_body).encode('utf-8')
    req = urllib.request.Request(url, data=data, method='POST')
    for key, value in headers.items():
        req.add_header(key, value)
    
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            body = resp.read().decode('utf-8')
            return parse_json_response(body)
    except APIError:
        raise
    except Exception as e:
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode('utf-8')
                return parse_json_response(body)
        except APIError:
            raise
        except Exception:
            raise APIError(f"请求失败: {str(e)}")

# ===== 从 Gemini 响应提取图片 =====
def extract_gemini_image(response):
    """从 Gemini 响应中提取 base64 图片数据"""
    parts = response.get('candidates', [{}])[0].get('content', {}).get('parts', [])
    for part in parts:
        if 'inlineData' in part:
            return part['inlineData']['data'], part['inlineData'].get('mimeType', 'image/png')
    raise APIError("Gemini 响应中无图片数据")

# ===== 从 Seedream 响应提取图片 URL =====
def extract_seedream_image_url(response):
    """兼容 Seedream 多种 data 结构，提取图片 URL"""
    data = response.get('data')
    if not data:
        raise APIError("Seedream 响应中无 data 字段")

    def pick_url_from_dict(obj):
        if not isinstance(obj, dict):
            return None
        # 常见直出字段
        direct = obj.get('url') or obj.get('imageUrl') or obj.get('image_url')
        if direct:
            return direct
        # 新结构：data.content[0].url
        content = obj.get('content')
        if isinstance(content, list) and content:
            first = content[0] if isinstance(content[0], dict) else None
            if first:
                nested = first.get('url') or first.get('imageUrl') or first.get('image_url')
                if nested:
                    return nested
        return None

    # 场景1：data 是数组
    if isinstance(data, list):
        if not data:
            raise APIError("Seedream 响应 data 数组为空")
        first = data[0]
        image_url = pick_url_from_dict(first)
        if not image_url:
            raise APIError("Seedream 响应 data[0] 中无图片 URL")
        return image_url

    # 场景2：data 是对象
    if isinstance(data, dict):
        image_url = pick_url_from_dict(data)
        if not image_url:
            raise APIError("Seedream 响应 data 对象中无图片 URL")
        return image_url

    raise APIError(f"Seedream 响应 data 类型异常: {type(data).__name__}")



# ===== 下载图片 =====
def download_image(url, output_path):
    """下载图片到本地"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    try:
        with urllib.request.urlopen(url, timeout=30, context=ctx) as resp:
            data = resp.read()
            with open(output_path, 'wb') as f:
                f.write(data)
            size_kb = len(data) / 1024
            if size_kb < 100:
                return False, f"图片太小（{size_kb:.1f}KB）"
            return True, output_path
    except Exception:
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                data = resp.read()
                with open(output_path, 'wb') as f:
                    f.write(data)
                size_kb = len(data) / 1024
                if size_kb < 100:
                    return False, f"图片太小（{size_kb:.1f}KB）"
                return True, output_path
        except Exception as e:
            return False, f"下载失败: {str(e)}"


def upload_to_internal_kcdn(local_file_path):
    """上传本地图片到内部 KCDN，返回内部 CDN URL"""
    upload_script = os.path.join(SCRIPT_DIR, 'upload-to-kcdn.sh')
    if not os.path.exists(upload_script):
        raise APIError(f"上传脚本不存在: {upload_script}")

    try:
        proc = subprocess.run(
            ['bash', upload_script, local_file_path],
            capture_output=True,
            text=True,
            timeout=120
        )
    except subprocess.TimeoutExpired:
        raise APIError("上传到内部 KCDN 超时")
    except Exception as e:
        raise APIError(f"调用上传脚本失败: {str(e)}")

    output = f"{proc.stdout}\n{proc.stderr}"
    if proc.returncode != 0:
        raise APIError(f"上传脚本执行失败: {output[:300]}")

    # 从脚本输出中提取 URL，优先内部 KCDN 链路
    urls = re.findall(r'https://[^\s\"\']+', output)
    if not urls:
        raise APIError("上传成功但未解析到 CDN URL")

    preferred = None
    for u in urls:
        if 'kcdn' in u or 'shwkwai.com' in u or 'corp.kuaishou.com' in u:
            preferred = u
            break

    return preferred or urls[0]

# ===== 图片 URL 转 base64 =====
def url_to_b64(url):
    """下载图片并转为 base64"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    try:
        with urllib.request.urlopen(url, timeout=30, context=ctx) as resp:
            data = resp.read()
            return base64.b64encode(data).decode('utf-8')
    except Exception:
        try:
            with urllib.request.urlopen(url, timeout=30) as resp:
                data = resp.read()
                return base64.b64encode(data).decode('utf-8')
        except Exception as e:
            raise APIError(f"下载图片转 base64 失败: {str(e)}")

# ===== 后台 Worker 主逻辑 =====
def worker_main(job_dir, args_dict):
    """
    后台 worker：执行实际的 API 调用
    实时写入 progress.json 让 agent 可以轮询
    """
    # 解析参数
    prompt = args_dict['prompt']
    image_url = args_dict['image_url']
    avatar_url = args_dict.get('avatar_url')
    output_path = args_dict['output']
    api_choice = args_dict.get('api', 'auto')

    # 记录启动时间用于总超时判断
    start_time = time.time()

    def check_timeout():
        if time.time() - start_time > TOTAL_TIMEOUT:
            write_progress(job_dir, 'failed', f'任务总超时（超过{TOTAL_TIMEOUT}秒）')
            raise APIError('任务总超时')

    try:
        config = load_config()
        seedream_config = config['seedreamApi']
        gemini_config = config['geminiApi']
    except Exception as e:
        write_progress(job_dir, 'failed', f'加载配置失败: {str(e)}')
        return

    # Gemini 优先，Seedream 兜底
    if api_choice == 'gemini':
        api_order = [('Gemini', 'gemini')]
    elif api_choice == 'seedream':
        api_order = [('Seedream', 'seedream')]
    else:
        api_order = [('Gemini', 'gemini'), ('Seedream', 'seedream')]

    try:
        for api_name, api_type in api_order:
            check_timeout()

            if api_type == 'gemini':
                write_progress(job_dir, 'running', '正在调用 Gemini API (IDC)...', {'api': 'Gemini', 'endpoint': 'IDC'})
                endpoints = [("IDC", gemini_config['idcUrl']), ("外网", gemini_config['defaultUrl'])]
                headers = resolve_headers(gemini_config.get('headers'))

                write_progress(job_dir, 'running', '正在下载原图并转为 base64...', {})
                try:
                    image_b64 = url_to_b64(image_url)
                except APIError as e:
                    write_progress(job_dir, 'failed', f'原图下载失败: {str(e)}')
                    return

                avatar_b64 = None
                if avatar_url:
                    write_progress(job_dir, 'running', '正在下载头像并转为 base64...', {})
                    try:
                        avatar_b64 = url_to_b64(avatar_url)
                    except APIError as e:
                        write_progress(job_dir, 'running', f'头像下载失败: {str(e)}，继续不使用头像', {'warning': str(e)})

                gemini_success = False
                for ep_name, ep_url in endpoints:
                    check_timeout()
                    for retry in range(MAX_RETRIES):
                        check_timeout()
                        if retry > 0:
                            write_progress(job_dir, 'running', f'Gemini {ep_name} 第{retry+1}次重试...', {'retry': retry+1})
                            time.sleep(BACKOFF_SECONDS[retry - 1])
                        else:
                            write_progress(job_dir, 'running', f'正在调用 Gemini API ({ep_name})...', {'retry': retry+1})

                        try:
                            result = call_gemini(ep_url, headers, prompt, image_b64, avatar_b64)
                        except APIError as e:
                            write_progress(job_dir, 'running', f'Gemini {ep_name} 失败: {str(e)}', {'error': str(e)})
                            continue

                        try:
                            img_b64, _mime = extract_gemini_image(result)
                            img_data = base64.b64decode(img_b64)
                            with open(output_path, 'wb') as f:
                                f.write(img_data)
                            size_kb = len(img_data) / 1024
                            if size_kb < 100:
                                write_progress(job_dir, 'running', f'图片太小（{size_kb:.1f}KB），重试...', {'size_kb': size_kb})
                                continue
                            write_progress(job_dir, 'success', '生成成功', {'output': output_path})
                            gemini_success = True
                            break
                        except Exception as e:
                            write_progress(job_dir, 'running', f'图片提取失败: {str(e)}', {'error': str(e)})
                            continue

                    if gemini_success:
                        return
                    write_progress(job_dir, 'running', f'Gemini {ep_name} 所有重试均失败，尝试下一个 endpoint...', {})

                if api_choice == 'gemini':
                    write_progress(job_dir, 'failed', 'Gemini API 所有 endpoint 均失败')
                    return
                # auto 模式下继续尝试 Seedream

            elif api_type == 'seedream':
                write_progress(job_dir, 'running', '正在调用 Seedream API (IDC)...', {'api': 'Seedream', 'endpoint': 'IDC'})
                endpoints = [("IDC", seedream_config['idcUrl']), ("外网", seedream_config['defaultUrl'])]
                images = [image_url]
                if avatar_url:
                    images.append(avatar_url)

                request_body = {
                    "model": seedream_config['requestBody']['model'],
                    "prompt": prompt,
                    "images": images,
                    "size": seedream_config['requestBody'].get('size', '2K'),
                    "response_format": "url",
                    "watermark": False,
                    "stream": False
                }
                headers = resolve_headers(seedream_config.get('headers'))

                seedream_success = False
                for ep_name, ep_url in endpoints:
                    check_timeout()
                    for retry in range(MAX_RETRIES):
                        check_timeout()
                        if retry > 0:
                            write_progress(job_dir, 'running', f'Seedream {ep_name} 第{retry+1}次重试...', {'retry': retry+1})
                            time.sleep(BACKOFF_SECONDS[retry - 1])
                        else:
                            write_progress(job_dir, 'running', f'正在调用 Seedream API ({ep_name})...', {'retry': retry+1})

                        try:
                            result = call_seedream(ep_url, headers, request_body)
                        except APIError as e:
                            write_progress(job_dir, 'running', f'Seedream {ep_name} 失败: {str(e)}', {'error': str(e)})
                            continue

                        if 'data' not in result or not result['data']:
                            write_progress(job_dir, 'running', f'Seedream {ep_name} 返回无图片数据', {})
                            continue

                        try:
                            image_url_result = extract_seedream_image_url(result)
                        except APIError as e:
                            write_progress(job_dir, 'running', f'Seedream 响应解析失败: {str(e)}', {
                                'error': str(e),
                                'raw_type': type(result.get('data')).__name__ if isinstance(result, dict) else type(result).__name__
                            })
                            continue

                        write_progress(job_dir, 'running', '已获取 Seedream 图片 URL（外部 CDN），正在下载并转内部流程...', {'image_url': image_url_result})
                        success, msg = download_image(image_url_result, output_path)
                        if not success:
                            write_progress(job_dir, 'running', f'下载失败: {msg}', {'error': msg})
                            continue

                        write_progress(job_dir, 'running', '外部 CDN 图片下载成功，正在转存到内部 KCDN...', {'output': output_path})
                        try:
                            internal_cdn_url = upload_to_internal_kcdn(output_path)
                        except APIError as e:
                            write_progress(job_dir, 'running', f'转内部 KCDN 失败: {str(e)}', {'error': str(e)})
                            continue

                        write_progress(job_dir, 'success', '生成成功', {
                            'output': output_path,
                            'seedream_external_url': image_url_result,
                            'internal_cdn_url': internal_cdn_url
                        })
                        seedream_success = True
                        break

                    if seedream_success:
                        return
                    write_progress(job_dir, 'running', f'Seedream {ep_name} 所有重试均失败，尝试下一个 endpoint...', {})

                write_progress(job_dir, 'failed', 'Seedream API 所有 endpoint 均失败')
                return

    except APIError as e:
        write_progress(job_dir, 'failed', f'任务失败: {str(e)}')
        return
    except Exception as e:
        write_progress(job_dir, 'failed', f'脚本异常: {str(e)}')
        return

    write_progress(job_dir, 'failed', '所有 API 均失败')

# ===== 启动后台任务 =====
def cmd_start(args):
    """启动后台生成任务，立即返回 job_id"""
    # 生成唯一 job_id
    job_id = str(uuid.uuid4())[:8]
    job_dir = os.path.join(JOBS_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)
    
    # 写入初始进度
    write_progress(job_dir, 'running', '任务已启动，正在准备...', {
        'prompt': args.prompt[:50] + '...' if len(args.prompt) > 50 else args.prompt,
        'image_url': args.image_url,
        'output': args.output
    })
    
    # 构建参数字典
    args_dict = {
        'prompt': args.prompt,
        'image_url': args.image_url,
        'avatar_url': args.avatar_url,
        'output': args.output,
        'api': args.api
    }
    
    # 将参数写入文件供 worker 读取
    args_file = os.path.join(job_dir, 'args.json')
    with open(args_file, 'w') as f:
        json.dump(args_dict, f)
    
    # 启动后台 worker（用 nohup 确保不受终端关闭影响）
    script_path = os.path.abspath(__file__)
    cmd = [
        'nohup', 'python3', script_path,
        'worker',
        '--job-dir', job_dir,
        '>/dev/null', '2>&1', '&'
    ]
    
    # 使用 subprocess 启动后台进程
    subprocess.Popen(
        ['python3', script_path, 'worker', '--job-dir', job_dir],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True  # 脱离终端 session
    )
    
    # 立即返回 job_id，让 agent 可以去轮询
    print(f"JOB:{job_dir}")
    return job_dir

# ===== 查询任务状态 =====
def cmd_status(args):
    """查询任务状态，供 agent 轮询"""
    try:
        job_dir = args.job_dir

        if not os.path.exists(job_dir):
            print("FAIL:任务不存在")
            return

        progress = read_progress(job_dir)
        status = progress.get('status', 'running')
        message = progress.get('message', '状态未知')
        detail = progress.get('detail', {})

        if status == 'success':
            internal_cdn_url = detail.get('internal_cdn_url', '')
            output = detail.get('output', '')
            if internal_cdn_url:
                print(f"SUCCESS:{internal_cdn_url}")
            else:
                print(f"SUCCESS:{output}")
        elif status == 'failed':
            print(f"FAIL:{message}")
        elif detail.get('retryable'):
            print("RETRY:暂时无法获取状态，请稍后重试")
        else:
            # running - 返回进度信息
            print(f"RUNNING:{message}")
    except Exception:
        # 最终兜底：绝不抛 traceback 到上层
        print("RETRY:暂时无法获取状态，请稍后重试")

# ===== Worker 命令入口 =====
def cmd_worker(args):
    """后台 worker 入口"""
    job_dir = args.job_dir
    
    # 读取参数
    args_file = os.path.join(job_dir, 'args.json')
    with open(args_file, 'r') as f:
        args_dict = json.load(f)
    
    # 执行主逻辑
    worker_main(job_dir, args_dict)

# ===== 主入口 =====
def main():
    parser = argparse.ArgumentParser(description='图生图 API 调用脚本（后台进程模式）')
    subparsers = parser.add_subparsers(dest='command', help='子命令')
    
    # start 子命令
    start_parser = subparsers.add_parser('start', help='启动后台生成任务')
    start_parser.add_argument('--prompt', required=True, help='生成指令')
    start_parser.add_argument('--image-url', required=True, help='原图 CDN URL')
    start_parser.add_argument('--avatar-url', default=None, help='头像 CDN URL（可选）')
    start_parser.add_argument('--output', default='/tmp/generated_image.png', help='输出文件路径')
    start_parser.add_argument('--api', default='auto', choices=['seedream', 'gemini', 'auto'], help='选择 API')
    
    # status 子命令
    status_parser = subparsers.add_parser('status', help='查询任务状态')
    status_parser.add_argument('--job-dir', required=True, help='任务目录路径（start 返回的 JOB:路径）')
    
    # worker 子命令（内部使用，agent 不直接调用）
    worker_parser = subparsers.add_parser('worker', help='后台 worker（内部使用）')
    worker_parser.add_argument('--job-dir', required=True, help='任务目录路径')
    
    args = parser.parse_args()
    
    if args.command == 'start':
        cmd_start(args)
    elif args.command == 'status':
        cmd_status(args)
    elif args.command == 'worker':
        cmd_worker(args)
    else:
        parser.print_help()
        sys.exit(1)

if __name__ == '__main__':
    main()
