#!/usr/bin/env python3
"""
YAML Dependency-Based Template Builder
Loads components from URLs and data from API endpoints
"""

import yaml
import requests
import re
import json
import asyncio
import aiohttp
from pathlib import Path
from typing import Dict, Any, Optional, Union
import time
from urllib.parse import urljoin

class YAMLTemplateBuilder:
    """Template builder that uses YAML dependency files"""
    
    def __init__(self, base_path: str = "src/frontend", use_cache: bool = True, timeout: int = 30):
        self.base_path = Path(base_path)
        self.use_cache = use_cache
        self.timeout = timeout
        self.template_pattern = re.compile(r'\{\{([^}]+)\}\}')
        
        # Caches
        self._file_cache = {}
        self._file_times = {}
        self._url_cache = {}
        self._url_cache_times = {}
        self.cache_duration = 300  # 5 minutes for URL cache
        
    def _load_file_with_cache(self, file_path: Path) -> str:
        """Load file with caching based on modification time"""
        if not file_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        
        file_str = str(file_path)
        current_mtime = file_path.stat().st_mtime
        
        if (self.use_cache and 
            file_str in self._file_cache and 
            self._file_times.get(file_str, 0) >= current_mtime):
            return self._file_cache[file_str]
        
        content = file_path.read_text(encoding='utf-8')
        
        if self.use_cache:
            self._file_cache[file_str] = content
            self._file_times[file_str] = current_mtime
        
        return content
    
    def _load_yaml_deps(self, template_path: Path) -> Dict[str, Any]:
        """Load YAML dependencies file for a template based on project structure"""
        # Determine if this is a page or component
        path_parts = template_path.parts
        
        if 'pages' in path_parts:
            # For pages: src/frontend/pages/PageName/html/PageName.html
            # YAML is at: src/frontend/pages/PageName/PageName.yaml
            page_idx = path_parts.index('pages')
            if page_idx + 1 < len(path_parts):
                page_name = path_parts[page_idx + 1]
                page_dir = template_path.parents[1]  # Go up from html/ to PageName/
                deps_file = page_dir / f"{page_name}.yaml"
        elif 'components' in path_parts:
            # For components: src/frontend/components/Group/html/component.html
            # YAML is at: src/frontend/components/Group/yaml/component.yaml
            comp_idx = path_parts.index('components')
            if comp_idx + 2 < len(path_parts):
                group_name = path_parts[comp_idx + 1]
                component_name = template_path.stem
                component_dir = template_path.parents[1]  # Go up from html/ to Group/
                deps_file = component_dir / "yaml" / f"{component_name}.yaml"
        else:
            # Fallback to old behavior for other files
            deps_file = template_path.with_suffix('.deps.yaml')
            if not deps_file.exists():
                deps_file = template_path.with_suffix('.deps.yml')
        
        if not deps_file.exists():
            return {'components': {}, 'data_dependencies': {}}
        
        try:
            deps_content = self._load_file_with_cache(deps_file)
            return yaml.safe_load(deps_content) or {'components': {}, 'data_dependencies': {}}
        except yaml.YAMLError as e:
            print(f"❌ Error parsing YAML deps file {deps_file}: {e}")
            return {'components': {}, 'data_dependencies': {}}
    
    def _fetch_url_with_cache(self, url: str) -> str:
        """Fetch URL content with caching"""
        current_time = time.time()
        
        if (self.use_cache and 
            url in self._url_cache and 
            current_time - self._url_cache_times.get(url, 0) < self.cache_duration):
            return self._url_cache[url]
        
        try:
            print(f"🌐 Fetching: {url}")
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            content = response.text
            
            if self.use_cache:
                self._url_cache[url] = content
                self._url_cache_times[url] = current_time
            
            return content
        except requests.RequestException as e:
            print(f"❌ Error fetching {url}: {e}")
            return f"<!-- Error loading {url}: {e} -->"
    
    def _fetch_data_with_cache(self, url: str) -> Any:
        """Fetch JSON data from URL with caching"""
        current_time = time.time()
        cache_key = f"data:{url}"
        
        if (self.use_cache and 
            cache_key in self._url_cache and 
            current_time - self._url_cache_times.get(cache_key, 0) < self.cache_duration):
            return self._url_cache[cache_key]
        
        try:
            print(f"📊 Fetching data: {url}")
            response = requests.get(url, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            
            if self.use_cache:
                self._url_cache[cache_key] = data
                self._url_cache_times[cache_key] = current_time
            
            return data
        except requests.RequestException as e:
            print(f"❌ Error fetching data from {url}: {e}")
            return {}
        except json.JSONDecodeError as e:
            print(f"❌ Error parsing JSON from {url}: {e}")
            return {}
    
    async def _fetch_url_async(self, session: aiohttp.ClientSession, url: str) -> str:
        """Async fetch URL content"""
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=self.timeout)) as response:
                response.raise_for_status()
                return await response.text()
        except Exception as e:
            print(f"❌ Error fetching {url}: {e}")
            return f"<!-- Error loading {url}: {e} -->"
    
    async def _fetch_data_async(self, session: aiohttp.ClientSession, url: str) -> Any:
        """Async fetch JSON data"""
        try:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=self.timeout)) as response:
                response.raise_for_status()
                return await response.json()
        except Exception as e:
            print(f"❌ Error fetching data from {url}: {e}")
            return {}
    
    def build_template_sync(self, template_path: Union[str, Path], extra_data: Dict[str, Any] = None) -> str:
        """Build template synchronously"""
        if extra_data is None:
            extra_data = {}
        
        full_path = self.base_path / template_path if not Path(template_path).is_absolute() else Path(template_path)
        
        # Load template content
        template_content = self._load_file_with_cache(full_path)
        
        # Load dependencies
        deps = self._load_yaml_deps(full_path)
        
        print(f"🔧 Building template: {template_path}")
        if deps.get('components'):
            print(f"📦 Components: {list(deps['components'].keys())}")
        if deps.get('data_dependencies'):
            print(f"📊 Data dependencies: {list(deps['data_dependencies'].keys())}")
        
        # Fetch components
        component_data = {}
        for component_name, component_url in deps.get('components', {}).items():
            # Handle relative URLs
            if not component_url.startswith(('http://', 'https://')):
                # Resolve relative to template location
                template_dir = full_path.parent
                component_path = (template_dir / component_url).resolve()
                if component_path.exists():
                    component_data[component_name] = self._load_file_with_cache(component_path)
                else:
                    print(f"⚠️  Component file not found: {component_path}")
                    component_data[component_name] = f"<!-- Component not found: {component_url} -->"
            else:
                component_data[component_name] = self._fetch_url_with_cache(component_url)
        
        # Fetch data dependencies
        api_data = {}
        for dep_name, api_url in deps.get('data_dependencies', {}).items():
            data = self._fetch_data_with_cache(api_url)
            # Flatten the data or nest it under the dependency name
            if isinstance(data, dict):
                api_data.update(data)  # Flatten
                api_data[dep_name] = data  # Also nest for specific access
            else:
                api_data[dep_name] = data
        
        # Combine all data
        all_data = {**component_data, **api_data, **extra_data}
        
        # Replace placeholders
        return self._replace_placeholders(template_content, all_data)
    
    async def build_template_async(self, template_path: Union[str, Path], extra_data: Dict[str, Any] = None) -> str:
        """Build template asynchronously (faster for multiple URLs)"""
        if extra_data is None:
            extra_data = {}
        
        full_path = self.base_path / template_path if not Path(template_path).is_absolute() else Path(template_path)
        
        # Load template content
        template_content = self._load_file_with_cache(full_path)
        
        # Load dependencies
        deps = self._load_yaml_deps(full_path)
        
        print(f"🔧 Building template async: {template_path}")
        
        async with aiohttp.ClientSession() as session:
            tasks = []
            component_names = []
            data_names = []
            
            # Prepare component fetch tasks
            for component_name, component_url in deps.get('components', {}).items():
                if component_url.startswith(('http://', 'https://')):
                    tasks.append(self._fetch_url_async(session, component_url))
                    component_names.append(component_name)
                else:
                    # Handle local files immediately
                    template_dir = full_path.parent
                    component_path = (template_dir / component_url).resolve()
                    if component_path.exists():
                        extra_data[component_name] = self._load_file_with_cache(component_path)
                    else:
                        extra_data[component_name] = f"<!-- Component not found: {component_url} -->"
            
            # Prepare data fetch tasks
            for dep_name, api_url in deps.get('data_dependencies', {}).items():
                tasks.append(self._fetch_data_async(session, api_url))
                data_names.append(dep_name)
            
            # Execute all tasks concurrently
            if tasks:
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Process component results
                for i, component_name in enumerate(component_names):
                    result = results[i]
                    if isinstance(result, Exception):
                        extra_data[component_name] = f"<!-- Error loading component: {result} -->"
                    else:
                        extra_data[component_name] = result
                
                # Process data results
                data_start_idx = len(component_names)
                for i, dep_name in enumerate(data_names):
                    result = results[data_start_idx + i]
                    if isinstance(result, Exception):
                        extra_data[dep_name] = {}
                    else:
                        # Flatten and nest data like sync version
                        if isinstance(result, dict):
                            extra_data.update(result)
                            extra_data[dep_name] = result
                        else:
                            extra_data[dep_name] = result
        
        # Replace placeholders
        return self._replace_placeholders(template_content, extra_data)
    
    def _replace_placeholders(self, template: str, data: Dict[str, Any]) -> str:
        """Replace {{placeholder}} with data"""
        def replace_func(match):
            key = match.group(1).strip()
            
            # Handle nested keys like {{user.name}}
            if '.' in key:
                try:
                    keys = key.split('.')
                    value = data
                    for k in keys:
                        value = value[k]
                    return str(value)
                except (KeyError, TypeError):
                    return match.group(0)  # Return original if not found
            else:
                return str(data.get(key, match.group(0)))
        
        return self.template_pattern.sub(replace_func, template)
    
    def clear_cache(self):
        """Clear all caches"""
        self._file_cache.clear()
        self._file_times.clear()
        self._url_cache.clear()
        self._url_cache_times.clear()
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics"""
        return {
            'file_cache_size': len(self._file_cache),
            'url_cache_size': len(self._url_cache),
            'cache_enabled': self.use_cache,
            'cached_files': list(self._file_cache.keys()),
            'cached_urls': [url for url in self._url_cache.keys() if not url.startswith('data:')]
        }

# Example usage
def demo_yaml_builder():
    """Demonstrate the YAML builder"""
    
    # Create example files
    example_dir = Path("example_templates")
    example_dir.mkdir(exist_ok=True)
    
    # Example template
    template_content = """<!DOCTYPE html>
<html>
<head>
    <title>{{title}}</title>
</head>
<body>
    {{header}}
    <main>
        <h1>Welcome {{user.name}}!</h1>
        <p>Today is {{today}}</p>
        <div class="stats">
            <p>Total users: {{stats.total_users}}</p>
            <p>Active users: {{stats.active_users}}</p>
        </div>
    </main>
    {{footer}}
</body>
</html>"""
    
    # Example dependencies
    deps_content = """
components:
  header: "./components/header.html"
  footer: "./components/footer.html"
  # remote_component: "https://example.com/remote-component.html"

data_dependencies:
  user_info: "https://jsonplaceholder.typicode.com/users/1"
  stats: "https://jsonplaceholder.typicode.com/posts"
  # today: "https://worldtimeapi.org/api/timezone/Etc/UTC"
"""
    
    # Write example files
    (example_dir / "page.html").write_text(template_content)
    (example_dir / "page.html.deps.yaml").write_text(deps_content)
    
    # Create example components
    (example_dir / "components").mkdir(exist_ok=True)
    (example_dir / "components" / "header.html").write_text('<header><h1>My Site</h1></header>')
    (example_dir / "components" / "footer.html").write_text('<footer><p>&copy; 2025 My Site</p></footer>')
    
    # Test the builder
    builder = YAMLTemplateBuilder(str(example_dir))
    
    try:
        print("🧪 Testing synchronous build...")
        result = builder.build_template_sync("page.html", {
            "title": "Test Page",
            "today": "2025-06-04"
        })
        print("✅ Sync build completed")
        print(f"📄 Result length: {len(result)} characters")
        
        print("\n🧪 Testing asynchronous build...")
        async def test_async():
            return await builder.build_template_async("page.html", {
                "title": "Test Page (Async)",
                "today": "2025-06-04"
            })
        
        result_async = asyncio.run(test_async())
        print("✅ Async build completed")
        print(f"📄 Result length: {len(result_async)} characters")
        
        # Show cache stats
        print(f"\n📊 Cache stats: {builder.get_cache_stats()}")
        
    except Exception as e:
        print(f"❌ Error during demo: {e}")

if __name__ == "__main__":
    demo_yaml_builder()