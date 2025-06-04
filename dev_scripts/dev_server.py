#!/usr/bin/env python3
"""
Enhanced development server with YAML dependency-based template building
Serves files, watches for changes, and builds templates using YAML configs
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
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler

# Import our YAML template builder
try:
    from yaml_template_builder import YAMLTemplateBuilder
except ImportError:
    print("❌ Could not import yaml_template_builder. Make sure yaml_template_builder.py is in the same directory.")
    print("💡 Also install required dependencies: pip install pyyaml aiohttp requests")
    sys.exit(1)

class ChangeHandler(FileSystemEventHandler):
    def __init__(self, template_builder=None):
        self.last_modified = time.time()
        self.template_builder = template_builder
    
    def on_modified(self, event):
        if event.is_directory:
            return
        
        # Avoid multiple rapid fire events
        now = time.time()
        if now - self.last_modified < 0.5:
            return
        self.last_modified = now
        
        # Watch for relevant file types including YAML deps
        if event.src_path.endswith(('.html', '.css', '.js', '.yaml', '.yml')):
            print(f"📝 File changed: {event.src_path}")
            
            # Clear template cache when files change
            if self.template_builder:
                self.template_builder.clear_cache()
                print("🧹 Template cache cleared")
            
            print("🔄 Refresh your browser to see changes")

class YAMLTemplateHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, template_builder=None, **kwargs):
        self.template_builder = template_builder
        super().__init__(*args, directory=str(FRONTEND_DIR), **kwargs)
    
    def end_headers(self):
        # Add headers to prevent caching during development
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
    
    def do_GET(self):
        """Handle GET requests with YAML template building"""
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path.lstrip('/')
        query_params = urllib.parse.parse_qs(parsed_path.query)
        
        # Check if this is a request that should be built using templates
        if self._should_build_template(path, query_params):
            try:
                content = self._build_and_serve_yaml_template(path, query_params)
                if content:
                    self.send_response(200)
                    self.send_header('Content-type', 'text/html; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(content.encode('utf-8'))
                    return
            except Exception as e:
                print(f"❌ Error building YAML template for {path}: {e}")
                import traceback
                traceback.print_exc()
                self._send_error_page(500, f"YAML Template Building Error: {e}")
                return
        
        # Fall back to default file serving
        super().do_GET()
    
    def _should_build_template(self, path: str, query_params: dict) -> bool:
        """Determine if a path should be built using YAML templates"""
        # Force build if build=true parameter
        if 'build' in query_params and query_params['build'][0].lower() == 'true':
            return True
        
        # Build pages in the pages directory
        if path.startswith('pages/') and path.endswith('.html'):
            # pages/PageName/html/PageName.html -> check pages/PageName/PageName.yaml
            path_parts = path.split('/')
            if len(path_parts) >= 4:  # pages/PageName/html/PageName.html
                page_name = path_parts[1]
                yaml_file = FRONTEND_DIR / "pages" / page_name / f"{page_name}.yaml"
                return yaml_file.exists()
        
        # Build root-level page requests (e.g., /welcome -> /pages/Welcome/html/Welcome.html)
        if ('.' not in path and path and 
            not path.startswith(('assets/', 'css/', 'js/', 'components/', 'static/'))):
            page_name = path.strip('/').title() or 'Welcome'
            yaml_file = FRONTEND_DIR / "pages" / page_name / f"{page_name}.yaml"
            return yaml_file.exists()
        
        return False
    
    def _build_and_serve_yaml_template(self, path: str, query_params: dict) -> str:
        """Build and return YAML template content"""
        if not self.template_builder:
            raise Exception("YAML template builder not available")
        
        # Extract extra data from query parameters
        extra_data = {}
        
        # Handle data parameter (JSON string)
        if 'data' in query_params:
            try:
                extra_data.update(json.loads(query_params['data'][0]))
            except json.JSONDecodeError:
                pass
        
        # Handle individual parameters
        for key, values in query_params.items():
            if key not in ['data', 'build', 'async']:
                extra_data[key] = values[0] if values else ''
        
        # Determine template path
        if path.startswith('pages/'):
            # Direct page path: pages/Welcome/html/Welcome.html
            template_path = path
        elif path == '' or path == '/':
            # Root request - serve Welcome page
            template_path = 'pages/Welcome/html/Welcome.html'
        else:
            # Simple page name: welcome, login, etc.
            page_name = path.strip('/').title()
            template_path = f'pages/{page_name}/html/{page_name}.html'
        
        print(f"🔧 Building YAML template: {template_path}")
        print(f"📊 Extra data: {extra_data}")
        
        # Check if we should use async building
        use_async = query_params.get('async', ['false'])[0].lower() == 'true'
        
        if use_async:
            # Run async build in a new event loop
            return self._run_async_build(template_path, extra_data)
        else:
            # Use synchronous build
            return self.template_builder.build_template_sync(template_path, extra_data)
    
    def _run_async_build(self, template_path: str, extra_data: dict) -> str:
        """Run async template build in a new event loop"""
        try:
            # Create new event loop for this thread
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                return loop.run_until_complete(
                    self.template_builder.build_template_async(template_path, extra_data)
                )
            finally:
                loop.close()
        except Exception as e:
            print(f"❌ Async build failed, falling back to sync: {e}")
            return self.template_builder.build_template_sync(template_path, extra_data)
    
    def _send_error_page(self, code: int, message: str):
        """Send a formatted error page"""
        error_html = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <title>Error {code}</title>
            <style>
                body {{ font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }}
                .error {{ 
                    color: #d32f2f; background: #ffebee; padding: 20px; 
                    border-radius: 8px; border-left: 4px solid #d32f2f;
                    max-width: 800px; margin: 0 auto;
                }}
                .code {{ font-size: 24px; font-weight: bold; margin-bottom: 10px; }}
                .message {{ margin-top: 10px; font-family: monospace; }}
                .help {{ margin-top: 20px; color: #666; }}
            </style>
        </head>
        <body>
            <div class="error">
                <div class="code">Error {code}</div>
                <div class="message">{message}</div>
                <div class="help">
                    <p><strong>Tips:</strong></p>
                    <ul>
                        <li>Check if the .deps.yaml file exists for this template</li>
                        <li>Verify all URLs in the dependencies are accessible</li>
                        <li>Check the console for detailed error messages</li>
                        <li>Try adding ?build=false to serve the raw file</li>
                    </ul>
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
        """Custom log format with color coding"""
        try:
            path = args[1] if len(args) > 1 else 'unknown'
            status = args[0] if len(args) > 0 else 'unknown'
            
            # Color code status
            if status.startswith('2'):
                status_color = '\033[92m'  # Green
            elif status.startswith('3'):
                status_color = '\033[93m'  # Yellow
            elif status.startswith('4') or status.startswith('5'):
                status_color = '\033[91m'  # Red
            else:
                status_color = '\033[0m'   # Default
            
            # Add template building indicator
            template_indicator = ""
            if hasattr(self, '_last_was_template_build') and self._last_was_template_build:
                template_indicator = " 🔧"
                self._last_was_template_build = False
            
            print(f"{status_color}[{status}]\033[0m {path}{template_indicator}")
        except:
            # Fallback to simple logging if anything goes wrong
            super().log_message(format, *args)

class ThreadedHTTPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Threaded HTTP server for better performance"""
    daemon_threads = True
    allow_reuse_address = True

def create_handler_class(template_builder):
    """Create a handler class with the template builder injected"""
    class HandlerWithYAMLBuilder(YAMLTemplateHTTPHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, template_builder=template_builder, **kwargs)
    
    return HandlerWithYAMLBuilder

def start_file_watcher(template_builder):
    """Start watching for file changes"""
    event_handler = ChangeHandler(template_builder)
    observer = Observer()
    observer.schedule(event_handler, str(FRONTEND_DIR), recursive=True)
    observer.start()
    print(f"👀 Watching for changes in {FRONTEND_DIR}")
    print("📝 Watching: .html, .css, .js, .yaml, .yml files")
    return observer

def print_welcome_info(server_url: str, port: int):
    """Print welcome information and available endpoints"""
    print("🚀 YAML Dependency-Based Development Server")
    print("=" * 60)
    print(f"🌐 Server running at: {server_url}")
    print(f"📁 Serving files from: {FRONTEND_DIR}")
    print()
    print("📄 Available pages:")
    print(f"   • Welcome page: {server_url}/")
    print(f"   • Welcome page: {server_url}/welcome")
    print(f"   • Any page: {server_url}/[page-name]")
    print()
    print("🔧 YAML Template building:")
    print(f"   • Automatic: Pages with .deps.yaml files are auto-built")
    print(f"   • Force build: {server_url}/any-page?build=true")
    print(f"   • With data: {server_url}/welcome?data={{\"title\":\"Custom Title\"}}")
    print(f"   • With params: {server_url}/welcome?site_name=Custom&button_text=Sign In")
    print(f"   • Async build: {server_url}/welcome?async=true")
    print()
    print("📋 YAML Dependencies:")
    print("   • Create [template].deps.yaml files alongside your templates")
    print("   • Components: Local files or remote URLs")
    print("   • Data: API endpoints that return JSON")
    print("   • See example files for syntax")
    print()
    print("🛠️  Development features:")
    print("   • Auto-reload on file changes")
    print("   • Template and URL caching")
    print("   • Async building for multiple API calls")
    print("   • Detailed error pages")
    print()
    print("🛑 Press Ctrl+C to stop the server")
    print("=" * 60)

def check_dependencies():
    """Check if required dependencies are installed"""
    missing = []
    
    try:
        import yaml
    except ImportError:
        missing.append("pyyaml")
    
    try:
        import aiohttp
    except ImportError:
        missing.append("aiohttp")
    
    try:
        import requests
    except ImportError:
        missing.append("requests")
    
    if missing:
        print("❌ Missing required dependencies:")
        for dep in missing:
            print(f"   • {dep}")
        print("\n💡 Install them with:")
        print(f"   pip install {' '.join(missing)}")
        return False
    
    return True

def create_example_yaml_files():
    """Create example YAML dependency files if they don't exist"""
    welcome_page_dir = FRONTEND_DIR / "pages" / "Welcome"
    welcome_html = welcome_page_dir / "html" / "Welcome.html"
    welcome_yaml = welcome_page_dir / "Welcome.yaml"  # Correct location per your structure
    
    if welcome_html.exists() and not welcome_yaml.exists():
        print("📝 Creating example YAML dependency file...")
        
        deps_content = """# YAML dependencies for Welcome page
components:
  brand_banner: "../components/General/html/brand_banner.html"
  login_button: "../components/Login/html/goto_login_btn.html"

data_dependencies:
  # Example API calls (these URLs are examples - replace with real APIs)
  # weather: "https://api.openweathermap.org/data/2.5/weather?q=London&appid=YOUR_API_KEY"
  # company_stats: "https://jsonplaceholder.typicode.com/posts/1"

default_data:
  title: "Welcome - Christy Plumbing & Heating"
  page_name: "Welcome"
  site_name: "Christy Plumbing & Heating"
  button_text: "Login"
  main_content: |
    <div class="container">
        <section class="section text-center">
            <h1>Welcome to {{site_name}}</h1>
            <p class="text-gray">Professional plumbing and heating services you can trust.</p>
            <p>Today's date: {{today}}</p>
        </section>
    </div>
"""
        
        welcome_yaml.write_text(deps_content)
        print(f"✅ Created: {welcome_yaml}")
        print("💡 Edit this file to customize your page dependencies")
        
    # Also check if we should create a component example
    brand_banner_html = FRONTEND_DIR / "components" / "General" / "html" / "brand_banner.html"
    brand_banner_yaml = FRONTEND_DIR / "components" / "General" / "yaml" / "brand_banner.yaml"
    
    if brand_banner_html.exists() and not brand_banner_yaml.exists():
        # Create the yaml directory if it doesn't exist
        brand_banner_yaml.parent.mkdir(exist_ok=True)
        
        component_deps = """# YAML dependencies for brand_banner component
components:
  # No sub-components for this basic component

data_dependencies:
  # Could fetch logo URL or company info from API
  # company_info: "https://api.yourcompany.com/company-info"

default_data:
  logo_src: "/assets/brand-banner.svg"
  logo_alt: "Christy Plumbing & Heating Logo"
"""
        
        brand_banner_yaml.write_text(component_deps)
        print(f"✅ Created: {brand_banner_yaml}")
        print("💡 Component YAML files go in the yaml/ subdirectory")

def main():
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
        sys.exit(1)
    
    # Configuration
    PORT = 8000
    HOST = 'localhost'
    
    # Initialize YAML template builder
    print("🔧 Initializing YAML template builder...")
    try:
        template_builder = YAMLTemplateBuilder(str(FRONTEND_DIR), use_cache=True, timeout=10)
        print("✅ YAML template builder ready")
        
        # Show cache stats
        stats = template_builder.get_cache_stats()
        print(f"📊 Cache: {stats['file_cache_size']} files, {stats['url_cache_size']} URLs")
        
    except Exception as e:
        print(f"❌ Failed to initialize YAML template builder: {e}")
        sys.exit(1)
    
    # Create example files if needed
    create_example_yaml_files()
    
    # Start file watcher in a separate thread
    try:
        observer = start_file_watcher(template_builder)
    except ImportError:
        print("⚠️  Install 'watchdog' for auto-reload: pip install watchdog")
        observer = None
    
    # Create custom handler class with template builder
    HandlerClass = create_handler_class(template_builder)
    
    # Start HTTP server
    try:
        with ThreadedHTTPServer((HOST, PORT), HandlerClass) as httpd:
            server_url = f"http://{HOST}:{PORT}"
            
            print_welcome_info(server_url, PORT)
            
            # Open browser to welcome page
            webbrowser.open(f"{server_url}/")
            
            # Start serving
            httpd.serve_forever()
            
    except KeyboardInterrupt:
        print("\n🛑 Shutting down server...")
        if observer:
            observer.stop()
            observer.join()
        print("✅ Server stopped")
    except OSError as e:
        if "Address already in use" in str(e):
            print(f"❌ Port {PORT} is already in use. Try a different port or stop the existing server.")
        else:
            print(f"❌ Error starting server: {e}")
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        if observer:
            observer.stop()
            observer.join()

if __name__ == "__main__":
    main()