#!/usr/bin/env python3
"""
Enhanced YAML Dependency-Based Development Server
Implements comprehensive URL routing, build detection, and development features
"""

import http.server
import socketserver
import webbrowser
import os
import sys
import json
import urllib.parse
import asyncio
from pathlib import Path
import threading
import time
import traceback
from typing import Dict, Any, Optional, Tuple, List
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Import our enhanced YAML template builder
try:
    from yaml_template_builder_enhanced import YAMLTemplateBuilder, AsyncYAMLTemplateBuilder, ComponentRef
except ImportError:
    print("❌ Could not import enhanced yaml template builder.")
    print("💡 Make sure all dependencies are installed: pip install pyyaml aiohttp requests watchdog beautifulsoup4")
    sys.exit(1)

class EnhancedChangeHandler(FileSystemEventHandler):
    """Enhanced file system event handler with smarter change detection"""
    
    def __init__(self, template_builder=None, server_handler=None):
        self.last_modified = {}
        self.template_builder = template_builder
        self.server_handler = server_handler
        self.debounce_time = 0.5
    
    def on_modified(self, event):
        if event.is_directory:
            return
        
        # Get file path and current time
        file_path = event.src_path
        now = time.time()
        
        # Debounce rapid fire events for the same file
        if file_path in self.last_modified:
            if now - self.last_modified[file_path] < self.debounce_time:
                return
        
        self.last_modified[file_path] = now
        
        # Watch for relevant file types
        if file_path.endswith(('.html', '.css', '.js', '.yaml', '.yml', '.svg', '.png', '.jpg', '.jpeg')):
            print(f"📝 File changed: {file_path}")
            
            # Clear appropriate caches
            if self.template_builder:
                if file_path.endswith(('.yaml', '.yml', '.html')):
                    # Clear template cache for structure changes
                    self.template_builder.clear_cache()
                    print("🧹 Template cache cleared")
                elif file_path.endswith(('.css', '.js')):
                    # For CSS/JS changes, we might want partial cache clearing
                    print("🎨 Asset change detected")
            
            # Notify about browser refresh
            print("🔄 Refresh your browser to see changes")
    
    def on_created(self, event):
        if not event.is_directory and event.src_path.endswith(('.html', '.css', '.js', '.yaml', '.yml')):
            print(f"➕ New file created: {event.src_path}")
            if self.template_builder:
                self.template_builder.clear_cache()
    
    def on_deleted(self, event):
        if not event.is_directory and event.src_path.endswith(('.html', '.css', '.js', '.yaml', '.yml')):
            print(f"🗑️  File deleted: {event.src_path}")
            if self.template_builder:
                self.template_builder.clear_cache()

class EnhancedYAMLTemplateHTTPHandler(http.server.SimpleHTTPRequestHandler):
    """Enhanced HTTP handler with comprehensive template building and routing"""
    
    def __init__(self, *args, template_builder=None, async_builder=None, **kwargs):
        self.template_builder = template_builder
        self.async_builder = async_builder
        self._build_stats = {"builds": 0, "cache_hits": 0, "errors": 0}
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)
    
    def end_headers(self):
        """Add development-friendly headers"""
        # Prevent caching during development
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        
        # Add CORS headers for development
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        
        super().end_headers()
    
    def do_GET(self):
        """Enhanced GET handler with comprehensive routing and build detection"""
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path.lstrip('/')
        query_params = urllib.parse.parse_qs(parsed_path.query)
        
        # Handle special development endpoints
        if path.startswith('__dev__/'):
            self._handle_dev_endpoint(path, query_params)
            return
        
        # Check if this request should trigger template building
        build_info = self._should_build_template(path, query_params)
        
        if build_info['should_build']:
            try:
                start_time = time.time()
                content = self._build_and_serve_template(build_info, query_params)
                build_time = time.time() - start_time
                
                if content:
                    self._build_stats["builds"] += 1
                    
                    # Send successful response
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html; charset=utf-8')
                    self.send_header('X-Build-Time', f"{build_time:.3f}s")
                    self.send_header('X-Build-Type', build_info['build_type'])
                    self.send_header('X-Template-Path', build_info['template_path'])
                    self.end_headers()
                    self.wfile.write(content.encode('utf-8'))
                    
                    # Log build success with emoji indicators
                    emoji = "📄" if build_info['build_type'] == 'page' else "📦"
                    print(f"{emoji} Built {build_info['template_path']} in {build_time:.3f}s")
                    return
                    
            except Exception as e:
                self._build_stats["errors"] += 1
                print(f"❌ Error building template for {path}: {e}")
                traceback.print_exc()
                self._send_error_page(500, f"Template Building Error: {e}", build_info.get('template_path', path))
                return
        
        # Fall back to default file serving
        try:
            super().do_GET()
        except Exception as e:
            print(f"❌ Error serving static file {path}: {e}")
            self._send_error_page(404, f"File not found: {path}")
    
    def _handle_dev_endpoint(self, path: str, query_params: Dict[str, List[str]]):
        """Handle special development endpoints"""
        endpoint = path[7:]  # Remove '__dev__/' prefix
        
        if endpoint == 'stats':
            # Return build statistics
            stats = {
                'build_stats': self._build_stats,
                'cache_stats': self.template_builder.get_cache_stats() if self.template_builder else {},
                'server_info': {
                    'frontend_dir': str(FRONTEND_DIR),
                    'template_builder_available': self.template_builder is not None,
                    'async_builder_available': self.async_builder is not None
                }
            }
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(stats, indent=2).encode('utf-8'))
            
        elif endpoint == 'clear-cache':
            # Clear all caches
            if self.template_builder:
                self.template_builder.clear_cache()
            if self.async_builder:
                self.async_builder.clear_cache()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'status': 'cache_cleared'}).encode('utf-8'))
            print("🧹 Cache manually cleared via dev endpoint")
            
        elif endpoint == 'components':
            # List available components
            components = self._discover_components()
            
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps(components, indent=2).encode('utf-8'))
            
        else:
            self.send_response(404)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"Dev endpoint not found: {endpoint}".encode('utf-8'))
    
    def _discover_components(self) -> Dict[str, Any]:
        """Discover all available components and pages"""
        components = {'pages': {}, 'components': {}}
        
        # Discover pages
        pages_dir = FRONTEND_DIR / "pages"
        if pages_dir.exists():
            for page_dir in pages_dir.iterdir():
                if page_dir.is_dir():
                    page_name = page_dir.name
                    html_file = page_dir / "html" / f"{page_name}.html"
                    yaml_file = page_dir / f"{page_name}.yaml"
                    
                    components['pages'][page_name] = {
                        'html_exists': html_file.exists(),
                        'yaml_exists': yaml_file.exists(),
                        'url': f"/{page_name.lower()}",
                        'direct_url': f"/pages/{page_name}/html/{page_name}.html"
                    }
        
        # Discover components
        comp_dir = FRONTEND_DIR / "components"
        if comp_dir.exists():
            for group_dir in comp_dir.iterdir():
                if group_dir.is_dir():
                    group_name = group_dir.name
                    components['components'][group_name] = {}
                    
                    html_dir = group_dir / "html"
                    if html_dir.exists():
                        for html_file in html_dir.glob("*.html"):
                            comp_name = html_file.stem
                            yaml_file = group_dir / "yaml" / f"{comp_name}.yaml"
                            
                            components['components'][group_name][comp_name] = {
                                'html_exists': True,
                                'yaml_exists': yaml_file.exists(),
                                'url': f"/components/{group_name}/html/{comp_name}.html"
                            }
        
        return components
    
    def _should_build_template(self, path: str, query_params: Dict[str, List[str]]) -> Dict[str, Any]:
        """Comprehensive build detection logic"""
        build_info = {
            'should_build': False,
            'template_path': None,
            'build_type': None,
            'yaml_path': None,
            'reason': None
        }
        
        # Force build if build=true parameter
        if 'build' in query_params and query_params['build'][0].lower() == 'true':
            build_info.update({
                'should_build': True,
                'reason': 'forced_via_parameter'
            })
        
        # Check for direct page/component requests with YAML files
        if path.startswith('pages/') and path.endswith('.html'):
            # Direct page access: pages/PageName/html/PageName.html
            path_parts = path.split('/')
            if len(path_parts) >= 4:  # pages/PageName/html/PageName.html
                page_name = path_parts[1]
                yaml_file = FRONTEND_DIR / "pages" / page_name / f"{page_name}.yaml"
                
                if yaml_file.exists():
                    build_info.update({
                        'should_build': True,
                        'template_path': path,
                        'build_type': 'page',
                        'yaml_path': str(yaml_file),
                        'reason': 'page_with_yaml'
                    })
                elif build_info['reason'] == 'forced_via_parameter':
                    build_info.update({
                        'template_path': path,
                        'build_type': 'page'
                    })
        
        elif path.startswith('components/') and path.endswith('.html'):
            # Direct component access: components/Group/html/component.html
            path_parts = path.split('/')
            if len(path_parts) >= 4:  # components/Group/html/component.html
                group_name = path_parts[1]
                comp_name = Path(path_parts[3]).stem
                yaml_file = FRONTEND_DIR / "components" / group_name / "yaml" / f"{comp_name}.yaml"
                
                if yaml_file.exists():
                    build_info.update({
                        'should_build': True,
                        'template_path': path,
                        'build_type': 'component',
                        'yaml_path': str(yaml_file),
                        'reason': 'component_with_yaml'
                    })
                elif build_info['reason'] == 'forced_via_parameter':
                    build_info.update({
                        'template_path': path,
                        'build_type': 'component'
                    })
        
        # Handle root-level page requests (e.g., /welcome -> pages/Welcome/html/Welcome.html)
        elif (not build_info['should_build'] and 
              '.' not in path and path and 
              not path.startswith(('assets/', 'css/', 'js/', 'components/', 'static/', '__dev__/'))):
            
            page_name = path.strip('/').title() or 'Welcome'
            template_path = f"pages/{page_name}/html/{page_name}.html"
            yaml_file = FRONTEND_DIR / "pages" / page_name / f"{page_name}.yaml"
            html_file = FRONTEND_DIR / template_path
            
            if yaml_file.exists() and html_file.exists():
                build_info.update({
                    'should_build': True,
                    'template_path': template_path,
                    'build_type': 'page',
                    'yaml_path': str(yaml_file),
                    'reason': 'friendly_url_with_yaml'
                })
            elif build_info['reason'] == 'forced_via_parameter' and html_file.exists():
                build_info.update({
                    'template_path': template_path,
                    'build_type': 'page'
                })
        
        # Handle root request (/ -> Welcome page)
        elif path == '' or path == '/':
            template_path = "pages/Welcome/html/Welcome.html"
            yaml_file = FRONTEND_DIR / "pages" / "Welcome" / "Welcome.yaml"
            html_file = FRONTEND_DIR / template_path
            
            if yaml_file.exists() and html_file.exists():
                build_info.update({
                    'should_build': True,
                    'template_path': template_path,
                    'build_type': 'page',
                    'yaml_path': str(yaml_file),
                    'reason': 'root_welcome_with_yaml'
                })
            elif build_info['reason'] == 'forced_via_parameter' and html_file.exists():
                build_info.update({
                    'template_path': template_path,
                    'build_type': 'page'
                })
        
        return build_info
    
    def _build_and_serve_template(self, build_info: Dict[str, Any], query_params: Dict[str, List[str]]) -> Optional[str]:
        """Build and return template content using enhanced builder"""
        if not self.template_builder:
            raise Exception("Template builder not available")
        
        template_path = build_info['template_path']
        
        # Extract extra data from query parameters
        extra_data = self._extract_query_data(query_params)
        
        # Add build metadata to extra_data
        extra_data['_build_info'] = {
            'build_time': time.strftime('%Y-%m-%d %H:%M:%S'),
            'build_type': build_info['build_type'],
            'reason': build_info['reason'],
            'template_path': template_path
        }
        
        print(f"🔧 Building template: {template_path}")
        if extra_data:
            filtered_data = {k: v for k, v in extra_data.items() if not k.startswith('_')}
            if filtered_data:
                print(f"📊 Extra data: {filtered_data}")
        
        # Choose build method based on query parameters
        use_async = query_params.get('async', ['false'])[0].lower() == 'true'
        
        if use_async and self.async_builder:
            print("🚀 Using async build")
            return self._run_async_build(template_path, extra_data)
        else:
            return self.template_builder.build_template_sync(template_path, extra_data)
    
    def _extract_query_data(self, query_params: Dict[str, List[str]]) -> Dict[str, Any]:
        """Extract template data from query parameters"""
        extra_data = {}
        
        # Handle structured data parameter (JSON string)
        if 'data' in query_params:
            try:
                extra_data.update(json.loads(query_params['data'][0]))
            except json.JSONDecodeError as e:
                print(f"⚠️  Invalid JSON in data parameter: {e}")
        
        # Handle individual parameters (excluding control parameters)
        control_params = {'data', 'build', 'async', 'debug', 'cache'}
        for key, values in query_params.items():
            if key not in control_params and values:
                # Handle multiple values
                if len(values) == 1:
                    extra_data[key] = values[0]
                else:
                    extra_data[key] = values
        
        return extra_data
    
    def _run_async_build(self, template_path: str, extra_data: Dict[str, Any]) -> str:
        """Run async template build in a new event loop"""
        try:
            # Create new event loop for this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(
                    self.async_builder.build_template_async(template_path, extra_data)
                )
            finally:
                loop.close()
        except Exception as e:
            print(f"❌ Async build failed, falling back to sync: {e}")
            return self.template_builder.build_template_sync(template_path, extra_data)
    
    def _send_error_page(self, code: int, message: str, template_path: str = ""):
        """Send a comprehensive, developer-friendly error page"""
        
        # Get additional debugging info
        debug_info = ""
        if self.template_builder:
            cache_stats = self.template_builder.get_cache_stats()
            debug_info = f"""
            <div class="debug-section">
                <h3>🛠️ Debug Information</h3>
                <div class="debug-grid">
                    <div><strong>Template Path:</strong> {template_path}</div>
                    <div><strong>Frontend Dir:</strong> {FRONTEND_DIR}</div>
                    <div><strong>Cache Enabled:</strong> {cache_stats.get('cache_enabled', 'Unknown')}</div>
                    <div><strong>Cached Files:</strong> {cache_stats.get('file_cache_size', 0)}</div>
                    <div><strong>Cached URLs:</strong> {cache_stats.get('url_cache_size', 0)}</div>
                </div>
            </div>
            """
        
        # Build comprehensive error page
        error_html = f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <title>Server Error {code}</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * {{ margin: 0; padding: 0; box-sizing: border-box; }}
                body {{ 
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh; padding: 20px; color: #333;
                }}
                .container {{ 
                    max-width: 1000px; margin: 0 auto; 
                    background: white; border-radius: 12px; overflow: hidden;
                    box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                }}
                .header {{ 
                    background: linear-gradient(135deg, #ff416c 0%, #ff4757 100%);
                    color: white; padding: 30px; text-align: center;
                }}
                .code {{ font-size: 4rem; font-weight: 900; margin-bottom: 10px; }}
                .message {{ 
                    background: #fff3cd; border-left: 4px solid #ffc107;
                    padding: 20px; margin: 30px; border-radius: 8px;
                    font-family: 'Monaco', 'Menlo', monospace; font-size: 14px;
                    white-space: pre-wrap; word-break: break-word;
                }}
                .help {{ padding: 30px; }}
                .help h3 {{ color: #2c3e50; margin-bottom: 15px; }}
                .help ul {{ margin-left: 20px; }}
                .help li {{ margin-bottom: 8px; line-height: 1.6; }}
                .debug-section {{ 
                    background: #f8f9fa; padding: 20px; margin: 20px 30px;
                    border-radius: 8px; border: 1px solid #e9ecef;
                }}
                .debug-grid {{ 
                    display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 10px; margin-top: 15px;
                }}
                .debug-grid div {{ 
                    background: white; padding: 10px; border-radius: 4px;
                    border: 1px solid #dee2e6; font-size: 13px;
                }}
                .actions {{ 
                    padding: 20px 30px; background: #f8f9fa;
                    border-top: 1px solid #e9ecef; text-align: center;
                }}
                .btn {{ 
                    display: inline-block; background: #007bff; color: white;
                    padding: 12px 24px; border-radius: 6px; text-decoration: none;
                    margin: 0 10px; font-weight: 500; transition: all 0.3s;
                }}
                .btn:hover {{ background: #0056b3; transform: translateY(-2px); }}
                .btn-secondary {{ background: #6c757d; }}
                .btn-secondary:hover {{ background: #545b62; }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <div class="code">{code}</div>
                    <h2>Development Server Error</h2>
                </div>
                
                <div class="message">{message}</div>
                
                {debug_info}
                
                <div class="help">
                    <h3>🚀 Troubleshooting Tips</h3>
                    <ul>
                        <li><strong>Check file paths:</strong> Verify that the template file exists at the expected location</li>
                        <li><strong>Validate YAML:</strong> Make sure your .yaml dependency files have valid syntax</li>
                        <li><strong>Test URLs:</strong> Check if remote URLs in dependencies are accessible</li>
                        <li><strong>Clear cache:</strong> Try <code>?build=true&cache=false</code> or visit <a href="/__dev__/clear-cache">/__dev__/clear-cache</a></li>
                        <li><strong>Check console:</strong> Look for detailed error messages in the server console</li>
                        <li><strong>Force rebuild:</strong> Add <code>?build=true</code> to any URL to force template building</li>
                        <li><strong>View stats:</strong> Check <a href="/__dev__/stats">/__dev__/stats</a> for server information</li>
                    </ul>
                    
                    <h3>🔧 Development Endpoints</h3>
                    <ul>
                        <li><code>/__dev__/stats</code> - View build and cache statistics</li>
                        <li><code>/__dev__/clear-cache</code> - Clear all caches</li>
                        <li><code>/__dev__/components</code> - List all available pages and components</li>
                    </ul>
                </div>
                
                <div class="actions">
                    <a href="/" class="btn">🏠 Go Home</a>
                    <a href="javascript:history.back()" class="btn btn-secondary">⬅️ Go Back</a>
                    <a href="/__dev__/stats" class="btn btn-secondary">📊 View Stats</a>
                </div>
            </div>
        </body>
        </html>
        """
        
        self.send_response(code)
        self.send_header('Content-type', 'text/html; charset=utf-8')
        self.end_headers()
        self.wfile.write(error_html.encode('utf-8'))
    
    def log_message(self, format, *args):
        """Enhanced logging with color coding and build indicators"""
        try:
            # Extract information from args
            if len(args) >= 2:
                status = str(args[0])
                path = str(args[1])
            else:
                status = 'unknown'
                path = 'unknown'
            
            # Color code based on status
            if status.startswith('2'):
                status_color = '\033[92m'  # Green
            elif status.startswith('3'):
                status_color = '\033[93m'  # Yellow  
            elif status.startswith('4'):
                status_color = '\033[91m'  # Red
            elif status.startswith('5'):
                status_color = '\033[95m'  # Magenta
            else:
                status_color = '\033[0m'   # Default
            
            # Add indicators for special requests
            indicators = []
            if path.startswith('__dev__/'):
                indicators.append('🛠️')
            if hasattr(self, '_last_build_type'):
                if self._last_build_type == 'page':
                    indicators.append('📄')
                elif self._last_build_type == 'component':
                    indicators.append('📦')
                delattr(self, '_last_build_type')
            
            indicator_str = ''.join(indicators)
            if indicator_str:
                indicator_str = f" {indicator_str}"
            
            # Format and print log message
            timestamp = time.strftime('%H:%M:%S')
            print(f"{status_color}[{status}]\033[0m {timestamp} {path}{indicator_str}")
            
        except Exception:
            # Fallback to simple logging if anything goes wrong
            super().log_message(format, *args)

class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Threaded HTTP server for better performance with multiple requests"""
    daemon_threads = True
    allow_reuse_address = True

def create_handler_class(template_builder, async_builder=None):
    """Factory function to create handler class with builders injected"""
    class HandlerWithBuilders(EnhancedYAMLTemplateHTTPHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, template_builder=template_builder, 
                           async_builder=async_builder, **kwargs)
    
    return HandlerWithBuilders

def start_file_watcher(template_builder, async_builder=None):
    """Start enhanced file watcher"""
    event_handler = EnhancedChangeHandler(template_builder, None)
    observer = Observer()
    observer.schedule(event_handler, str(FRONTEND_DIR), recursive=True)
    observer.start()
    
    print(f"👀 Enhanced file watcher active")
    print(f"📁 Monitoring: {FRONTEND_DIR}")
    print("📝 Watching: .html, .css, .js, .yaml, .yml, image files")
    print("🔧 Smart cache invalidation enabled")
    
    return observer

def print_welcome_info(server_url: str, port: int):
    """Print comprehensive welcome information"""
    print("🚀 Enhanced YAML Dependency-Based Development Server")
    print("=" * 70)
    print(f"🌐 Server URL: {server_url}")
    print(f"📁 Frontend Directory: {FRONTEND_DIR}")
    print()
    
    # Discover and display available pages
    pages_dir = FRONTEND_DIR / "pages"
    if pages_dir.exists():
        print("📄 Available Pages:")
        for page_dir in sorted(pages_dir.iterdir()):
            if page_dir.is_dir():
                page_name = page_dir.name
                html_file = page_dir / "html" / f"{page_name}.html"
                yaml_file = page_dir / f"{page_name}.yaml"
                
                status_indicators = []
                if html_file.exists():
                    status_indicators.append("📄 HTML")
                if yaml_file.exists():
                    status_indicators.append("🔧 YAML")
                
                if status_indicators:
                    friendly_url = f"{server_url}/{page_name.lower()}"
                    direct_url = f"{server_url}/pages/{page_name}/html/{page_name}.html"
                    
                    print(f"   • {page_name}")
                    print(f"     - Friendly: {friendly_url}")
                    print(f"     - Direct:   {direct_url}")
                    print(f"     - Status:   {' | '.join(status_indicators)}")
    
    print()
    print("🔧 Template Building Features:")
    print(f"   • Automatic building for pages/components with YAML dependencies")
    print(f"   • Three component resolution methods (path/group-name/URL)")
    print(f"   • Smart asset management (CSS/JS deduplication & organization)")
    print(f"   • Recursive component dependency resolution")
    print(f"   • API data fetching with caching")
    print(f"   • Circular dependency detection")
    
    print()
    print("🛠️  Development Endpoints:")
    print(f"   • Stats & Info:     {server_url}/__dev__/stats")
    print(f"   • Clear Cache:      {server_url}/__dev__/clear-cache")
    print(f"   • List Components:  {server_url}/__dev__/components")
    
    print()
    print("🎛️  URL Parameters:")
    print(f"   • Force build:      ?build=true")
    print(f"   • Async building:   ?async=true") 
    print(f"   • Inject data:      ?data={{\"key\":\"value\"}}")
    print(f"   • Custom params:    ?title=Custom&user=John")
    
    print()
    print("📋 Example URLs:")
    print(f"   • {server_url}/")
    print(f"   • {server_url}/welcome?title=Custom%20Title")
    print(f"   • {server_url}/welcome?data={{\"user\":{{\"name\":\"John\"}}}}")
    print(f"   • {server_url}/pages/Welcome/html/Welcome.html?build=true&async=true")
    
    print()
    print("🔍 Development Features:")
    print("   • Real-time file watching with smart cache invalidation")
    print("   • Color-coded request logging with build indicators")
    print("   • Comprehensive error pages with debugging information")
    print("   • Build performance timing and statistics")
    print("   • CORS headers for development APIs")
    
    print()
    print("🛑 Press Ctrl+C to stop the server")
    print("=" * 70)

def check_dependencies():
    """Check if all required dependencies are installed"""
    missing = []
    
    required_packages = {
        'yaml': 'pyyaml',
        'aiohttp': 'aiohttp', 
        'requests': 'requests',
        'bs4': 'beautifulsoup4',
        'watchdog': 'watchdog'
    }
    
    for module, package in required_packages.items():
        try:
            __import__(module)
        except ImportError:
            missing.append(package)
    
    if missing:
        print("❌ Missing required dependencies:")
        for dep in missing:
            print(f"   • {dep}")
        print(f"\n💡 Install them with:")
        print(f"   pip install {' '.join(missing)}")
        return False
    
    return True

def create_example_files():
    """Create comprehensive example files if they don't exist"""
    
    # Create Welcome page example if it doesn't exist
    welcome_dir = FRONTEND_DIR / "pages" / "Welcome"
    welcome_html = welcome_dir / "html" / "Welcome.html"
    welcome_yaml = welcome_dir / "Welcome.yaml"
    
    if not welcome_yaml.exists() and welcome_html.exists():
        print("📝 Creating enhanced Welcome page YAML...")
        
        # Enhanced YAML with all features demonstrated
        yaml_content = """# Enhanced YAML Dependencies for Welcome Page
# Demonstrates all three component resolution methods

components:
  # Method 1: Direct relative path (legacy support)
  brand_banner: "../../../components/General/html/brand_banner.html"
  
  # Method 2: Group/name object (preferred for internal components)
  login_button:
    component_group: "Login"
    component_name: "goto_login_btn"
  
  # Method 3: Remote URL (for external widgets)
  # weather_widget: "https://your-widget-service.com/weather.html"

data_dependencies:
  # Example API endpoints (replace with real APIs)
  # company_stats: "https://api.yourcompany.com/stats"
  # user_count: "https://jsonplaceholder.typicode.com/users"
  # daily_quote: "https://api.quotegarden.io/api/v3/quotes/random"

default_data:
  # Default template variables
  page_title: "Welcome - Christy Plumbing & Heating"
  site_name: "Christy Plumbing & Heating"
  welcome_message: "Professional plumbing and heating services you can trust"
  current_year: 2025
  
  # Custom data that can be overridden via URL parameters
  user_name: "Valued Customer"
  show_special_offer: true
  
  # Company information
  company:
    name: "Christy Plumbing & Heating"
    phone: "(555) 123-4567"
    email: "info@christyplumbing.com"
    established: 1995
"""
        
        welcome_yaml.write_text(yaml_content)
        print(f"✅ Created: {welcome_yaml}")
    
    # Create enhanced brand banner component example
    brand_banner_dir = FRONTEND_DIR / "components" / "General"
    brand_banner_yaml = brand_banner_dir / "yaml" / "brand_banner.yaml"
    
    if not brand_banner_yaml.exists():
        brand_banner_yaml.parent.mkdir(exist_ok=True)
        
        component_yaml = """# Brand Banner Component Dependencies
# Example of a component with data dependencies

data_dependencies:
  # Could fetch dynamic company info
  # company_info: "https://api.yourcompany.com/company-info"

default_data:
  logo_src: "/assets/brand-banner.svg"
  logo_alt: "Christy Plumbing & Heating - Professional Services Since 1995"
  company_tagline: "Your Trusted Local Experts"
"""
        
        brand_banner_yaml.write_text(component_yaml)
        print(f"✅ Created: {brand_banner_yaml}")

def main():
    """Enhanced main function with comprehensive setup"""
    global FRONTEND_DIR
    
    # Check dependencies first
    if not check_dependencies():
        sys.exit(1)
    
    # Set up paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    FRONTEND_DIR = project_root / "src" / "frontend"
    
    if not FRONTEND_DIR.exists():
        print(f"❌ Frontend directory not found: {FRONTEND_DIR}")
        print("💡 Make sure you're running this from the correct directory")
        sys.exit(1)
    
    # Configuration
    PORT = int(os.environ.get('DEV_SERVER_PORT', 8000))
    HOST = os.environ.get('DEV_SERVER_HOST', 'localhost')
    USE_ASYNC = os.environ.get('DEV_SERVER_ASYNC', 'true').lower() == 'true'
    
    print("🔧 Initializing Enhanced YAML Template System...")
    
    # Initialize template builders
    try:
        template_builder = YAMLTemplateBuilder(str(FRONTEND_DIR), use_cache=True, timeout=10)
        async_builder = AsyncYAMLTemplateBuilder(str(FRONTEND_DIR), use_cache=True, timeout=10) if USE_ASYNC else None
        
        print("✅ Template builders initialized")
        print(f"🔄 Async building: {'enabled' if async_builder else 'disabled'}")
        
        # Show initial cache stats
        stats = template_builder.get_cache_stats()
        print(f"📊 Initial cache state: {stats['file_cache_size']} files, {stats['url_cache_size']} URLs")
        
    except Exception as e:
        print(f"❌ Failed to initialize template builders: {e}")
        traceback.print_exc()
        sys.exit(1)
    
    # Create example files for demonstration
    try:
        create_example_files()
    except Exception as e:
        print(f"⚠️  Could not create example files: {e}")
    
    # Start file watcher
    observer = None
    try:
        observer = start_file_watcher(template_builder, async_builder)
    except ImportError:
        print("⚠️  Watchdog not available - install for auto-reload: pip install watchdog")
    except Exception as e:
        print(f"⚠️  Could not start file watcher: {e}")
    
    # Create HTTP server with enhanced handler
    try:
        HandlerClass = create_handler_class(template_builder, async_builder)
        
        with ThreadedHTTPServer((HOST, PORT), HandlerClass) as httpd:
            server_url = f"http://{HOST}:{PORT}"
            
            # Print comprehensive welcome information
            print_welcome_info(server_url, PORT)
            
            # Open browser to welcome page
            try:
                webbrowser.open(f"{server_url}/")
            except Exception as e:
                print(f"⚠️  Could not open browser: {e}")
            
            print(f"\n🎯 Server ready and listening on {server_url}")
            print("📡 Waiting for requests...")
            
            # Start serving with graceful error handling
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                print("\n🛑 Graceful shutdown initiated...")
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down server...")
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"❌ Port {PORT} is already in use.")
            print(f"💡 Try setting a different port: DEV_SERVER_PORT=8001 python {sys.argv[0]}")
            print(f"💡 Or stop the existing server on port {PORT}")
        else:
            print(f"❌ Network error: {e}")
    except Exception as e:
        print(f"❌ Unexpected server error: {e}")
        traceback.print_exc()
    finally:
        # Cleanup
        if observer:
            observer.stop()
            observer.join()
            print("🧹 File watcher stopped")
        
        print("✅ Server shutdown complete")

if __name__ == "__main__":
    main()